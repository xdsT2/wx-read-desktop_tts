/**
 * ProviderManager —— TTS Provider 管理器
 * 负责：API Key 加密存储、Provider 注册/注销、测试合成
 *
 * 安全方案：API Key 使用 AES-256-CBC 加密后存储在本地文件
 * 密钥派生自 app.getPath('userData') 的路径哈希 + 固定盐
 * （后续可升级为 keytar 系统密钥链方案）
 */

import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { ProviderConfig, loadConfigs, addConfig, removeConfig, updateConfig, setDefaultProvider as setDefaultConfig, getDefaultProviderConfig } from './providerConfigStore';
import { registerProvider, getProvider } from './ttsService';
import { RestTTSProvider } from './providers/RestTTSProvider';

// ---- 加密配置 ----
const ALGORITHM = 'aes-256-cbc';
const KEYS_DIR = () => path.join(app.getPath('userData'), 'tts-keys');
const KEYS_PATH = () => path.join(KEYS_DIR(), 'keys.enc');

// 从 app 路径派生加密密钥（每次安装唯一）
function getEncryptionKey(): Buffer {
  const userDataPath = app.getPath('userData');
  return crypto.createHash('sha256').update(`wx-read-tts-key:${userDataPath}`).digest();
}

/** 加密文本 */
function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/** 解密文本 */
function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  const parts = ciphertext.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ---- Key Store（加密文件存储所有 API Keys） ----
interface KeyStore {
  [providerId: string]: string; // encrypted apiKey
}

async function loadKeyStore(): Promise<KeyStore> {
  try {
    const raw = await fs.promises.readFile(KEYS_PATH(), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveKeyStore(store: KeyStore): Promise<void> {
  await fs.promises.mkdir(KEYS_DIR(), { recursive: true });
  await fs.promises.writeFile(KEYS_PATH(), JSON.stringify(store), 'utf-8');
}

async function saveApiKey(providerId: string, apiKey: string): Promise<void> {
  const store = await loadKeyStore();
  store[providerId] = encrypt(apiKey);
  await saveKeyStore(store);
}

async function getApiKey(providerId: string): Promise<string | null> {
  const store = await loadKeyStore();
  const encrypted = store[providerId];
  if (!encrypted) return null;
  try {
    return decrypt(encrypted);
  } catch {
    console.error(`[ProviderManager] 解密 API Key 失败: ${providerId}`);
    return null;
  }
}

async function deleteApiKey(providerId: string): Promise<void> {
  const store = await loadKeyStore();
  delete store[providerId];
  await saveKeyStore(store);
}

// ---- Provider 注册/注销 ----

/** 生成唯一 ID */
function generateId(): string {
  return 'user_' + crypto.randomBytes(4).toString('hex');
}

/** 根据 ProviderConfig + apiKey 创建并注册 Provider 实例 */
function createAndRegisterProvider(cfg: ProviderConfig, apiKey: string): void {
  if (cfg.type === 'rest' && cfg.endpoint) {
    const provider = new RestTTSProvider({
      id: cfg.id,
      displayName: cfg.displayName,
      apiEndpoint: cfg.endpoint,
      apiKey: apiKey,
      audioFormat: cfg.audioFormat || 'mp3',
    });
    registerProvider(provider);
    console.log(`[ProviderManager] 已注册 Provider: ${cfg.id} (${cfg.displayName})`);
  } else {
    console.warn(`[ProviderManager] 不支持的 Provider 类型: ${cfg.type}，跳过注册`);
  }
}

/** 添加 Provider（从 UI 调用） */
export async function addProvider(opts: {
  type: string;
  displayName: string;
  endpoint?: string;
  apiKey?: string;
  audioFormat?: string;
  voice?: string;
}): Promise<ProviderConfig> {
  const id = generateId();
  const cfg: ProviderConfig = {
    id,
    type: opts.type,
    displayName: opts.displayName,
    endpoint: opts.endpoint,
    audioFormat: opts.audioFormat || 'mp3',
    voice: opts.voice || undefined,
    enabled: true,
    isDefault: false,
    createdAt: Date.now(),
  };

  // 保存 API Key（加密）
  if (opts.apiKey) {
    await saveApiKey(id, opts.apiKey);
  }

  // 保存非敏感配置
  await addConfig(cfg);

  // 立即注册到运行时
  if (opts.apiKey && cfg.enabled) {
    createAndRegisterProvider(cfg, opts.apiKey);
  }

  return cfg;
}

/** 删除 Provider */
export async function removeProviderAction(id: string): Promise<void> {
  await removeConfig(id);
  await deleteApiKey(id);
  // 注意：当前 registerProvider 不支持 unregister，仅从配置中移除
  // 下次重启后该 Provider 不再注册
  console.log(`[ProviderManager] 已删除 Provider: ${id}`);
}

/** 更新 Provider 配置 */
export async function updateProviderAction(id: string, partial: Partial<ProviderConfig> & { apiKey?: string }): Promise<ProviderConfig | null> {
  if (partial.apiKey) {
    await saveApiKey(id, partial.apiKey);
    delete partial.apiKey;
  }
  const cfg = await updateConfig(id, partial);
  if (cfg && partial.apiKey && cfg.enabled) {
    const apiKey = await getApiKey(id);
    if (apiKey) createAndRegisterProvider(cfg, apiKey);
  }
  return cfg;
}

/** 设置默认 Provider */
export async function setDefaultProviderAction(id: string): Promise<void> {
  await setDefaultConfig(id);
}

/** 列出所有 Provider 配置（不含 API Key） */
export async function listProviderConfigsAction(): Promise<ProviderConfig[]> {
  return loadConfigs();
}

/** 获取默认 Provider 配置 */
export async function getDefaultProviderAction(): Promise<ProviderConfig | null> {
  return getDefaultProviderConfig();
}

/** 测试 Provider（用短文本验证可用性） */
export async function testProviderAction(id: string, testText?: string): Promise<{ ok: boolean; message: string }> {
  const cfgs = await loadConfigs();
  const cfg = cfgs.find((c) => c.id === id);
  if (!cfg) {
    return { ok: false, message: '未找到该 Provider 配置' };
  }

  const apiKey = await getApiKey(id);
  if (!apiKey && cfg.type !== 'local') {
    return { ok: false, message: 'API Key 未设置或已丢失，请重新输入' };
  }

  try {
    // 创建临时 Provider 实例进行测试
    if (cfg.type === 'rest' && cfg.endpoint && apiKey) {
      const provider = new RestTTSProvider({
        id: cfg.id + '_test',
        displayName: cfg.displayName + ' (测试)',
        apiEndpoint: cfg.endpoint,
        apiKey: apiKey,
        audioFormat: cfg.audioFormat || 'mp3',
      });

      const text = testText || '测试语音合成';
      const result = await provider.synthesize(text, { voice: cfg.voice });

      // 清理临时文件
      try {
        const { unlink } = await import('fs/promises');
        await unlink(result.filePath);
      } catch { /* ignore */ }

      return { ok: true, message: `测试成功！音频格式: ${result.format}` };
    }

    return { ok: false, message: `不支持的 Provider 类型: ${cfg.type}` };
  } catch (err) {
    return { ok: false, message: `测试失败: ${(err as Error).message}` };
  }
}

/** 启动时加载所有已保存的 Provider 并注册 */
export async function loadAndRegisterAllProviders(): Promise<void> {
  const cfgs = await loadConfigs();
  let registered = 0;

  for (const cfg of cfgs) {
    if (!cfg.enabled) continue;

    const apiKey = await getApiKey(cfg.id);
    if (!apiKey && cfg.type !== 'local') {
      console.warn(`[ProviderManager] Provider ${cfg.id} 缺少 API Key，跳过注册`);
      continue;
    }

    createAndRegisterProvider(cfg, apiKey || '');
    registered++;
  }

  console.log(`[ProviderManager] 启动时注册了 ${registered} 个 Provider`);
}
