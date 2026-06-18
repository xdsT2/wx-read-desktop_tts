/**
 * TTS 注入脚本 —— 内联版本（无模块依赖）
 * 此文件会被 main.ts 读取并通过 executeJavaScript 注入到微信读书页面
 * 所有逻辑内联，不使用 import/export，确保在页面上下文中直接运行
 *
 * v3 改进：
 * - debug 日志 + volume=1 + onstart 回调
 * - 健壮 initVoices（onvoiceschanged + fallback timeout + 3s 兜底提示）
 * - "从这里开始朗读" 选区浮动按钮
 * - 本地语音不可用时禁用播放 + 友好提示
 * - TextChunker 用 matchAll 保留分隔符切分
 * - PlaybackStore 不再存全文，改用 textHash + textLength 验证
 */

(function () {
  'use strict';

  var DEBUG = true;
  function log() { if (DEBUG) { var args = Array.prototype.slice.call(arguments); args.unshift('[TTS Engine]'); console.log.apply(console, args); } }
  function warn() { if (DEBUG) { var args = Array.prototype.slice.call(arguments); args.unshift('[TTS Engine]'); console.warn.apply(console, args); } }

  // ============================================================
  // 1. Web Speech API 引擎（增加 debug 日志 + volume=1 + onstart）
  // ============================================================
  function WebTTSEngine() {
    this.utterance = null;
    this.currentChunkIndex = 0;
    this.chunks = [];
    this._rate = 1;
    this._voice = null;
    this._isPlaying = false;
    this._isPaused = false;
    this.onChunkEnd = null;
    this.onAllEnd = null;
    this.onError = null;
  }

  WebTTSEngine.checkAvailability = function () {
    if (!('speechSynthesis' in window)) {
      return { supported: false, hasChineseVoice: false, voices: [], message: '当前浏览器不支持 Web Speech API。请考虑升级浏览器或使用云端 TTS 服务。' };
    }
    var allVoices = speechSynthesis.getVoices();
    var zhVoices = allVoices.filter(function (v) { return v.lang.startsWith('zh') || v.lang.includes('CN'); });
    if (zhVoices.length === 0) {
      return { supported: true, hasChineseVoice: false, voices: [], message: 'Web Speech API 可用，但未检测到中文语音。请在系统设置中安装中文语音包，或切换到云端 TTS。' };
    }
    return { supported: true, hasChineseVoice: true, voices: zhVoices, message: 'Web Speech API 可用，检测到 ' + zhVoices.length + ' 个中文语音。' };
  };

  WebTTSEngine.getChineseVoices = function () {
    return speechSynthesis.getVoices().filter(function (v) { return v.lang.startsWith('zh') || v.lang.includes('CN'); });
  };

  WebTTSEngine.prototype.setCallbacks = function (opts) {
    this.onChunkEnd = opts.onChunkEnd || null;
    this.onAllEnd = opts.onAllEnd || null;
    this.onError = opts.onError || null;
  };

  WebTTSEngine.prototype.speak = function (text) {
    if (!('speechSynthesis' in window)) {
      var msg = '浏览器不支持 Web Speech API，无法朗读。请切换到云端 TTS 服务。';
      console.error('[TTS] ' + msg);
      if (this.onError) this.onError(0, msg);
      return;
    }
    var zhVoices = WebTTSEngine.getChineseVoices();
    if (zhVoices.length === 0 && !this._voice) {
      warn('未检测到中文语音，将使用默认语音');
      if (this.onError) this.onError(0, '未检测到中文语音，朗读效果可能不佳。建议安装中文语音包或切换云端 TTS。');
    }
    this.cancel();
    this.chunks = this.splitIntoChunks(text);
    this.currentChunkIndex = 0;
    this._isPlaying = true;
    this._isPaused = false;
    log('开始朗读，共', this.chunks.length, '段');
    this.speakCurrentChunk();
  };

  WebTTSEngine.prototype.speakFrom = function (chunkIndex, chunks) {
    this.cancel();
    this.chunks = chunks;
    this.currentChunkIndex = chunkIndex;
    this._isPlaying = true;
    this._isPaused = false;
    log('从第', chunkIndex, '段开始朗读，共', chunks.length, '段');
    this.speakCurrentChunk();
  };

  WebTTSEngine.prototype.pause = function () {
    if (speechSynthesis.speaking && !speechSynthesis.paused) { speechSynthesis.pause(); this._isPaused = true; log('已暂停'); }
  };

  WebTTSEngine.prototype.resume = function () {
    if (speechSynthesis.paused) { speechSynthesis.resume(); this._isPaused = false; log('已恢复'); }
  };

  WebTTSEngine.prototype.cancel = function () {
    speechSynthesis.cancel();
    this.utterance = null;
    this._isPlaying = false;
    this._isPaused = false;
  };

  WebTTSEngine.prototype.previous = function () {
    if (this.currentChunkIndex > 0) { this.currentChunkIndex--; this.speakCurrentChunk(); return true; }
    return false;
  };

  WebTTSEngine.prototype.next = function () {
    if (this.currentChunkIndex < this.chunks.length - 1) { this.currentChunkIndex++; this.speakCurrentChunk(); return true; }
    return false;
  };

  WebTTSEngine.prototype.speakCurrentChunk = function () {
    var self = this;
    if (this.currentChunkIndex >= this.chunks.length) {
      this._isPlaying = false;
      log('全部片段朗读完毕');
      if (this.onAllEnd) this.onAllEnd();
      return;
    }
    var text = this.chunks[this.currentChunkIndex];
    if (!text || !text.trim()) { this.currentChunkIndex++; this.speakCurrentChunk(); return; }

    this.utterance = new SpeechSynthesisUtterance(text);
    this.utterance.rate = this._rate;
    this.utterance.volume = 1; // 确保音量最大
    this.utterance.lang = 'zh-CN';
    if (this._voice) this.utterance.voice = this._voice;

    log('朗读第 ' + (this.currentChunkIndex + 1) + '/' + this.chunks.length + ' 段: "' + text.slice(0, 30) + '..."');

    this.utterance.onstart = function () {
      log('第 ' + self.currentChunkIndex + ' 段 onstart 触发');
    };

    this.utterance.onend = function () {
      log('第 ' + self.currentChunkIndex + ' 段 onend 触发');
      self.currentChunkIndex++;
      if (self.onChunkEnd) self.onChunkEnd(self.currentChunkIndex);
      if (self._isPlaying && !self._isPaused) self.speakCurrentChunk();
    };

    this.utterance.onerror = function (e) {
      warn('第 ' + self.currentChunkIndex + ' 段 onerror: ' + e.error);
      if (self.onError) self.onError(self.currentChunkIndex, e.error);
      if (e.error !== 'canceled' && e.error !== 'interrupted') {
        self.currentChunkIndex++;
        if (self._isPlaying && !self._isPaused) self.speakCurrentChunk();
      }
    };

    speechSynthesis.speak(this.utterance);
  };

  WebTTSEngine.prototype.splitIntoChunks = function (text, maxChars) {
    if (maxChars === undefined) maxChars = 300;
    var re = /.*?[。！？\n]|.+$/gs;
    var matches = [], m;
    while ((m = re.exec(text)) !== null) { matches.push(m[0]); if (m[0].length === 0) { re.lastIndex++; } }
    var chunks = [], buffer = '';
    for (var i = 0; i < matches.length; i++) {
      var trimmed = matches[i].trim();
      if (!trimmed) continue;
      if (trimmed.length > maxChars) {
        if (buffer.trim()) { chunks.push(buffer.trim()); buffer = ''; }
        for (var j = 0; j < trimmed.length; j += maxChars) { chunks.push(trimmed.slice(j, j + maxChars)); }
        continue;
      }
      if ((buffer + trimmed).length > maxChars && buffer) { chunks.push(buffer.trim()); buffer = trimmed; }
      else { buffer += trimmed; }
    }
    if (buffer.trim()) chunks.push(buffer.trim());
    return chunks.length > 0 ? chunks : [text];
  };

  // ============================================================
  // 2. 文本提取器
  // ============================================================
  var TextExtractor = {
    extract: function () {
      var text = TextExtractor.extractText();
      if (!text || text.trim().length < 10) { console.warn('[TTS] 未在页面中提取到有效文本'); return null; }
      return { text: text.trim(), chapterTitle: TextExtractor.extractChapterTitle(), chapterIndex: TextExtractor.extractChapterInfo().index, totalChapters: TextExtractor.extractChapterInfo().total };
    },
    extractText: function () {
      var selectors = ['.readerContent', '.render-text-container', '[class*="readerText"]', '[class*="render_text"]', '.text-content', 'article', '.content', '#j_content', 'main'];
      for (var i = 0; i < selectors.length; i++) {
        var el = document.querySelector(selectors[i]);
        if (el) { var t = TextExtractor.cleanText(el.textContent || ''); if (t.length > 20) return t; }
      }
      return TextExtractor.scanForContent();
    },
    cleanText: function (raw) {
      return raw.replace(/\s+/g, ' ').replace(/[^\u4e00-\u9fa5a-zA-Z0-9，。！？、；：""''（）\n\r\s\.\,\!\?\;\:\(\)\-\—]/g, '').trim();
    },
    scanForContent: function () {
      var bestEl = null, maxLength = 0;
      var skipSelectors = ['nav', 'header', 'footer', 'aside', '[role="navigation"]', 'script', 'style', '.toolbar', '.sidebar'];
      var candidates = document.querySelectorAll('div, section, article, main');
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        var shouldSkip = false;
        for (var j = 0; j < skipSelectors.length; j++) { if (el.matches(skipSelectors[j]) || el.closest(skipSelectors[j])) { shouldSkip = true; break; } }
        if (shouldSkip) continue;
        var text = (el.textContent || '').trim();
        var chineseCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
        if (chineseCount > maxLength && chineseCount > 50) { maxLength = chineseCount; bestEl = el; }
      }
      return bestEl ? TextExtractor.cleanText(bestEl.textContent || '') : '';
    },
    extractChapterTitle: function () {
      var selectors = ['.chapter-title', '.chapter_title', '[class*="chapterTitle"]', '.current-chapter h1', '.chapterInfo_title', 'h1.title', '.title'];
      for (var i = 0; i < selectors.length; i++) { var el = document.querySelector(selectors[i]); if (el && el.textContent && el.textContent.trim()) return el.textContent.trim(); }
      return '未知章节';
    },
    extractChapterInfo: function () {
      try {
        var activeItem = document.querySelector('[class*="chapter"][class*="active"], [class*="chapter_item"][class*="selected"]');
        if (activeItem) { var siblings = activeItem.parentElement ? activeItem.parentElement.children : null; if (siblings) { var idx = Array.prototype.indexOf.call(siblings, activeItem); return { index: idx >= 0 ? idx : 0, total: siblings.length }; } }
      } catch (e) { /* ignore */ }
      return { index: 0, total: 1 };
    }
  };

  // ============================================================
  // 3. 播放状态持久化（不存全文，用 hash 验证）
  // ============================================================
  function simpleHash(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) { var c = str.charCodeAt(i); hash = ((hash << 5) - hash) + c; hash = hash & hash; }
    return (hash >>> 0).toString(16);
  }

  var PlaybackStore = {
    PREFIX: 'tts_playback_',
    save: function (state, text) {
      var existing = PlaybackStore.load(state.bookId);
      var merged = {
        bookId: state.bookId,
        chapterTitle: state.chapterTitle || (existing ? existing.chapterTitle : ''),
        chapterIndex: state.chapterIndex !== undefined ? state.chapterIndex : (existing ? existing.chapterIndex : 0),
        chunkIndex: state.chunkIndex !== undefined ? state.chunkIndex : (existing ? existing.chunkIndex : 0),
        textHash: text ? simpleHash(text) : (existing ? existing.textHash : ''),
        textLength: text ? text.length : (existing ? existing.textLength : 0),
        rate: state.rate !== undefined ? state.rate : (existing ? existing.rate : 1),
        voiceName: state.voiceName !== undefined ? state.voiceName : (existing ? existing.voiceName : null),
        timestamp: Date.now()
      };
      try { localStorage.setItem(PlaybackStore.PREFIX + state.bookId, JSON.stringify(merged)); }
      catch (e) { console.warn('[TTS] 保存播放进度失败:', e); }
    },
    load: function (bookId) {
      try { var raw = localStorage.getItem(PlaybackStore.PREFIX + bookId); return raw ? JSON.parse(raw) : null; }
      catch (e) { return null; }
    },
    matchesSavedState: function (bookId, currentText) {
      var saved = PlaybackStore.load(bookId);
      if (!saved) return false;
      return saved.textHash === simpleHash(currentText) && saved.textLength === currentText.length;
    },
    clear: function (bookId) { localStorage.removeItem(PlaybackStore.PREFIX + bookId); }
  };

  var DEFAULT_SETTINGS = { rate: 1, voiceName: null, autoExtract: true, showFallbackHint: true };

  var SettingsStore = {
    KEY: 'tts_settings',
    save: function (partial) {
      var current = SettingsStore.load();
      var merged = Object.assign({}, current, partial);
      try { localStorage.setItem(SettingsStore.KEY, JSON.stringify(merged)); }
      catch (e) { console.warn('[TTS] 保存设置失败:', e); }
    },
    load: function () {
      try { var raw = localStorage.getItem(SettingsStore.KEY); return raw ? Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw)) : Object.assign({}, DEFAULT_SETTINGS); }
      catch (e) { return Object.assign({}, DEFAULT_SETTINGS); }
    }
  };

  // ============================================================
  // 4. 悬浮播放器 UI + "从这里开始朗读" 按钮
  // ============================================================
  var PLAYER_CSS = '#wx-read-tts-player{position:fixed;bottom:20px;right:20px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;user-select:none;transition:opacity .3s ease,transform .3s ease}#wx-read-tts-player.tts-hidden{opacity:0;pointer-events:none;transform:translateY(20px)}#wx-read-tts-player .tts-bar{display:flex;align-items:center;gap:6px;background:rgba(30,30,34,.95);backdrop-filter:blur(12px);border-radius:14px;padding:8px 12px;box-shadow:0 4px 24px rgba(0,0,0,.4),0 0 1px rgba(255,255,255,.1);color:#e8e8e8;font-size:13px;min-width:320px}#wx-read-tts-player .tts-btn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:none;border-radius:50%;background:transparent;color:#ccc;cursor:pointer;transition:background .15s,color .15s,transform .1s;flex-shrink:0}#wx-read-tts-player .tts-btn:hover{background:rgba(255,255,255,.12);color:#fff}#wx-read-tts-player .tts-btn:active{transform:scale(.92)}#wx-read-tts-player .tts-btn.tts-play-btn{width:40px;height:40px;background:#1aad63;color:#fff}#wx-read-tts-player .tts-btn.tts-play-btn:hover{background:#1bc06d}#wx-read-tts-player .tts-chapter-info{flex:1;min-width:0;overflow:hidden}#wx-read-tts-player .tts-chapter-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;color:#aaa;margin-bottom:2px}#wx-read-tts-player .tts-progress-line{display:flex;align-items:center;gap:6px;font-size:11px;color:#888}#wx-read-tts-player .tts-progress-bar-bg{flex:1;height:3px;background:rgba(255,255,255,.15);border-radius:2px;overflow:hidden;cursor:pointer}#wx-read-tts-player .tts-progress-bar-fill{height:100%;background:#1aad63;border-radius:2px;transition:width .2s linear;width:0}#wx-read-tts-player .tts-rate-select{appearance:none;-webkit-appearance:none;background:rgba(255,255,255,.08);border:none;border-radius:6px;color:#ddd;font-size:12px;padding:4px 6px;cursor:pointer;outline:none;min-width:48px}#wx-read-tts-player .tts-rate-select option{background:#2a2a2e;color:#fff}#wx-read-tts-player .tts-divider{width:1px;height:20px;background:rgba(255,255,255,.15);flex-shrink:0}#wx-read-tts-player .tts-error-bar{display:none;background:rgba(180,60,60,.9);color:#ffe0e0;font-size:11px;padding:6px 12px;border-radius:0 0 14px 14px;margin-top:-4px;line-height:1.4}#wx-read-tts-player .tts-error-bar.tts-error-visible{display:block}#wx-read-tts-player .tts-error-bar .tts-error-close{float:right;cursor:pointer;margin-left:8px;font-weight:bold}#wx-read-tts-settings{position:fixed;bottom:90px;right:20px;z-index:2147483647;background:rgba(30,30,34,.97);backdrop-filter:blur(16px);border-radius:14px;padding:18px 20px;box-shadow:0 8px 32px rgba(0,0,0,.5);color:#e8e8e8;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;font-size:13px;min-width:280px;display:none;user-select:none}#wx-read-tts-settings.tts-visible{display:block}#wx-read-tts-settings .tts-setting-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}#wx-read-tts-settings .tts-setting-row:last-child{margin-bottom:0}#wx-read-tts-settings label{color:#aaa;font-size:12px}#wx-read-tts-settings select,#wx-read-tts-settings input[type=range]{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);border-radius:6px;color:#ddd;font-size:12px;padding:4px 8px;outline:none;cursor:pointer}#wx-read-tts-settings select option{background:#2a2a2e}#wx-read-tts-settings input[type=range]{-webkit-appearance:none;width:120px;padding:0;border:none;height:4px;border-radius:2px}#wx-read-tts-settings input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#1aad63;cursor:pointer;border:2px solid #fff}#wx-read-tts-settings .tts-set-title{font-weight:600;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,.08);font-size:14px}#wx-read-tts-start-here{position:fixed;z-index:2147483646;background:#1aad63;color:#fff;border:none;border-radius:8px;padding:6px 14px;font-size:12px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,.3);display:none;user-select:none;white-space:nowrap;transition:opacity .2s,transform .2s}#wx-read-tts-start-here:hover{background:#1bc06d;transform:scale(1.04)}#wx-read-tts-start-here:active{transform:scale(.96)}';

  function createPlayerHTML() {
    return '<div id="wx-read-tts-player" class="tts-hidden"><div class="tts-bar">' +
      '<button class="tts-btn tts-prev-btn" title="上一段">⏮</button>' +
      '<button class="tts-btn tts-play-btn" title="播放/暂停">▶</button>' +
      '<button class="tts-btn tts-next-btn" title="下一段">⏭</button>' +
      '<div class="tts-chapter-info"><div class="tts-chapter-title">点击开始朗读</div>' +
      '<div class="tts-progress-line"><span class="tts-pos-text">0/0</span>' +
      '<div class="tts-progress-bar-bg"><div class="tts-progress-bar-fill"></div></div></div></div>' +
      '<div class="tts-divider"></div>' +
      '<select class="tts-rate-select" title="语速"><option value="0.5">0.5x</option><option value="0.75">0.75x</option>' +
      '<option value="1" selected>1x</option><option value="1.25">1.25x</option>' +
      '<option value="1.5">1.5x</option><option value="2">2x</option></select>' +
      '<button class="tts-btn tts-settings-btn" title="设置">⚙</button>' +
      '<button class="tts-btn tts-close-btn" title="关闭">×</button></div>' +
      '<div class="tts-error-bar"><span class="tts-error-close">×</span><span class="tts-error-msg"></span></div></div>' +
      '<div id="wx-read-tts-settings"><div class="tts-set-title">TTS 朗读设置</div>' +
      '<div class="tts-setting-row"><label>语音选择</label><select class="tts-voice-select"><option value="">加载中...</option></select></div>' +
      '<div class="tts-setting-row"><label>朗读速度</label><input type="range" class="tts-rate-slider" min="0.25" max="3" step="0.25" value="1"><span class="tts-rate-value">1x</span></div>' +
      '<div class="tts-setting-row"><label>自动提取文本</label><input type="checkbox" class="tts-auto-extract" checked></div>' +
      '<div class="tts-setting-row"><label>断点续播</label><input type="checkbox" class="tts-resume-toggle" checked></div></div>';
  }

  // ============================================================
  // 5. 主播放器（完整版：debug + startHere + 健壮 initVoices + 不可用提示）
  // ============================================================
  function TTSPlayer() {
    var self = this;
    this.engine = new WebTTSEngine();
    this.settings = SettingsStore.load();
    this.currentContent = null;
    this.currentChunks = [];
    this.bookId = '';
    this._totalChunks = 0;
    this._currentIndex = 0;
    this._voicesLoaded = false;

    // 注入样式和 HTML
    var styleEl = document.createElement('style');
    styleEl.textContent = PLAYER_CSS;
    document.head.appendChild(styleEl);
    var wrapper = document.createElement('div');
    wrapper.innerHTML = createPlayerHTML();
    document.body.appendChild(wrapper);

    this.container = document.getElementById('wx-read-tts-player');
    this.settingsPanel = document.getElementById('wx-read-tts-settings');

    // 创建"从这里开始朗读"浮动按钮
    this.startHereBtn = document.createElement('button');
    this.startHereBtn.id = 'wx-read-tts-start-here';
    this.startHereBtn.textContent = '从这里开始朗读';
    document.body.appendChild(this.startHereBtn);

    this.engine._rate = this.settings.rate;

    // 绑定引擎回调
    this.engine.setCallbacks({
      onChunkEnd: function (idx) { self.onChunkEnd(idx); },
      onAllEnd: function () { self.onAllEnd(); },
      onError: function (chunkIdx, err) { self.onEngineError(chunkIdx, err); }
    });

    // 初始化语音列表（健壮版）
    this.initVoices();

    // 显示播放器
    this.container.classList.remove('tts-hidden');
    this.updateRateUI();

    // 检测可用性
    this.checkAvailability();

    // ---- UI 事件绑定 ----
    this.container.querySelector('.tts-play-btn').addEventListener('click', function () { self.togglePlay(); });
    this.container.querySelector('.tts-prev-btn').addEventListener('click', function () { self.previous(); });
    this.container.querySelector('.tts-next-btn').addEventListener('click', function () { self.next(); });
    this.container.querySelector('.tts-close-btn').addEventListener('click', function () { self.close(); });
    this.container.querySelector('.tts-settings-btn').addEventListener('click', function () { self.toggleSettings(); });
    this.container.querySelector('.tts-error-close').addEventListener('click', function () { self.hideError(); });

    this.container.querySelector('.tts-rate-select').addEventListener('change', function (e) { self.setRate(parseFloat(e.target.value)); });
    this.settingsPanel.querySelector('.tts-rate-slider').addEventListener('input', function (e) { self.setRate(parseFloat(e.target.value)); });
    this.settingsPanel.querySelector('.tts-voice-select').addEventListener('change', function (e) { self.setVoice(e.target.value || null); });

    document.addEventListener('mousedown', function (e) {
      if (self.settingsPanel.classList.contains('tts-visible')) {
        if (!self.settingsPanel.contains(e.target) && !self.container.contains(e.target)) {
          self.settingsPanel.classList.remove('tts-visible');
        }
      }
    });

    // "从这里开始朗读" 按钮点击
    this.startHereBtn.addEventListener('click', function () {
      var sel = window.getSelection();
      var selText = sel ? sel.toString().trim() : '';
      if (selText) { self.startFromSelection(selText); }
      self.startHereBtn.style.display = 'none';
    });

    // 选区变化时显示/隐藏 startHere 按钮
    document.addEventListener('selectionchange', function () {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        self.startHereBtn.style.display = 'none';
        return;
      }
      try {
        var range = sel.getRangeAt(0);
        var rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          self.startHereBtn.style.display = 'none';
          return;
        }
        self.startHereBtn.style.display = 'block';
        self.startHereBtn.style.top = (rect.top + window.scrollY - 36) + 'px';
        self.startHereBtn.style.left = (rect.left + window.scrollX + rect.width / 2 - 60) + 'px';
      } catch (e) {
        self.startHereBtn.style.display = 'none';
      }
    });

    console.log('[TTS] 微信读书听书功能已加载 (v3)');
  }

  TTSPlayer.prototype.checkAvailability = function () {
    var avail = WebTTSEngine.checkAvailability();
    if (!avail.supported) {
      this.showError(avail.message);
      this.disablePlayback();
      return;
    }
    if (!avail.hasChineseVoice) {
      console.warn('[TTS] ' + avail.message);
    }
  };

  TTSPlayer.prototype.disablePlayback = function () {
    var playBtn = this.container.querySelector('.tts-play-btn');
    if (playBtn) { playBtn.style.opacity = '0.4'; playBtn.style.pointerEvents = 'none'; }
  };

  TTSPlayer.prototype.enablePlayback = function () {
    var playBtn = this.container.querySelector('.tts-play-btn');
    if (playBtn) { playBtn.style.opacity = '1'; playBtn.style.pointerEvents = 'auto'; }
  };

  TTSPlayer.prototype.initVoices = function () {
    var self = this;
    function loadVoices() {
      var voices = WebTTSEngine.getChineseVoices();
      if (voices.length > 0) {
        self._voicesLoaded = true;
        self.populateVoices(voices, self.settings.voiceName);
        if (self.settings.voiceName) { var match = voices.find(function (v) { return v.name === self.settings.voiceName; }); if (match) self.engine._voice = match; }
        self.hideError();
        self.enablePlayback();
        console.log('[TTS] 已加载', voices.length, '个中文语音');
      } else if (!self._voicesLoaded) {
        console.warn('[TTS] getVoices() 返回空，等待异步加载...');
      }
    }
    if (speechSynthesis.onvoiceschanged !== undefined) { speechSynthesis.onvoiceschanged = loadVoices; }
    loadVoices();
    // Fallback：延迟重试
    setTimeout(loadVoices, 200);
    setTimeout(loadVoices, 1000);
    // 最终兜底：3s 后如果仍无中文语音，显示提示
    setTimeout(function () {
      if (!self._voicesLoaded) {
        var voices = WebTTSEngine.getChineseVoices();
        if (voices.length === 0) {
          self.showError('本机未检测到中文语音，朗读功能不可用。请在系统设置中安装中文语音包，或联系管理员配置云端 TTS。');
          self.disablePlayback();
        }
      }
    }, 3000);
  };

  TTSPlayer.prototype.populateVoices = function (voices, selectedName) {
    var sel = this.settingsPanel.querySelector('.tts-voice-select');
    if (!sel) return;
    sel.innerHTML = '';
    voices.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = v.name + ' (' + v.lang + ')';
      if (v.name === selectedName) opt.selected = true;
      sel.appendChild(opt);
    });
  };

  TTSPlayer.prototype.togglePlay = function () {
    if (this.engine._isPlaying && !this.engine._isPaused) { this.engine.pause(); this.updatePlayIcon(false); }
    else if (this.engine._isPaused) { this.engine.resume(); this.updatePlayIcon(true); }
    else { this.extractAndPlay(); }
  };

  TTSPlayer.prototype.previous = function () { if (this.engine.previous()) { this.saveProgress(); this.updatePosition(); } };
  TTSPlayer.prototype.next = function () { if (this.engine.next()) { this.saveProgress(); this.updatePosition(); } };

  TTSPlayer.prototype.setRate = function (rate) {
    this.engine._rate = Math.max(0.25, Math.min(4, rate));
    this.settings.rate = rate;
    this.updateRateUI();
    SettingsStore.save({ rate: rate });
  };

  TTSPlayer.prototype.setVoice = function (name) {
    var voices = speechSynthesis.getVoices();
    var match = name ? voices.find(function (v) { return v.name === name; }) : null;
    this.engine._voice = match || null;
    this.settings.voiceName = name;
    SettingsStore.save({ voiceName: name });
  };

  TTSPlayer.prototype.close = function () { this.engine.cancel(); this.container.classList.add('tts-hidden'); this.settingsPanel.classList.remove('tts-visible'); };
  TTSPlayer.prototype.toggleSettings = function () { this.settingsPanel.classList.toggle('tts-visible'); };

  TTSPlayer.prototype.extractAndPlay = function () {
    var content = TextExtractor.extract();
    if (!content) { this.showError('未能提取到文本内容，请确保已在阅读页面打开一本书。'); return; }
    this.currentContent = content;
    this.currentChunks = this.chunkText(content.text);
    this.bookId = this.makeBookId(content);
    this.hideError();

    if (this.settings.autoExtract) {
      var saved = PlaybackStore.load(this.bookId);
      if (saved && saved.chunkIndex > 0 && saved.chunkIndex < this.currentChunks.length) {
        var isSame = PlaybackStore.matchesSavedState(this.bookId, content.text);
        if (isSame) {
          if (confirm('检测到上次在「' + saved.chapterTitle + '」第 ' + saved.chunkIndex + ' 段停止，是否继续？')) {
            this.resumeFrom(saved);
            return;
          }
        } else {
          PlaybackStore.clear(this.bookId);
        }
      }
    }
    this.startNew(content);
  };

  /** 从选中文本位置开始朗读 */
  TTSPlayer.prototype.startFromSelection = function (selectedText) {
    if (!selectedText) return;
    var content = TextExtractor.extract();
    if (!content) { this.showError('未能提取到文本内容'); return; }

    this.currentContent = content;
    this.currentChunks = this.chunkText(content.text);
    this.bookId = this.makeBookId(content);

    var fullText = content.text;
    var charIndex = fullText.indexOf(selectedText);

    // 模糊匹配：尝试前60字符
    if (charIndex === -1 && selectedText.length > 10) {
      var prefix = selectedText.slice(0, Math.min(60, selectedText.length));
      charIndex = fullText.indexOf(prefix);
    }

    if (charIndex === -1) {
      console.warn('[TTS] 选中文本未在章节全文中找到，从头开始朗读');
      this.engine.speak(content.text);
      this.setChapterTitle(content.chapterTitle);
      this.setTotalChunks(this.engine.chunks.length);
      this.setCurrentIndex(0);
      this.updatePlayIcon(true);
      return;
    }

    // 通过累积偏移找到 chunk 索引
    var chunkIndex = 0, offset = 0;
    for (var i = 0; i < this.currentChunks.length; i++) {
      if (charIndex >= offset && charIndex < offset + this.currentChunks[i].length) {
        chunkIndex = i;
        break;
      }
      offset += this.currentChunks[i].length;
    }

    console.log('[TTS] 从选区开始朗读: charIndex=' + charIndex + ', chunkIndex=' + chunkIndex);
    this.engine.speakFrom(chunkIndex, this.currentChunks);
    this.setChapterTitle(content.chapterTitle);
    this.setTotalChunks(this.currentChunks.length);
    this.setCurrentIndex(chunkIndex);
    this.updatePlayIcon(true);
  };

  TTSPlayer.prototype.resumeFrom = function (state) {
    var chunks = this.currentChunks;
    this.engine.speakFrom(state.chunkIndex, chunks);
    this.setChapterTitle(state.chapterTitle);
    this.setTotalChunks(chunks.length);
    this.setCurrentIndex(state.chunkIndex);
    this.updatePlayIcon(true);
    this.engine._rate = state.rate || this.settings.rate;
  };

  TTSPlayer.prototype.startNew = function (content) {
    this.engine.speak(content.text);
    this.setChapterTitle(content.chapterTitle);
    this.setTotalChunks(this.engine.chunks.length);
    this.setCurrentIndex(0);
    this.updatePlayIcon(true);
  };

  TTSPlayer.prototype.onChunkEnd = function (index) { this.setCurrentIndex(index); this.saveProgress(); };
  TTSPlayer.prototype.onAllEnd = function () { this.updatePlayIcon(false); this.setCurrentIndex(0); if (this.bookId) PlaybackStore.clear(this.bookId); };

  TTSPlayer.prototype.onEngineError = function (chunkIndex, error) {
    if (error === 'canceled' || error === 'interrupted') return;
    if (error.indexOf('中文语音') >= 0 || error.indexOf('不支持') >= 0) { this.showError(error); }
    else { this.showError('朗读出错（第' + chunkIndex + '段）：' + error); }
  };

  // ---- UI 辅助 ----
  TTSPlayer.prototype.setChapterTitle = function (v) { var el = this.container.querySelector('.tts-chapter-title'); if (el) el.textContent = v || '未知章节'; };
  TTSPlayer.prototype.setCurrentIndex = function (idx) {
    this._currentIndex = idx;
    var total = this._totalChunks || 1;
    var posEl = this.container.querySelector('.tts-pos-text');
    var fillEl = this.container.querySelector('.tts-progress-bar-fill');
    if (posEl) posEl.textContent = idx + '/' + total;
    if (fillEl) fillEl.style.width = ((idx / total) * 100) + '%';
  };
  TTSPlayer.prototype.setTotalChunks = function (v) { this._totalChunks = v; this.setCurrentIndex(this._currentIndex || 0); };
  TTSPlayer.prototype.updatePlayIcon = function (playing) { var btn = this.container.querySelector('.tts-play-btn'); if (btn) btn.textContent = playing ? '⏸' : '▶'; };
  TTSPlayer.prototype.updateRateUI = function () {
    var sel = this.container.querySelector('.tts-rate-select');
    var slider = this.settingsPanel.querySelector('.tts-rate-slider');
    var valLabel = this.settingsPanel.querySelector('.tts-rate-value');
    if (sel) sel.value = String(this.settings.rate);
    if (slider) slider.value = String(this.settings.rate);
    if (valLabel) valLabel.textContent = this.settings.rate + 'x';
  };
  TTSPlayer.prototype.updatePosition = function () { this.setCurrentIndex(this.engine.currentChunkIndex); };

  TTSPlayer.prototype.showError = function (message) {
    var bar = this.container.querySelector('.tts-error-bar');
    var msg = this.container.querySelector('.tts-error-msg');
    if (bar && msg) { msg.textContent = message; bar.classList.add('tts-error-visible'); }
  };
  TTSPlayer.prototype.hideError = function () {
    var bar = this.container.querySelector('.tts-error-bar');
    if (bar) bar.classList.remove('tts-error-visible');
  };

  TTSPlayer.prototype.chunkText = function (text, maxChars) {
    if (maxChars === undefined) maxChars = 300;
    var re = /.*?[。！？\n]|.+$/gs;
    var matches = [], m;
    while ((m = re.exec(text)) !== null) { matches.push(m[0]); if (m[0].length === 0) { re.lastIndex++; } }
    var chunks = [], buffer = '';
    for (var i = 0; i < matches.length; i++) {
      var trimmed = matches[i].trim();
      if (!trimmed) continue;
      if (trimmed.length > maxChars) {
        if (buffer.trim()) { chunks.push(buffer.trim()); buffer = ''; }
        for (var j = 0; j < trimmed.length; j += maxChars) { chunks.push(trimmed.slice(j, j + maxChars)); }
        continue;
      }
      if ((buffer + trimmed).length > maxChars && buffer) { chunks.push(buffer.trim()); buffer = trimmed; }
      else { buffer += trimmed; }
    }
    if (buffer.trim()) chunks.push(buffer.trim());
    return chunks.length > 0 ? chunks : [text];
  };

  TTSPlayer.prototype.saveProgress = function () {
    if (!this.bookId || !this.currentContent) return;
    PlaybackStore.save({
      bookId: this.bookId,
      chapterTitle: this.currentContent.chapterTitle,
      chapterIndex: this.currentContent.chapterIndex,
      chunkIndex: this.engine.currentChunkIndex,
      rate: this.engine._rate,
      voiceName: this.settings.voiceName
    }, this.currentContent.text);
  };

  TTSPlayer.prototype.makeBookId = function (content) {
    try { return 'book_' + location.hostname + '_' + btoa(content.chapterTitle).slice(0, 16); }
    catch (e) { return 'book_' + Date.now(); }
  };

  // ============================================================
  // 6. 启动
  // ============================================================
  window.__WX_READ_TTS__ = new TTSPlayer();

})();
