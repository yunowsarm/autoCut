import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { loadEnv } from './env.js';
import { buildSegments, pairSegmentsWithImages } from './media.js';
import { renderVideo } from './render.js';

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

function parseSettings(body) {
  return {
    charsPerSecond: Number(body.charsPerSecond) || 4,
    minSeconds: Number(body.minSeconds) || 2,
    maxSeconds: Number(body.maxSeconds) || 8,
    subtitleEnabled: body.subtitleEnabled !== 'false',
    ttsMaxChunkChars: Number(body.ttsMaxChunkChars) || undefined
  };
}

async function cleanupUploads(files) {
  await Promise.allSettled(files.map((file) => fs.unlink(file.path)));
}

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
    res.status(400).json({
      ok: false,
      error: error.message || '视频生成失败。'
    });
  } finally {
    await cleanupUploads(files);
  }
});

app.listen(PORT, () => {
  console.log(`AutoCut local server is running at http://localhost:${PORT}`);
});
