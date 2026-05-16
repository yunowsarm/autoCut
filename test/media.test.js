import test from "node:test";
import assert from "node:assert/strict";
import { resolveImageFit } from "../src/render.js";
import {
  buildSegments,
  naturalSortFiles,
  pairSegmentsWithImages,
  splitSegments,
  splitTextForTts,
  wrapSubtitleLines,
  wrapSubtitleText,
} from "../src/media.js";

test("resolveImageFit maps crop toggle to cover or contain", () => {
  assert.equal(resolveImageFit({ imageFit: "cover" }), "cover");
  assert.equal(resolveImageFit({ imageFit: "contain" }), "contain");
  assert.equal(resolveImageFit({ imageCropFill: true }), "cover");
  assert.equal(resolveImageFit({ imageCropFill: false }), "contain");
});

test("splitSegments ignores empty lines", () => {
  assert.deepEqual(splitSegments("第一段\n\n  第二段  \r\n第三段"), [
    "第一段",
    "第二段",
    "第三段",
  ]);
});

test("buildSegments clamps duration by text length", () => {
  const segments = buildSegments(
    "短\n这是一段比较长比较长比较长比较长比较长比较长比较长比较长比较长比较长的文本",
    {
      charsPerSecond: 4,
      minSeconds: 2,
      maxSeconds: 8,
    },
  );

  assert.equal(segments[0].duration, 2);
  assert.equal(segments[1].duration, 8);
});

test("naturalSortFiles sorts numeric filenames naturally", () => {
  const files = [
    { originalname: "10.jpg" },
    { originalname: "2.jpg" },
    { originalname: "1.jpg" },
  ];
  assert.deepEqual(
    naturalSortFiles(files).map((file) => file.originalname),
    ["1.jpg", "2.jpg", "10.jpg"],
  );
});

test("pairSegmentsWithImages fails when images are insufficient", () => {
  const segments = buildSegments("一\n二", {
    charsPerSecond: 4,
    minSeconds: 2,
    maxSeconds: 8,
  });

  assert.throws(
    () =>
      pairSegmentsWithImages(segments, [
        { originalname: "1.jpg", path: "1.jpg" },
      ]),
    /图片数量不足/,
  );
});

test("wrapSubtitleText keeps long text bounded", () => {
  const wrapped = wrapSubtitleText(
    "这是一段很长很长很长很长很长很长很长很长很长很长很长的字幕",
    6,
    3,
  );
  assert.equal(wrapped.split("\\N").length, 3);
  assert.match(wrapped, /…$/);
});

test("wrapSubtitleLines returns plain lines without ASS newline token", () => {
  const lines = wrapSubtitleLines("一二三四五六七八九", 3, 4);
  assert.deepEqual(lines, ["一二三", "四五六", "七八九"]);
  assert.ok(!lines.some((line) => /\\N/.test(line)));
});

test("splitTextForTts caps chunk size without punctuation", () => {
  const parts = splitTextForTts("x".repeat(250), 70);
  assert.ok(parts.length >= 3);
  assert.ok(parts.every((p) => p.length <= 70));
});

test("splitTextForTts keeps short text as one chunk", () => {
  assert.deepEqual(splitTextForTts("短", 80), ["短"]);
});
