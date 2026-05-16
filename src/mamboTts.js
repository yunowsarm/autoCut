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

/** MiloraAPI 文档: https://api.milorapart.top/docs/75/mbAIscvip */
const DEFAULT_ENDPOINT = 'https://api.milorapart.top/apis/mbAIscvip';

function toInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeAuthMode(value) {
  const mode = String(value || 'query').toLowerCase();
  return ['query', 'bearer', 'header', 'none'].includes(mode) ? mode : 'query';
}

export function buildMamboConfig(env = process.env) {
  return {
    endpoint:
      env.MILORA_TTS_ENDPOINT ||
      env.MAMBO_TTS_ENDPOINT ||
      DEFAULT_ENDPOINT,
    apiKey: env.MILORA_TTS_API_KEY || env.MAMBO_TTS_API_KEY || '',
    apiKeyParam:
      env.MILORA_TTS_API_KEY_PARAM || env.MAMBO_TTS_API_KEY_PARAM || 'key',
    authMode: normalizeAuthMode(
      env.MILORA_TTS_AUTH_MODE || env.MAMBO_TTS_AUTH_MODE,
    ),
    authHeader:
      env.MILORA_TTS_AUTH_HEADER ||
      env.MAMBO_TTS_AUTH_HEADER ||
      'Authorization',
    timeoutMs: toInt(
      env.MILORA_TTS_TIMEOUT_MS || env.MAMBO_TTS_TIMEOUT_MS,
      120000,
    ),
  };
}

export const buildMiloraConfig = buildMamboConfig;

export function buildMamboRequestUrl(text, config = buildMamboConfig()) {
  const url = new URL(config.endpoint || DEFAULT_ENDPOINT);
  url.searchParams.set('text', text);
  if (config.apiKey && config.authMode === 'query') {
    url.searchParams.set(config.apiKeyParam || 'key', config.apiKey);
  }
  return url.toString();
}

function buildHeaders(config) {
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'AutoCut-Local/1.0'
  };

  if (!config.apiKey) {
    return headers;
  }

  if (config.authMode === 'bearer') {
    headers.Authorization = `Bearer ${config.apiKey}`;
  } else if (config.authMode === 'header') {
    headers[config.authHeader || 'Authorization'] = config.apiKey;
  }

  return headers;
}

function formatFetchCause(error) {
  const cause = error?.cause;
  const parts = [
    cause?.code,
    cause?.errno,
    cause?.syscall,
    cause?.address,
    cause?.port
  ].filter(Boolean);
  return parts.length > 0 ? ` (${parts.join(' ')})` : '';
}

function createTtsError(message, statusCode = 502) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&bull;/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarizeResponseBody(body) {
  const text = stripHtml(body);
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
}

async function fetchJson(url, config) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(config),
      signal: controller.signal
    });
    const body = await response.text();

    if (!response.ok) {
      throw createTtsError(
        `Mambo TTS request failed: HTTP ${response.status} ${summarizeResponseBody(body)}`
      );
    }

    try {
      return JSON.parse(body);
    } catch {
      throw createTtsError(`Mambo TTS returned invalid JSON: ${body}`);
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createTtsError(`Mambo TTS request timed out after ${config.timeoutMs}ms.`);
    }
    if (error?.message === 'fetch failed') {
      throw createTtsError(
        `Mambo TTS network request failed${formatFetchCause(error)}. Check whether this machine can open ${new URL(url).origin}.`
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function assertApiSuccess(payload) {
  if (payload?.code == null) return;
  const code = Number(payload.code);
  if (Number.isFinite(code) && code !== 200) {
    const message = payload.msg || payload.message || `错误码 ${code}`;
    throw createTtsError(`Milora TTS 合成失败：${message}`);
  }
}

function readAudioUrl(payload) {
  assertApiSuccess(payload);

  const audioUrl =
    payload?.url ||
    payload?.data?.url ||
    payload?.data?.audio ||
    payload?.data?.audioUrl ||
    payload?.audio ||
    payload?.audioUrl;

  if (!audioUrl || typeof audioUrl !== 'string') {
    throw createTtsError(
      `Milora TTS 未返回音频地址：${JSON.stringify(payload)}`,
    );
  }

  return audioUrl;
}

async function downloadFile(url, outputPath) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': 'AutoCut-Local/1.0'
      }
    });
  } catch (error) {
    if (error?.message === 'fetch failed') {
      throw createTtsError(
        `Mambo TTS audio download network request failed${formatFetchCause(error)}. URL: ${url}`
      );
    }
    throw error;
  }
  if (!response.ok) {
    throw createTtsError(`Mambo TTS audio download failed: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, buffer);
}

export class MamboTtsProvider extends TtsProvider {
  constructor(config = buildMamboConfig()) {
    super();
    this.config = config;
    if (!this.config.apiKey) {
      throw new Error(
        '缺少 Milora TTS API Key，请在 .env 中设置 MILORA_TTS_API_KEY 或 MAMBO_TTS_API_KEY。',
      );
    }
  }

  async synthesizeToFile(text, outputPath) {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
      throw new Error('TTS 文本不能为空。');
    }
    const requestUrl = buildMamboRequestUrl(trimmed, this.config);
    const payload = await fetchJson(requestUrl, this.config);
    const audioUrl = readAudioUrl(payload);
    await downloadFile(audioUrl, outputPath);
  }

  async generateNarration(segments, settings = {}) {
    const outputPath = settings.narrationOutputPath;
    if (!outputPath) {
      throw new Error('Missing narrationOutputPath for narration output.');
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

export const MiloraTtsProvider = MamboTtsProvider;
export const buildMiloraRequestUrl = buildMamboRequestUrl;
