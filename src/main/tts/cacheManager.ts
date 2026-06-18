/**
 * CacheManager —— TTS 合成结果缓存管理
 * 缓存 key = SHA1(providerId:voice:rate:text)
 * 缓存文件存于 app.getPath('userData')/tts-cache
 * 支持 LRU 清理，最大容量可配置
 */

import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { app } from 'electron';

const MAX_CACHE_BYTES = 1024 * 1024 * 500; // 500MB

let cacheDir = '';

/** 确保缓存目录存在 */
export async function ensureCacheDir(): Promise<string> {
  if (!cacheDir) {
    cacheDir = path.join(app.getPath('userData'), 'tts-cache');
  }
  await fs.promises.mkdir(cacheDir, { recursive: true });
  return cacheDir;
}

/** 生成缓存哈希 key */
export function hashKey(payload: string): string {
  return crypto.createHash('sha1').update(payload).digest('hex');
}

/** 根据哈希获取缓存文件路径 */
export function cacheFilePath(hash: string, ext = '.mp3'): string {
  return path.join(cacheDir || path.join(app.getPath('userData'), 'tts-cache'), `${hash}${ext}`);
}

/** 检查缓存是否命中，命中返回文件路径，否则返回 null */
export async function isCached(hash: string, ext = '.mp3'): Promise<string | null> {
  try {
    const p = cacheFilePath(hash, ext);
    await fs.promises.stat(p);
    return p;
  } catch {
    return null;
  }
}

/** 将合成结果写入缓存（从源文件复制） */
export async function writeToCache(hash: string, srcPath: string, ext = '.mp3'): Promise<string> {
  await ensureCacheDir();
  const dest = cacheFilePath(hash, ext);
  await fs.promises.copyFile(srcPath, dest);
  return dest;
}

/** 直接将 Buffer 写入缓存文件 */
export async function writeBufferToCache(hash: string, buffer: Buffer, ext = '.mp3'): Promise<string> {
  await ensureCacheDir();
  const dest = cacheFilePath(hash, ext);
  await fs.promises.writeFile(dest, buffer);
  return dest;
}

/** 更新缓存文件的访问时间（用于 LRU） */
export async function touchCache(hash: string, ext = '.mp3'): Promise<void> {
  try {
    const p = cacheFilePath(hash, ext);
    const now = new Date();
    await fs.promises.utimes(p, now, now);
  } catch { /* ignore */ }
}

/**
 * 清理缓存（LRU 策略）
 * 当缓存总大小超过 MAX_CACHE_BYTES 时，删除最久未访问的文件
 */
export async function cleanupCacheIfNeeded(): Promise<void> {
  try {
    const dir = await ensureCacheDir();
    const files = await fs.promises.readdir(dir);
    const fileStats: Array<{ name: string; size: number; atime: Date; path: string }> = [];

    let totalSize = 0;
    for (const name of files) {
      const fp = path.join(dir, name);
      try {
        const stat = await fs.promises.stat(fp);
        if (stat.isFile()) {
          fileStats.push({ name, size: stat.size, atime: stat.atime, path: fp });
          totalSize += stat.size;
        }
      } catch { /* skip */ }
    }

    if (totalSize <= MAX_CACHE_BYTES) return;

    // 按访问时间升序（最旧在前）
    fileStats.sort((a, b) => a.atime.getTime() - b.atime.getTime());

    // 删除最旧的文件直到总大小低于阈值
    for (const f of fileStats) {
      if (totalSize <= MAX_CACHE_BYTES * 0.8) break; // 清理到 80%
      try {
        await fs.promises.unlink(f.path);
        totalSize -= f.size;
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

/** 获取缓存统计信息 */
export async function getCacheStats(): Promise<{ fileCount: number; totalBytes: number }> {
  try {
    const dir = await ensureCacheDir();
    const files = await fs.promises.readdir(dir);
    let totalBytes = 0;
    let fileCount = 0;
    for (const name of files) {
      const fp = path.join(dir, name);
      try {
        const stat = await fs.promises.stat(fp);
        if (stat.isFile()) {
          fileCount++;
          totalBytes += stat.size;
        }
      } catch { /* skip */ }
    }
    return { fileCount, totalBytes };
  } catch {
    return { fileCount: 0, totalBytes: 0 };
  }
}

/** 清空所有缓存 */
export async function clearAllCache(): Promise<void> {
  try {
    const dir = await ensureCacheDir();
    const files = await fs.promises.readdir(dir);
    for (const name of files) {
      try { await fs.promises.unlink(path.join(dir, name)); } catch { /* skip */ }
    }
  } catch { /* ignore */ }
}
