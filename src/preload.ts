// Preload script
// 通过 contextBridge 安全暴露 TTS API 给 renderer

import { contextBridge, ipcRenderer } from 'electron';

// 通过 contextBridge 安全暴露 TTS API 给 renderer
contextBridge.exposeInMainWorld('electronTTS', {
  /** 请求云端 TTS 合成 */
  synthesize: (opts: { providerId: string; text: string; voice?: string; rate?: number }) =>
    ipcRenderer.invoke('tts/synthesize', opts),

  /** 列出所有已注册的 TTS Provider 及其语音 */
  listProviders: () => ipcRenderer.invoke('tts/listProviders'),

  /** 获取缓存统计 */
  getCacheStats: () => ipcRenderer.invoke('tts/cacheStats'),

  /** 清理缓存 */
  clearCache: () => ipcRenderer.invoke('tts/clearCache'),

  // ---- Provider 管理 ----

  /** 添加 Provider */
  addProvider: (opts: { type: string; displayName: string; endpoint?: string; apiKey?: string; audioFormat?: string; voice?: string }) =>
    ipcRenderer.invoke('tts/addProvider', opts),

  /** 删除 Provider */
  removeProvider: (id: string) => ipcRenderer.invoke('tts/removeProvider', id),

  /** 列出所有 Provider 配置 */
  listProviderConfigs: () => ipcRenderer.invoke('tts/listProviderConfigs'),

  /** 测试 Provider */
  testProvider: (opts: { id: string; text?: string }) => ipcRenderer.invoke('tts/testProvider', opts),

  /** 设置默认 Provider */
  setDefaultProvider: (id: string) => ipcRenderer.invoke('tts/setDefaultProvider', id),

  /** 获取默认 Provider */
  getDefaultProvider: () => ipcRenderer.invoke('tts/getDefaultProvider'),

  /** 更新 Provider */
  updateProvider: (id: string, partial: any) => ipcRenderer.invoke('tts/updateProvider', id, partial),
});
