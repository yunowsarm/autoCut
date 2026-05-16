import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import staticFfmpegPath from 'ffmpeg-static';

const CACHE_DIR = path.join(os.homedir(), '.cache', 'autocut-local');
const CACHED_BINARY = path.join(
  CACHE_DIR,
  process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
);

let resolvedFfmpegPath = null;

function spawnVersionCheck(binaryPath) {
  return new Promise((resolve) => {
    const child = spawn(binaryPath, ['-version'], { windowsHide: true });
    let settled = false;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    child.on('error', () => finish(false));
    child.on('close', (code) => finish(code === 0));
    setTimeout(() => {
      child.kill();
      finish(false);
    }, 8000);
  });
}

async function isUsable(binaryPath) {
  if (!binaryPath) return false;
  try {
    await fs.access(binaryPath, fsSync.constants.R_OK);
  } catch {
    return false;
  }
  return spawnVersionCheck(binaryPath);
}

async function copyToCache(sourcePath) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.copyFile(sourcePath, CACHED_BINARY);
  if (process.platform !== 'win32') {
    await fs.chmod(CACHED_BINARY, 0o755);
  }
  return CACHED_BINARY;
}

export async function resolveFfmpeg() {
  if (resolvedFfmpegPath) {
    return resolvedFfmpegPath;
  }

  const envPath = process.env.FFMPEG_BIN || process.env.FFMPEG_PATH;
  if (envPath && (await isUsable(envPath))) {
    resolvedFfmpegPath = envPath;
    return resolvedFfmpegPath;
  }

  if (staticFfmpegPath && fsSync.existsSync(staticFfmpegPath)) {
    if (await isUsable(staticFfmpegPath)) {
      resolvedFfmpegPath = staticFfmpegPath;
      return resolvedFfmpegPath;
    }

    if (fsSync.existsSync(CACHED_BINARY) && (await isUsable(CACHED_BINARY))) {
      resolvedFfmpegPath = CACHED_BINARY;
      return resolvedFfmpegPath;
    }

    try {
      const cachedPath = await copyToCache(staticFfmpegPath);
      if (await isUsable(cachedPath)) {
        resolvedFfmpegPath = cachedPath;
        return resolvedFfmpegPath;
      }
    } catch {
      // Source may still be locked while ffmpeg-static is downloading.
    }
  } else if (fsSync.existsSync(CACHED_BINARY) && (await isUsable(CACHED_BINARY))) {
    resolvedFfmpegPath = CACHED_BINARY;
    return resolvedFfmpegPath;
  }

  if (await isUsable('ffmpeg')) {
    resolvedFfmpegPath = 'ffmpeg';
    return resolvedFfmpegPath;
  }

  throw new Error(
    '无法启动 ffmpeg（可能仍在下载或被占用）。请先停止 pnpm start，运行 pnpm run setup-ffmpeg，完成后再重试。也可在 .env 中设置 FFMPEG_BIN 指向本机 ffmpeg.exe。'
  );
}
