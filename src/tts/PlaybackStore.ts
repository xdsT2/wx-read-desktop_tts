/**
 * 播放进度持久化存储
 * 使用 localStorage 保存每本书的朗读位置，支持断点续播
 */

export interface PlaybackState {
  bookId: string;
  chapterTitle: string;
  chapterIndex: number;
  chunkIndex: number;
  text: string;           // 当前章节完整文本（用于恢复分片）
  rate: number;
  voiceName: string | null;
  timestamp: number;
}

const STORAGE_KEY_PREFIX = 'tts_playback_';

export class PlaybackStore {
  /**
   * 保存当前播放状态
   */
  static save(state: Partial<PlaybackState> & { bookId: string }): void {
    const existing = PlaybackStore.load(state.bookId);
    const merged: PlaybackState = {
      bookId: state.bookId,
      chapterTitle: state.chapterTitle || (existing?.chapterTitle ?? ''),
      chapterIndex: state.chapterIndex ?? (existing?.chapterIndex ?? 0),
      chunkIndex: state.chunkIndex ?? (existing?.chunkIndex ?? 0),
      text: state.text || (existing?.text ?? ''),
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
}

export const DEFAULT_SETTINGS: TTSSettings = {
  rate: 1,
  voiceName: null,
  autoExtract: true,
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
