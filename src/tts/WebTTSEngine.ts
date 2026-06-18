/**
 * Web Speech API TTS 引擎封装
 * 支持：播放/暂停/恢复/停止、语速调节、音色选择、逐段朗读回调
 */
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
  }): void {
    this.onChunkEnd = opts.onChunkEnd;
    this.onAllEnd = opts.onAllEnd;
  }

  /**
   * 开始朗读文本（自动分片后逐段播放）
   */
  speak(text: string): void {
    if (!('speechSynthesis' in window)) {
      console.error('[TTS] 浏览器不支持 Web Speech API');
      return;
    }
    this.cancel();
    this.chunks = this.splitIntoChunks(text);
    this.currentChunkIndex = 0;
    this._isPlaying = true;
    this._isPaused = false;
    this.speakCurrentChunk();
  }

  /**
   * 从指定片段索引继续播放（用于断点续播）
   */
  speakFrom(chunkIndex: number, chunks: string[]): void {
    this.cancel();
    this.chunks = chunks;
    this.currentChunkIndex = chunkIndex;
    this._isPlaying = true;
    this._isPaused = false;
    this.speakCurrentChunk();
  }

  /** 暂停 */
  pause(): void {
    if (speechSynthesis.speaking && !speechSynthesis.paused) {
      speechSynthesis.pause();
      this._isPaused = true;
    }
  }

  /** 恢复 */
  resume(): void {
    if (speechSynthesis.paused) {
      speechSynthesis.resume();
      this._isPaused = false;
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
      this.onAllEnd?.();
      return;
    }

    const text = this.chunks[this.currentChunkIndex];
    if (!text || !text.trim()) {
      // 空片段直接跳过
      this.currentChunkIndex++;
      this.speakCurrentChunk();
      return;
    }

    this.utterance = new SpeechSynthesisUtterance(text);
    this.utterance.rate = this._rate;
    this.utterance.lang = 'zh-CN';
    if (this._voice) this.utterance.voice = this._voice;

    this.utterance.onend = () => {
      this.currentChunkIndex++;
      this.onChunkEnd?.(this.currentChunkIndex);
      // 自动播放下一段
      if (this._isPlaying && !this._isPaused) {
        this.speakCurrentChunk();
      }
    };

    this.utterance.onerror = (event) => {
      console.warn(`[TTS] 片段 ${this.currentChunkIndex} 朗读错误:`, event.error);
      this.currentChunkIndex++;
      if (this._isPlaying && !this._isPaused) {
        this.speakCurrentChunk();
      }
    };

    speechSynthesis.speak(this.utterance);
  }

  /**
   * 将长文本按中文标点分片
   * 按句号、问号、感叹号、换行切分，每片不超过 maxChars 字符
   */
  private splitIntoChunks(text: string, maxChars = 300): string[] {
    // 按中文标点和换行分割
    const sentences = text.split(/(?<=[。！？\n])/g);
    const chunks: string[] = [];
    let buffer = '';

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (!trimmed) continue;

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
