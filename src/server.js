import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { loadEnv } from './env.js';
import { buildSegments, pairSegmentsWithImages } from './media.js';
import { renderVideo } from './render.js';
import { resolveTtsProviderName } from './tts.js';
import { buildMamboConfig } from './mamboTts.js';

loadEnv();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const upload = multer({
  dest: path.join(process.cwd(), 'uploads'),
  limits: {
    files: 500,
    fileSize: 30 * 1024 * 1024
  }
});

app.use(express.static(path.join(process.cwd(), 'public')));
app.use('/output', express.static(path.join(process.cwd(), 'output')));

const IMAGE_MOTION_MODES = new Set(['both', 'zoom', 'float', 'alternate', 'random', 'none']);

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
  return {
    charsPerSecond: Number(body.charsPerSecond) || 4,
    minSeconds: Number(body.minSeconds) || 2,
    maxSeconds: Number(body.maxSeconds) || 8,
    subtitleEnabled: body.subtitleEnabled !== 'false',
    ttsMaxChunkChars: Number(body.ttsMaxChunkChars) || undefined,
    imageMotion: IMAGE_MOTION_MODES.has(imageMotion) ? imageMotion : 'both',
    imageFit: parseImageFit(body),
    imageCropFill: parseImageFit(body) === 'cover'
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

app.get('/api/config', (_req, res) => {
  const ttsProvider = resolveTtsProviderName();
  const miloraConfigured = Boolean(buildMamboConfig().apiKey);
  res.json({
    ok: true,
    ttsProvider,
    miloraConfigured,
    ttsDocsUrl: 'https://api.milorapart.top/docs/75/mbAIscvip',
  });
});

app.post('/api/render', upload.array('images'), async (req, res) => {
  const files = req.files || [];

  try {
    const settings = parseSettings(req.body);
    const segments = buildSegments(req.body.text, settings);
    const pairs = pairSegmentsWithImages(segments, files);
    const result = await renderVideo({ pairs, settings });

    res.json({
      ok: true,
      downloadUrl: result.downloadUrl,
      outputName: result.outputName,
      segmentCount: pairs.length,
      totalDuration: Number(result.totalDuration.toFixed(2))
    });
  } catch (error) {
    console.error('[render failed]', error);
    res.status(statusCodeForError(error)).json({
      ok: false,
      error: error.message || '视频生成失败。'
    });
  } finally {
    await cleanupUploads(files);
  }
});

app.listen(PORT, () => {
  const ttsProvider = resolveTtsProviderName();
  const miloraReady = ttsProvider === 'milora' && Boolean(buildMamboConfig().apiKey);
  console.log(`AutoCut local server is running at http://localhost:${PORT}`);
  console.log(`TTS provider: ${ttsProvider}${miloraReady ? ' (Milora mbAIscvip ready)' : ''}`);
  if (ttsProvider === 'milora' && !miloraReady) {
    console.warn('Milora TTS API key missing. Set MILORA_TTS_API_KEY in .env');
  }
});
