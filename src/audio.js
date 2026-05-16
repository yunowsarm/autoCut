import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveFfmpeg } from './ffmpeg.js';

function ffprobePathFromFfmpeg(ffmpegPath) {
  if (/ffmpeg\.exe$/i.test(ffmpegPath)) {
    return ffmpegPath.replace(/ffmpeg\.exe$/i, 'ffprobe.exe');
  }
  if (ffmpegPath.endsWith('ffmpeg')) {
    return `${ffmpegPath.slice(0, -'ffmpeg'.length)}ffprobe`;
  }
  return ffmpegPath;
}

async function runFfmpeg(args) {
  const ffmpegPath = await resolveFfmpeg();
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}

function probeViaFfmpegStderr(ffmpegPath, filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-i', filePath], {
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', () => {
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
      if (!match) {
        reject(new Error(`无法读取媒体时长：${filePath}`));
        return;
      }
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      const seconds = Number(match[3]);
      resolve(hours * 3600 + minutes * 60 + seconds);
    });
  });
}

function probeViaFfprobe(ffprobePath, filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffprobePath,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ],
      { windowsHide: true },
    );
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe 退出码 ${code}`));
        return;
      }
      const sec = Number(stdout.trim());
      if (!Number.isFinite(sec) || sec <= 0) {
        reject(new Error('ffprobe 未返回有效时长'));
        return;
      }
      resolve(sec);
    });
  });
}

export async function probeMediaDuration(filePath) {
  const ffmpegPath = await resolveFfmpeg();
  const ffprobePath = ffprobePathFromFfmpeg(ffmpegPath);

  if (fsSync.existsSync(ffprobePath)) {
    try {
      return await probeViaFfprobe(ffprobePath, filePath);
    } catch {
      // ffprobe 不可用或失败时退回 ffmpeg 解析 stderr
    }
  }

  return probeViaFfmpegStderr(ffmpegPath, filePath);
}

/** 与 CFR 视频帧边界对齐，避免每段舍入误差累积导致音画漂移 */
export function quantizeDurationToFps(seconds, fps = 30) {
  const s = Math.max(0, Number(seconds) || 0);
  const frameCount = Math.max(1, Math.round(s * fps));
  const clipSeconds = frameCount / fps;
  return { frameCount, clipSeconds };
}

/** 将单段音频裁切或补静音到与视频完全相同的时长 */
export async function normalizeAudioToDuration(inputPath, outputPath, durationSeconds) {
  const d = Math.max(1 / 30, Number(durationSeconds) || 0);
  const filter = `atrim=duration=${d},asetpts=PTS-STARTPTS,apad=whole_dur=${d}`;
  await runFfmpeg([
    '-y',
    '-i',
    inputPath,
    '-af',
    filter,
    '-ar',
    '48000',
    '-ac',
    '1',
    '-c:a',
    'libmp3lame',
    '-q:a',
    '4',
    outputPath
  ]);
}

export async function concatAudioFiles(inputPaths, outputPath) {
  if (inputPaths.length === 0) {
    throw new Error('没有可拼接的音频片段。');
  }

  if (inputPaths.length === 1) {
    await fs.copyFile(inputPaths[0], outputPath);
    return;
  }

  const workDir = path.dirname(outputPath);
  const listPath = path.join(workDir, 'audio-concat.txt');
  const list = inputPaths
    .map((filePath) => `file '${filePath.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
    .join('\n');
  await fs.writeFile(listPath, list, 'utf8');

  const ffmpegPath = await resolveFfmpeg();
  await new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath],
      { windowsHide: true }
    );
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `音频拼接失败，退出码 ${code}`));
    });
  });
}

export function applySegmentDurations(pairs, segments) {
  const byIndex = new Map(segments.map((segment) => [segment.index, segment]));

  return pairs.map((pair) => {
    const segment = byIndex.get(pair.index);
    if (!segment?.duration) return pair;
    let next = { ...pair, duration: segment.duration };
    if (segment.frameCount != null) {
      next = { ...next, frameCount: segment.frameCount };
    }
    if (segment.subtitleChunks?.length) {
      next = { ...next, subtitleChunks: segment.subtitleChunks };
    }
    return next;
  });
}
