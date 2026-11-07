/* global window, document */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * Review screenshots of the static export served by `preview-static.mjs`
 * (never a deployment): each scene as a visitor meets it, plus a still,
 * complete full page (reduced motion) per language and size.
 *
 *   node scripts/capture-site.mjs [outDir]
 */
const base = process.env.SITE_PREVIEW_URL ?? 'http://localhost:3210';
const out =
  process.argv[2] ?? fileURLToPath(new URL('../../../docs/design/site-final/', import.meta.url));
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });

const sizes = [
  ['desktop', 1440, 900],
  ['tablet', 768, 1024],
  ['mobile', 390, 844],
  ['small', 360, 740],
];
const scenes = ['#idea', '#hospitals', '#patients', '#bangladesh', '#people', '#contact'];

for (const locale of ['en', 'bn']) {
  for (const [name, width, height] of sizes) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      isMobile: width < 800,
      hasTouch: width < 800,
    });
    const page = await context.newPage();
    await page.goto(`${base}/${locale}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2600);
    await page.screenshot({ path: `${out}/${locale}-${name}-0-hero.png` });
    if (name === 'desktop' || name === 'mobile') {
      for (const [index, id] of scenes.entries()) {
        const top = await page
          .locator(id)
          .evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
        // Arrive part-way in, as a reader would: the idea lit, the map mid-way and drawn.
        const into =
          id === '#idea'
            ? height * 0.17
            : id === '#bangladesh' && name === 'desktop'
              ? height * 1.1
              : 0;
        await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), top + into);
        await page.waitForTimeout(900);
        await page.screenshot({
          path: `${out}/${locale}-${name}-${String(index + 1)}-${id.slice(1)}.png`,
        });
      }
    }
    await context.close();

    const still = await browser.newContext({
      viewport: { width, height },
      reducedMotion: 'reduce',
    });
    const full = await still.newPage();
    await full.goto(`${base}/${locale}`, { waitUntil: 'networkidle' });
    // Let every lazy photograph load and every reveal play once.
    const total = await full.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < total; y += height * 0.6) {
      await full.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
      await full.waitForTimeout(150);
    }
    await full.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await full.waitForTimeout(800);
    await full.screenshot({ path: `${out}/${locale}-${name}-full.png`, fullPage: true });
    for (const path of ['hospitals', 'about']) {
      await full.goto(`${base}/${locale}/${path}`, { waitUntil: 'networkidle' });
      const h = await full.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < h; y += height * 0.6) {
        await full.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
        await full.waitForTimeout(120);
      }
      await full.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await full.waitForTimeout(600);
      await full.screenshot({ path: `${out}/${locale}-${name}-${path}.png`, fullPage: true });
    }
    await still.close();
    console.log(`${locale} ${name}`);
  }
}
await browser.close();
