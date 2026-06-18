/**
 * TTS Service —— 主进程 TTS 编排服务
 * 管理 Provider 注册表、IPC handlers、缓存、并发与重试策略
 */

import { ipcMain } from 'electron';
import { ITTSProvider, SynthOptions } from './providers/ITTSProvider';
import { ensureCacheDir, hashKey, isCached, cacheFilePath, writeBufferToCache, touchCache, cleanupCacheIfNeeded, getCacheStats, clearAllCache } from './cacheManager';
import { addProvider, removeProviderAction, listProviderConfigsAction, testProviderAction, setDefaultProviderAction, getDefaultProviderAction, updateProviderAction } from './providerManager';

// ---- Provider Registry ----
const providers = new Map<string, ITTSProvider>();

/** 注册一个 TTS Provider */
export function registerProvider(provider: ITTSProvider): void {
  providers.set(provider.id, provider);
  console.log(`[TTS Service] 注册 Provider: ${provider.id} (${provider.displayName})`);
}

/** 获取已注册的 Provider */
export function getProvider(id: string): ITTSProvider | undefined {
  return providers.get(id);
}

/** 列出所有已注册的 Provider 信息 */
export function listProviders(): Array<{ id: string; displayName: string; supportsStreaming?: boolean }> {
  return Array.from(providers.values()).map((p) => ({
    id: p.id,
    displayName: p.displayName,
    supportsStreaming: p.supportsStreaming,
  }));
}

// ---- 重试配置 ----
const MAX_RETRIES = 3;
const RETRY_DELAYS = [500, 1000, 2000]; // 指数退避

/**
 * 带重试的合成调用
 */
async function synthesizeWithRetry(
  provider: ITTSProvider,
  text: string,
  opts: SynthOptions,
  retries = MAX_RETRIES
): Promise<{ filePath: string; format: string; cached: boolean }> {
  const key = hashKey(`${provider.id}:${opts.voice || ''}:${opts.rate || 1}:${text}`);
  const ext = '.mp3'; // 默认 mp3

  // 检查缓存
  await ensureCacheDir();
  const cached = await isCached(key, ext);
  if (cached) {
    await touchCache(key, ext);
    return { filePath: cached, format: ext.slice(1), cached: true };
  }

  // 执行合成（带重试）
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const result = await provider.synthesize(text, opts);

      // 将结果写入缓存
      const cachedPath = cacheFilePath(key, `.${result.format}`);
      const { copyFile } = await import('fs/promises');
      await copyFile(result.filePath, cachedPath);

      // 异步清理缓存（不阻塞）
      cleanupCacheIfNeeded().catch(() => { /* ignore */ });

      return { filePath: cachedPath, format: result.format, cached: false };
    } catch (err) {
      lastError = err as Error;
      console.warn(`[TTS Service] 合成失败 (尝试 ${attempt + 1}/${retries}):`, lastError.message);
      if (attempt < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
      }
    }
  }

  throw new Error(`合成失败（重试 ${retries} 次后）: ${lastError?.message}`);
}

// ---- IPC Handlers ----

/** 初始化所有 IPC handlers */
export function initTTSIPC(): void {
  // 合成请求
  ipcMain.handle('tts/synthesize', async (_event, params: {
    providerId: string;
    text: string;
    voice?: string;
    rate?: number;
  }) => {
    const { providerId, text, voice, rate } = params;
    if (!text || text.trim().length === 0) {
      throw new Error('文本为空，无法合成');
    }

    const provider = providers.get(providerId);
    if (!provider) {
      throw new Error(`未知的 TTS Provider: ${providerId}`);
    }

    const result = await synthesizeWithRetry(provider, text, { voice, rate });
    return {
      url: `file://${result.filePath}`,
      format: result.format,
      cached: result.cached,
    };
  });

  // 列出所有 Provider
  ipcMain.handle('tts/listProviders', async () => {
    const result = [];
    for (const [id, provider] of providers) {
      let voices: Array<{ name: string; lang?: string; gender?: string }> = [];
      try {
        voices = (await provider.listVoices()).map((v) => ({
          name: v.name,
          lang: v.lang,
          gender: v.gender,
        }));
      } catch { /* ignore */ }
      result.push({
        id,
        displayName: provider.displayName,
        supportsStreaming: provider.supportsStreaming,
        voices,
      });
    }
    return result;
  });

  // 获取缓存统计
  ipcMain.handle('tts/cacheStats', async () => {
    return getCacheStats();
  });

  // 清理缓存
  ipcMain.handle('tts/clearCache', async () => {
    await clearAllCache();
    return { success: true };
  });

  // ---- Provider 管理 IPC ----

  // 添加 Provider
  ipcMain.handle('tts/addProvider', async (_event, opts: {
    type: string;
    displayName: string;
    endpoint?: string;
    apiKey?: string;
    audioFormat?: string;
    voice?: string;
  }) => {
    try {
      const cfg = await addProvider(opts);
      return { success: true, config: cfg };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // 删除 Provider
  ipcMain.handle('tts/removeProvider', async (_event, id: string) => {
    try {
      await removeProviderAction(id);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // 列出所有 Provider 配置
  ipcMain.handle('tts/listProviderConfigs', async () => {
    return listProviderConfigsAction();
  });

  // 测试 Provider
  ipcMain.handle('tts/testProvider', async (_event, opts: { id: string; text?: string }) => {
    return testProviderAction(opts.id, opts.text);
  });

  // 设置默认 Provider
  ipcMain.handle('tts/setDefaultProvider', async (_event, id: string) => {
    await setDefaultProviderAction(id);
    return { success: true };
  });

  // 获取默认 Provider
  ipcMain.handle('tts/getDefaultProvider', async () => {
    return getDefaultProviderAction();
  });

  // 更新 Provider
  ipcMain.handle('tts/updateProvider', async (_event, id: string, partial: Partial<import('./providerConfigStore').ProviderConfig> & { apiKey?: string }) => {
    try {
      const cfg = await updateProviderAction(id, partial);
      return { success: true, config: cfg };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  console.log('[TTS Service] IPC handlers 已注册（含 Provider 管理）');
}
