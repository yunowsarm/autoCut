import path from "node:path";

export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;
export const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
]);

export function splitSegments(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function countReadableChars(text) {
  return Array.from(String(text || "").replace(/\s+/g, "")).length;
}

export function durationForText(text, settings) {
  const charsPerSecond = Number(settings.charsPerSecond) || 4;
  const minSeconds = Number(settings.minSeconds) || 2;
  const maxSeconds = Number(settings.maxSeconds) || 8;
  const rawSeconds = countReadableChars(text) / charsPerSecond;
  return Number(clamp(rawSeconds, minSeconds, maxSeconds).toFixed(2));
}

export function buildSegments(text, settings) {
  return splitSegments(text).map((content, index) => ({
    index,
    text: content,
    duration: durationForText(content, settings),
  }));
}

export function isSupportedImage(filename) {
  return SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

export function naturalSortFiles(files) {
  const collator = new Intl.Collator("zh-Hans-CN", {
    numeric: true,
    sensitivity: "base",
  });

  return [...files].sort((a, b) => {
    const nameA = a.originalname || a.name || a.path;
    const nameB = b.originalname || b.name || b.path;
    return collator.compare(nameA, nameB);
  });
}

export function pairSegmentsWithImages(segments, imageFiles) {
  const images = naturalSortFiles(
    imageFiles.filter((file) =>
      isSupportedImage(file.originalname || file.path),
    ),
  );

  if (segments.length === 0) {
    throw new Error("请先输入至少一段小说文本。");
  }

  if (images.length < segments.length) {
    throw new Error(
      `图片数量不足：需要 ${segments.length} 张，当前只有 ${images.length} 张。`,
    );
  }

  return segments.map((segment, index) => ({
    ...segment,
    image: images[index],
  }));
}

export function assignImagesToSegments(segments, imageFiles = []) {
  const images = naturalSortFiles(
    imageFiles.filter((file) => isSupportedImage(file.originalname || file.name || file.path)),
  );

  if (segments.length === 0) {
    throw new Error("请先输入至少一段小说文本。");
  }

  return segments.map((segment, index) => ({
    ...segment,
    image: images[index] || null,
  }));
}

/** 折行后的多行字幕（不含 ASS 换行符），供逐行转义后再用 \\N 拼接 */
export function wrapSubtitleLines(text, maxCharsPerLine = 18, maxLines = 4) {
  const chars = Array.from(
    String(text || "")
      .replace(/\s+/g, " ")
      .trim(),
  );
  const lines = [];
  let current = "";

  for (const char of chars) {
    current += char;
    if (Array.from(current).length >= maxCharsPerLine) {
      lines.push(current);
      current = "";
      if (lines.length === maxLines) break;
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  if (chars.length > maxCharsPerLine * maxLines && lines.length > 0) {
    lines[lines.length - 1] = `${Array.from(lines[lines.length - 1])
      .slice(0, -1)
      .join("")}…`;
  }

  return lines;
}

export function wrapSubtitleText(text, maxCharsPerLine = 18, maxLines = 4) {
  return wrapSubtitleLines(text, maxCharsPerLine, maxLines).join("\\N");
}

/** 长段拆成多句 TTS，减轻单条过长时字幕与朗读脱节 */
export function splitTextForTts(text, maxChunkChars = 80) {
  const raw = String(text || "")
    .replace(/\s+/g, "")
    .trim();
  if (!raw) return [];
  if (raw.length <= maxChunkChars) return [raw];

  const chunks = [];
  let buf = "";
  const flush = () => {
    if (buf) {
      chunks.push(buf);
      buf = "";
    }
  };

  for (const ch of Array.from(raw)) {
    buf += ch;
    const boundary = /[。！？；.!?;]/.test(ch);
    const longEnough = buf.length >= 12;
    if (buf.length >= maxChunkChars || (boundary && longEnough)) {
      flush();
    }
  }
  flush();

  return chunks.length ? chunks : [raw];
}
