/**
 * TTS 注入脚本 —— 内联版本（无模块依赖）
 * 此文件会被 main.ts 读取并通过 executeJavaScript 注入到微信读书页面
 * 所有逻辑内联，不使用 import/export，确保在页面上下文中直接运行
 */

(function () {
  'use strict';

  // ============================================================
  // 1. Web Speech API 引擎
  // ============================================================
  class WebTTSEngine {
    constructor() {
      this.utterance = null;
      this.currentChunkIndex = 0;
      this.chunks = [];
      this._rate = 1;
      this._voice = null;
      this._isPlaying = false;
      this._isPaused = false;
      this.onChunkEnd = null;
      this.onAllEnd = null;
    }

    static getChineseVoices() {
      return speechSynthesis.getVoices().filter(function (v) {
        return v.lang.startsWith('zh') || v.lang.includes('CN');
      });
    }

    get rate() { return this._rate; }
    set rate(v) {
      this._rate = Math.max(0.25, Math.min(4, v));
      if (this.utterance) this.utterance.rate = this._rate;
    }

    get voice() { return this._voice; }
    set voice(v) { this._voice = v; }
    get isPlaying() { return this._isPlaying; }
    get isPaused() { return this._isPaused; }
    get currentIndex() { return this.currentChunkIndex; }
    get totalChunks() { return this.chunks.length; }

    setCallbacks(opts) {
      this.onChunkEnd = opts.onChunkEnd || null;
      this.onAllEnd = opts.onAllEnd || null;
    }

    speak(text) {
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

    speakFrom(chunkIndex, chunks) {
      this.cancel();
      this.chunks = chunks;
      this.currentChunkIndex = chunkIndex;
      this._isPlaying = true;
      this._isPaused = false;
      this.speakCurrentChunk();
    }

    pause() {
      if (speechSynthesis.speaking && !speechSynthesis.paused) {
        speechSynthesis.pause();
        this._isPaused = true;
      }
    }

    resume() {
      if (speechSynthesis.paused) {
        speechSynthesis.resume();
        this._isPaused = false;
      }
    }

    cancel() {
      speechSynthesis.cancel();
      this.utterance = null;
      this._isPlaying = false;
      this._isPaused = false;
    }

    previous() {
      if (this.currentChunkIndex > 0) {
        this.currentChunkIndex--;
        this.speakCurrentChunk();
        return true;
      }
      return false;
    }

    next() {
      if (this.currentChunkIndex < this.chunks.length - 1) {
        this.currentChunkIndex++;
        this.speakCurrentChunk();
        return true;
      }
      return false;
    }

    speakCurrentChunk() {
      var self = this;
      if (this.currentChunkIndex >= this.chunks.length) {
        this._isPlaying = false;
        if (this.onAllEnd) this.onAllEnd();
        return;
      }

      var text = this.chunks[this.currentChunkIndex];
      if (!text || !text.trim()) {
        this.currentChunkIndex++;
        this.speakCurrentChunk();
        return;
      }

      this.utterance = new SpeechSynthesisUtterance(text);
      this.utterance.rate = this._rate;
      this.utterance.lang = 'zh-CN';
      if (this._voice) this.utterance.voice = this._voice;

      this.utterance.onend = function () {
        self.currentChunkIndex++;
        if (self.onChunkEnd) self.onChunkEnd(self.currentChunkIndex);
        if (self._isPlaying && !self._isPaused) {
          self.speakCurrentChunk();
        }
      };

      this.utterance.onerror = function (e) {
        console.warn('[TTS] 片段 ' + self.currentChunkIndex + ' 朗读错误:', e.error);
        self.currentChunkIndex++;
        if (self._isPlaying && !self._isPaused) {
          self.speakCurrentChunk();
        }
      };

      speechSynthesis.speak(this.utterance);
    }

    splitIntoChunks(text, maxChars) {
      if (maxChars === undefined) maxChars = 300;
      var sentences = text.split(/(?<=[。！？\n])/g);
      var chunks = [];
      var buffer = '';
      for (var i = 0; i < sentences.length; i++) {
        var trimmed = sentences[i].trim();
        if (!trimmed) continue;
        if ((buffer + trimmed).length > maxChars && buffer) {
          chunks.push(buffer.trim());
          buffer = trimmed;
        } else {
          buffer = buffer ? buffer + trimmed : trimmed;
        }
      }
      if (buffer.trim()) chunks.push(buffer.trim());
      return chunks.length > 0 ? chunks : [text];
    }
  }

  // ============================================================
  // 2. 文本提取器
  // ============================================================
  var TextExtractor = {
    extract: function () {
      var text = TextExtractor.extractText();
      if (!text || text.trim().length < 10) {
        console.warn('[TTS] 未在页面中提取到有效文本');
        return null;
      }
      return {
        text: text.trim(),
        chapterTitle: TextExtractor.extractChapterTitle(),
        chapterIndex: TextExtractor.extractChapterInfo().index,
        totalChapters: TextExtractor.extractChapterInfo().total,
      };
    },

    extractText: function () {
      var selectors = [
        '.readerContent', '.render-text-container', '[class*="readerText"]',
        '[class*="render_text"]', '.text-content', 'article', '.content',
        '#j_content', 'main'
      ];
      for (var i = 0; i < selectors.length; i++) {
        var el = document.querySelector(selectors[i]);
        if (el) {
          var t = TextExtractor.cleanText(el.textContent || '');
          if (t.length > 20) return t;
        }
      }
      return TextExtractor.scanForContent();
    },

    cleanText: function (raw) {
      return raw.replace(/\s+/g, ' ')
        .replace(/[^\u4e00-\u9fa5a-zA-Z0-9，。！？、；：""''（）\n\r\s\.\,\!\?\;\:\(\)\-\—]/g, '')
        .trim();
    },

    scanForContent: function () {
      var bestEl = null, maxLength = 0;
      var skipSelectors = ['nav', 'header', 'footer', 'aside', '[role="navigation"]', 'script', 'style', '.toolbar', '.sidebar'];
      var candidates = document.querySelectorAll('div, section, article, main');
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        var shouldSkip = false;
        for (var j = 0; j < skipSelectors.length; j++) {
          if (el.matches(skipSelectors[j]) || el.closest(skipSelectors[j])) { shouldSkip = true; break; }
        }
        if (shouldSkip) continue;
        var text = (el.textContent || '').trim();
        var chineseCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
        if (chineseCount > maxLength && chineseCount > 50) { maxLength = chineseCount; bestEl = el; }
      }
      return bestEl ? TextExtractor.cleanText(bestEl.textContent || '') : '';
    },

    extractChapterTitle: function () {
      var selectors = ['.chapter-title', '.chapter_title', '[class*="chapterTitle"]',
        '.current-chapter h1', '.chapterInfo_title', 'h1.title', '.title'];
      for (var i = 0; i < selectors.length; i++) {
        var el = document.querySelector(selectors[i]);
        if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
      }
      return '未知章节';
    },

    extractChapterInfo: function () {
      try {
        var activeItem = document.querySelector('[class*="chapter"][class*="active"], [class*="chapter_item"][class*="selected"]');
        if (activeItem) {
          var siblings = activeItem.parentElement ? activeItem.parentElement.children : null;
          if (siblings) {
            var idx = Array.prototype.indexOf.call(siblings, activeItem);
            return { index: idx >= 0 ? idx : 0, total: siblings.length };
          }
        }
      } catch (e) { /* ignore */ }
      return { index: 0, total: 1 };
    }
  };

  // ============================================================
  // 3. 播放状态持久化
  // ============================================================
  var PlaybackStore = {
    PREFIX: 'tts_playback_',
    save: function (state) {
      var existing = PlaybackStore.load(state.bookId);
      var merged = Object.assign({}, existing, state, { timestamp: Date.now() });
      try {
        localStorage.setItem(PlaybackStore.PREFIX + state.bookId, JSON.stringify(merged));
      } catch (e) { console.warn('[TTS] 保存播放进度失败:', e); }
    },
    load: function (bookId) {
      try {
        var raw = localStorage.getItem(PlaybackStore.PREFIX + bookId);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },
    clear: function (bookId) {
      localStorage.removeItem(PlaybackStore.PREFIX + bookId);
    },
    clearAll: function () {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(PlaybackStore.PREFIX) === 0) keys.push(k);
      }
      keys.forEach(function (k) { localStorage.removeItem(k); });
    }
  };

  var DEFAULT_SETTINGS = { rate: 1, voiceName: null, autoExtract: true };

  var SettingsStore = {
    KEY: 'tts_settings',
    save: function (partial) {
      var current = SettingsStore.load();
      var merged = Object.assign({}, current, partial);
      try { localStorage.setItem(SettingsStore.KEY, JSON.stringify(merged)); }
      catch (e) { console.warn('[TTS] 保存设置失败:', e); }
    },
    load: function () {
      try {
        var raw = localStorage.getItem(SettingsStore.KEY);
        return raw ? Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw)) : Object.assign({}, DEFAULT_SETTINGS);
      } catch (e) { return Object.assign({}, DEFAULT_SETTINGS); }
    }
  };

  // ============================================================
  // 4. 悬浮播放器 UI
  // ============================================================
  var PLAYER_CSS = '#wx-read-tts-player{position:fixed;bottom:20px;right:20px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;user-select:none;transition:opacity .3s ease,transform .3s ease}#wx-read-tts-player.tts-hidden{opacity:0;pointer-events:none;transform:translateY(20px)}#wx-read-tts-player .tts-bar{display:flex;align-items:center;gap:6px;background:rgba(30,30,34,.95);backdrop-filter:blur(12px);border-radius:14px;padding:8px 12px;box-shadow:0 4px 24px rgba(0,0,0,.4),0 0 1px rgba(255,255,255,.1);color:#e8e8e8;font-size:13px;min-width:320px}#wx-read-tts-player .tts-btn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:none;border-radius:50%;background:transparent;color:#ccc;cursor:pointer;transition:background .15s,color .15s,transform .1s;flex-shrink:0}#wx-read-tts-player .tts-btn:hover{background:rgba(255,255,255,.12);color:#fff}#wx-read-tts-btn:active{transform:scale(.92)}#wx-read-tts-player .tts-btn.tts-play-btn{width:40px;height:40px;background:#1aad63;color:#fff}#wx-read-tts-player .tts-btn.tts-play-btn:hover{background:#1bc06d}#wx-read-tts-player .tts-chapter-info{flex:1;min-width:0;overflow:hidden}#wx-read-tts-player .tts-chapter-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;color:#aaa;margin-bottom:2px}#wx-read-tts-player .tts-progress-line{display:flex;align-items:center;gap:6px;font-size:11px;color:#888}#wx-read-tts-player .tts-progress-bar-bg{flex:1;height:3px;background:rgba(255,255,255,.15);border-radius:2px;overflow:hidden;cursor:pointer}#wx-read-tts-player .tts-progress-bar-fill{height:100%;background:#1aad63;border-radius:2px;transition:width .2s linear;width:0}#wx-read-tts-player .tts-rate-select{appearance:none;-webkit-appearance:none;background:rgba(255,255,255,.08);border:none;border-radius:6px;color:#ddd;font-size:12px;padding:4px 6px;cursor:pointer;outline:none;min-width:48px}#wx-read-tts-player .tts-rate-select option{background:#2a2a2e;color:#fff}#wx-read-tts-player .tts-divider{width:1px;height:20px;background:rgba(255,255,255,.15);flex-shrink:0}#wx-read-tts-settings{position:fixed;bottom:90px;right:20px;z-index:2147483647;background:rgba(30,30,34,.97);backdrop-filter:blur(16px);border-radius:14px;padding:18px 20px;box-shadow:0 8px 32px rgba(0,0,0,.5);color:#e8e8e8;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;font-size:13px;min-width:280px;display:none;user-select:none}#wx-read-tts-settings.tts-visible{display:block}#wx-read-tts-settings .tts-setting-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}#wx-read-tts-settings .tts-setting-row:last-child{margin-bottom:0}#wx-read-tts-settings label{color:#aaa;font-size:12px}#wx-read-tts-settings select,#wx-read-tts-settings input[type=range]{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);border-radius:6px;color:#ddd;font-size:12px;padding:4px 8px;outline:none;cursor:pointer}#wx-read-tts-settings select option{background:#2a2a2e}#wx-read-tts-settings input[type=range]{-webkit-appearance:none;width:120px;padding:0;border:none;height:4px;border-radius:2px}#wx-read-tts-settings input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#1aad63;cursor:pointer;border:2px solid #fff}#wx-read-tts-settings .tts-set-title{font-weight:600;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,.08);font-size:14px}';

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
      '<button class="tts-btn tts-close-btn" title="关闭">×</button></div></div>' +
      '<div id="wx-read-tts-settings"><div class="tts-set-title">TTS 朗读设置</div>' +
      '<div class="tts-setting-row"><label>语音选择</label><select class="tts-voice-select"><option value="">加载中...</option></select></div>' +
      '<div class="tts-setting-row"><label>朗读速度</label><input type="range" class="tts-rate-slider" min="0.25" max="3" step="0.25" value="1"><span class="tts-rate-value">1x</span></div>' +
      '<div class="tts-setting-row"><label>自动提取文本</label><input type="checkbox" class="tts-auto-extract" checked></div>' +
      '<div class="tts-setting-row"><label>断点续播</label><input type="checkbox" class="tts-resume-toggle" checked></div></div>';
  }

  // ============================================================
  // 5. 主播放器 —— 编排所有组件
  // ============================================================
  function TTSPlayer() {
    var self = this;
    this.engine = new WebTTSEngine();
    this.settings = SettingsStore.load();
    this.currentContent = null;
    this.currentChunks = [];
    this.bookId = '';
    this._totalChunks = 0;

    // 注入样式和 HTML
    var styleEl = document.createElement('style');
    styleEl.textContent = PLAYER_CSS;
    document.head.appendChild(styleEl);
    var wrapper = document.createElement('div');
    wrapper.innerHTML = createPlayerHTML();
    document.body.appendChild(wrapper);

    this.container = document.getElementById('wx-read-tts-player');
    this.settingsPanel = document.getElementById('wx-read-tts-settings');

    // 应用保存的设置
    this.engine.rate = this.settings.rate;

    // 绑定引擎回调
    this.engine.setCallbacks({
      onChunkEnd: function (idx) { self.onChunkEnd(idx); },
      onAllEnd: function () { self.onAllEnd(); }
    });

    // 初始化语音列表
    this.initVoices();

    // 显示播放器
    this.container.classList.remove('tts-hidden');
    this.updateRateUI();

    // ---- UI 事件绑定 ----
    this.container.querySelector('.tts-play-btn').addEventListener('click', function () { self.togglePlay(); });
    this.container.querySelector('.tts-prev-btn').addEventListener('click', function () { self.previous(); });
    this.container.querySelector('.tts-next-btn').addEventListener('click', function () { self.next(); });
    this.container.querySelector('.tts-close-btn').addEventListener('click', function () { self.close(); });
    this.container.querySelector('.tts-settings-btn').addEventListener('click', function () { self.toggleSettings(); });

    this.container.querySelector('.tts-rate-select').addEventListener('change', function (e) {
      self.setRate(parseFloat(e.target.value));
    });

    this.settingsPanel.querySelector('.tts-rate-slider').addEventListener('input', function (e) {
      self.setRate(parseFloat(e.target.value));
    });

    this.settingsPanel.querySelector('.tts-voice-select').addEventListener('change', function (e) {
      var name = e.target.value || null;
      self.setVoice(name);
    });

    document.addEventListener('mousedown', function (e) {
      if (self.settingsPanel.classList.contains('tts-visible')) {
        if (!self.settingsPanel.contains(e.target) && !self.container.contains(e.target)) {
          self.settingsPanel.classList.remove('tts-visible');
        }
      }
    });

    console.log('[TTS] 微信读书听书功能已加载 ✅');
  }

  // ---- 语音初始化 ----
  TTSPlayer.prototype.initVoices = function () {
    var self = this;
    function loadVoices() {
      var voices = WebTTSEngine.getChineseVoices();
      if (voices.length > 0) {
        self.populateVoices(voices, self.settings.voiceName);
        if (self.settings.voiceName) {
          var match = voices.find(function (v) { return v.name === self.settings.voiceName; });
          if (match) self.engine.voice = match;
        }
      }
    }
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = loadVoices;
    }
    loadVoices();
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

  // ---- 播放控制 ----
  TTSPlayer.prototype.togglePlay = function () {
    if (this.engine.isPlaying && !this.engine.isPaused) {
      this.engine.pause();
      this.updatePlayIcon(false);
    } else if (this.engine.isPaused) {
      this.engine.resume();
      this.updatePlayIcon(true);
    } else {
      this.extractAndPlay();
    }
  };

  TTSPlayer.prototype.previous = function () {
    if (this.engine.previous()) { this.saveProgress(); this.updatePosition(); }
  };

  TTSPlayer.prototype.next = function () {
    if (this.engine.next()) { this.saveProgress(); this.updatePosition(); }
  };

  TTSPlayer.prototype.setRate = function (rate) {
    this.engine.rate = rate;
    this.settings.rate = rate;
    this.updateRateUI();
    SettingsStore.save({ rate: rate });
  };

  TTSPlayer.prototype.setVoice = function (name) {
    var voices = speechSynthesis.getVoices();
    var match = name ? voices.find(function (v) { return v.name === name; }) : null;
    this.engine.voice = match;
    this.settings.voiceName = name;
    SettingsStore.save({ voiceName: name });
  };

  TTSPlayer.prototype.close = function () {
    this.engine.cancel();
    this.container.classList.add('tts-hidden');
    this.settingsPanel.classList.remove('tts-visible');
  };

  TTSPlayer.prototype.toggleSettings = function () {
    this.settingsPanel.classList.toggle('tts-visible');
  };

  // ---- 文本提取与播放 ----
  TTSPlayer.prototype.extractAndPlay = function () {
    var content = TextExtractor.extract();
    if (!content) {
      alert('未能提取到文本内容，请确保已在阅读页面打开一本书。');
      return;
    }
    this.currentContent = content;
    this.currentChunks = this.chunkText(content.text);
    this.bookId = this.makeBookId(content);

    // 断点续播检查
    if (this.settings.autoExtract) {
      var saved = PlaybackStore.load(this.bookId);
      if (saved && saved.chunkIndex > 0 && saved.chunkIndex < this.currentChunks.length) {
        if (confirm('检测到上次在「' + saved.chapterTitle + '」第 ' + saved.chunkIndex + ' 段停止，是否继续？')) {
          this.resumeFrom(saved);
          return;
        }
      }
    }

    this.startNew(content);
  };

  TTSPlayer.prototype.resumeFrom = function (state) {
    var chunks = state.text ? this.chunkText(state.text) : this.currentChunks;
    this.engine.speakFrom(state.chunkIndex, chunks);
    this.setChapterTitle(state.chapterTitle);
    this.setTotalChunks(chunks.length);
    this.setCurrentIndex(state.chunkIndex);
    this.updatePlayIcon(true);
    this.engine.rate = state.rate || this.settings.rate;
  };

  TTSPlayer.prototype.startNew = function (content) {
    this.engine.speak(content.text);
    this.setChapterTitle(content.chapterTitle);
    this.setTotalChunks(this.engine.totalChunks);
    this.setCurrentIndex(0);
    this.updatePlayIcon(true);
  };

  // ---- 回调 ----
  TTSPlayer.prototype.onChunkEnd = function (index) {
    this.setCurrentIndex(index);
    this.saveProgress();
  };

  TTSPlayer.prototype.onAllEnd = function () {
    this.updatePlayIcon(false);
    this.setCurrentIndex(0);
    if (this.bookId) PlaybackStore.clear(this.bookId);
  };

  // ---- UI 更新辅助 ----
  TTSPlayer.prototype.setChapterTitle = function (v) {
    var el = this.container.querySelector('.tts-chapter-title');
    if (el) el.textContent = v || '未知章节';
  };

  TTSPlayer.prototype.setCurrentIndex = function (idx) {
    this._currentIndex = idx;
    var total = this._totalChunks || 1;
    var posEl = this.container.querySelector('.tts-pos-text');
    var fillEl = this.container.querySelector('.tts-progress-bar-fill');
    if (posEl) posEl.textContent = idx + '/' + total;
    if (fillEl) fillEl.style.width = ((idx / total) * 100) + '%';
  };

  TTSPlayer.prototype.setTotalChunks = function (v) {
    this._totalChunks = v;
    this.setCurrentIndex(this._currentIndex || 0);
  };

  TTSPlayer.prototype.updatePlayIcon = function (playing) {
    var btn = this.container.querySelector('.tts-play-btn');
    if (btn) btn.textContent = playing ? '⏸' : '▶';
  };

  TTSPlayer.prototype.updateRateUI = function () {
    var sel = this.container.querySelector('.tts-rate-select');
    var slider = this.settingsPanel.querySelector('.tts-rate-slider');
    var valLabel = this.settingsPanel.querySelector('.tts-rate-value');
    if (sel) sel.value = String(this.settings.rate);
    if (slider) slider.value = String(this.settings.rate);
    if (valLabel) valLabel.textContent = this.settings.rate + 'x';
  };

  TTSPlayer.prototype.updatePosition = function () {
    this.setCurrentIndex(this.engine.currentIndex);
  };

  // ---- 分片 ----
  TTSPlayer.prototype.chunkText = function (text, maxChars) {
    if (maxChars === undefined) maxChars = 300;
    var sentences = text.split(/(?<=[。！？\n])/g);
    var chunks = [], buffer = '';
    for (var i = 0; i < sentences.length; i++) {
      var trimmed = sentences[i].trim();
      if (!trimmed) continue;
      if ((buffer + trimmed).length > maxChars && buffer) {
        chunks.push(buffer.trim());
        buffer = trimmed;
      } else {
        buffer = buffer ? buffer + trimmed : trimmed;
      }
    }
    if (buffer.trim()) chunks.push(buffer.trim());
    return chunks.length > 0 ? chunks : [text];
  };

  // ---- 持久化 ----
  TTSPlayer.prototype.saveProgress = function () {
    if (!this.bookId || !this.currentContent) return;
    PlaybackStore.save({
      bookId: this.bookId,
      chapterTitle: this.currentContent.chapterTitle,
      chapterIndex: this.currentContent.chapterIndex,
      chunkIndex: this.engine.currentIndex,
      text: this.currentContent.text,
      rate: this.engine.rate,
      voiceName: this.settings.voiceName
    });
  };

  TTSPlayer.prototype.makeBookId = function (content) {
    try {
      return 'book_' + location.hostname + '_' + btoa(content.chapterTitle).slice(0, 16);
    } catch (e) {
      return 'book_' + Date.now();
    }
  };

  // ============================================================
  // 6. 启动
  // ============================================================
  window.__WX_READ_TTS__ = new TTSPlayer();

})();
