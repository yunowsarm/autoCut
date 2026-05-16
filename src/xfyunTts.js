import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  concatAudioFiles,
  normalizeAudioToDuration,
  probeMediaDuration,
  quantizeDurationToFps
} from './audio.js';
import { splitTextForTts } from './media.js';
import { NarrationTrack, TtsProvider } from './tts.js';

const HOST = 'api-dx.xf-yun.com';
const CREATE_PATH = '/v1/private/dts_create';
const QUERY_PATH = '/v1/private/dts_query';
const BASE_URL = `https://${HOST}`;

function requireConfigValue(config, key) {
  if (!config[key]) {
    throw new Error(`缺少讯飞配置：${key}`);
  }
  return config[key];
}

function toInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function buildXfyunConfig(env = process.env) {
  return {
    appId: env.XFYUN_APP_ID,
    apiKey: env.XFYUN_API_KEY,
    apiSecret: env.XFYUN_API_SECRET,
    vcn: env.XFYUN_VCN || 'x4_mingge',
    speed: toInt(env.XFYUN_SPEED, 50),
    volume: toInt(env.XFYUN_VOLUME, 50),
    pitch: toInt(env.XFYUN_PITCH, 50),
    sampleRate: toInt(env.XFYUN_SAMPLE_RATE, 16000),
    pollIntervalMs: toInt(env.XFYUN_POLL_INTERVAL_MS, 2000),
    timeoutMs: toInt(env.XFYUN_TIMEOUT_MS, 180000)
  };
}

export function buildAuthUrl(pathname, config, now = new Date()) {
  const apiKey = requireConfigValue(config, 'apiKey');
  const apiSecret = requireConfigValue(config, 'apiSecret');
  const date = now.toUTCString();
  const signatureOrigin = `host: ${HOST}\ndate: ${date}\nPOST ${pathname} HTTP/1.1`;
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(signatureOrigin)
    .digest('base64');
  const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = Buffer.from(authorizationOrigin, 'utf8').toString('base64');
  const params = new URLSearchParams({
    host: HOST,
    date,
    authorization
  });

  return `${BASE_URL}${pathname}?${params.toString()}`;
}

async function postJson(pathname, config, body) {
  const response = await fetch(buildAuthUrl(pathname, config), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`讯飞接口请求失败：HTTP ${response.status} ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`讯飞接口返回了无法解析的 JSON：${text}`);
  }
}

function assertHeaderOk(result, action) {
  const header = result?.header;
  if (!header || header.code !== 0) {
    const code = header?.code ?? 'unknown';
    const message = header?.message || 'unknown error';
    throw new Error(`讯飞${action}失败：${code} ${message}`);
  }
  return header;
}

async function createTask(text, config) {
  const appId = requireConfigValue(config, 'appId');
  const body = {
    header: {
      app_id: appId
    },
    parameter: {
      dts: {
        vcn: config.vcn,
        language: 'zh',
        speed: config.speed,
        volume: config.volume,
        pitch: config.pitch,
        rhy: 0,
        bgs: 0,
        reg: 0,
        rdn: 0,
        scn: 0,
        audio: {
          encoding: 'lame',
          sample_rate: config.sampleRate,
          channels: 1,
          bit_depth: 16,
          frame_size: 0
        },
        pybuf: {
          encoding: 'utf8',
          compress: 'raw',
          format: 'plain'
        }
      }
    },
    payload: {
      text: {
        encoding: 'utf8',
        compress: 'raw',
        format: 'plain',
        text: Buffer.from(text, 'utf8').toString('base64')
      }
    }
  };
  const result = await postJson(CREATE_PATH, config, body);
  const header = assertHeaderOk(result, '创建任务');

  if (!header.task_id) {
    throw new Error('讯飞创建任务成功但没有返回 task_id。');
  }

  return header.task_id;
}

async function queryTask(taskId, config) {
  const result = await postJson(QUERY_PATH, config, {
    header: {
      app_id: config.appId,
      task_id: taskId
    }
  });
  const header = assertHeaderOk(result, '查询任务');
  return {
    status: String(header.task_status || ''),
    audioUrlBase64: result?.payload?.audio?.audio
  };
}

async function waitForAudioUrl(taskId, config) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < config.timeoutMs) {
    await sleep(config.pollIntervalMs);
    const result = await queryTask(taskId, config);

    if (result.status === '5') {
      if (!result.audioUrlBase64) {
        throw new Error('讯飞任务完成但没有返回音频链接。');
      }
      return Buffer.from(result.audioUrlBase64, 'base64').toString('utf8');
    }

    if (result.status === '2' || result.status === '4') {
      throw new Error(`讯飞任务处理失败，状态码：${result.status}`);
    }
  }

  throw new Error('讯飞语音合成超时，请稍后重试或调大 XFYUN_TIMEOUT_MS。');
}

async function downloadFile(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`讯飞音频下载失败：HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, buffer);
}

export class XfyunLongTextTtsProvider extends TtsProvider {
  constructor(config = buildXfyunConfig()) {
    super();
    this.config = config;
  }

  async synthesizeToFile(text, outputPath) {
    const taskId = await createTask(text, this.config);
    const audioUrl = await waitForAudioUrl(taskId, this.config);
    await downloadFile(audioUrl, outputPath);
  }

  async generateNarration(segments, settings = {}) {
    const outputPath = settings.narrationOutputPath;
    if (!outputPath) {
      throw new Error('缺少旁白输出路径 narrationOutputPath。');
    }

    const workDir = path.dirname(outputPath);
    const timedSegments = [];
    const audioPaths = [];
    const maxChunk =
      Number(settings.ttsMaxChunkChars) ||
      Number(process.env.TTS_MAX_CHUNK_CHARS) ||
      80;

    for (const segment of segments) {
      const segmentPath = path.join(
        workDir,
        `tts-${String(segment.index).padStart(4, '0')}.mp3`
      );
      const chunks = splitTextForTts(segment.text, maxChunk);

      if (chunks.length === 1) {
        await this.synthesizeToFile(chunks[0], segmentPath);
        const probedDuration = await probeMediaDuration(segmentPath);
        audioPaths.push(segmentPath);
        timedSegments.push({
          ...segment,
          audioPath: segmentPath,
          probedDuration,
          duration: probedDuration
        });
        continue;
      }

      const chunkNormPaths = [];
      const subtitleChunks = [];
      let totalFrames = 0;

      for (let ci = 0; ci < chunks.length; ci++) {
        const rawPath = path.join(
          workDir,
          `tts-${String(segment.index).padStart(4, '0')}-${ci}.mp3`
        );
        await this.synthesizeToFile(chunks[ci], rawPath);
        const probed = await probeMediaDuration(rawPath);
        const { frameCount, clipSeconds } = quantizeDurationToFps(probed, 30);
        const normPath = path.join(
          workDir,
          `tts-${String(segment.index).padStart(4, '0')}-${ci}-n.mp3`
        );
        await normalizeAudioToDuration(rawPath, normPath, clipSeconds);
        chunkNormPaths.push(normPath);
        subtitleChunks.push({ text: chunks[ci], duration: clipSeconds });
        totalFrames += frameCount;
      }

      await concatAudioFiles(chunkNormPaths, segmentPath);
      const clipSeconds = totalFrames / 30;

      audioPaths.push(segmentPath);
      timedSegments.push({
        ...segment,
        audioPath: segmentPath,
        probedDuration: clipSeconds,
        duration: clipSeconds,
        frameCount: totalFrames,
        subtitleChunks
      });
    }

    await concatAudioFiles(audioPaths, outputPath);
    const totalDuration = Number(
      timedSegments.reduce((sum, segment) => sum + segment.duration, 0).toFixed(2)
    );

    return new NarrationTrack({
      filePath: outputPath,
      duration: totalDuration,
      segments: timedSegments
    });
  }
}
