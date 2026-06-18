/**
 * TTS 听书功能主入口 —— 编排器
 * 在微信读书页面上下文中运行，协调：文本提取 → 分片 → TTS 引擎 → UI 控制 → 状态持久化
 *
 * 改进：
 * - PlaybackStore 不再存全文，改用 textHash 验证
 * - 断点续播时重新从页面提取文本并分片
 * - 增加 onError 回调，UI 展示错误提示
 * - 启动时检测 speechSynthesis 可用性
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

    // 初始化语音列表（异步加载）
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
    if (!avail.supported) {
      this.ui.showError(avail.message);
      return;
    }
    if (!avail.hasChineseVoice && this.settings.showFallbackHint) {
      this.ui.showError(avail.message);
    }
  }

  /** 初始化可用语音列表 */
  private initVoices(): void {
    const loadVoices = () => {
      const voices = WebTTSEngine.getChineseVoices();
      if (voices.length > 0) {
        this.ui.populateVoices(voices, this.settings.voiceName);
        // 如果有保存的音色，自动设置
        if (this.settings.voiceName) {
          const match = voices.find((v) => v.name === this.settings.voiceName);
          if (match) this.engine.voice = match;
        }
        // 有中文语音后清除错误提示
        this.ui.hideError();
      }
    };

    // Chrome 需要等 voiceschanged 事件
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = loadVoices;
    }
    // 立即尝试一次（某些浏览器已就绪）
    loadVoices();
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
      // 开始新朗读
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

    // 清除之前的错误提示
    this.ui.hideError();

    // 检查是否有断点可恢复
    if (this.settings.autoExtract) {
      const saved = PlaybackStore.load(this.bookId);
      if (saved && saved.chunkIndex > 0 && saved.chunkIndex < this.currentChunks.length) {
        // 验证章节文本是否变更
        const isSameChapter = PlaybackStore.matchesSavedState(this.bookId, content.text);
        if (isSameChapter) {
          if (confirm(`检测到上次在「${saved.chapterTitle}」第 ${saved.chunkIndex} 段停止，是否继续？`)) {
            this.resumeFrom(saved);
            return;
          }
        } else {
          // 章节已变更，清除旧断点
          PlaybackStore.clear(this.bookId);
        }
      }
    }

    // 正常开始
    this.startNew(content, this.currentChunks.map((c) => c.text));
  }

  /**
   * 从断点恢复播放
   * 改进：不再从 localStorage 读取全文，而是重新从页面提取
   */
  private resumeFrom(state: NonNullable<ReturnType<typeof PlaybackStore.load>>): void {
    // 使用当前已提取的文本（刚从页面提取的）
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
    // 清除断点
    if (this.bookId) PlaybackStore.clear(this.bookId);
  }

  private onEngineError(chunkIndex: number, error: string): void {
    // 只对关键错误显示提示（跳过 canceled/interrupted 等正常中断）
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
    // 传入 text 用于计算 hash，不再存储原文
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
    // 使用 URL + 章节标题生成唯一 ID
    try {
      return `book_${location.hostname}_${btoa(content.chapterTitle).slice(0, 16)}`;
    } catch {
      return `book_${Date.now()}`;
    }
  }

  /** 关闭播放器（公开方法，供外部调用） */
  close(): void {
    this.engine.cancel();
    this.ui.hide();
    this.ui.hideSettings();
  }
}

// ---- 启动入口 ----
let playerInstance: TTSPlayer | null = null;

/**
 * 初始化/获取 TTS 播放器实例（单例）
 */
export function initTTS(): TTSPlayer {
  if (!playerInstance) {
    playerInstance = new TTSPlayer();
  }
  return playerInstance;
}

/**
 * 销毁 TTS 播放器
 */
export function destroyTTS(): void {
  if (playerInstance) {
    playerInstance.close();
    playerInstance = null;
  }
}
