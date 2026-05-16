import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  applySegmentDurations,
  concatAudioFiles,
  normalizeAudioToDuration,
  quantizeDurationToFps,
} from "./audio.js";
import { resolveFfmpeg } from "./ffmpeg.js";
import { wrapSubtitleLines } from "./media.js";
import { createTtsProvider, generateNarration } from "./tts.js";

const OUTPUT_ROOT = path.join(process.cwd(), "output");
const WORK_ROOT = path.join(os.tmpdir(), "autocut-local");
const VIDEO_FPS = 30;

const RANDOM_MOTION_POOL = ["zoom", "float", "both"];
const VIDEO_SIZES = {
  "21:9": { width: 2100, height: 900 },
  "16:9": { width: 1920, height: 1080 },
  "3:2": { width: 1620, height: 1080 },
  "4:3": { width: 1440, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
  "3:4": { width: 1080, height: 1440 },
  "2:3": { width: 1080, height: 1620 },
  "9:16": { width: 1080, height: 1920 },
};

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

export function resolveVideoSize(settings = {}) {
  const aspectRatio = String(settings.aspectRatio || "9:16").trim();
  return VIDEO_SIZES[aspectRatio] || VIDEO_SIZES["9:16"];
}

function resolveMotionSettings(settings = {}) {
  return {
    zoomStart: clampNumber(settings.motionZoomStart, 1, 1.5, 1),
    zoomEnd: clampNumber(settings.motionZoomEnd, 1, 1.8, 1.12),
    floatAmplitude: clampNumber(settings.motionFloatAmplitude, 0, 240, 88),
    floatSpeed: clampNumber(settings.motionFloatSpeed, 0.2, 5, 1),
  };
}

function reportProgress(onProgress, progress, message) {
  if (typeof onProgress === "function") {
    onProgress({ progress: Math.round(progress), message });
  }
}

/** 按段落序号稳定随机，同一项目重复导出动效一致 */
function randomMotionForIndex(index) {
  const slot = Math.abs((index * 9301 + 49297) % 233280);
  return RANDOM_MOTION_POOL[slot % RANDOM_MOTION_POOL.length];
}

/** zoom | float | both | alternate | random | none */
function resolveImageMotion(pair, settings) {
  const mode = settings?.imageMotion || "both";
  if (mode === "alternate") {
    return pair.index % 2 === 0 ? "zoom" : "float";
  }
  if (mode === "random") {
    return randomMotionForIndex(pair.index);
  }
  return mode;
}

/** cover=裁切铺满 | contain=完整显示（留黑边） */
export function resolveImageFit(settings) {
  const raw = String(settings?.imageFit ?? settings?.imageCropFill ?? "cover")
    .toLowerCase()
    .trim();
  if (["contain", "fit", "0", "false", "no", "letterbox"].includes(raw)) {
    return "contain";
  }
  return "cover";
}

function buildCoverFilters(size) {
  const W = size.width;
  const H = size.height;
  return [
    `scale=${W}:${H}:force_original_aspect_ratio=increase`,
    `crop=${W}:${H}`,
  ];
}

function buildContainFilters(size) {
  const W = size.width;
  const H = size.height;
  return [
    `scale=${W}:${H}:force_original_aspect_ratio=decrease`,
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black`,
  ];
}

/** 单张静图 → 缓慢推镜 / 上下浮动（zoompan） */
function buildImageMotionFilters(frameCount, motion, imageFit = "cover", settings = {}) {
  const n = Math.max(1, frameCount);
  const size = resolveVideoSize(settings);
  const W = size.width;
  const H = size.height;
  const denom = Math.max(1, n - 1);
  const isContain = imageFit === "contain";
  const motionSettings = resolveMotionSettings(settings);

  if (motion === "none") {
    return isContain ? buildContainFilters(size) : buildCoverFilters(size);
  }

  const floatAmp = motionSettings.floatAmplitude;
  const floatPeriod = Math.max(1, (n * 2.8) / motionSettings.floatSpeed);
  const zoomStart = motionSettings.zoomStart;
  const zoomEnd = Math.max(zoomStart, motionSettings.zoomEnd);
  const zoomStep = (zoomEnd - zoomStart) / denom;
  const fixedZoom = String(Math.max(zoomStart, zoomEnd));

  let zExpr;
  let yExpr = `ih/2-(ih/zoom/2)+${floatAmp}*sin(2*PI*on/${floatPeriod})`;

  if (motion === "zoom") {
    zExpr = `min(${zoomEnd},${zoomStart}+${zoomStep}*on)`;
    yExpr = "ih/2-(ih/zoom/2)";
  } else if (motion === "float") {
    zExpr = fixedZoom;
  } else {
    zExpr = `min(${zoomEnd},${zoomStart}+${zoomStep}*on)`;
  }

  const zoompan = `zoompan=z='${zExpr}':x='iw/2-(iw/zoom/2)':y='${yExpr}':d=${n}:s=${W}x${H}:fps=${VIDEO_FPS}`;

  if (isContain) {
    const fitPad = buildContainFilters(size).join(",");
    const headroom = `scale='max(${W},iw*1.15)':'max(${H},ih*1.15)':force_original_aspect_ratio=increase`;
    return [fitPad, headroom, zoompan];
  }

  const preScale = `scale='max(${W},iw)':'max(${H},ih)':force_original_aspect_ratio=increase`;
  return [preScale, zoompan];
}

function ffmpegEscapePath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function assEscapeLine(line) {
  return String(line || "")
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}");
}

/** 先逐行转义，再用 ASS 换行符 \\N 拼接，避免把换行标记误转成字面反斜杠 */
function assEscapeLinesJoin(lines) {
  return lines.map(assEscapeLine).join("\\N");
}

function formatAssTime(seconds) {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const cs = centiseconds % 100;
  const totalSeconds = Math.floor(centiseconds / 100);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

async function runFfmpeg(args) {
  const ffmpegPath = await resolveFfmpeg();
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
    });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}

async function writeAssSubtitle(filePath, text, duration, subtitleChunks, settings) {
  const size = resolveVideoSize(settings);
  const subtitleMaxChars = Math.min(32, Math.max(12, Math.round(size.width / 60)));
  const fontSize = Math.min(64, Math.max(38, Math.round(size.width / 19)));
  const marginV = Math.max(48, Math.round(size.height * 0.0885));
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${size.width}
PlayResY: ${size.height}
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Microsoft YaHei,${fontSize},&H00FFFFFF,&H00FFFFFF,&H90000000,&H90000000,-1,0,0,0,100,100,0,0,1,4,1,2,88,88,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  let events = "";

  if (subtitleChunks?.length > 1) {
    let t = 0;
    for (const ch of subtitleChunks) {
      const start = formatAssTime(t);
      const end = formatAssTime(t + ch.duration);
      const wrappedText = assEscapeLinesJoin(wrapSubtitleLines(ch.text, subtitleMaxChars));
      events += `Dialogue: 0,${start},${end},Default,,0,0,0,,${wrappedText}\n`;
      t += ch.duration;
    }
  } else {
    const wrappedText = assEscapeLinesJoin(wrapSubtitleLines(text, subtitleMaxChars));
    const end = formatAssTime(duration);
    events = `Dialogue: 0,0:00:00.00,${end},Default,,0,0,0,,${wrappedText}\n`;
  }

  await fs.writeFile(filePath, header + events, "utf8");
}

async function renderClip(pair, workDir, subtitleEnabled, settings) {
  const clipPath = path.join(
    workDir,
    `clip-${String(pair.index).padStart(4, "0")}.mp4`,
  );
  const assPath = path.join(
    workDir,
    `subtitle-${String(pair.index).padStart(4, "0")}.ass`,
  );
  const fps = VIDEO_FPS;
  const { frameCount, clipSeconds } =
    pair.frameCount != null
      ? { frameCount: pair.frameCount, clipSeconds: pair.duration }
      : quantizeDurationToFps(pair.duration, fps);
  const motion = resolveImageMotion(pair, settings);
  const imageFit = resolveImageFit(settings);
  const vf = [
    ...buildImageMotionFilters(frameCount, motion, imageFit, settings),
    "setsar=1",
    "format=yuv420p",
  ];

  if (subtitleEnabled) {
    await writeAssSubtitle(
      assPath,
      pair.text,
      clipSeconds,
      pair.subtitleChunks,
      settings,
    );
    vf.push(`subtitles='${ffmpegEscapePath(assPath)}'`);
  }

  await runFfmpeg([
    "-y",
    "-loop",
    "1",
    "-t",
    String(clipSeconds),
    "-i",
    pair.image.path,
    "-vf",
    vf.join(","),
    "-r",
    String(fps),
    "-frames:v",
    String(frameCount),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    clipPath,
  ]);

  return clipPath;
}

async function concatClips(clipPaths, outputPath, workDir) {
  const listPath = path.join(workDir, "concat.txt");
  const list = clipPaths
    .map(
      (clipPath) =>
        `file '${clipPath.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`,
    )
    .join("\n");
  await fs.writeFile(listPath, list, "utf8");

  await runFfmpeg([
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

async function muxAudio(videoPath, audioPath, outputPath) {
  await runFfmpeg([
    "-y",
    "-i",
    videoPath,
    "-i",
    audioPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

export async function renderVideo({ pairs, settings, onProgress }) {
  reportProgress(onProgress, 1, "准备生成任务");
  await fs.mkdir(OUTPUT_ROOT, { recursive: true });
  await fs.mkdir(WORK_ROOT, { recursive: true });

  const jobId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const workDir = path.join(WORK_ROOT, jobId);
  await fs.mkdir(workDir, { recursive: true });

  const narrationPath = path.join(workDir, "narration.mp3");
  const ttsProvider = await createTtsProvider(settings.ttsProvider);
  reportProgress(onProgress, 5, "正在生成配音");
  const narration = await generateNarration(
    pairs.map(({ text, duration, index }) => ({ text, duration, index })),
    {
      ...settings,
      narrationOutputPath: narrationPath,
      onProgress: ({ progress, message }) => {
        reportProgress(onProgress, 5 + progress * 0.3, message || "正在生成配音");
      },
    },
    ttsProvider,
  );
  reportProgress(onProgress, 35, "配音生成完成，正在对齐时长");

  const timedPairs =
    narration?.segments?.length > 0
      ? applySegmentDurations(pairs, narration.segments)
      : pairs;

  let pairsForVideo = timedPairs;
  let muxAudioPath = narration?.filePath;

  if (narration?.segments?.length > 0) {
    const normPaths = [];
    const aligned = [];

    for (let i = 0; i < timedPairs.length; i++) {
      const pair = timedPairs[i];
      const seg = narration.segments.find((s) => s.index === pair.index);
      if (!seg?.audioPath) {
        throw new Error(`缺少第 ${pair.index + 1} 段的旁白文件路径。`);
      }

      if (
        pair.subtitleChunks?.length > 1 &&
        pair.frameCount != null &&
        seg.audioPath
      ) {
        normPaths.push(seg.audioPath);
        aligned.push({
          ...pair,
          duration: seg.duration,
          frameCount: seg.frameCount,
          subtitleChunks: pair.subtitleChunks,
        });
        continue;
      }

      const raw = Number(seg.probedDuration ?? seg.duration ?? pair.duration);
      const { frameCount, clipSeconds } = quantizeDurationToFps(raw, 30);
      const normPath = path.join(
        workDir,
        `narr-norm-${String(pair.index).padStart(4, "0")}.mp3`,
      );
      await normalizeAudioToDuration(seg.audioPath, normPath, clipSeconds);
      normPaths.push(normPath);
      aligned.push({ ...pair, duration: clipSeconds, frameCount });
      reportProgress(onProgress, 35 + ((i + 1) / timedPairs.length) * 10, "正在对齐音频时长");
    }

    muxAudioPath = path.join(workDir, "narration-aligned.mp3");
    await concatAudioFiles(normPaths, muxAudioPath);
    pairsForVideo = aligned;
  }

  const clipPaths = [];
  for (let i = 0; i < pairsForVideo.length; i++) {
    const pair = pairsForVideo[i];
    reportProgress(onProgress, 45 + (i / pairsForVideo.length) * 40, `正在渲染第 ${i + 1}/${pairsForVideo.length} 段`);
    clipPaths.push(
      await renderClip(
        pair,
        workDir,
        Boolean(settings.subtitleEnabled),
        settings,
      ),
    );
    reportProgress(onProgress, 45 + ((i + 1) / pairsForVideo.length) * 40, `已渲染第 ${i + 1}/${pairsForVideo.length} 段`);
  }

  const outputName = `output-${jobId}.mp4`;
  const outputPath = path.join(OUTPUT_ROOT, outputName);
  const silentVideoPath = path.join(workDir, "silent.mp4");
  reportProgress(onProgress, 88, "正在合并视频片段");
  await concatClips(clipPaths, silentVideoPath, workDir);

  if (muxAudioPath) {
    reportProgress(onProgress, 94, "正在合并音频");
    await muxAudio(silentVideoPath, muxAudioPath, outputPath);
  } else {
    await fs.copyFile(silentVideoPath, outputPath);
  }
  reportProgress(onProgress, 100, "生成完成");

  return {
    outputName,
    outputPath,
    downloadUrl: `/output/${outputName}`,
    totalDuration: pairsForVideo.reduce((sum, pair) => sum + pair.duration, 0),
    videoSize: resolveVideoSize(settings),
  };
}
