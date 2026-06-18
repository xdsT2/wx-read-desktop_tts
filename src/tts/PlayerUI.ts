/**
 * TTS 悬浮播放器 UI
 * 在微信读书页面右下角显示控制条，包含：播放/暂停、上/下一章、语速、设置按钮
 */

import { TextExtractor } from './TextExtractor';

// ---- CSS 样式 ----
export const PLAYER_STYLES = `
#wx-read-tts-player {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 2147483647;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  user-select: none;
  transition: opacity 0.3s ease, transform 0.3s ease;
}
#wx-read-tts-player.tts-hidden {
  opacity: 0;
  pointer-events: none;
  transform: translateY(20px);
}
#wx-read-tts-player .tts-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(30, 30, 34, 0.95);
  backdrop-filter: blur(12px);
  border-radius: 14px;
  padding: 8px 12px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4), 0 0 1px rgba(255, 255, 255, 0.1);
  color: #e8e8e8;
  font-size: 13px;
  min-width: 320px;
}
#wx-read-tts-player .tts-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #ccc;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, transform 0.1s;
  flex-shrink: 0;
}
#wx-read-tts-player .tts-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}
#wx-read-tts-player .tts-btn:active {
  transform: scale(0.92);
}
#wx-read-tts-player .tts-btn.tts-play-btn {
  width: 40px;
  height: 40px;
  background: #1aad63;
  color: #fff;
}
#wx-read-tts-player .tts-btn.tts-play-btn:hover {
  background: #1bc06d;
}
#wx-read-tts-player .tts-chapter-info {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
#wx-read-tts-player .tts-chapter-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  color: #aaa;
  margin-bottom: 2px;
}
#wx-read-tts-player .tts-progress-line {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #888;
}
#wx-read-tts-player .tts-progress-bar-bg {
  flex: 1;
  height: 3px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
  overflow: hidden;
  cursor: pointer;
}
#wx-read-tts-player .tts-progress-bar-fill {
  height: 100%;
  background: #1aad63;
  border-radius: 2px;
  transition: width 0.2s linear;
  width: 0%;
}
#wx-read-tts-player .tts-rate-select {
  appearance: none;
  -webkit-appearance: none;
  background: rgba(255, 255, 255, 0.08);
  border: none;
  border-radius: 6px;
  color: #ddd;
  font-size: 12px;
  padding: 4px 6px;
  cursor: pointer;
  outline: none;
  width: auto;
  min-width: 48px;
}
#wx-read-tts-player .tts-rate-select option {
  background: #2a2a2e;
  color: #fff;
}
#wx-read-tts-player .tts-divider {
  width: 1px;
  height: 20px;
  background: rgba(255, 255, 255, 0.15);
  flex-shrink: 0;
}

/* 设置面板 */
#wx-read-tts-settings {
  position: fixed;
  bottom: 90px;
  right: 20px;
  z-index: 2147483647;
  background: rgba(30, 30, 34, 0.97);
  backdrop-filter: blur(16px);
  border-radius: 14px;
  padding: 18px 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  color: #e8e8e8;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 13px;
  min-width: 280px;
  display: none;
  user-select: none;
}
#wx-read-tts-settings.tts-visible { display: block; }
#wx-read-tts-settings .tts-setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
#wx-read-tts-settings .tts-setting-row:last-child { margin-bottom: 0; }
#wx-read-tts-settings label {
  color: #aaa;
  font-size: 12px;
}
#wx-read-tts-settings select,
#wx-read-tts-settings input[type="range"] {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #ddd;
  font-size: 12px;
  padding: 4px 8px;
  outline: none;
  cursor: pointer;
}
#wx-read-tts-settings select option { background: #2a2a2e; }
#wx-read-tts-settings input[type="range"] {
  -webkit-appearance: none;
  width: 120px;
  padding: 0;
  border: none;
  height: 4px;
  border-radius: 2px;
}
#wx-read-tts-settings input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #1aad63;
  cursor: pointer;
  border: 2px solid #fff;
}
#wx-read-tts-settings .tts-set-title {
  font-weight: 600;
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 14px;
}

/* 错误提示条 */
#wx-read-tts-player .tts-error-bar {
  display: none;
  background: rgba(180, 60, 60, 0.9);
  color: #ffe0e0;
  font-size: 11px;
  padding: 6px 12px;
  border-radius: 0 0 14px 14px;
  margin-top: -4px;
  line-height: 1.4;
}
#wx-read-tts-player .tts-error-bar.tts-error-visible { display: block; }
#wx-read-tts-player .tts-error-bar .tts-error-close {
  float: right;
  cursor: pointer;
  margin-left: 8px;
  font-weight: bold;
}

/* "从这里开始朗读" 选区浮动按钮 */
#wx-read-tts-start-here {
  position: fixed;
  z-index: 2147483646;
  background: #1aad63;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 12px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  cursor: pointer;
  box-shadow: 0 2px 12px rgba(0,0,0,0.3);
  display: none;
  user-select: none;
  white-space: nowrap;
  transition: opacity 0.2s, transform 0.2s;
}
#wx-read-tts-start-here:hover { background: #1bc06d; transform: scale(1.04); }
#wx-read-tts-start-here:active { transform: scale(0.96); }
`;

// ---- HTML 模板 ----
export function createPlayerHTML(): string {
  return `
<div id="wx-read-tts-player" class="tts-hidden">
  <div class="tts-bar">
    <button class="tts-btn tts-prev-btn" title="上一段">⏮</button>
    <button class="tts-btn tts-play-btn" title="播放/暂停">▶</button>
    <button class="tts-btn tts-next-btn" title="下一段">⏭</button>

    <div class="tts-chapter-info">
      <div class="tts-chapter-title">点击开始朗读</div>
      <div class="tts-progress-line">
        <span class="tts-pos-text">0/0</span>
        <div class="tts-progress-bar-bg">
          <div class="tts-progress-bar-fill"></div>
        </div>
      </div>
    </div>

    <div class="tts-divider"></div>
    <select class="tts-rate-select" title="语速">
      <option value="0.5">0.5x</option>
      <option value="0.75">0.75x</option>
      <option value="1" selected>1x</option>
      <option value="1.25">1.25x</option>
      <option value="1.5">1.5x</option>
      <option value="2">2x</option>
    </select>

    <button class="tts-btn tts-settings-btn" title="设置">⚙</button>
    <button class="tts-btn tts-close-btn" title="关闭">×</button>
  </div>
  <div class="tts-error-bar"><span class="tts-error-close">×</span><span class="tts-error-msg"></span></div>
</div>

<div id="wx-read-tts-settings">
  <div class="tts-set-title">TTS 朗读设置</div>
  <div class="tts-setting-row">
    <label>语音选择</label>
    <select class="tts-voice-select"><option value="">加载中...</option></select>
  </div>
  <div class="tts-setting-row">
    <label>朗读速度</label>
    <input type="range" class="tts-rate-slider" min="0.25" max="3" step="0.25" value="1">
    <span class="tts-rate-value">1x</span>
  </div>
  <div class="tts-setting-row">
    <label>自动提取文本</label>
    <input type="checkbox" class="tts-auto-extract" checked>
  </div>
  <div class="tts-setting-row">
    <label>断点续播</label>
    <input type="checkbox" class="tts-resume-toggle" checked>
  </div>
</div>`;
}

/**
 * 播放器 UI 控制器
 */
export interface PlayerUICallbacks {
  onPlayPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onRateChange: (rate: number) => void;
  onVoiceChange: (voiceName: string | null) => void;
  onClose: () => void;
  onExtractClick: () => void; // 手动触发提取+播放
  onStartFromSelection?: (selectedText: string) => void; // 从选区开始朗读
}

export class PlayerUI {
  private container: HTMLElement;
  private settingsPanel: HTMLElement;
  private startHereBtn: HTMLElement;
  private callbacks: PlayerUICallbacks;

  /** 当前章节标题 */
  set chapterTitle(v: string) {
    const el = this.container.querySelector('.tts-chapter-title');
    if (el) el.textContent = v || '未知章节';
  }

  /** 当前进度（当前片段/总片段） */
  set progress(current: number) {
    const total = this._totalChunks || 1;
    const posEl = this.container.querySelector('.tts-pos-text') as HTMLElement;
    const fillEl = this.container.querySelector('.tts-progress-bar-fill') as HTMLElement;
    if (posEl) posEl.textContent = `${current}/${total}`;
    if (fillEl) fillEl.style.width = `${(current / total) * 100}%`;
  }

  /** 总片段数 */
  private _totalChunks = 0;
  set totalChunks(v: number) {
    this._totalChunks = v;
    this.progress = this._currentIndex;
  }

  private _currentIndex = 0;
  set currentIndex(v: number) {
    this._currentIndex = v;
    this.progress = v;
  }

  /** 播放状态图标 */
  set playing(isPlaying: boolean) {
    const btn = this.container.querySelector('.tts-play-btn') as HTMLElement;
    if (btn) btn.textContent = isPlaying ? '⏸' : '▶';
  }

  /** 显示/隐藏 */
  show(): void {
    this.container.classList.remove('tts-hidden');
  }
  hide(): void {
    this.container.classList.add('tts-hidden');
  }
  toggle(): void {
    this.container.classList.toggle('tts-hidden');
  }
  get isVisible(): boolean {
    return !this.container.classList.contains('tts-hidden');
  }

  /** 设置面板 */
  showSettings(): void {
    this.settingsPanel.classList.toggle('tts-visible');
  }
  hideSettings(): void {
    this.settingsPanel.classList.remove('tts-visible');
  }

  /** 语速下拉同步 */
  set rateValue(v: number) {
    const sel = this.container.querySelector('.tts-rate-select') as HTMLSelectElement;
    const slider = this.settingsPanel.querySelector('.tts-rate-slider') as HTMLInputElement;
    const valLabel = this.settingsPanel.querySelector('.tts-rate-value') as HTMLElement;
    if (sel) sel.value = String(v);
    if (slider) slider.value = String(v);
    if (valLabel) valLabel.textContent = `${v}x`;
  }

  /** 填充语音列表 */
  populateVoices(voices: SpeechSynthesisVoice[], selectedName?: string | null): void {
    const sel = this.settingsPanel.querySelector('.tts-voice-select') as HTMLSelectElement;
    if (!sel) return;
    sel.innerHTML = '';
    voices.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      if (v.name === selectedName) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  /** 显示错误提示 */
  showError(message: string): void {
    const bar = this.container.querySelector('.tts-error-bar');
    const msg = this.container.querySelector('.tts-error-msg');
    if (bar && msg) {
      msg.textContent = message;
      bar.classList.add('tts-error-visible');
    }
  }

  /** 隐藏错误提示 */
  hideError(): void {
    const bar = this.container.querySelector('.tts-error-bar');
    if (bar) bar.classList.remove('tts-error-visible');
  }

  constructor(callbacks: PlayerUICallbacks) {
    this.callbacks = callbacks;

    // 注入样式
    const styleEl = document.createElement('style');
    styleEl.textContent = PLAYER_STYLES;
    document.head.appendChild(styleEl);

    // 注入 HTML
    const wrapper = document.createElement('div');
    wrapper.innerHTML = createPlayerHTML();
    document.body.appendChild(wrapper);

    this.container = document.getElementById('wx-read-tts-player')!;
    this.settingsPanel = document.getElementById('wx-read-tts-settings')!;

    // 创建"从这里开始朗读"浮动按钮
    this.startHereBtn = document.createElement('button');
    this.startHereBtn.id = 'wx-read-tts-start-here';
    this.startHereBtn.textContent = '从这里开始朗读';
    document.body.appendChild(this.startHereBtn);

    // 绑定事件
    this.bindEvents(callbacks);
  }

  private bindEvents(cb: PlayerUICallbacks): void {
    // 播放/暂停
    this.container.querySelector('.tts-play-btn')?.addEventListener('click', () => cb.onPlayPause());
    // 上一段
    this.container.querySelector('.tts-prev-btn')?.addEventListener('click', () => cb.onPrevious());
    // 下一段
    this.container.querySelector('.tts-next-btn')?.addEventListener('click', () => cb.onNext());
    // 关闭
    this.container.querySelector('.tts-close-btn')?.addEventListener('click', () => cb.onClose());
    // 设置
    this.container.querySelector('.tts-settings-btn')?.addEventListener('click', () => this.showSettings());

    // 语速（下拉）
    this.container.querySelector('.tts-rate-select')?.addEventListener('change', (e) => {
      const rate = parseFloat((e.target as HTMLSelectElement).value);
      cb.onRateChange(rate);
    });

    // 语速（滑块）
    this.settingsPanel.querySelector('.tts-rate-slider')?.addEventListener('input', (e) => {
      const rate = parseFloat((e.target as HTMLInputElement).value);
      cb.onRateChange(rate);
    });

    // 语音选择
    this.settingsPanel.querySelector('.tts-voice-select')?.addEventListener('change', (e) => {
      const name = (e.target as HTMLSelectElement).value || null;
      cb.onVoiceChange(name);
    });

    // 点击外部关闭设置面板
    document.addEventListener('mousedown', (e) => {
      if (this.settingsPanel.classList.contains('tts-visible')) {
        const target = e.target as HTMLElement;
        if (!this.settingsPanel.contains(target) && !this.container.contains(target)) {
          this.hideSettings();
        }
      }
    });

    // 错误条关闭按钮
    this.container.querySelector('.tts-error-close')?.addEventListener('click', () => this.hideError());

    // "从这里开始朗读" 按钮点击
    this.startHereBtn.addEventListener('click', () => {
      const sel = window.getSelection();
      const selText = sel ? sel.toString().trim() : '';
      if (selText && cb.onStartFromSelection) {
        cb.onStartFromSelection(selText);
      }
      this.startHereBtn.style.display = 'none';
    });

    // 选区变化时显示/隐藏 startHere 按钮
    // 条件：选区在正文容器内 + 选区文本足够长（>=3字符）
    // cleanText 匹配失败时不阻止显示（让用户点击后再尝试定位）
    document.addEventListener('selectionchange', () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        this.startHereBtn.style.display = 'none';
        return;
      }

      // 找正文容器（可能为 null）
      const contentEl = TextExtractor.findContentElement();
      if (!contentEl) {
        this.startHereBtn.style.display = 'none';
        return;
      }

      // 选区文本太短则不显示
      const rawSelText = sel.toString().trim();
      if (rawSelText.length < 3) {
        this.startHereBtn.style.display = 'none';
        return;
      }

      // 检查选区是否在正文容器内
      try {
        const range = sel.getRangeAt(0);
        if (!contentEl.contains(range.startContainer)) {
          this.startHereBtn.style.display = 'none';
          return;
        }

        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          this.startHereBtn.style.display = 'none';
          return;
        }

        // 定位按钮到选区右上角
        const top = rect.top + window.scrollY - 36;
        const left = rect.right + window.scrollX - 80;
        this.startHereBtn.style.top = (top > 10 ? top : rect.bottom + window.scrollY + 8) + 'px';
        this.startHereBtn.style.left = (left > 10 ? left : rect.left + window.scrollX) + 'px';
        this.startHereBtn.style.display = 'block';
      } catch {
        this.startHereBtn.style.display = 'none';
      }
    });
  }
}
