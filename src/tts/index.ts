/**
 * TTS 听书功能主入口 —— 编排器
 * 在微信读书页面上下文中运行，协调：文本提取 → 分片 → TTS 引擎 → UI 控制 → 状态持久化
 *
 * 改进：
 * - PlaybackStore 不再存全文，改用 textHash 验证
 * - 断点续播时重新从页面提取文本并分片
 * - 增加 onError 回调，UI 展示错误提示
 * - 启动时检测 speechSynthesis 可用性
 * - "从这里开始朗读" 选区浮动按钮
 * - 更健壮的 initVoices（onvoiceschanged + fallback timeout）
 */

import { WebTTSEngine } from './WebTTSEngine';
import { TextExtractor, ExtractedContent } from './TextExtractor';
import { TextChunker, ChunkInfo } from './TextChunker';
import { PlaybackStore, TTSSettings, SettingsStore, DEFAULT_SETTINGS } from './PlaybackStore';
import { PlayerUI } from './PlayerUI';

export class TTSPlayer {
  private engine: WebTTSEngine;
  private ui: PlayerUI;
  private settings: TTSSettings = DEFAULT_SETTINGS;
  private currentContent: ExtractedContent | null = null;
  private currentChunks: ChunkInfo[] = [];
  private bookId = '';
  private _availability: { supported: boolean; hasChineseVoice: boolean } = { supported: false, hasChineseVoice: false };

  constructor() {
    this.engine = new WebTTSEngine();
    this.ui = new PlayerUI({
      onPlayPause: () => this.togglePlay(),
      onPrevious: () => this.previous(),
      onNext: () => this.next(),
      onRateChange: (rate) => this.setRate(rate),
      onVoiceChange: (name) => this.setVoice(name),
      onClose: () => this.close(),
      onExtractClick: () => this.extractAndPlay(),
      onStartFromSelection: (selText) => this.startFromSelection(selText),
    });

    // 加载保存的设置
    this.settings = SettingsStore.load();
    this.engine.rate = this.settings.rate;

    // 绑定引擎回调（含 onError）
    this.engine.setCallbacks({
      onChunkEnd: (index) => this.onChunkEnd(index),
      onAllEnd: () => this.onAllEnd(),
      onError: (chunkIndex, error) => this.onEngineError(chunkIndex, error),
    });

    // 初始化语音列表（异步加载 + fallback timeout）
    this.initVoices();

    // 显示播放器
    this.ui.show();
    this.ui.rateValue = this.settings.rate;

    // 启动时检测可用性
    this.checkAvailability();

    console.log('[TTS] 微信读书听书功能已加载');
  }

  /** 检测 Web Speech API 可用性并给出提示 */
  private checkAvailability(): void {
    const avail = WebTTSEngine.checkAvailability();
    this._availability = { supported: avail.supported, hasChineseVoice: avail.hasChineseVoice };

    if (!avail.supported) {
      this.ui.showError(avail.message);
      this.disablePlayback();
      return;
    }
    if (!avail.hasChineseVoice) {
      // 语音可能稍后异步加载，先不立即禁用
      console.warn('[TTS] ' + avail.message);
    }
  }

  /** 禁用播放按钮（当 TTS 完全不可用时） */
  private disablePlayback(): void {
    const playBtn = document.querySelector('#wx-read-tts-player .tts-play-btn') as HTMLElement;
    if (playBtn) {
      playBtn.style.opacity = '0.4';
      playBtn.style.pointerEvents = 'none';
    }
  }

  /** 启用播放按钮 */
  private enablePlayback(): void {
    const playBtn = document.querySelector('#wx-read-tts-player .tts-play-btn') as HTMLElement;
    if (playBtn) {
      playBtn.style.opacity = '1';
      playBtn.style.pointerEvents = 'auto';
    }
  }

  /** 初始化可用语音列表（更健壮：onvoiceschanged + fallback timeout） */
  private initVoices(): void {
    let voicesLoaded = false;

    const loadVoices = () => {
      const voices = WebTTSEngine.getChineseVoices();
      if (voices.length > 0) {
        voicesLoaded = true;
        this.ui.populateVoices(voices, this.settings.voiceName);
        if (this.settings.voiceName) {
          const match = voices.find((v) => v.name === this.settings.voiceName);
          if (match) this.engine.voice = match;
        }
        this.ui.hideError();
        this._availability.hasChineseVoice = true;
        this.enablePlayback();
        console.log('[TTS] 已加载', voices.length, '个中文语音');
      } else if (!voicesLoaded) {
        // 仍无中文语音，但 API 可用
        console.warn('[TTS] getVoices() 返回空，等待异步加载...');
      }
    };

    // Chrome 需要等 voiceschanged 事件
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = loadVoices;
    }
    // 立即尝试一次（某些浏览器已就绪）
    loadVoices();

    // Fallback：延迟 200ms 和 1000ms 再试一次（防止 onvoiceschanged 不触发）
    setTimeout(loadVoices, 200);
    setTimeout(loadVoices, 1000);
    // 最终兜底：3s 后如果仍无中文语音，显示提示
    setTimeout(() => {
      if (!voicesLoaded) {
        const voices = WebTTSEngine.getChineseVoices();
        if (voices.length === 0) {
          this.ui.showError('本机未检测到中文语音，朗读功能不可用。请在系统设置中安装中文语音包，或联系管理员配置云端 TTS。');
          this.disablePlayback();
        }
      }
    }, 3000);
  }

  // ---- 播放控制 ----

  private togglePlay(): void {
    if (this.engine.isPlaying && !this.engine.isPaused) {
      this.engine.pause();
      this.ui.playing = false;
    } else if (this.engine.isPaused) {
      this.engine.resume();
      this.ui.playing = true;
    } else {
      this.extractAndPlay();
    }
  }

  private previous(): void {
    if (this.engine.previous()) {
      this.saveProgress();
      this.updateUIPosition();
    }
  }

  private next(): void {
    if (this.engine.next()) {
      this.saveProgress();
      this.updateUIPosition();
    }
  }

  private setRate(rate: number): void {
    this.engine.rate = rate;
    this.settings.rate = rate;
    this.ui.rateValue = rate;
    SettingsStore.save({ rate });
  }

  private setVoice(name: string | null): void {
    const voices = speechSynthesis.getVoices();
    const match = name ? voices.find((v) => v.name === name) : null;
    this.engine.voice = match || null;
    this.settings.voiceName = name;
    SettingsStore.save({ voiceName: name });
  }

  // ---- 文本提取与播放 ----

  /**
   * 提取页面文本并开始朗读
   */
  extractAndPlay(): void {
    const content = TextExtractor.extract();
    if (!content) {
      this.ui.showError('未能提取到文本内容，请确保已在阅读页面打开一本书。');
      return;
    }

    this.currentContent = content;
    this.currentChunks = TextChunker.chunk(content.text);
    this.bookId = this.generateBookId(content);

    this.ui.hideError();

    // 检查是否有断点可恢复
    if (this.settings.autoExtract) {
      const saved = PlaybackStore.load(this.bookId);
      if (saved && saved.chunkIndex > 0 && saved.chunkIndex < this.currentChunks.length) {
        const isSameChapter = PlaybackStore.matchesSavedState(this.bookId, content.text);
        if (isSameChapter) {
          if (confirm(`检测到上次在「${saved.chapterTitle}」第 ${saved.chunkIndex} 段停止，是否继续？`)) {
            this.resumeFrom(saved);
            return;
          }
        } else {
          PlaybackStore.clear(this.bookId);
        }
      }
    }

    this.startNew(content, this.currentChunks.map((c) => c.text));
  }

  /**
   * 从选中文本位置开始朗读
   * 优先使用 Range API 精确计算选区在正文容器内的字符偏移，
   * 比 indexOf 更可靠（正确处理 DOM text node 分割、空格差异等）
   * 若选区不在正文容器内，退回用文本模糊匹配
   */
  startFromSelection(selectedText: string): void {
    if (!selectedText) return;

    const content = TextExtractor.extract();
    if (!content) {
      this.ui.showError('未能提取到文本内容，请确保已在阅读页面打开一本书。');
      return;
    }

    this.currentContent = content;
    this.currentChunks = TextChunker.chunk(content.text);
    this.bookId = this.generateBookId(content);
    const chunks = this.currentChunks.map((c) => c.text);

    // 1. 优先用 Range API 精确计算选区在正文容器内的字符偏移
    const contentEl = TextExtractor.findContentElement();
    const domOffset = TextExtractor.getSelectionOffsetInContainer(contentEl);

    let charIndex = -1;
    if (domOffset >= 0) {
      // 选区在正文容器内，直接用 DOM 偏移
      charIndex = domOffset;
      console.log(`[TTS] Range API 定位: domOffset=${domOffset}`);
    } else {
      // 2. 选区不在正文容器内，退回用文本模糊匹配
      const fullText = content.text;
      charIndex = fullText.indexOf(selectedText);
      if (charIndex === -1 && selectedText.length > 10) {
        const prefix = selectedText.slice(0, Math.min(60, selectedText.length));
        charIndex = fullText.indexOf(prefix);
      }
      if (charIndex >= 0) {
        console.log(`[TTS] 文本模糊匹配定位: charIndex=${charIndex}`);
      }
    }

    // 3. 仍找不到，从头开始
    if (charIndex === -1) {
      console.warn('[TTS] 无法精确定位选区在正文中的偏移，已从当前章节开头开始朗读');
      this.engine.speak(content.text);
      this.ui.chapterTitle = content.chapterTitle;
      this.ui.totalChunks = this.engine.totalChunks;
      this.ui.currentIndex = 0;
      this.ui.playing = true;
      return;
    }

    // 4. 把 charIndex 映射到 chunkIndex
    let chunkIndex = 0;
    let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
      if (charIndex >= offset && charIndex < offset + chunks[i].length) {
        chunkIndex = i;
        break;
      }
      offset += chunks[i].length;
    }

    console.log(`[TTS] 从选区开始朗读: charIndex=${charIndex}, chunkIndex=${chunkIndex}`);
    this.engine.speakFrom(chunkIndex, chunks);
    this.ui.chapterTitle = content.chapterTitle;
    this.ui.totalChunks = chunks.length;
    this.ui.currentIndex = chunkIndex;
    this.ui.playing = true;
  }

  /**
   * 从断点恢复播放
   */
  private resumeFrom(state: NonNullable<ReturnType<typeof PlaybackStore.load>>): void {
    const chunks = this.currentChunks.map((c) => c.text);
    this.engine.speakFrom(state.chunkIndex, chunks);
    this.ui.chapterTitle = state.chapterTitle;
    this.ui.totalChunks = chunks.length;
    this.ui.currentIndex = state.chunkIndex;
    this.ui.playing = true;
    this.engine.rate = state.rate || this.settings.rate;
  }

  /**
   * 开始新的朗读
   */
  private startNew(content: ExtractedContent, chunks: string[]): void {
    this.engine.speak(content.text);
    this.ui.chapterTitle = content.chapterTitle;
    this.ui.totalChunks = this.engine.totalChunks;
    this.ui.currentIndex = 0;
    this.ui.playing = true;
  }

  // ---- 回调 ----

  private onChunkEnd(index: number): void {
    this.ui.currentIndex = index;
    this.saveProgress();
  }

  private onAllEnd(): void {
    this.ui.playing = false;
    this.ui.currentIndex = 0;
    if (this.bookId) PlaybackStore.clear(this.bookId);
  }

  private onEngineError(chunkIndex: number, error: string): void {
    if (error === 'canceled' || error === 'interrupted') return;
    if (error.includes('中文语音') || error.includes('不支持')) {
      this.ui.showError(error);
    } else {
      this.ui.showError(`朗读出错（第${chunkIndex}段）：${error}`);
    }
  }

  private updateUIPosition(): void {
    this.ui.currentIndex = this.engine.currentIndex;
  }

  // ---- 持久化 ----

  private saveProgress(): void {
    if (!this.bookId || !this.currentContent) return;
    PlaybackStore.save({
      bookId: this.bookId,
      chapterTitle: this.currentContent.chapterTitle,
      chapterIndex: this.currentContent.chapterIndex,
      chunkIndex: this.engine.currentIndex,
      rate: this.engine.rate,
      voiceName: this.settings.voiceName,
    }, this.currentContent.text);
  }

  private generateBookId(content: ExtractedContent): string {
    try {
      return `book_${location.hostname}_${btoa(content.chapterTitle).slice(0, 16)}`;
    } catch {
      return `book_${Date.now()}`;
    }
  }

  /** 关闭播放器 */
  close(): void {
    this.engine.cancel();
    this.ui.hide();
    this.ui.hideSettings();
  }
}

// ---- 启动入口 ----
let playerInstance: TTSPlayer | null = null;

export function initTTS(): TTSPlayer {
  if (!playerInstance) {
    playerInstance = new TTSPlayer();
  }
  return playerInstance;
}

export function destroyTTS(): void {
  if (playerInstance) {
    playerInstance.close();
    playerInstance = null;
  }
}
