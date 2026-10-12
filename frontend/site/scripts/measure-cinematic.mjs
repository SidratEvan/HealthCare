/* global window, document, performance, PerformanceObserver, scrollY, requestAnimationFrame */
import { chromium } from '@playwright/test';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../../../docs/design/site-cinematic/', import.meta.url));
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
for (const locale of ['en', 'bn']) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 100,
    downloadThroughput: 1_600_000 / 8,
    uploadThroughput: 750_000 / 8,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(() => {
    window.__siteMetrics = { lcp: 0, cls: 0, longTasks: [] };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__siteMetrics.lcp = entry.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        if (!entry.hadRecentInput) window.__siteMetrics.cls += entry.value;
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        window.__siteMetrics.longTasks.push(Math.round(entry.duration));
    }).observe({ type: 'longtask', buffered: true });
  });
  await page.goto(`http://localhost:3210/${locale}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  results.push(
    await page.evaluate(
      (locale) => ({
        locale,
        ...window.__siteMetrics,
        navigation: performance.getEntriesByType('navigation')[0].toJSON(),
        resources: performance
          .getEntriesByType('resource')
          .map((r) => ({
            name: new URL(r.name).pathname,
            transferBytes: r.transferSize,
            durationMs: Math.round(r.duration),
          })),
      }),
      locale,
    ),
  );
  await context.close();
}

const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  recordVideo: { dir: `${out}/video`, size: { width: 1440, height: 960 } },
});
const page = await context.newPage();
await page.goto('http://localhost:3210/en');
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1200);
const hero = await page.locator('.pulse-hero').evaluate((el) => el.offsetHeight);
const audience = await page.locator('#experiences').evaluate((el) => el.offsetTop);
const country = await page.locator('#bangladesh').evaluate((el) => el.offsetTop);
const intervals = [];
async function glide(to, duration) {
  const frames = await page.evaluate(
    async ({ to, duration }) => {
      const from = scrollY,
        started = performance.now();
      let previous = started;
      const deltas = [];
      await new Promise((resolve) => {
        function step(now) {
          deltas.push(now - previous);
          previous = now;
          const p = Math.min((now - started) / duration, 1);
          const eased = p * p * (3 - 2 * p);
          window.scrollTo({ top: from + (to - from) * eased, behavior: 'instant' });
          if (p < 1) requestAnimationFrame(step);
          else resolve();
        }
        requestAnimationFrame(step);
      });
      return deltas;
    },
    { to, duration },
  );
  intervals.push(...frames);
}
await glide(hero * 0.45, 1500);
await page.screenshot({ path: `${out}/hero-mid-transition.png` });
await glide(audience - 160, 1800);
await page.screenshot({ path: `${out}/audience-connected.png` });
await glide(audience + 160, 2200);
await page.screenshot({ path: `${out}/audience-separated.png` });
await glide(audience + 380, 1600);
await page.screenshot({ path: `${out}/audience-reconnected.png` });
await glide(audience - 160, 2500);
await page.screenshot({ path: `${out}/audience-reversed.png` });
await glide(country - 600, 1800);
await glide(country + 80, 2600);
await page.screenshot({ path: `${out}/bangladesh-settled.png` });
await glide(country - 650, 1500);
await glide(country + 80, 1800);
await page.waitForTimeout(600);
const sorted = intervals.slice(1).sort((a, b) => a - b);
results.push({
  desktopRecordedScroll: {
    frames: sorted.length,
    medianFrameMs: sorted[Math.floor(sorted.length * 0.5)],
    p95FrameMs: sorted[Math.floor(sorted.length * 0.95)],
    framesOver50ms: sorted.filter((n) => n > 50).length,
    note: 'Headless Chromium with video recording on this host; not a real-device frame-rate guarantee.',
  },
});
const video = page.video();
await context.close();
await rename(await video.path(), `${out}/cinematic-scroll.webm`);
await writeFile(`${out}/performance.json`, JSON.stringify(results, null, 2));
await browser.close();
console.log(
  JSON.stringify(
    results.map((r) =>
      r.locale ? { locale: r.locale, lcp: r.lcp, cls: r.cls, longTasks: r.longTasks.length } : r,
    ),
    null,
    2,
  ),
);
