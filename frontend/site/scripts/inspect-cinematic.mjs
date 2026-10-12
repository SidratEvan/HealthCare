/* global document, window, innerWidth */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const out = fileURLToPath(new URL('../../../docs/design/site-cinematic/', import.meta.url));
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const findings = [];
for (const [locale, width, height] of [
  ['en', 1440, 960],
  ['bn', 1440, 960],
  ['en', 390, 844],
  ['bn', 390, 844],
]) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:3210/${locale}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  const size = width > 960 ? 'desktop' : 'mobile';
  await page.screenshot({ path: `${out}/${locale}-${size}-hero.png` });
  for (const id of ['vision', 'experiences', 'hospitals', 'patients', 'bangladesh', 'contact']) {
    await page.locator(`#${id}`).scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    if (locale === 'en' && width > 960) await page.screenshot({ path: `${out}/${id}-desktop.png` });
  }
  // Full-page exports use the supported static composition. Real scrolling is
  // captured separately, because sticky timelines cannot fit in a single still.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${locale}-${size}-full.png`, fullPage: true });
  findings.push({
    locale,
    width,
    errors,
    overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  });
  await page.close();
}
await writeFile(`${out}/browser-inspection.json`, JSON.stringify(findings, null, 2));
await browser.close();
