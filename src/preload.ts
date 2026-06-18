// Preload script
// 由于当前项目 contextIsolation: false，renderer 可直接使用 ipcRenderer
// 此文件保留为未来启用 contextIsolation 时的桥接入口

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
});
