import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { app, BrowserWindow } from 'electron';
import { initTTSIPC, registerProvider } from './main/tts/ttsService';
import { RestTTSProvider } from './main/tts/providers/RestTTSProvider';

dotenv.config();

// ---- 初始化 TTS Service ----
initTTSIPC();

// 注册通用 REST Provider（从环境变量读取配置）
// 使用方式：设置环境变量 TTS_REST_API_ENDPOINT 和 TTS_REST_API_KEY
const restEndpoint = process.env.TTS_REST_API_ENDPOINT;
const restApiKey = process.env.TTS_REST_API_KEY;
if (restEndpoint && restApiKey) {
  registerProvider(new RestTTSProvider({
    id: 'rest-default',
    displayName: '云端 TTS (REST)',
    apiEndpoint: restEndpoint,
    apiKey: restApiKey,
    audioFormat: 'mp3',
  }));
  console.log('[Main] 已注册 REST TTS Provider');
} else {
  console.log('[Main] 未配置 REST TTS 环境变量，仅使用本地 Web Speech');
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    title: `wx-read-desktop ${process.env.npm_package_version}`,

    height: 800,
    width: 1280,

    autoHideMenuBar: process.env.NODE_ENV === 'dev' ? false : true,

    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadURL('https://weread.qq.com/');

  // Open the DevTools.
  process.env.NODE_ENV === 'dev' && mainWindow.webContents.openDevTools();

  // 注入 TTS 听书脚本（页面加载完成后）
  mainWindow.webContents.on('did-finish-load', () => {
    injectTTS(mainWindow);
  });
};

/**
 * 将编译后的 TTS 脚本注入到微信读书页面
 */
function injectTTS(win: BrowserWindow): void {
  try {
    const injectPath = path.join(__dirname.replace('tsout', 'src'), 'ttsInject.ts');
    if (fs.existsSync(injectPath)) {
      const code = fs.readFileSync(injectPath, 'utf-8');
      win.webContents.executeJavaScript(code)
        .then(() => console.log('[Main] TTS 脚本注入成功'))
        .catch((err) => console.error('[Main] TTS 注入失败:', err));
    } else {
      console.warn('[Main] TTS 注入脚本未找到，跳过注入:', injectPath);
    }
  } catch (err) {
    console.error('[Main] TTS 注入异常:', err);
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
