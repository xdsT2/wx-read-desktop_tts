/**
 * ProviderConfigStore —— TTS Provider 配置持久化
 * 非敏感配置写入本地 JSON 文件
 * API Key 使用加密存储（见 providerManager.ts）
 */

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

const CONFIG_PATH = path.join(app.getPath('userData'), 'tts-providers.json');

export interface ProviderConfig {
  /** 唯一 ID */
  id: string;
  /** Provider 类型：rest / doubao / xunfei / tencent 等 */
  type: 'rest' | 'doubao' | 'xunfei' | 'tencent' | string;
  /** 显示名称 */
  displayName: string;
  /** API 端点 */
  endpoint?: string;
  /** 音频格式 */
  audioFormat?: string;
  /** 默认语音 */
  voice?: string;
  /** 是否启用 */
  enabled?: boolean;
  /** 是否为默认 Provider */
  isDefault?: boolean;
  /** 创建时间 */
  createdAt?: number;
}

/** 加载所有配置 */
export async function loadConfigs(): Promise<ProviderConfig[]> {
  try {
    const raw = await fs.promises.readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as ProviderConfig[];
  } catch {
    return [];
  }
}

/** 保存所有配置 */
export async function saveConfigs(cfgs: ProviderConfig[]): Promise<void> {
  await fs.promises.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fs.promises.writeFile(CONFIG_PATH, JSON.stringify(cfgs, null, 2), 'utf-8');
}

/** 添加一条配置 */
export async function addConfig(cfg: ProviderConfig): Promise<void> {
  const cfgs = await loadConfigs();
  cfgs.push(cfg);
  await saveConfigs(cfgs);
}

/** 删除一条配置 */
export async function removeConfig(id: string): Promise<void> {
  const cfgs = (await loadConfigs()).filter((c) => c.id !== id);
  await saveConfigs(cfgs);
}

/** 更新一条配置 */
export async function updateConfig(id: string, partial: Partial<ProviderConfig>): Promise<ProviderConfig | null> {
  const cfgs = await loadConfigs();
  const idx = cfgs.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  Object.assign(cfgs[idx], partial);
  await saveConfigs(cfgs);
  return cfgs[idx];
}

/** 设置默认 Provider（同时取消其他默认） */
export async function setDefaultProvider(id: string): Promise<void> {
  const cfgs = await loadConfigs();
  for (const c of cfgs) {
    c.isDefault = c.id === id;
  }
  await saveConfigs(cfgs);
}

/** 获取默认 Provider 配置 */
export async function getDefaultProviderConfig(): Promise<ProviderConfig | null> {
  const cfgs = await loadConfigs();
  return cfgs.find((c) => c.isDefault && c.enabled) || null;
}

/** 获取配置文件路径（供调试） */
export function getConfigPath(): string {
  return CONFIG_PATH;
}
