/**
 * TTS Provider 统一接口
 * 所有云端/本地 TTS 适配器必须实现此接口
 * 在主进程中使用，密钥不暴露给 renderer
 */

export interface VoiceInfo {
  name: string;
  lang?: string;
  gender?: 'male' | 'female' | 'neutral';
}

export interface SynthesizeResult {
  /** 本地已写好的音频文件绝对路径 */
  filePath: string;
  /** 音频格式 */
  format: 'mp3' | 'wav' | 'ogg' | string;
  /** 音频时长（秒），可选 */
  durationSeconds?: number;
}

export interface SynthOptions {
  /** 语音名称/ID */
  voice?: string;
  /** 语速（1.0 为正常） */
  rate?: number;
  /** 提供商特有选项 */
  providerOptions?: Record<string, any>;
}

export interface ITTSProvider {
  /** 提供商唯一标识，如 'doubao', 'xunfei', 'tencent' */
  id: string;
  /** 提供商显示名称 */
  displayName: string;
  /** 是否支持流式返回 */
  supportsStreaming?: boolean;
  /** 列出可用语音 */
  listVoices(): Promise<VoiceInfo[]>;
  /** 合成文本为音频并写入本地文件 */
  synthesize(text: string, opts: SynthOptions): Promise<SynthesizeResult>;
}
