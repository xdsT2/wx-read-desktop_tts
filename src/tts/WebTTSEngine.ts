/**
 * Web Speech API TTS 引擎封装
 * 支持：播放/暂停/恢复/停止、语速调节、音色选择、逐段朗读回调
 * 改进：增加可用性检测、错误回调、中文语音回退提示、debug 日志
 */

export interface TTSAvailability {
  supported: boolean;       // speechSynthesis API 是否存在
  hasChineseVoice: boolean; // 是否有中文语音
  voices: SpeechSynthesisVoice[]; // 所有中文语音
  allVoices: SpeechSynthesisVoice[]; // 所有语音
  message: string;          // 可读的状态描述
}

const DEBUG = true;
function log(...args: any[]): void { if (DEBUG) console.log('[TTS Engine]', ...args); }
function warn(...args: any[]): void { if (DEBUG) console.warn('[TTS Engine]', ...args); }

export class WebTTSEngine {
  private utterance: SpeechSynthesisUtterance | null = null;
  private currentChunkIndex = 0;
  private chunks: string[] = [];
  private _rate = 1;
  private _voice: SpeechSynthesisVoice | null = null;
  private _isPlaying = false;
  private _isPaused = false;
  private onChunkEnd?: (index: number) => void;
  private onAllEnd?: () => void;
  private onError?: (chunkIndex: number, error: string) => void;

  /**
   * 检测 Web Speech API 的可用性
   * 返回详细的可用性报告，包括中文语音检测
   */
  static checkAvailability(): TTSAvailability {
    if (!('speechSynthesis' in window)) {
      return {
        supported: false,
        hasChineseVoice: false,
        voices: [],
        allVoices: [],
        message: '当前浏览器不支持 Web Speech API。请考虑升级浏览器或使用云端 TTS 服务。',
      };
    }

    const allVoices = speechSynthesis.getVoices();
    const chineseVoices = allVoices.filter(
      (v) => v.lang.startsWith('zh') || v.lang.includes('CN')
    );

    if (chineseVoices.length === 0) {
      return {
        supported: true,
        hasChineseVoice: false,
        voices: [],
        allVoices,
        message: 'Web Speech API 可用，但未检测到中文语音。请在系统设置中安装中文语音包，或切换到云端 TTS。',
      };
    }

    return {
      supported: true,
      hasChineseVoice: true,
      voices: chineseVoices,
      allVoices,
      message: `Web Speech API 可用，检测到 ${chineseVoices.length} 个中文语音。`,
    };
  }

  /** 获取系统可用中文语音列表 */
  static getChineseVoices(): SpeechSynthesisVoice[] {
    return speechSynthesis.getVoices().filter(
      (v) => v.lang.startsWith('zh') || v.lang.includes('CN')
    );
  }

  get rate(): number {
    return this._rate;
  }

  set rate(v: number) {
    this._rate = Math.max(0.25, Math.min(4, v));
    if (this.utterance) this.utterance.rate = this._rate;
  }

  get voice(): SpeechSynthesisVoice | null {
    return this._voice;
  }

  set voice(v: SpeechSynthesisVoice | null) {
    this._voice = v;
  }

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  get isPaused(): boolean {
    return this._isPaused;
  }

  get currentIndex(): number {
    return this.currentChunkIndex;
  }

  get totalChunks(): number {
    return this.chunks.length;
  }

  /**
   * 设置事件回调
   */
  setCallbacks(opts: {
    onChunkEnd?: (index: number) => void;
    onAllEnd?: () => void;
    onError?: (chunkIndex: number, error: string) => void;
  }): void {
    this.onChunkEnd = opts.onChunkEnd;
    this.onAllEnd = opts.onAllEnd;
    this.onError = opts.onError;
  }

  /**
   * 开始朗读文本（自动分片后逐段播放）
   */
  speak(text: string): void {
    if (!('speechSynthesis' in window)) {
      const msg = '浏览器不支持 Web Speech API，无法朗读。请切换到云端 TTS 服务。';
      console.error('[TTS] ' + msg);
      this.onError?.(0, msg);
      return;
    }

    // 检测中文语音
    const chineseVoices = WebTTSEngine.getChineseVoices();
    if (chineseVoices.length === 0 && !this._voice) {
      warn('未检测到中文语音，将使用默认语音（可能无法正确朗读中文）');
      this.onError?.(0, '未检测到中文语音，朗读效果可能不佳。建议安装中文语音包或切换云端 TTS。');
    }

    this.cancel();
    this.chunks = this.splitIntoChunks(text);
    this.currentChunkIndex = 0;
    this._isPlaying = true;
    this._isPaused = false;
    log('开始朗读，共', this.chunks.length, '段');
    this.speakCurrentChunk();
  }

  /**
   * 从指定片段索引继续播放（用于断点续播 / 从选区开始）
   */
  speakFrom(chunkIndex: number, chunks: string[]): void {
    this.cancel();
    this.chunks = chunks;
    this.currentChunkIndex = chunkIndex;
    this._isPlaying = true;
    this._isPaused = false;
    log('从第', chunkIndex, '段开始朗读，共', chunks.length, '段');
    this.speakCurrentChunk();
  }

  /** 暂停 */
  pause(): void {
    if (speechSynthesis.speaking && !speechSynthesis.paused) {
      speechSynthesis.pause();
      this._isPaused = true;
      log('已暂停');
    }
  }

  /** 恢复 */
  resume(): void {
    if (speechSynthesis.paused) {
      speechSynthesis.resume();
      this._isPaused = false;
      log('已恢复');
    }
  }

  /** 停止并清除 */
  cancel(): void {
    speechSynthesis.cancel();
    this.utterance = null;
    this._isPlaying = false;
    this._isPaused = false;
  }

  /** 跳到上一段 */
  previous(): boolean {
    if (this.currentChunkIndex > 0) {
      this.currentChunkIndex--;
      this.speakCurrentChunk();
      return true;
    }
    return false;
  }

  /** 跳到下一段 */
  next(): boolean {
    if (this.currentChunkIndex < this.chunks.length - 1) {
      this.currentChunkIndex++;
      this.speakCurrentChunk();
      return true;
    }
    return false;
  }

  /** 内部：播放当前片段 */
  private speakCurrentChunk(): void {
    if (this.currentChunkIndex >= this.chunks.length) {
      this._isPlaying = false;
      log('全部片段朗读完毕');
      this.onAllEnd?.();
      return;
    }

    const text = this.chunks[this.currentChunkIndex];
    if (!text || !text.trim()) {
      this.currentChunkIndex++;
      this.speakCurrentChunk();
      return;
    }

    this.utterance = new SpeechSynthesisUtterance(text);
    this.utterance.rate = this._rate;
    this.utterance.volume = 1; // 确保音量最大
    this.utterance.lang = 'zh-CN';
    if (this._voice) this.utterance.voice = this._voice;

    log(`朗读第 ${this.currentChunkIndex + 1}/${this.chunks.length} 段: "${text.slice(0, 30)}..."`);

    this.utterance.onstart = () => {
      log(`第 ${this.currentChunkIndex} 段 onstart 触发`);
    };

    this.utterance.onend = () => {
      log(`第 ${this.currentChunkIndex} 段 onend 触发`);
      this.currentChunkIndex++;
      this.onChunkEnd?.(this.currentChunkIndex);
      if (this._isPlaying && !this._isPaused) {
        this.speakCurrentChunk();
      }
    };

    this.utterance.onerror = (event) => {
      warn(`第 ${this.currentChunkIndex} 段 onerror: ${event.error}`);
      this.onError?.(this.currentChunkIndex, event.error);
      if (event.error !== 'canceled' && event.error !== 'interrupted') {
        this.currentChunkIndex++;
        if (this._isPlaying && !this._isPaused) {
          this.speakCurrentChunk();
        }
      }
    };

    speechSynthesis.speak(this.utterance);
  }

  /**
   * 将长文本按中文标点分片
   * 按句号、问号、感叹号、换行切分，每片不超过 maxChars 字符
   */
  private splitIntoChunks(text: string, maxChars = 300): string[] {
    const pattern = /.*?[。！？\n]|.+$/gs;
    const matches = Array.from(text.matchAll(pattern));
    const chunks: string[] = [];
    let buffer = '';

    for (const match of matches) {
      const sentence = match[0];
      if (!sentence) continue;
      const trimmed = sentence.trim();
      if (!trimmed) continue;

      if (trimmed.length > maxChars) {
        if (buffer.trim()) { chunks.push(buffer.trim()); buffer = ''; }
        for (let i = 0; i < trimmed.length; i += maxChars) {
          chunks.push(trimmed.slice(i, i + maxChars));
        }
        continue;
      }

      if ((buffer + trimmed).length > maxChars && buffer) {
        chunks.push(buffer.trim());
        buffer = trimmed;
      } else {
        buffer += trimmed;
      }
    }
    if (buffer.trim()) chunks.push(buffer.trim());

    return chunks.length > 0 ? chunks : [text];
  }
}
