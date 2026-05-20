import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { loadEnv } from '../src/env.js';
import { assignImagesToSegments, buildSegments, isSupportedImage, naturalSortFiles } from '../src/media.js';
import { renderVideo } from '../src/render.js';
import { resolveTtsProviderName } from '../src/tts.js';
import { buildMamboConfig } from '../src/mamboTts.js';
import { buildXfyunConfig } from '../src/xfyunTts.js';

loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg']);
const IMAGE_MOTION_MODES = new Set(['both', 'zoom', 'float', 'alternate', 'random', 'none']);
const ASPECT_RATIOS = new Set(['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16']);
const TTS_PROVIDERS = new Set(['milora', 'xfyun', 'none']);

let mainWindow = null;

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function imageFileFromPath(filePath, originalname = path.basename(filePath)) {
  return {
    path: filePath,
    originalname,
    name: path.basename(filePath),
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 980,
    minHeight: 720,
    title: 'AutoCut Desktop',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(APP_ROOT, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);

  mainWindow.loadFile(path.join(APP_ROOT, 'public', 'index.html'));
}

async function listImagesInFolder(folderPath) {
  const files = [];

  async function walk(currentDir, relativeDir = '') {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const filePath = path.join(currentDir, entry.name);
      const relativePath = path.join(relativeDir, entry.name);

      if (entry.isDirectory()) {
        await walk(filePath, relativePath);
        continue;
      }

      if (!entry.isFile() || !isSupportedImage(entry.name)) continue;
      files.push(imageFileFromPath(filePath, relativePath));
    }
  }

  await walk(folderPath);
  return naturalSortFiles(files);
}

function parseSettings(raw = {}) {
  const imageMotion = String(raw.imageMotion || 'both');
  const aspectRatio = String(raw.aspectRatio || '9:16');
  const ttsProvider = resolveTtsProviderName(raw.ttsProvider || process.env.TTS_PROVIDER);
  const imageFit = raw.imageFit === 'contain' || raw.imageCropFill === false ? 'contain' : 'cover';

  return {
    charsPerSecond: Number(raw.charsPerSecond) || 4,
    minSeconds: Number(raw.minSeconds) || 2,
    maxSeconds: Number(raw.maxSeconds) || 8,
    subtitleEnabled: raw.subtitleEnabled !== false,
    ttsMaxChunkChars: Number(raw.ttsMaxChunkChars) || undefined,
    imageMotion: IMAGE_MOTION_MODES.has(imageMotion) ? imageMotion : 'both',
    imageFit,
    imageCropFill: imageFit === 'cover',
    aspectRatio: ASPECT_RATIOS.has(aspectRatio) ? aspectRatio : '9:16',
    motionZoomStart: clampNumber(raw.motionZoomStart, 1, 1.5, 1),
    motionZoomEnd: clampNumber(raw.motionZoomEnd, 1, 1.8, 1.12),
    motionFloatAmplitude: clampNumber(raw.motionFloatAmplitude, 0, 240, 88),
    motionFloatSpeed: clampNumber(raw.motionFloatSpeed, 0.2, 5, 1),
    ttsProvider: TTS_PROVIDERS.has(ttsProvider) ? ttsProvider : 'milora',
    bgmPath: raw.bgmPath || null,
    bgmVolume: clampNumber(raw.bgmVolume, 0, 1, 0.18),
  };
}

function getConfig() {
  const ttsProvider = resolveTtsProviderName();
  const miloraConfigured = Boolean(buildMamboConfig().apiKey);
  const xfyunConfig = buildXfyunConfig();
  const xfyunConfigured = Boolean(
    xfyunConfig.appId && xfyunConfig.apiKey && xfyunConfig.apiSecret,
  );

  return {
    ok: true,
    desktop: true,
    ttsProvider,
    miloraConfigured,
    xfyunConfigured,
  };
}

ipcMain.handle('config:get', () => getConfig());

ipcMain.handle('dialog:select-image-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择图片文件夹',
    properties: ['openDirectory'],
  });

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true, images: [] };
  }

  const folderPath = result.filePaths[0];
  const images = await listImagesInFolder(folderPath);
  return {
    canceled: false,
    folderPath,
    images,
  };
});

ipcMain.handle('dialog:select-image-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择段落图片',
    properties: ['openFile'],
    filters: [
      { name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'webp'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true, image: null };
  }

  return {
    canceled: false,
    image: imageFileFromPath(result.filePaths[0]),
  };
});

ipcMain.handle('dialog:select-bgm-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择背景音乐',
    properties: ['openFile'],
    filters: [
      { name: '音频文件', extensions: [...AUDIO_EXTENSIONS].map((ext) => ext.slice(1)) },
      { name: '所有文件', extensions: ['*'] },
    ],
  });

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true, file: null };
  }

  const filePath = result.filePaths[0];
  return {
    canceled: false,
    file: {
      path: filePath,
      name: path.basename(filePath),
    },
  };
});

ipcMain.handle('dialog:select-output-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择输出目录',
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true, folderPath: null };
  }

  return {
    canceled: false,
    folderPath: result.filePaths[0],
  };
});

ipcMain.handle('render:start', async (event, payload = {}) => {
  try {
    if (!payload.outputDir) {
      throw new Error('请先选择输出目录。');
    }

    const settings = parseSettings(payload.settings);
    const segments = buildSegments(payload.text, settings);
    const pairs = Array.isArray(payload.segmentImages)
      ? segments.map((segment, index) => ({
          ...segment,
          image: payload.segmentImages[index] || null,
        }))
      : assignImagesToSegments(segments, payload.images || []);
    const result = await renderVideo({
      pairs,
      settings,
      outputDir: payload.outputDir,
      onProgress: ({ progress, message }) => {
        event.sender.send('render:progress', { progress, message });
      },
    });

    return {
      ok: true,
      result: {
        outputName: result.outputName,
        outputPath: result.outputPath,
        segmentCount: pairs.length,
        totalDuration: Number(result.totalDuration.toFixed(2)),
        videoSize: result.videoSize,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message || '视频生成失败。',
    };
  }
});

ipcMain.handle('shell:open-output-folder', async (_event, filePath) => {
  if (!filePath) return { ok: false, error: '没有可打开的输出文件。' };
  shell.showItemInFolder(filePath);
  return { ok: true };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
