import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { loadEnv } from './env.js';
import { assignImagesToSegments, buildSegments } from './media.js';
import { renderVideo } from './render.js';
import { resolveTtsProviderName } from './tts.js';
import { buildMamboConfig } from './mamboTts.js';
import { buildXfyunConfig } from './xfyunTts.js';

loadEnv();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const upload = multer({
  dest: path.join(process.cwd(), 'uploads'),
  limits: {
    files: 500,
    fileSize: 30 * 1024 * 1024,
  },
});

app.use(express.static(path.join(process.cwd(), 'public')));
app.use('/output', express.static(path.join(process.cwd(), 'output')));

const IMAGE_MOTION_MODES = new Set(['both', 'zoom', 'float', 'alternate', 'random', 'none']);
const ASPECT_RATIOS = new Set(['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16']);
const TTS_PROVIDERS = new Set(['milora', 'xfyun', 'none']);
const jobs = new Map();

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function parseImageFit(body) {
  const fit = String(body.imageFit || '').toLowerCase();
  if (fit === 'contain' || fit === 'cover') return fit;
  if (body.imageCropFill === 'false' || body.imageCropFill === '0') {
    return 'contain';
  }
  return 'cover';
}

function parseSettings(body) {
  const imageMotion = String(body.imageMotion || 'both');
  const aspectRatio = String(body.aspectRatio || '9:16');
  const imageFit = parseImageFit(body);
  const ttsProvider = resolveTtsProviderName(body.ttsProvider || process.env.TTS_PROVIDER);

  return {
    charsPerSecond: Number(body.charsPerSecond) || 4,
    minSeconds: Number(body.minSeconds) || 2,
    maxSeconds: Number(body.maxSeconds) || 8,
    subtitleEnabled: body.subtitleEnabled !== 'false',
    ttsMaxChunkChars: Number(body.ttsMaxChunkChars) || undefined,
    imageMotion: IMAGE_MOTION_MODES.has(imageMotion) ? imageMotion : 'both',
    imageFit,
    imageCropFill: imageFit === 'cover',
    aspectRatio: ASPECT_RATIOS.has(aspectRatio) ? aspectRatio : '9:16',
    motionZoomStart: clampNumber(body.motionZoomStart, 1, 1.5, 1),
    motionZoomEnd: clampNumber(body.motionZoomEnd, 1, 1.8, 1.12),
    motionFloatAmplitude: clampNumber(body.motionFloatAmplitude, 0, 240, 88),
    motionFloatSpeed: clampNumber(body.motionFloatSpeed, 0.2, 5, 1),
    ttsProvider: TTS_PROVIDERS.has(ttsProvider) ? ttsProvider : 'milora',
  };
}

async function cleanupUploads(files) {
  await Promise.allSettled(files.map((file) => fs.unlink(file.path)));
}

function statusCodeForError(error) {
  if (Number.isInteger(error?.statusCode)) {
    return error.statusCode;
  }

  return 400;
}

function createJob() {
  const job = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: 'queued',
    progress: 0,
    message: '等待开始',
    result: null,
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  jobs.set(job.id, job);
  return job;
}

function updateJob(job, patch) {
  Object.assign(job, patch, { updatedAt: Date.now() });
}

function serializeJob(job) {
  return {
    ok: job.status !== 'error',
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    result: job.result,
    error: job.error,
  };
}

async function runRenderJob(job, pairs, settings, files) {
  try {
    updateJob(job, {
      status: 'running',
      progress: 1,
      message: '开始生成',
    });
    const result = await renderVideo({
      pairs,
      settings,
      onProgress: ({ progress, message }) => {
        updateJob(job, {
          status: 'running',
          progress: Math.min(99, Math.max(1, Number(progress) || 1)),
          message: message || job.message,
        });
      },
    });
    updateJob(job, {
      status: 'done',
      progress: 100,
      message: '生成完成',
      result: {
        downloadUrl: result.downloadUrl,
        outputName: result.outputName,
        segmentCount: pairs.length,
        totalDuration: Number(result.totalDuration.toFixed(2)),
        videoSize: result.videoSize,
      },
    });
  } catch (error) {
    console.error('[render failed]', error);
    updateJob(job, {
      status: 'error',
      message: '生成失败',
      error: error.message || '视频生成失败。',
    });
  } finally {
    await cleanupUploads(files);
  }
}

app.get('/api/config', (_req, res) => {
  const ttsProvider = resolveTtsProviderName();
  const miloraConfigured = Boolean(buildMamboConfig().apiKey);
  const xfyunConfig = buildXfyunConfig();
  const xfyunConfigured = Boolean(
    xfyunConfig.appId && xfyunConfig.apiKey && xfyunConfig.apiSecret,
  );
  res.json({
    ok: true,
    ttsProvider,
    miloraConfigured,
    xfyunConfigured,
    ttsDocsUrl: 'https://api.milorapart.top/docs/75/mbAIscvip',
  });
});

app.post(
  '/api/render',
  upload.fields([
    { name: 'images', maxCount: 500 },
    { name: 'bgm', maxCount: 1 },
  ]),
  async (req, res) => {
  const imageFiles = req.files?.images || [];
  const bgmFile = req.files?.bgm?.[0] || null;
  const files = [...imageFiles, ...(bgmFile ? [bgmFile] : [])];

  try {
    const settings = parseSettings(req.body);
    settings.bgmPath = bgmFile?.path || null;
    settings.bgmVolume = clampNumber(req.body.bgmVolume, 0, 1, 0.18);
    const segments = buildSegments(req.body.text, settings);
    const pairs = assignImagesToSegments(segments, imageFiles);
    const job = createJob();
    runRenderJob(job, pairs, settings, files);

    res.status(202).json({
      ok: true,
      jobId: job.id,
      statusUrl: `/api/render/${job.id}`,
    });
  } catch (error) {
    console.error('[render failed]', error);
    await cleanupUploads(files);
    res.status(statusCodeForError(error)).json({
      ok: false,
      error: error.message || '视频生成失败。',
    });
  }
});

app.get('/api/render/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({
      ok: false,
      error: '任务不存在或已过期。',
    });
    return;
  }

  res.json(serializeJob(job));
});

app.listen(PORT, () => {
  const ttsProvider = resolveTtsProviderName();
  const miloraReady = ttsProvider === 'milora' && Boolean(buildMamboConfig().apiKey);
  console.log(`AutoCut local server is running at http://localhost:${PORT}`);
  // console.log(`TTS provider: ${ttsProvider}${miloraReady ? ' (Milora mbAIscvip ready)' : ''}`);
  if (ttsProvider === 'milora' && !miloraReady) {
    console.warn('Milora TTS API key missing. Set MILORA_TTS_API_KEY in .env');
  }
});
