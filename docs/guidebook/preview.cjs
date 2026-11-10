// Renders chosen pages of book.html to PNG for a visual check: node preview.cjs 1 2 15 ...
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const L = require('./lib.cjs');
(async () => {
  const pages = process.argv.slice(2).map(Number);
  const browser = await L.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1123, height: 760 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(join(__dirname, 'book.html')).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const sections = page.locator('section.page');
  for (const n of pages) {
    const s = sections.nth(n - 1);
    const title = ((await s.locator('h1, h2').first().textContent().catch(() => '')) ?? '').trim().slice(0, 50);
    await s.screenshot({ path: join(__dirname, `preview-${n}.png`) });
    console.log(`preview-${n}.png  ${title}`);
  }
  await browser.close();
})();
