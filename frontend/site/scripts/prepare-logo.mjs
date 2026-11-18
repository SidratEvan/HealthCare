import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Every MedLiveHealth logo file, from the supplied artwork (`FRONTEND.md` §0.5).
 *
 *   node frontend/site/scripts/prepare-logo.mjs <path to Montserrat-ExtraBold.ttf>
 *
 * The supplied artwork (docs/design/brand/medlivebd-logo-supplied.png, made
 * official on 7 October) says MedLiveBD. The product became MedLiveHealth on
 * 18 November and no new artwork has been supplied yet, so until it is this
 * script makes the lockup: the mark, "MedLive" and the tagline are the
 * supplied pixels, untouched, and only "BD" is replaced by "Health", set in
 * Montserrat ExtraBold (SIL Open Font Licence; github.com/JulietaUla/Montserrat,
 * release v7.222). "Health" is measured against the supplied letters, not
 * guessed: their cap height and baseline, their stroke width (24 px at the
 * light half's 94 px caps: ExtraBold narrowed to the supplied letters' width,
 * which also matches their letter widths), their spacing, and the colour of
 * "BD" in each half. The font is not committed; it is only needed to run this.
 *
 * The canvas grows by the extra width and the mark and the tagline stay
 * centred over the longer word. Writes:
 *
 *   docs/design/brand/medlivehealth-logo-master.png    both halves, laid out as the supplied file
 *   docs/design/brand/medlivehealth-logo-light.png     the light lockup at native pixels
 *   frontend/console/public/brand/medlivehealth-logo-light.png        (the same file)
 *   frontend/patient/public/brand/medlivehealth-logo-light.webp       (the header, 218 px high)
 *   frontend/site/public/brand/medlivehealth-logo-light.webp, medlivehealth-logo-480.webp
 *   frontend/site/public/brand/medlivehealth-lockup-dark.webp         (the navy header)
 *   frontend/site/public/brand/medlivehealth-mark.webp                (the mark alone)
 *
 * When a designer's master for MedLiveHealth arrives, it replaces the master
 * and the first half of this script; the rest cuts it the same way.
 */
const require = createRequire(import.meta.url);
const nextDir = path.dirname(require.resolve('next/package.json'));
const sharp = require(require.resolve('sharp', { paths: [nextDir] }));
// Satori, as Next bundles it for `next/og`: it reads a font file directly,
// where libvips's text rendering goes through fontconfig and may substitute.
const { ImageResponse } = await import(
  pathToFileURL(path.join(nextDir, 'dist/compiled/@vercel/og/index.node.js')).href
);

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const at = (...p) => path.join(repo, ...p);
const SUPPLIED = at('docs/design/brand/medlivebd-logo-supplied.png');

const fontPath = process.argv[2];
if (fontPath === undefined) {
  console.error('usage: node frontend/site/scripts/prepare-logo.mjs <Montserrat-ExtraBold.ttf>');
  process.exit(1);
}
const font = await readFile(fontPath);

/**
 * The supplied file's two halves, measured from its pixels. `ml` is "MedLive"
 * (first to last inked column), `bdEnd` the last column of "BD", `cap` the top
 * and bottom rows of the B, `gap` the blank columns between "e" and "B", and
 * `band` the rows that hold the wordmark and nothing else (the mark ends above
 * it, the tagline starts below it). The top and bottom colours of "BD" are
 * sampled along its first and last rows.
 */
const W0 = 1086;
const HALVES = {
  dark: {
    left: 0,
    ground: { r: 0, g: 0, b: 0 },
    ml: [172, 723],
    bdEnd: 914,
    cap: [463, 559],
    gap: 12,
    band: [440, 585],
    colour: ['#01F7FC', '#01EAFB'],
  },
  light: {
    left: W0,
    ground: { r: 255, g: 255, b: 255 },
    ml: [1279 - W0, 1816 - W0],
    bdEnd: 1997 - W0,
    cap: [470, 563],
    gap: 11,
    band: [450, 590],
    colour: ['#04A8A0', '#019E9B'],
  },
};
const HEIGHT = 724;

/** Text rendered white on transparency at 400 px, with its inked box. */
async function setText(text, letterSpacing = 0) {
  const element = {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        fontFamily: 'Montserrat',
        fontWeight: 800,
        fontSize: 400,
        letterSpacing,
        color: 'white',
        padding: 40,
      },
      children: text,
    },
  };
  const response = new ImageResponse(element, {
    width: 2400,
    height: 600,
    fonts: [{ name: 'Montserrat', data: font, weight: 800, style: 'normal' }],
  });
  const png = Buffer.from(await response.arrayBuffer());
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width,
    y0 = info.height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + 3] > 0) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  return { png, box: { x0, y0, x1, y1 } };
}

const H = await setText('H');
const medLive = await setText('MedLive');
// Montserrat's spacing is about 2 px looser than the supplied letters' at
// their size; 6 units at 400 px is that much once scaled.
const health = await setText('Health', -6);

/** "Health" for one half: coloured, scaled, and where its baseline goes. */
async function healthFor(half) {
  const capPx = half.cap[1] - half.cap[0] + 1;
  const k = capPx / (H.box.y1 - H.box.y0 + 1);
  // Narrowed so that "MedLive" in Montserrat would be as wide as the supplied
  // "MedLive"; that brings the strokes and the letters to the supplied width.
  const xScale = (half.ml[1] - half.ml[0] + 1) / ((medLive.box.x1 - medLive.box.x0 + 1) * k);
  // The baseline is the bottom of the H; round letters overshoot it.
  const top = health.box.y0;
  const bottom = Math.max(health.box.y1, H.box.y1);
  const cut = await sharp(health.png)
    .extract({
      left: health.box.x0,
      top,
      width: health.box.x1 - health.box.x0 + 1,
      height: bottom - top + 1,
    })
    .png()
    .toBuffer();
  const width = Math.round((health.box.x1 - health.box.x0 + 1) * k * xScale);
  const height = Math.round((bottom - top + 1) * k);
  const letters = await sharp(cut)
    .resize({ width, height, fit: 'fill', kernel: 'lanczos3' })
    .png()
    .toBuffer();
  const [from, to] = half.colour;
  const gradient = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${from}"/>` +
      `<stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
      '<rect width="100%" height="100%" fill="url(#g)"/></svg>',
  );
  const coloured = await sharp(gradient)
    .ensureAlpha()
    .composite([{ input: letters, blend: 'dest-in' }])
    .png()
    .toBuffer();
  const aboveBaseline = Math.round((H.box.y1 - top + 1) * k);
  return { image: coloured, width, top: half.cap[1] + 1 - aboveBaseline };
}

/** One half of the master: the supplied half with "BD" become "Health". */
async function buildHalf(half) {
  const word = await healthFor(half);
  const wordStart = half.ml[1] + 1 + half.gap;
  const oldWidth = half.bdEnd - half.ml[0] + 1;
  const newWidth = wordStart + word.width - half.ml[0];
  // Even, so the mark and the tagline move by whole pixels.
  const extra = Math.ceil((newWidth - oldWidth) / 2) * 2;
  const width = W0 + extra;
  const piece = (top, bottom, left = 0, right = W0) =>
    sharp(SUPPLIED)
      .extract({ left: half.left + left, top, width: right - left, height: bottom - top })
      .png()
      .toBuffer();
  // The supplied halves meet in a soft seam; it stays at the edges, which are
  // ground, and is not carried inwards with the mark and the tagline.
  const INSET = 40;
  const [above, below, medLivePart] = await Promise.all([
    piece(0, half.band[0], INSET, W0 - INSET),
    piece(half.band[1], HEIGHT, INSET, W0 - INSET),
    piece(half.band[0], half.band[1], half.ml[0] - 4, half.ml[1] + 1 + Math.floor(half.gap / 2)),
  ]);
  const image = await sharp({
    create: { width, height: HEIGHT, channels: 3, background: half.ground },
  })
    .composite([
      { input: above, left: extra / 2 + INSET, top: 0 },
      { input: below, left: extra / 2 + INSET, top: half.band[1] },
      { input: medLivePart, left: half.ml[0] - 4, top: half.band[0] },
      { input: word.image, left: wordStart, top: word.top },
    ])
    .removeAlpha()
    .png()
    .toBuffer();
  return { image, width, extra };
}

const dark = await buildHalf(HALVES.dark);
const light = await buildHalf(HALVES.light);

await sharp({
  create: {
    width: dark.width + light.width,
    height: HEIGHT,
    channels: 3,
    background: { r: 255, g: 255, b: 255 },
  },
})
  .composite([
    { input: dark.image, left: 0, top: 0 },
    { input: light.image, left: dark.width, top: 0 },
  ])
  .png()
  .toFile(at('docs/design/brand/medlivehealth-logo-master.png'));

// --- The light lockup: the light half cut to its ink, as the 7 October file
// was (four pixels clear on the left and top, three on the right and bottom).
{
  const { data, info } = await sharp(light.image).raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width,
    y0 = info.height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      if (Math.min(data[i], data[i + 1], data[i + 2]) < 235) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  const box = { left: x0 - 4, top: y0 - 4, width: x1 - x0 + 8, height: y1 - y0 + 8 };
  const lockup = await sharp(light.image).extract(box).png().toBuffer();
  await sharp(lockup).toFile(at('docs/design/brand/medlivehealth-logo-light.png'));
  await sharp(lockup).toFile(at('frontend/console/public/brand/medlivehealth-logo-light.png'));
  const header = await sharp(lockup)
    .resize({ height: 218, kernel: 'lanczos3' })
    .webp({ quality: 92 })
    .toBuffer();
  await sharp(header).toFile(at('frontend/patient/public/brand/medlivehealth-logo-light.webp'));
  await sharp(header).toFile(at('frontend/site/public/brand/medlivehealth-logo-light.webp'));
  await sharp(lockup)
    .resize({ width: 480, kernel: 'lanczos3' })
    .webp({ quality: 92 })
    .toFile(at('frontend/site/public/brand/medlivehealth-logo-480.webp'));
  console.log(`light lockup ${String(box.width)}x${String(box.height)}`);
}

// --- The navy header's lockup, from the master's dark half: the black turned
// into transparency (alpha = brightest channel, colour un-premultiplied), the
// mark and the wordmark side by side, the tagline left out at header size.
async function unblack(image, region) {
  const { data, info } = await sharp(image)
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

const mark = await unblack(dark.image, {
  left: 250 + dark.extra / 2,
  top: 120,
  width: 580,
  height: 322,
});
const word = await unblack(dark.image, {
  left: 150,
  top: HALVES.dark.band[0],
  width: 790 + dark.extra,
  height: HALVES.dark.band[1] - HALVES.dark.band[0],
});

const LOCKUP_H = 112; // twice the header's 56 px
const markImg = await sharp(mark).resize({ height: LOCKUP_H }).png().toBuffer();
const wordH = Math.round(LOCKUP_H * 0.5);
const wordImg = await sharp(word).resize({ height: wordH }).png().toBuffer();
const mw = (await sharp(markImg).metadata()).width;
const ww = (await sharp(wordImg).metadata()).width;
const gap = Math.round(LOCKUP_H * 0.18);
const lockupWidth = mw + gap + ww;
await sharp({
  create: {
    width: lockupWidth,
    height: LOCKUP_H,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([
    { input: markImg, left: 0, top: 0 },
    { input: wordImg, left: mw + gap, top: Math.round((LOCKUP_H - wordH) / 2) + 2 },
  ])
  .webp({ quality: 92, alphaQuality: 100 })
  .toFile(at('frontend/site/public/brand/medlivehealth-lockup-dark.webp'));
console.log(`dark lockup ${String(lockupWidth)}x${String(LOCKUP_H)}`);

// The mark alone, for the connection motif's hub.
await sharp(mark)
  .resize({ height: 128 })
  .webp({ quality: 92, alphaQuality: 100 })
  .toFile(at('frontend/site/public/brand/medlivehealth-mark.webp'));
console.log(`master ${String(dark.width + light.width)}x${String(HEIGHT)}`);
