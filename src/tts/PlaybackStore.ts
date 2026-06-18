/**
 * 播放进度持久化存储
 * 使用 localStorage 保存每本书的朗读位置，支持断点续播
 *
 * 改进：不再存储完整章节文本到 localStorage（避免配额溢出），
 * 改为存储 textHash（简单哈希前缀）用于验证章节是否变更。
 * 断点续播时重新从页面提取文本并分片，按 chunkIndex 恢复位置。
 */

export interface PlaybackState {
  bookId: string;
  chapterTitle: string;
  chapterIndex: number;
  chunkIndex: number;
  textHash: string;      // 章节文本的哈希前缀（用于检测章节是否变更）
  textLength: number;    // 章节文本长度（辅助验证）
  rate: number;
  voiceName: string | null;
  timestamp: number;
}

const STORAGE_KEY_PREFIX = 'tts_playback_';

/**
 * 简单哈希函数（不依赖 crypto，适用于浏览器环境）
 * 返回文本的 32 位哈希的十六进制表示
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return (hash >>> 0).toString(16);
}

export class PlaybackStore {
  /**
   * 保存当前播放状态
   * @param text 当前章节文本（仅用于计算 hash，不会存储原文）
   */
  static save(state: Partial<PlaybackState> & { bookId: string }, text?: string): void {
    const existing = PlaybackStore.load(state.bookId);
    const merged: PlaybackState = {
      bookId: state.bookId,
      chapterTitle: state.chapterTitle || (existing?.chapterTitle ?? ''),
      chapterIndex: state.chapterIndex ?? (existing?.chapterIndex ?? 0),
      chunkIndex: state.chunkIndex ?? (existing?.chunkIndex ?? 0),
      textHash: text ? simpleHash(text) : (existing?.textHash ?? ''),
      textLength: text ? text.length : (existing?.textLength ?? 0),
      rate: state.rate ?? (existing?.rate ?? 1),
      voiceName: state.voiceName !== undefined ? state.voiceName : (existing?.voiceName ?? null),
      timestamp: Date.now(),
    };
    try {
      localStorage.setItem(STORAGE_KEY_PREFIX + state.bookId, JSON.stringify(merged));
    } catch (e) {
      console.warn('[TTS] 保存播放进度失败:', e);
    }
  }

  /**
   * 加载播放状态
   */
  static load(bookId: string): PlaybackState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_PREFIX + bookId);
      if (!raw) return null;
      return JSON.parse(raw) as PlaybackState;
    } catch {
      return null;
    }
  }

  /**
   * 验证当前文本是否与保存的断点匹配
   * 返回 true 表示章节未变更，可以安全恢复
   */
  static matchesSavedState(bookId: string, currentText: string): boolean {
    const saved = PlaybackStore.load(bookId);
    if (!saved) return false;
    return saved.textHash === simpleHash(currentText) && saved.textLength === currentText.length;
  }

  /**
   * 清除指定书籍的播放记录
   */
  static clear(bookId: string): void {
    localStorage.removeItem(STORAGE_KEY_PREFIX + bookId);
  }

  /**
   * 清除所有播放记录
   */
  static clearAll(): void {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_KEY_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  }

  /**
   * 获取所有已保存的播放记录列表（用于展示历史）
   */
  static listAll(): PlaybackState[] {
    const records: PlaybackState[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_KEY_PREFIX)) {
        try {
          const raw = localStorage.getItem(key);
          if (raw) records.push(JSON.parse(raw));
        } catch { /* ignore */ }
      }
    }
    // 按时间倒序
    return records.sort((a, b) => b.timestamp - a.timestamp);
  }
}

/**
 * TTS 设置持久化
 */
const SETTINGS_KEY = 'tts_settings';

export interface TTSSettings {
  rate: number;
  voiceName: string | null;
  autoExtract: boolean;
  /** 当 Web Speech API 不可用或无中文语音时，是否显示回退提示 */
  showFallbackHint: boolean;
}

export const DEFAULT_SETTINGS: TTSSettings = {
  rate: 1,
  voiceName: null,
  autoExtract: true,
  showFallbackHint: true,
};

export class SettingsStore {
  static save(settings: Partial<TTSSettings>): void {
    const current = SettingsStore.load();
    const merged = { ...current, ...settings };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
    } catch (e) {
      console.warn('[TTS] 保存设置失败:', e);
    }
  }

  static load(): TTSSettings {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return DEFAULT_SETTINGS;
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }
}
