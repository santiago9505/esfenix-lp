import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const publicRoot = path.join(root, 'public');
const assetsRoot = path.join(publicRoot, 'assets');
const imagesRoot = path.join(assetsRoot, 'images');
const iconRoot = path.join(publicRoot, 'icons');

const colors = {
  cream: '#fcf9f6',
  forest: '#1d1d1b',
  white: '#ffffff',
};

async function renderIcon(size, output, padding = 0.16) {
  const logoSize = Math.round(size * (1 - padding * 2));
  const logo = await sharp(path.join(assetsRoot, 'esfenix-logo.svg'))
    .resize(logoSize, logoSize, { fit: 'contain' })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: colors.cream,
    },
  })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(output);
}

function textLayer() {
  return Buffer.from(`
    <svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="wash" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#1d1d1b" stop-opacity="0.94"/>
          <stop offset="0.55" stop-color="#1d1d1b" stop-opacity="0.46"/>
          <stop offset="1" stop-color="#1d1d1b" stop-opacity="0.06"/>
        </linearGradient>
        <linearGradient id="bottom" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#1d1d1b" stop-opacity="0"/>
          <stop offset="1" stop-color="#1d1d1b" stop-opacity="0.3"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="630" fill="url(#wash)"/>
      <rect width="1200" height="630" fill="url(#bottom)"/>
      <text x="88" y="216" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="19" font-weight="700" letter-spacing="4">ESFENIX INTERNATIONAL</text>
      <text x="88" y="342" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="300">Fresh flowers,</text>
      <text x="88" y="510" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="400" letter-spacing="1">Premium flowers and floral supplies</text>
    </svg>
  `);
}

async function renderSocialPreview() {
  const background = await sharp(path.join(imagesRoot, 'heroimage2.webp'))
    .resize(1200, 630, { fit: 'cover', position: 'center' })
    .toBuffer();
  const logo = await sharp(path.join(assetsRoot, 'esfenix-logo-altern.svg'))
    .resize(92, 92, { fit: 'contain' })
    .png()
    .toBuffer();
  const wordmark = await sharp(path.join(assetsRoot, 'blooming-wht.svg'))
    .resize({ width: 382, height: 72, fit: 'inside' })
    .png()
    .toBuffer();

  await sharp(background)
    .composite([
      { input: textLayer(), top: 0, left: 0 },
      { input: logo, top: 83, left: 88 },
      { input: wordmark, top: 367, left: 88 },
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(path.join(assetsRoot, 'esfenix-social-preview.png'));
}

await fs.mkdir(iconRoot, { recursive: true });
await renderIcon(16, path.join(publicRoot, 'favicon-16x16.png'), 0.12);
await renderIcon(32, path.join(publicRoot, 'favicon-32x32.png'), 0.12);
await renderIcon(180, path.join(publicRoot, 'apple-touch-icon.png'), 0.12);
await renderIcon(192, path.join(iconRoot, 'icon-192.png'), 0.12);
await renderIcon(512, path.join(iconRoot, 'icon-512.png'), 0.12);
await renderSocialPreview();

console.log('Generated favicon, app icons and social preview assets.');
