/**
 * TTS 注入脚本 —— 微信读书听书 v4（彻底重做）
 *
 * 核心改进：
 * 1. 文本提取：多策略 + 可见区域优先 + 兜底 body 全文
 * 2. 原生选区工具栏注入"朗读"按钮（不再用浮动按钮）
 * 3. 自动断点续播（无需确认弹窗）
 * 4. 播放器 UI 优化：状态清晰、错误友好
 */

(function () {
  'use strict';

  var DEBUG = true;
  function log() { if (DEBUG) { var args = Array.prototype.slice.call(arguments); args.unshift('[TTS]'); console.log.apply(console, args); } }
  function warn() { if (DEBUG) { var args = Array.prototype.slice.call(arguments); args.unshift('[TTS]'); console.warn.apply(console, args); } }

  // ============================================================
  // 1. Web Speech API 引擎
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
      return { supported: false, hasChineseVoice: false, voices: [], message: '浏览器不支持语音合成' };
    }
    var allVoices = speechSynthesis.getVoices();
    var zhVoices = allVoices.filter(function (v) { return v.lang.startsWith('zh') || v.lang.includes('CN'); });
    if (zhVoices.length === 0) {
      return { supported: true, hasChineseVoice: false, voices: [], message: '未检测到中文语音' };
    }
    return { supported: true, hasChineseVoice: true, voices: zhVoices, message: 'OK' };
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
    if (!('speechSynthesis' in window)) { if (this.onError) this.onError(0, '不支持语音合成'); return; }
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
    log('从第', chunkIndex + 1, '段开始，共', chunks.length, '段');
    this.speakCurrentChunk();
  };

  WebTTSEngine.prototype.pause = function () {
    if (speechSynthesis.speaking && !speechSynthesis.paused) { speechSynthesis.pause(); this._isPaused = true; }
  };

  WebTTSEngine.prototype.resume = function () {
    if (speechSynthesis.paused) { speechSynthesis.resume(); this._isPaused = false; }
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
      log('朗读完毕');
      if (this.onAllEnd) this.onAllEnd();
      return;
    }
    var text = this.chunks[this.currentChunkIndex];
    if (!text || !text.trim()) { this.currentChunkIndex++; this.speakCurrentChunk(); return; }

    this.utterance = new SpeechSynthesisUtterance(text);
    this.utterance.rate = this._rate;
    this.utterance.volume = 1;
    this.utterance.lang = 'zh-CN';
    if (this._voice) this.utterance.voice = this._voice;

    log('[' + (this.currentChunkIndex + 1) + '/' + this.chunks.length + '] ', text.slice(0, 40));

    this.utterance.onstart = function () {};
    this.utterance.onend = function () {
      self.currentChunkIndex++;
      if (self.onChunkEnd) self.onChunkEnd(self.currentChunkIndex);
      if (self._isPlaying && !self._isPaused) self.speakCurrentChunk();
    };
    this.utterance.onerror = function (e) {
      warn('onerror:', e.error);
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
  // 2. 文本提取器 —— 多策略，确保能提取到内容
  // ============================================================
  var TextExtractor = {
    /** 提取正文，返回 { text, chapterTitle } 或 null */
    extract: function () {
      var text = TextExtractor.extractText();
      if (!text || text.trim().length < 10) {
        warn('文本提取失败，长度:', text ? text.length : 0);
        return null;
      }
      return {
        text: text.trim(),
        chapterTitle: TextExtractor.extractChapterTitle()
      };
    },

    /** 核心提取：多策略依次尝试 */
    extractText: function () {
      // 策略1：直接收集页面中所有可见的段落文本（最可靠）
      var result = TextExtractor.extractVisibleParagraphs();
      if (result && result.length > 20) return result;

      // 策略2：已知微信读书选择器
      var knownSelectors = [
        '.readerContent', '.render-text-container',
        '[class*="readerText"]', '[class*="render_text"]',
        '.text-content', 'article', '.content',
        '#j_content', 'main', '.reader_content',
        '[class*="chapter"]', '[class*="readerChapter"]'
      ];
      for (var i = 0; i < knownSelectors.length; i++) {
        var el = document.querySelector(knownSelectors[i]);
        if (el) {
          var t = TextExtractor.cleanText(el.textContent || '');
          if (t.length > 20) { log('提取成功(选择器):', knownSelectors[i], '长度:', t.length); return t; }
        }
      }

      // 策略3：找中文最多的容器
      var best = TextExtractor.findBestContainer();
      if (best && best.text.length > 20) { log('提取成功(最佳容器), 长度:', best.text.length); return best.text; }

      // 策略4：兜底 — 收集 body 中所有含中文的文本节点
      var fallback = TextExtractor.extractFromBody();
      if (fallback.length > 20) { log('提取成功(body兜底), 长度:', fallback.length); return fallback; }

      warn('所有提取策略均失败');
      return '';
    },

    /** 策略1：收集可见区域内的段落文本 */
    extractVisibleParagraphs: function () {
      var texts = [];

      // 先尝试 p 标签
      var ps = document.querySelectorAll('p');
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        var t = (p.textContent || '').trim();
        if (t.length < 4) continue;
        // 跳过明显非正文的元素
        var cls = (p.className || '').toLowerCase();
        if (cls.indexOf('toolbar') >= 0 || cls.indexOf('menu') >= 0 ||
            cls.indexOf('nav') >= 0 || cls.indexOf('footer') >= 0 ||
            cls.indexOf('header') >= 0 || cls.indexOf('sidebar') >= 0) continue;
        var rect = p.getBoundingClientRect();
        // 跳过不可见元素但保留即将可见的（高度为0可能是还没渲染）
        if (rect.width === 0 && rect.height === 0 && t.length < 10) continue;
        texts.push(t);
      }

      if (texts.length >= 3) {
        log('提取到', texts.length, '个段落');
        return texts.join('\n');
      }

      // 如果 p 太少，尝试 div/span 中含中文较多的元素
      var allEls = document.querySelectorAll('div, section, span');
      var candidates = [];
      for (var j = 0; j < allEls.length; j++) {
        var el = allEls[j];
        var et = (el.textContent || '').trim();
        var chineseCount = (et.match(/[\u4e00-\u9fa5]/g) || []).length;
        if (chineseCount > 30 && et.length < 50000) {
          candidates.push({ el: el, text: et, chinese: chineseCount });
        }
      }
      // 取中文最多的前几个合并
      candidates.sort(function (a, b) { return b.chinese - a.chinese; });
      if (candidates.length > 0) {
        return candidates[0].text;
      }

      return texts.join('\n');
    },

    /** 策略3：找中文密度最高的容器 */
    findBestContainer: function () {
      var skip = ['script', 'style', 'noscript', 'nav', 'header', 'footer', 'aside'];
      var candidates = document.querySelectorAll('div, section, article, main');
      var best = null, bestScore = 0;
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        var skipEl = false;
        for (var j = 0; j < skip.length; j++) {
          if (el.tagName.toLowerCase() === skip[j] || el.closest(skip[j])) { skipEl = true; break; }
        }
        if (skipEl) continue;
        var t = (el.textContent || '').trim();
        var chinese = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
        var ratio = chinese / (t.length || 1);
        // 中文占比高 + 中文数量多 = 好候选
        var score = chinese * ratio;
        if (score > bestScore && chinese > 50) { bestScore = score; best = { el: el, text: TextExtractor.cleanText(t) }; }
      }
      return best;
    },

    /** 策略4：body 兜底 */
    extractFromBody: function () {
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
      var texts = [];
      while (walker.nextNode()) {
        var node = walker.currentNode;
        var t = node.textContent.trim();
        if (t.length < 2) continue;
        var parent = node.parentElement;
        if (!parent) continue;
        var tag = parent.tagName.toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'noscript') continue;
        // 只要包含中文就收录
        if (/[\u4e00-\u9fa5]/.test(t)) texts.push(t);
      }
      return texts.join('\n');
    },

    cleanText: function (raw) {
      return raw
        .replace(/\s+/g, ' ')
        .replace(/[^\u4e00-\u9fa5a-zA-Z0-9，。！？、；：""''（）\n\r\s\.\,\!\?\;\:\(\)\-\—\·]/g, '')
        .trim();
    },

    extractChapterTitle: function () {
      var sel = ['.chapter-title', '.chapter_title', '[class*="chapterTitle"]',
        '.current-chapter h1', '.chapterInfo_title', 'h1.title', '.title',
        '[class*="chapter"][class*="title"]'];
      for (var i = 0; i < sel.length; i++) {
        var el = document.querySelector(sel[i]);
        if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
      }
      // 尝试从 URL 或页面标题获取
      var title = document.title || '';
      if (title && title !== '微信读书') return title.replace(/_.*$/, '');
      return '当前章节';
    },

    /** 找到正文容器的 DOM 元素 */
    findContentElement: function () {
      var selectors = ['.readerContent', '.render-text-container', '[class*="readerText"]',
        '[class*="render_text"]', '.text-content', 'article', '.content', 'main'];
      for (var i = 0; i < selectors.length; i++) {
        var el = document.querySelector(selectors[i]);
        if (el && (el.textContent || '').trim().length > 20) return el;
      }
      var best = TextExtractor.findBestContainer();
      return best ? best.el : null;
    },

    /** 找可视区域中心对应的 chunkIndex */
    findVisibleChunkIndex: function (fullText, chunks) {
      var contentEl = TextExtractor.findContentElement();
      if (!contentEl) return 0;
      var centerY = window.innerHeight / 2;
      var items = contentEl.querySelectorAll('p, div, span, [class*="text"], [class*="paragraph"]');
      var bestEl = null, bestDist = Infinity;
      for (var i = 0; i < items.length; i++) {
        var r = items[i].getBoundingClientRect();
        if (r.height === 0) continue;
        var c = r.top + r.height / 2;
        var d = Math.abs(c - centerY);
        if (r.top < window.innerHeight && r.bottom > 0 && d < bestDist) {
          bestDist = d; bestEl = items[i];
        }
      }
      if (!bestEl) return 0;
      var elText = TextExtractor.cleanText(bestEl.textContent || '');
      if (!elText || elText.length < 4) return 0;
      var idx = fullText.indexOf(elText);
      if (idx === -1 && elText.length > 15) idx = fullText.indexOf(elText.slice(0, 15));
      if (idx === -1) return 0;
      var offset = 0;
      for (var j = 0; j < chunks.length; j++) {
        if (idx >= offset && idx < offset + chunks[j].length) return j;
        offset += chunks[j].length;
      }
      return 0;
    }
  };

  // ============================================================
  // 3. 持久化存储
  // ============================================================
  function simpleHash(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) { var c = str.charCodeAt(i); h = ((h << 5) - h) + c; h = h & h; }
    return (h >>> 0).toString(16);
  }

  var PlaybackStore = {
    PREFIX: 'wxread_tts_',
    save: function (bookId, state, text) {
      try {
        var data = {
          bookId: bookId,
          chapterTitle: state.chapterTitle || '',
          chunkIndex: state.chunkIndex || 0,
          totalChunks: state.totalChunks || 0,
          textHash: text ? simpleHash(text) : '',
          textLength: text ? text.length : 0,
          rate: state.rate || 1,
          voiceName: state.voiceName || null,
          timestamp: Date.now()
        };
        localStorage.setItem(PlaybackStore.PREFIX + bookId, JSON.stringify(data));
        log('进度已保存:', data.chunkIndex + '/' + data.totalChunks, data.chapterTitle);
      } catch (e) { warn('保存失败:', e); }
    },
    load: function (bookId) {
      try { var r = localStorage.getItem(PlaybackStore.PREFIX + bookId); return r ? JSON.parse(r) : null; }
      catch (e) { return null; }
    },
    clear: function (bookId) { try { localStorage.removeItem(PlaybackStore.PREFIX + bookId); } catch(e){} },
    getLastBookId: function () {
      try { return localStorage.getItem(PlaybackStore.PREFIX + '_lastBook') || ''; }
      catch (e) { return ''; }
    },
    setLastBookId: function (id) {
      try { localStorage.setItem(PlaybackStore.PREFIX + '_lastBook', id); } catch(e){}
    }
  };

  var SettingsStore = {
    KEY: 'wxread_tts_settings',
    DEFAULTS: { rate: 1, voiceName: null, autoResume: true },
    save: function (p) {
      try { var c = SettingsStore.load(); Object.assign(c, p); localStorage.setItem(SettingsStore.KEY, JSON.stringify(c)); }
      catch (e) {}
    },
    load: function () {
      try { var r = localStorage.getItem(SettingsStore.KEY); return r ? Object.assign({}, SettingsStore.DEFAULTS, JSON.parse(r)) : Object.assign({}, SettingsStore.DEFAULTS); }
      catch (e) { return Object.assign({}, SettingsStore.DEFAULTS); }
    }
  };

  // ============================================================
  // 4. 播放器 UI
  // ============================================================
  var CSS = '' +
    '#wxr-tts{position:fixed;bottom:16px;right:16px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;user-select:none}' +
    '#wxr-tts .bar{display:flex;align-items:center;gap:6px;background:rgba(32,32,36,.94);backdrop-filter:blur(16px);border-radius:14px;padding:8px 12px;box-shadow:0 4px 24px rgba(0,0,0,.45);color:#eee;font-size:13px;min-width:300px}' +
    '#wxr-tts .bar button{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border:none;border-radius:50%;background:transparent;color:#bbb;cursor:pointer;font-size:15px;transition:all .15s;flex-shrink:0}' +
    '#wxr-tts .bar button:hover{background:rgba(255,255,255,.12);color:#fff}' +
    '#wxr-tts .bar button:active{transform:scale(.9)}' +
    '#wxr-tts .bar button.play-btn{width:42px;height:42px;background:#1aad63;color:#fff;font-size:18px}' +
    '#wxr-tts .bar button.play-btn:hover{background:#1bc06d}' +
    '#wxr-tts .bar button.play-btn.playing{background:#e64340}' +
    '#wxr-tts .info{flex:1;min-width:0}' +
    '#wxr-tts .title{font-size:11px;color:#aaa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px}' +
    '#wxr-tts .progress{display:flex;align-items:center;gap:6px;font-size:11px;color:#888}' +
    '#wxr-tts .pos{min-width:36px;text-align:right}' +
    '#wxr-tts .pb-bg{flex:1;height:3px;background:rgba(255,255,255,.12);border-radius:2px;overflow:hidden;cursor:pointer}' +
    '#wxr-tts .pb-fill{height:100%;background:#1aad63;border-radius:2px;transition:width .2s;width:0%}' +
    '#wxr-tts .divider{width:1px;height:22px;background:rgba(255,255,255,.12)}' +
    '#wxr-tts select.rate{appearance:none;-webkit-appearance:none;background:rgba(255,255,255,.08);border:none;border-radius:6px;color:#ccc;font-size:11px;padding:4px 6px;cursor:pointer;outline:none;min-width:46px}' +
    '#wxr-tts select.rate option{background:#222;color:#fff}' +
    '#wxr-tts .err{display:none;background:rgba(200,60,60,.92);color:#ffd;padding:6px 12px;border-radius:0 0 14px 14px;margin-top:-4px;font-size:11px;line-height:1.4}' +
    '#wxr-tts .err.show{display:block}' +
    '#wxr-tts .err .close{float:right;cursor:pointer;margin-left:8px;font-weight:bold;color:#faa}' +

    /* 设置面板 */
    '#wxr-tts-set{position:fixed;bottom:84px;right:16px;z-index:2147483647;background:rgba(32,32,36,.97);backdrop-filter:blur(20px);border-radius:14px;padding:16px 18px;box-shadow:0 8px 36px rgba(0,0,0,.55);color:#eee;font-family:inherit;font-size:13px;min-width:260px;display:none;user-select:none}' +
    '#wxr-tts-set.show{display:block}' +
    '#wxr-tts-set h3{margin:0 0 12px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,.08);font-size:14px;font-weight:600}' +
    '#wxr-tts-set .row{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}' +
    '#wxr-tts-set .row:last-child{margin-bottom:0}' +
    '#wxr-tts-set label{color:#aaa;font-size:12px}' +
    '#wxr-tts-set select,#wxr-tts-set input[type=range]{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);border-radius:6px;color:#ddd;font-size:12px;padding:3px 6px;outline:none;cursor:pointer}' +
    '#wxr-tts-set input[type=range]{width:110px;padding:0;border:none;height:4px}' +
    '#wxr-tts-set input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#1aad63;cursor:pointer;border:2px solid #fff}' +

    /* 原生工具栏注入按钮 */
    '.wxr-tts-toolbar-btn{display:inline-flex;align-items:center;gap:3px;padding:4px 10px;margin-left:4px;border:none;border-radius:4px;background:rgba(26,173,99,.9);color:#fff;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap;vertical-align:middle;transition:background .15s}' +
    '.wxr-tts-toolbar-btn:hover{background:rgba(27,192,109,1)}' +
    '.wxr-tts-toolbar-btn:active{transform:scale(.95)}';

  function createPlayerHTML() {
    return '<div id="wxr-tts"><div class="bar">' +
      '<button class="prev" title="上一段">⏮</button>' +
      '<button class="play-btn" title="播放">▶</button>' +
      '<button class="next" title="下一段">⏭</button>' +
      '<div class="info"><div class="title">点击 ▶ 开始朗读</div>' +
      '<div class="progress"><span class="pos">0/0</span><div class="pb-bg"><div class="pb-fill"></div></div></div></div>' +
      '<div class="divider"></div>' +
      '<select class="rate" title="语速"><option value="0.5">0.5x</option><option value="0.75">0.75x</option>' +
      '<option value="1" selected>1x</option><option value="1.25">1.25x</option>' +
      '<option value="1.5">1.5x</option><option value="2">2x</option></select>' +
      '<button class="set-btn" title="设置">⚙</button>' +
      '<button class="close-btn" title="关闭">×</button></div>' +
      '<div class="err"><span class="close">×</span><span class="msg"></span></div></div>' +
      '<div id="wxr-tts-set"><h3>朗读设置</h3>' +
      '<div class="row"><label>语音</label><select class="voice-sel"><option value="">加载中...</option></select></div>' +
      '<div class="row"><label>语速</label><input type="range" class="rate-slider" min="0.25" max="3" step="0.25" value="1"><span class="rate-val">1x</span></div>' +
      '<div class="row"><label>自动续播</label><input type="checkbox" class="auto-resume" checked></div></div>';
  }

  // ============================================================
  // 5. 主播放器
  // ============================================================
  function TTSPlayer() {
    var self = this;
    this.engine = new WebTTSEngine();
    this.settings = SettingsStore.load();
    this.content = null;
    this.chunks = [];
    this.bookId = '';
    this.totalChunks = 0;
    this.currentIndex = 0;

    // 注入样式和 HTML
    var s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
    var w = document.createElement('div');
    w.innerHTML = createPlayerHTML();
    document.body.appendChild(w);

    this.el = document.getElementById('wxr-tts');
    this.setEl = document.getElementById('wxr-tts-set');

    this.engine._rate = this.settings.rate;
    this.engine.setCallbacks({
      onChunkEnd: function (idx) { self.currentIndex = idx; self.updatePos(); self.saveProgress(); },
      onAllEnd: function () { self.updatePlayBtn(false); self.currentIndex = 0; self.updatePos(); },
      onError: function (idx, err) { if (err !== 'canceled' && err !== 'interrupted') self.showError(err); }
    });

    this.initVoices();
    this.bindEvents();
    this.checkAvail();
    this.injectToolbarButton();

    // 显示播放器
    this.updateRateUI();
    log('TTS v4 已加载');
  }

  TTSPlayer.prototype.initVoices = function () {
    var self = this;
    function load() {
      var vs = WebTTSEngine.getChineseVoices();
      if (vs.length > 0) {
        self.populateVoices(vs);
        if (self.settings.voiceName) {
          var m = vs.find(function (v) { return v.name === self.settings.voiceName; });
          if (m) self.engine._voice = m;
        }
      }
    }
    if (speechSynthesis.onvoiceschanged) speechSynthesis.onvoiceschanged = load;
    load();
    setTimeout(load, 200);
    setTimeout(load, 1000);
  };

  TTSPlayer.prototype.populateVoices = function (voices) {
    var sel = this.setEl.querySelector('.voice-sel');
    if (!sel) return;
    sel.innerHTML = '';
    voices.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v.name;
      o.textContent = v.name.replace(/.*\((.*)\)/, '$1');
      if (v.name === self.settings.voiceName) o.selected = true;
      sel.appendChild(o);
    });
  };

  TTSPlayer.prototype.checkAvail = function () {
    var a = WebTTSEngine.checkAvailability();
    if (!a.supported) { this.showError(a.message); }
    else if (!a.hasChineseVoice) { warn(a.message); }
  };

  TTSPlayer.prototype.bindEvents = function () {
    var self = this;
    var bar = this.el.querySelector('.bar');

    bar.querySelector('.play-btn').onclick = function () { self.togglePlay(); };
    bar.querySelector('.prev').onclick = function () { if (self.engine.previous()) { self.saveProgress(); self.updatePos(); } };
    bar.querySelector('.next').onclick = function () { if (self.engine.next()) { self.saveProgress(); self.updatePos(); } };
    bar.querySelector('.close-btn').onclick = function () { self.close(); };
    bar.querySelector('.set-btn').onclick = function () { self.toggleSet(); };
    this.el.querySelector('.err .close').onclick = function () { self.hideError(); };

    bar.querySelector('.rate').onchange = function (e) { self.setRate(parseFloat(e.target.value)); };
    this.setEl.querySelector('.rate-slider').oninput = function (e) { self.setRate(parseFloat(e.target.value)); };
    this.setEl.querySelector('.voice-sel').onchange = function (e) { self.setVoice(e.target.value || null); };

    // 点击外部关闭设置
    document.addEventListener('mousedown', function (e) {
      if (self.setEl.classList.contains('show') &&
          !self.setEl.contains(e.target) && !self.el.contains(e.target)) {
        self.setEl.classList.remove('show');
      }
    });

    // 进度条点击跳转
    this.el.querySelector('.pb-bg').onclick = function (e) {
      if (!self.chunks.length) return;
      var pct = e.offsetX / this.offsetWidth;
      var targetIdx = Math.floor(pct * self.chunks.length);
      targetIdx = Math.max(0, Math.min(targetIdx, self.chunks.length - 1));
      self.engine.speakFrom(targetIdx, self.chunks);
      self.updatePlayBtn(true);
      self.updatePos();
    };
  };

  /** 注入按钮到微信读书原生选区工具栏 */
  TTSPlayer.prototype.injectToolbarButton = function () {
    var self = this;
    var injected = false;

    function tryInject() {
      // 微信读书选区工具栏的特征选择器
      var toolbars = document.querySelectorAll(
        '[class*="selection_bar"], [class*="selectBar"], ' +
        '[class*="toolbar"][class*="select"], ' +
        '[class*="menu"][class*="copy"], ' +
        '.selection-bar, .select-toolbar, #selectionBar'
      );

      // 也尝试通过特征查找：包含"复制"文字的工具栏
      if (toolbars.length === 0) {
        var allDivs = document.querySelectorAll('div[style*="position"]');
        for (var i = 0; i < allDivs.length; i++) {
          var d = allDivs[i];
          var txt = (d.textContent || '');
          if ((txt.indexOf('复制') >= 0 || txt.indexOf('马克笔') >= 0) && d.children.length >= 2 && d.children.length <= 10) {
            // 可能是工具栏
            var rect = d.getBoundingClientRect();
            if (rect.height > 20 && rect.height < 80 && rect.width > 200) {
              toolbars = [d];
              break;
            }
          }
        }
      }

      for (var j = 0; j < toolbars.length; j++) {
        var tb = toolbars[j];
        // 避免重复注入
        if (tb.querySelector('.wxr-tts-toolbar-btn')) continue;

        var btn = document.createElement('button');
        btn.className = 'wxr-tts-toolbar-btn';
        btn.innerHTML = '&#128266; 朗读';
        btn.title = '从这里开始朗读';
        btn.onclick = function (e) {
          e.preventDefault();
          e.stopPropagation();
          var selTxt = '';
          try { selTxt = (window.getSelection() || {}).toString().trim() || ''; } catch(x) {}
          if (selTxt) {
            self.startFromSelection(selTxt);
          } else {
            // 没有选中文本，从当前位置开始
            self.togglePlay();
          }
          // 点击后隐藏工具栏（模拟原生行为）
          setTimeout(function () {
            try { var s = window.getSelection(); if (s) s.removeAllRanges(); } catch(x) {}
          }, 100);
        };
        tb.appendChild(btn);
        log('已注入朗读按钮到选区工具栏');
        injected = true;
      }
    }

    // 立即尝试一次
    tryInject();

    // 用 MutationObserver 监控后续出现的工具栏
    var observer = new MutationObserver(function () {
      tryInject();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // 定时重试（工具栏可能延迟出现）
    setInterval(tryInject, 1500);
  };

  // ---- 播放控制 ----

  TTSPlayer.prototype.togglePlay = function () {
    if (this.engine._isPlaying && !this.engine._isPaused) {
      this.engine.pause();
      this.updatePlayBtn(false);
    } else if (this.engine._isPaused) {
      this.engine.resume();
      this.updatePlayBtn(true);
    } else {
      this.startReading();
    }
  };

  TTSPlayer.prototype.startReading = function () {
    var content = TextExtractor.extract();
    if (!content) {
      this.showError('无法提取文本，请确认已在阅读页面打开书籍');
      return;
    }

    this.content = content;
    this.chunks = this.engine.splitIntoChunks(content.text);
    this.bookId = 'book_' + simpleHash(content.chapterTitle);
    this.totalChunks = this.chunks.length;
    PlaybackStore.setLastBookId(this.bookId);
    this.hideError();

    log('提取到文本:', content.text.length, '字,', this.chunks.length, '段');

    // 自动续播：直接恢复，不需要弹窗确认
    if (this.settings.autoResume) {
      var saved = PlaybackStore.load(this.bookId);
      if (saved && saved.chunkIndex > 0 && saved.chunkIndex < this.chunks.length) {
        log('自动续播: 第', saved.chunkIndex + 1, '段 (共', saved.chunkIndex + '/' + saved.totalChunks + ')');
        this.engine.speakFrom(saved.chunkIndex, this.chunks);
        this.updateTitle(content.chapterTitle + ' (续播)');
        this.updatePlayBtn(true);
        this.updatePos();
        this.engine._rate = saved.rate || this.settings.rate;
        this.updateRateUI();
        return;
      }
    }

    // 从可视区域开始
    var visIdx = TextExtractor.findVisibleChunkIndex(content.text, this.chunks);
    if (visIdx > 0) {
      log('从可视区域第', visIdx + 1, '段开始');
      this.engine.speakFrom(visIdx, this.chunks);
    } else {
      this.engine.speak(content.text);
    }
    this.updateTitle(content.chapterTitle);
    this.updatePlayBtn(true);
    this.updatePos();
  };

  TTSPlayer.prototype.startFromSelection = function (selText) {
    if (!selText) return;
    var content = TextExtractor.extract();
    if (!content) { this.showError('无法提取文本'); return; }

    this.content = content;
    this.chunks = this.engine.splitIntoChunks(content.text);
    this.bookId = 'book_' + simpleHash(content.chapterTitle);
    this.totalChunks = this.chunks.length;

    // 在全文中定位选区
    var cleanedSel = TextExtractor.cleanText(selText);
    var charIdx = content.text.indexOf(cleanedSel);
    if (charIdx === -1 && cleanedSel.length > 10) charIdx = content.text.indexOf(cleanedSel.slice(0, 30));

    if (charIdx === -1) {
      // 尝试用更短的前缀
      for (var len = 20; len >= 5; len -= 5) {
        charIdx = content.text.indexOf(cleanedSel.slice(0, len));
        if (charIdx !== -1) break;
      }
    }

    if (charIdx === -1) {
      // 最终兜底：从可视区域开始
      warn('无法定位选区，从可视区域开始');
      charIdx = 0;
    }

    // 映射到 chunk
    var offset = 0, chunkIdx = 0;
    for (var i = 0; i < this.chunks.length; i++) {
      if (charIdx >= offset && charIdx < offset + this.chunks[i].length) { chunkIdx = i; break; }
      offset += this.chunks[i].length;
    }

    log('从选区开始: chunk', chunkIdx + 1, '/', this.chunks.length);
    this.engine.speakFrom(chunkIdx, this.chunks);
    this.updateTitle(content.chapterTitle + ' (从选区)');
    this.updatePlayBtn(true);
    this.updatePos();
  };

  TTSPlayer.prototype.close = function () {
    this.engine.cancel();
    this.el.style.display = 'none';
    this.setEl.classList.remove('show');
  };

  TTSPlayer.prototype.toggleSet = function () { this.setEl.classList.toggle('show'); };

  // ---- 设置 ----

  TTSPlayer.prototype.setRate = function (r) {
    this.engine._rate = Math.max(0.25, Math.min(4, r));
    this.settings.rate = r;
    this.updateRateUI();
    SettingsStore.save({ rate: r });
  };

  TTSPlayer.prototype.setVoice = function (name) {
    var vs = speechSynthesis.getVoices();
    this.engine._voice = name ? (vs.find(function (v) { return v.name === name; }) || null) : null;
    this.settings.voiceName = name;
    SettingsStore.save({ voiceName: name });
  };

  // ---- UI 更新 ----

  TTSPlayer.prototype.updatePlayBtn = function (playing) {
    var btn = this.el.querySelector('.play-btn');
    if (!btn) return;
    btn.textContent = playing ? '⏸' : '▶';
    btn.className = 'play-btn' + (playing ? ' playing' : '');
    btn.title = playing ? '暂停' : '播放';
  };

  TTSPlayer.prototype.updateTitle = function (t) {
    var el = this.el.querySelector('.title');
    if (el) el.textContent = t || '点击 ▶ 开始朗读';
  };

  TTSPlayer.prototype.updatePos = function () {
    this.currentIndex = this.engine.currentChunkIndex;
    var total = this.totalChunks || 1;
    var pos = this.currentIndex + '/' + total;
    var posEl = this.el.querySelector('.pos');
    var fill = this.el.querySelector('.pb-fill');
    if (posEl) posEl.textContent = pos;
    if (fill) fill.style.width = ((this.currentIndex / total) * 100) + '%';
  };

  TTSPlayer.prototype.updateRateUI = function () {
    var sel = this.el.querySelector('.rate');
    var slider = this.setEl.querySelector('.rate-slider');
    var val = this.setEl.querySelector('.rate-val');
    if (sel) sel.value = String(this.settings.rate);
    if (slider) slider.value = String(this.settings.rate);
    if (val) val.textContent = this.settings.rate + 'x';
  };

  TTSPlayer.prototype.showError = function (msg) {
    var err = this.el.querySelector('.err');
    var msgEl = this.el.querySelector('.err .msg');
    if (err && msgEl) { msgEl.textContent = msg; err.classList.add('show'); }
  };

  TTSPlayer.prototype.hideError = function () {
    var err = this.el.querySelector('.err');
    if (err) err.classList.remove('show');
  };

  TTSPlayer.prototype.saveProgress = function () {
    if (!this.bookId || !this.content) return;
    PlaybackStore.save(this.bookId, {
      chapterTitle: this.content.chapterTitle,
      chunkIndex: this.engine.currentChunkIndex,
      totalChunks: this.totalChunks,
      rate: this.engine._rate,
      voiceName: this.settings.voiceName
    }, this.content.text);
  };

  // ============================================================
  // 6. 启动
  // ============================================================
  window.__WX_READ_TTS__ = new TTSPlayer();

})();
