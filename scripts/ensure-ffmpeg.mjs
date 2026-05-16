import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const staticPath = require("ffmpeg-static");
const installScript = path.join(
  path.dirname(require.resolve("ffmpeg-static")),
  "install.js",
);

const MIN_BYTES = 50_000_000;

function runInstall() {
  const binariesUrl =
    process.env.FFMPEG_BINARIES_URL ||
    "https://cdn.npmmirror.com/binaries/ffmpeg-static";

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [installScript], {
      stdio: "inherit",
      env: {
        ...process.env,
        FFMPEG_BINARIES_URL: binariesUrl,
      },
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg-static install exited with code ${code}`));
    });
  });
}

async function main() {
  if (!staticPath) {
    console.error("ffmpeg-static does not support this platform.");
    process.exit(1);
  }

  let size = 0;
  try {
    size = fs.statSync(staticPath).size;
  } catch {
    size = 0;
  }

  if (size >= MIN_BYTES) {
    console.log(
      `ffmpeg already present (${Math.round(size / 1024 / 1024)} MB).`,
    );
    return;
  }

  if (size > 0) {
    console.log(
      `Removing incomplete ffmpeg (${Math.round(size / 1024 / 1024)} MB)...`,
    );
    fs.unlinkSync(staticPath);
  }

  console.log("Downloading ffmpeg (mirror-friendly)...");
  await runInstall();

  const finalSize = fs.statSync(staticPath).size;
  if (finalSize < MIN_BYTES) {
    throw new Error(
      `Download looks incomplete (${finalSize} bytes). Check network or set FFMPEG_BINARIES_URL.`,
    );
  }

  console.log(`ffmpeg ready (${Math.round(finalSize / 1024 / 1024)} MB).`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
