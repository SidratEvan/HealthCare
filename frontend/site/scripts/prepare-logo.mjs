import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * The navy header's lockup, derived from the supplied logo's dark half
 * (docs/design/brand/medlivebd-logo-supplied.png, left panel on black). The
 * black is turned into transparency (alpha = brightest channel, colour
 * un-premultiplied), the mark and the wordmark are set side by side, and the
 * tagline is left out at header size. The supplied file is never changed.
 */
const require = createRequire(import.meta.url);
const sharp = require(
  require.resolve('sharp', { paths: [path.dirname(require.resolve('next/package.json'))] }),
);
const source = new URL('../../../docs/design/brand/medlivebd-logo-supplied.png', import.meta.url);
const out = new URL('../public/brand/', import.meta.url);

async function unblack(region) {
  const { data, info } = await sharp(source.pathname.replace(/^\/([A-Za-z]:)/, '$1'))
    .extract(region)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    const a = Math.max(r, g, b);
    // Below a whisper of light is the black panel itself.
    const alpha = a < 14 ? 0 : a;
    const k = alpha === 0 ? 0 : 255 / alpha;
    rgba[j] = Math.min(255, Math.round(r * k));
    rgba[j + 1] = Math.min(255, Math.round(g * k));
    rgba[j + 2] = Math.min(255, Math.round(b * k));
    rgba[j + 3] = alpha;
  }
  return await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim({ threshold: 1 })
    .png()
    .toBuffer();
}

const mark = await unblack({ left: 250, top: 120, width: 580, height: 322 });
const word = await unblack({ left: 150, top: 455, width: 790, height: 120 });

const H = 112; // twice the header's 56 px
const markImg = await sharp(mark).resize({ height: H }).png().toBuffer();
const wordH = Math.round(H * 0.5);
const wordImg = await sharp(word).resize({ height: wordH }).png().toBuffer();
const mw = (await sharp(markImg).metadata()).width;
const ww = (await sharp(wordImg).metadata()).width;
const gap = Math.round(H * 0.18);
const width = mw + gap + ww;
await sharp({
  create: { width, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([
    { input: markImg, left: 0, top: 0 },
    { input: wordImg, left: mw + gap, top: Math.round((H - wordH) / 2) + 2 },
  ])
  .webp({ quality: 92, alphaQuality: 100 })
  .toFile(path.join(out.pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'medlivebd-lockup-dark.webp'));
console.log(`lockup ${String(width)}x${String(H)}`);

// The mark alone, for the connection motif's hub.
await sharp(mark)
  .resize({ height: 128 })
  .webp({ quality: 92, alphaQuality: 100 })
  .toFile(path.join(out.pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'medlivebd-mark.webp'));
