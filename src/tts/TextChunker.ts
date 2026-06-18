/**
 * 文本分片器 —— 将长章节文本拆分为适合 TTS 的短片段
 * 对中文优先按句号、感叹号、问号、换行切分；超长则按字符数截断
 *
 * 重写要点：
 * 1. 用 matchAll 保留分隔符的切分，确保 startIndex 精确
 * 2. 累积字符计数器追踪偏移，不依赖 split 后的偏移猜测
 * 3. 超长无标点段走 forceSplitByChars 兜底
 */

export interface ChunkInfo {
  text: string;
  startIndex: number; // 在原文中的字符起始偏移
}

export class TextChunker {
  private static readonly MAX_CHUNK_CHARS = 300;

  /**
   * 匹配"句子 + 结束标点"的模式，保留分隔符
   * 匹配：任意字符（非贪婪）后跟 [。！？\n]，或文本末尾的剩余内容
   */
  private static readonly SENTENCE_PATTERN = /.*?[。！？\n]|.+$/gs;

  /**
   * 将文本分片，返回带偏移信息的片段数组
   */
  static chunk(text: string, maxChars = TextChunker.MAX_CHUNK_CHARS): ChunkInfo[] {
    if (!text || !text.trim()) return [];

    const chunks: ChunkInfo[] = [];
    let buffer = '';
    let bufferStart = 0;

    // 用 matchAll 提取所有"句+分隔符"片段，保留原始顺序和位置
    const matches = [...text.matchAll(TextChunker.SENTENCE_PATTERN)];

    for (const match of matches) {
      const sentence = match[0];
      if (!sentence) continue;

      const trimmed = sentence.trim();
      if (!trimmed) continue;

      // 如果单句就超过 maxChars，需要强制切分
      if (trimmed.length > maxChars) {
        // 先把当前 buffer 推出
        if (buffer.trim()) {
          chunks.push({ text: buffer.trim(), startIndex: bufferStart });
          buffer = '';
        }
        // 对超长句强制按字符数切分
        const subChunks = TextChunker.forceSplitByChars(trimmed, maxChars);
        // 计算 subChunks 在原文中的偏移：从 match.index + sentence 中 trimmed 的起始位置
        const trimmedOffsetInSentence = sentence.indexOf(trimmed);
        const sentenceStartInOriginal = match.index ?? 0;
        let subOffset = sentenceStartInOriginal + trimmedOffsetInSentence;
        for (const sc of subChunks) {
          chunks.push({ text: sc.text, startIndex: subOffset });
          subOffset += sc.text.length;
        }
        bufferStart = subOffset;
        continue;
      }

      // 正常累积
      if ((buffer + trimmed).length > maxChars && buffer) {
        chunks.push({ text: buffer.trim(), startIndex: bufferStart });
        bufferStart = match.index ?? 0;
        buffer = trimmed;
      } else {
        if (!buffer) bufferStart = match.index ?? 0;
        buffer += trimmed;
      }
    }

    // 推出剩余 buffer
    if (buffer.trim()) {
      chunks.push({ text: buffer.trim(), startIndex: bufferStart });
    }

    // 兜底：如果全部分片失败（理论上不会），强制按字符数切割
    if (chunks.length === 0 && text.trim()) {
      return TextChunker.forceSplitByChars(text, maxChars);
    }

    return chunks;
  }

  /**
   * 强制按固定字符数切割（兜底方案，用于无标点的超长句）
   */
  static forceSplitByChars(text: string, maxChars: number): ChunkInfo[] {
    const chunks: ChunkInfo[] = [];
    for (let i = 0; i < text.length; i += maxChars) {
      chunks.push({
        text: text.slice(i, i + maxChars),
        startIndex: i,
      });
    }
    return chunks;
  }
}
