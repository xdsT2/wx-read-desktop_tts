/**
 * 文本分片器 —— 将长章节文本拆分为适合 TTS 的短片段
 * 对中文优先按句号、感叹号、问号、换行切分；超长则按字符数截断
 */

export interface ChunkInfo {
  text: string;
  startIndex: number; // 在原文中的字符起始偏移
}

export class TextChunker {
  private static readonly MAX_CHUNK_CHARS = 300;
  private static readonly SENTENCE_DELIMITERS = /[。！？\n]/;

  /**
   * 将文本分片，返回带偏移信息的片段数组
   */
  static chunk(text: string, maxChars = TextChunker.MAX_CHUNK_CHARS): ChunkInfo[] {
    if (!text || !text.trim()) return [];

    const chunks: ChunkInfo[] = [];
    let offset = 0;
    let buffer = '';
    let bufferStart = 0;

    // 先按句子分隔符初步切分
    const rawParts = text.split(TextChunker.SENTENCE_DELIMITERS);

    for (const part of rawParts) {
      const trimmed = part.trim();
      if (!trimmed) {
        // 分隔符本身占位
        offset += part.length + 1; // +1 for delimiter
        continue;
      }

      const candidate = buffer ? buffer + part[text.indexOf(part) >= 0 ? part.lastIndexOf(trimmed) || 0 : 0] + (buffer !== '' ? '。' : '') : trimmed;

      // 简化处理：直接按长度累积
      if ((buffer + trimmed).length > maxChars && buffer) {
        chunks.push({ text: buffer.trim(), startIndex: bufferStart });
        bufferStart = offset;
        buffer = trimmed;
      } else {
        if (buffer) buffer += '。' + trimmed;
        else buffer = trimmed;
      }
      offset += part.length + 1;
    }

    if (buffer.trim()) {
      chunks.push({ text: buffer.trim(), startIndex: bufferStart });
    }

    // 兜底：如果全部分片失败，强制按字符数切割
    if (chunks.length === 0 && text.trim()) {
      return TextChunker.forceSplitByChars(text, maxChars);
    }

    return chunks;
  }

  /**
   * 强制按固定字符数切割（兜底方案）
   */
  private static forceSplitByChars(text: string, maxChars: number): ChunkInfo[] {
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
