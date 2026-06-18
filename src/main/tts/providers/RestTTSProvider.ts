/**
 * 通用 REST TTS Provider Adapter
 * 可适配大多数提供 REST API 的 TTS 服务（豆包、讯飞、腾讯云等）
 * 只需配置 apiEndpoint、apiKey 和请求/响应格式即可
 */

import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { ITTSProvider, SynthesizeResult, SynthOptions, VoiceInfo } from './ITTSProvider';
import * as path from 'path';
import * as os from 'os';

export interface RestProviderConfig {
  /** Provider 唯一标识 */
  id: string;
  /** 显示名称 */
  displayName: string;
  /** API 端点 URL */
  apiEndpoint: string;
  /** API 密钥（从环境变量读取，不硬编码） */
  apiKey: string;
  /** 是否支持流式 */
  supportsStreaming?: boolean;
  /** 请求体构建函数（可覆盖默认行为） */
  buildRequestBody?: (text: string, opts: SynthOptions) => any;
  /** 请求头构建函数（可覆盖默认行为） */
  buildHeaders?: (apiKey: string) => Record<string, string>;
  /** 响应解析函数（可覆盖默认行为，用于非标准响应格式） */
  parseResponse?: (buffer: Buffer) => { audio: Buffer; format: string };
  /** 音频格式 */
  audioFormat?: string;
}

export class RestTTSProvider implements ITTSProvider {
  id: string;
  displayName: string;
  supportsStreaming?: boolean;

  private config: RestProviderConfig;

  constructor(config: RestProviderConfig) {
    this.id = config.id;
    this.displayName = config.displayName;
    this.supportsStreaming = config.supportsStreaming;
    this.config = config;
  }

  async listVoices(): Promise<VoiceInfo[]> {
    // 通用 REST provider 通常不提供语音列表接口
    // 子类或具体 adapter 可覆盖此方法
    return [];
  }

  async synthesize(text: string, opts: SynthOptions): Promise<SynthesizeResult> {
    const headers = this.config.buildHeaders
      ? this.config.buildHeaders(this.config.apiKey)
      : {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        };

    const body = this.config.buildRequestBody
      ? this.config.buildRequestBody(text, opts)
      : {
          text,
          voice: opts.voice || 'default',
          rate: opts.rate || 1,
        };

    const bodyStr = JSON.stringify(body);

    // 使用 Node.js 原生 http/https 发起请求
    const buffer = await this.httpPost(this.config.apiEndpoint, headers, bodyStr);

    // 解析响应（支持自定义解析）
    const format = this.config.audioFormat || 'mp3';
    const audioBuffer = this.config.parseResponse
      ? this.config.parseResponse(buffer).audio
      : buffer;

    // 写入临时文件
    const tmpPath = path.join(os.tmpdir(), `tts-${Date.now()}.${format}`);
    const { writeFile } = await import('fs/promises');
    await writeFile(tmpPath, audioBuffer);

    return {
      filePath: tmpPath,
      format,
    };
  }

  /**
   * 使用 Node.js 原生 http/https 发起 POST 请求
   */
  private httpPost(urlStr: string, headers: Record<string, string>, body: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(urlStr);
      const isHttps = parsedUrl.protocol === 'https:';
      const lib = isHttps ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const req = lib.request(options, (res) => {
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          let errData = '';
          res.on('data', (chunk) => { errData += chunk; });
          res.on('end', () => {
            reject(new Error(`TTS API 错误 (${res.statusCode}): ${errData}`));
          });
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk) => { chunks.push(Buffer.from(chunk)); });
        res.on('end', () => { resolve(Buffer.concat(chunks)); });
      });

      req.on('error', (err) => { reject(err); });
      req.write(body);
      req.end();
    });
  }
}
