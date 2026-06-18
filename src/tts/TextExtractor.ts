/**
 * 微信读书页面文本提取器
 * 从 weread.qq.com 的阅读页面 DOM 中提取当前章节的正文内容
 */

export interface ExtractedContent {
  text: string;
  chapterTitle: string;
  chapterIndex: number;
  totalChapters: number;
}

export class TextExtractor {
  /**
   * 尝试多种选择器策略提取阅读正文
   */
  static extract(): ExtractedContent | null {
    // 策略1：微信读书渲染层常用选择器
    const text = TextExtractor.extractText();
    if (!text || text.trim().length < 10) {
      console.warn('[TTS] 未在页面中提取到有效文本');
      return null;
    }

    const chapterTitle = TextExtractor.extractChapterTitle();
    const chapterInfo = TextExtractor.extractChapterInfo();

    return {
      text: text.trim(),
      chapterTitle,
      chapterIndex: chapterInfo.index,
      totalChapters: chapterInfo.total,
    };
  }

  /**
   * 提取正文文本（多策略尝试）
   * 优先提取正文段落级元素（p），而非整个容器（避免包含侧栏/注释）
   */
  private static extractText(): string {
    // 策略0（最精确）：在正文容器内只提取段落级元素
    const contentEl = TextExtractor.findContentElement();
    if (contentEl) {
      // 优先找 p 标签（微信读书正文通常用 p）
      const paragraphs = contentEl.querySelectorAll('p');
      if (paragraphs.length > 0) {
        const texts: string[] = [];
        for (const p of Array.from(paragraphs)) {
          // 跳过太短的（可能是标签/按钮）和不可见的
          const text = (p.textContent || '').trim();
          if (text.length < 2) continue;
          const rect = p.getBoundingClientRect();
          // 跳过隐藏元素
          if (rect.width === 0 && rect.height === 0) continue;
          texts.push(text);
        }
        if (texts.length > 0) {
          const combined = texts.join('\n');
          const cleaned = TextExtractor.cleanText(combined);
          if (cleaned.length > 20) return cleaned;
        }
      }

      // 如果没找到 p，用容器的 textContent 但排除非正文子元素
      const filtered = TextExtractor.extractFilteredContent(contentEl);
      if (filtered.length > 20) return filtered;
    }

    // 策略1：微信读书渲染层常用选择器
    const selectors = [
      '.readerContent',
      '.render-text-container',
      '[class*="readerText"]',
      '[class*="render_text"]',
      '.text-content',
      'article',
      '.content',
      '#j_content',
      'main',
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) {
        const text = TextExtractor.cleanText(el.textContent || '');
        if (text.length > 20) return text;
      }
    }

    // 兜底：遍历所有可能的内容区域
    const allText = TextExtractor.scanForContent();
    return allText;
  }

  /**
   * 从容器中提取正文，排除注释、脚注、侧栏等非正文子元素
   */
  private static extractFilteredContent(container: Element): string {
    // 克隆容器以避免修改原始 DOM
    const clone = container.cloneNode(true) as Element;

    // 移除非正文子元素
    const excludeSelectors = [
      'nav', 'header', 'footer', 'aside',
      '[role="navigation"]', '[role="complementary"]',
      '.footnote', '.annotation', '.comment', '.note',
      '.sidebar', '.toolbar', '.menu', '.breadcrumb',
      'script', 'style', 'noscript',
      '[class*="foot"]', '[class*="note"]', '[class*="comment"]',
      '[class*="sidebar"]', '[class*="toolbar"]', '[class*="menu"]',
      '[class*="header"]', '[class*="footer"]',
    ];

    for (const sel of excludeSelectors) {
      const els = clone.querySelectorAll(sel);
      els.forEach((el) => el.remove());
    }

    return TextExtractor.cleanText(clone.textContent || '');
  }

  /**
   * 清理提取的文本（去除多余空白、特殊字符）
   * 公开方法，供 selectionchange 和 startFromSelection 使用
   */
  static cleanText(raw: string): string {
    return raw
      .replace(/\s+/g, ' ')
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9，。！？、；：""''（）\n\r\s\.\,\!\?\;\:\(\)\-\—]/g, '')
      .trim();
  }

  /**
   * 扫描页面寻找最长文本块作为内容区域
   */
  private static scanForContent(): string {
    let bestEl: Element | null = null;
    let maxLength = 0;

    // 排除导航、工具栏等非内容区域
    const skipSelectors = ['nav', 'header', 'footer', 'aside', '[role="navigation"]', 'script', 'style', '.toolbar', '.sidebar'];

    const candidates = Array.from(document.querySelectorAll('div, section, article, main'));

    for (const el of candidates) {
      // 跳过非内容区域
      let shouldSkip = false;
      for (const sel of skipSelectors) {
        if (el.matches(sel) || el.closest(sel)) {
          shouldSkip = true;
          break;
        }
      }
      if (shouldSkip) continue;

      const text = (el.textContent || '').trim();
      // 内容区域应该有足够的中文文本
      const chineseCount = text.match(/[\u4e00-\u9fa5]/g)?.length || 0;
      if (chineseCount > maxLength && chineseCount > 50) {
        maxLength = chineseCount;
        bestEl = el;
      }
    }

    return bestEl ? TextExtractor.cleanText(bestEl.textContent || '') : '';
  }

  /**
   * 提取当前章节标题
   */
  private static extractChapterTitle(): string {
    const selectors = [
      '.chapter-title',
      '.chapter_title',
      '[class*="chapterTitle"]',
      '.current-chapter h1',
      '.chapterInfo_title',
      'h1.title',
      '.title',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent?.trim()) {
        return el.textContent.trim();
      }
    }

    return '未知章节';
  }

  /**
   * 找到正文容器的 DOM 元素（与 extractText 使用相同的选择器优先级）
   * 用于计算选区在正文内的精确字符偏移
   */
  static findContentElement(): HTMLElement {
    const selectors = [
      '.readerContent',
      '.render-text-container',
      '[class*="readerText"]',
      '[class*="render_text"]',
      '.text-content',
      'article',
      '.content',
      '#j_content',
      'main',
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (el && (el.textContent || '').trim().length > 20) return el;
    }

    // 兜底：用 scanForContent 的逻辑找最佳元素
    let bestEl: HTMLElement | null = null;
    let maxLength = 0;
    const skipSelectors = ['nav', 'header', 'footer', 'aside', '[role="navigation"]', 'script', 'style', '.toolbar', '.sidebar'];
    const candidates = Array.from(document.querySelectorAll('div, section, article, main'));
    for (const el of candidates) {
      let shouldSkip = false;
      for (const sel of skipSelectors) {
        if (el.matches(sel) || el.closest(sel)) { shouldSkip = true; break; }
      }
      if (shouldSkip) continue;
      const text = (el.textContent || '').trim();
      const chineseCount = text.match(/[\u4e00-\u9fa5]/g)?.length || 0;
      if (chineseCount > maxLength && chineseCount > 50) {
        maxLength = chineseCount;
        bestEl = el as HTMLElement;
      }
    }

    return bestEl || null;
  }

  /**
   * 计算当前选区在指定容器内的字符偏移
   * 使用 Range API 精确计算，正确处理 text node 分割和内联标签
   * 返回 -1 表示选区不在容器内
   */
  static getSelectionOffsetInContainer(container: HTMLElement): number {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return -1;
    const range = sel.getRangeAt(0);
    if (!container.contains(range.startContainer)) return -1;

    const preRange = document.createRange();
    preRange.selectNodeContents(container);
    preRange.setEnd(range.startContainer, range.startOffset);
    return preRange.toString().length;
  }

  /**
   * 找到当前可视区域中间的段落文本，在 fullText 中定位后映射到 chunkIndex
   * 返回 0 表示无法定位（从头开始）
   */
  static findVisibleChunkIndex(fullText: string, chunks: string[]): number {
    const contentEl = TextExtractor.findContentElement();
    if (!contentEl) return 0;

    // 获取可视区域中心点
    const viewportCenter = window.innerHeight / 2;

    // 在正文容器内找到可视区域中心附近的段落元素
    const paragraphs = contentEl.querySelectorAll('p, div.readerChapterContent, span, [class*="text"]');
    let bestEl: Element | null = null;
    let bestDistance = Infinity;

    for (const p of Array.from(paragraphs)) {
      const rect = p.getBoundingClientRect();
      if (rect.height === 0) continue;

      const elCenter = rect.top + rect.height / 2;
      const distance = Math.abs(elCenter - viewportCenter);

      // 只考虑在可视区域内的元素
      if (rect.top < window.innerHeight && rect.bottom > 0 && distance < bestDistance) {
        bestDistance = distance;
        bestEl = p;
      }
    }

    if (!bestEl) return 0;

    // 用该元素的文本在 fullText 中定位
    const elText = TextExtractor.cleanText(bestEl.textContent || '');
    if (!elText || elText.length < 4) return 0;

    // 尝试在 fullText 中找到该段落
    let charIndex = fullText.indexOf(elText);
    if (charIndex === -1 && elText.length > 20) {
      // 模糊匹配：用前 20 字符
      charIndex = fullText.indexOf(elText.slice(0, 20));
    }

    if (charIndex === -1) return 0;

    // 把 charIndex 映射到 chunkIndex
    let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
      if (charIndex >= offset && charIndex < offset + chunks[i].length) {
        return i;
      }
      offset += chunks[i].length;
    }

    return 0;
  }

  /**
   * 提取章节索引信息
   */
  private static extractChapterInfo(): { index: number; total: number } {
    // 尝试从目录/章节导航获取
    try {
      const activeItem = document.querySelector('[class*="chapter"][class*="active"], [class*="chapter_item"][class*="selected"]');
      if (activeItem) {
        const siblings = activeItem.parentElement?.children;
        if (siblings) {
          const index = Array.from(siblings).indexOf(activeItem);
          return { index: index >= 0 ? index : 0, total: siblings.length };
        }
      }
    } catch { /* ignore */ }

    return { index: 0, total: 1 };
  }
}
