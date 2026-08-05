import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const imagesRoot = path.join(root, 'public', 'assets', 'images');
const sourceVideo = path.join(imagesRoot, 'Hero-Video.mp4');
const optimizedVideo = path.join(imagesRoot, 'Hero-Video.optimized.mp4');
const mobileVideo = path.join(imagesRoot, 'Hero-Video.mobile.mp4');

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(png|jpe?g)$/i.test(entry.name)) files.push(full);
  }
  return files;
}

function isStale(input, output) {
  if (!fs.existsSync(output)) return true;
  return fs.statSync(input).mtimeMs > fs.statSync(output).mtimeMs;
}

async function optimizeImages() {
  let before = 0;
  let after = 0;
  let written = 0;

  for (const file of walk(imagesRoot)) {
    const output = file.replace(/\.(png|jpe?g)$/i, '.webp');
    if (!isStale(file, output)) continue;

    const inputSize = fs.statSync(file).size;
    const meta = await sharp(file).metadata();
    const options = meta.hasAlpha
      ? { quality: 86, alphaQuality: 92, effort: 6, smartSubsample: true }
      : { quality: 86, effort: 6, smartSubsample: true };

    await sharp(file).rotate().webp(options).toFile(output);

    before += inputSize;
    after += fs.statSync(output).size;
    written += 1;
  }

  console.log(`Optimized ${written} images (${formatBytes(before)} -> ${formatBytes(after)})`);
}

function optimizeVideo() {
  if (!fs.existsSync(sourceVideo)) return;
  let optimized = 0;

  if (isStale(sourceVideo, optimizedVideo)) {
    runFfmpeg([
      '-y',
      '-i', sourceVideo,
      '-an',
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '27',
      '-movflags', '+faststart',
      '-pix_fmt', 'yuv420p',
      optimizedVideo,
    ]);
    optimized += 1;
  }

  if (isStale(sourceVideo, mobileVideo)) {
    runFfmpeg([
      '-y',
      '-i', sourceVideo,
      '-vf', 'scale=960:-2',
      '-an',
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '27',
      '-movflags', '+faststart',
      '-pix_fmt', 'yuv420p',
      mobileVideo,
    ]);
    optimized += 1;
  }

  console.log(optimized ? `Optimized ${optimized} video files` : 'Video already optimized');
}

function runFfmpeg(args) {
  const result = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error('ffmpeg failed while optimizing video assets');
  }
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

await optimizeImages();
optimizeVideo();
