/** Local-only component preview; no Next routes, API or database.
 * Uses the installed React/esbuild/Tailwind/Playwright tools. --check verifies
 * browsers and writes safe review screenshots. Run after the console build.
 */
import { createRequire } from 'node:module';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const consoleDir = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(consoleDir, '../..');
const require = createRequire(import.meta.url);
const apiRequire = createRequire(join(root, 'backend/api/package.json'));
const { build } = createRequire(apiRequire.resolve('tsx/package.json'))('esbuild');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const output = join(root, '.cache/console-foundation-preview');
await mkdir(output, { recursive: true });
await build({
  entryPoints: [join(root, 'shared/ui/src/console/__preview__/FoundationPreview.jsx')],
  outfile: join(output, 'preview.js'),
  bundle: true,
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
});
const sharedStyles = join(root, 'shared/ui/src/styles.css');
// The Next loader resolves Tailwind from the app. In this standalone runner,
// resolve the same existing app dependency explicitly, without changing CSS.
const source = (await readFile(sharedStyles, 'utf8')).replace(
  "@import 'tailwindcss';",
  `@import '${require.resolve('tailwindcss/index.css').replaceAll('\\', '/')}';`,
);
const styles = await postcss([tailwind({ base: root })]).process(source, { from: sharedStyles });
const foundationStyles = await readFile(join(root, 'shared/ui/src/console/foundation.css'), 'utf8');
// next/font's existing build output supplies local fonts; no remote font fetch.
const mediaDir = join(consoleDir, '.next/static/media');
const cssDir = join(consoleDir, '.next/static/css');
const builtCss = (
  await Promise.all(
    (await readdir(cssDir))
      .filter((name) => name.endsWith('.css'))
      .map((name) => readFile(join(cssDir, name), 'utf8')),
  )
).join('\n');
const fontFaces = [...builtCss.matchAll(/@font-face\s*\{[^}]+\}/g)]
  .map(([face]) => face)
  .filter((face) => /Anek/i.test(face))
  .map((face) =>
    face
      .replace(/font-family:[^;]+;/, 'font-family:"Anek Bangla";')
      .replace(
        /url\(([^)]+)\)/g,
        (_match, url) => `url("/fonts/${basename(url.replace(/["']/g, '').split('?')[0])}")`,
      ),
  );
assert(fontFaces.length > 0, 'Build the console first so next/font assets are available.');
await writeFile(
  join(output, 'preview.css'),
  styles.css + '\n' + foundationStyles + '\n' + fontFaces.join('\n'),
);
const logo = join(root, 'docs/design/brand/medlivebd-logo-light.png');
const html =
  '<!doctype html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MedLiveBD local design review</title><link rel="stylesheet" href="/preview.css"></head><body><div id="root"></div><script src="/preview.js"></script></body></html>';
const assets = new Map([
  ['/preview.js', [join(output, 'preview.js'), 'text/javascript']],
  ['/preview.css', [join(output, 'preview.css'), 'text/css']],
  ['/logo.png', [logo, 'image/png']],
  ...(await readdir(mediaDir))
    .filter((name) => name.endsWith('.woff2'))
    .map((name) => [`/fonts/${name}`, [join(mediaDir, name), 'font/woff2']]),
]);
const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  if (path === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
    return;
  }
  const asset = assets.get(path);
  if (asset === undefined) {
    response.writeHead(404);
    response.end();
    return;
  }
  readFile(asset[0])
    .then((data) => {
      response.writeHead(200, { 'content-type': asset[1] });
      response.end(data);
    })
    .catch(() => {
      response.writeHead(500);
      response.end();
    });
});
await new Promise((done, reject) => {
  server.once('error', reject);
  server.listen(3210, '127.0.0.1', done);
});
process.stdout.write('Local component review: http://127.0.0.1:3210\n');

if (process.argv.includes('--check')) {
  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch();
  const screenshotDir = join(root, 'docs/design/console-foundation');
  await mkdir(screenshotDir, { recursive: true });
  const errors = [];
  const remote = [];
  const evidence = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (!request.url().startsWith('http://127.0.0.1:3210')) remote.push(request.url());
    });
    // Existing primitives outside the opt-in scope stay visually unchanged.
    await page.goto('http://127.0.0.1:3210/?legacy=1');
    const legacyBefore = await page.getByRole('button').evaluate((button) => ({
      color: globalThis.getComputedStyle(button).backgroundColor,
      radius: globalThis.getComputedStyle(button).borderRadius,
    }));
    for (const [width, height, name] of [
      [1440, 900, 'desktop'],
      [1024, 768, 'landscape'],
      [768, 1024, 'portrait'],
    ]) {
      for (const locale of ['bn', 'en']) {
        await page.setViewportSize({ width, height });
        await page.goto('http://127.0.0.1:3210/');
        await page.getByTestId(`language-${locale}`).click();
        await page.evaluate(() => globalThis.document.fonts.ready);
        await page.getByRole('textbox').first().fill('Local form check');
        assert(
          await page.evaluate(
            () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
          ),
          'Page overflow',
        );
        await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
        const violations = await page.evaluate(async () =>
          (await globalThis.axe.run(globalThis.document)).violations.map(
            (violation) =>
              `${violation.id}: ${violation.help}; ${violation.nodes.map((node) => `${node.target.join(' ')} ${node.failureSummary}`).join('; ')}`,
          ),
        );
        assert.deepEqual(violations, [], `Accessibility ${name}/${locale}`);
        const clippedLabels = await page.locator('.cf-bilingual').evaluateAll((labels) =>
          labels
            .filter((label) => {
              const button = label.closest('button');
              if (button === null || globalThis.getComputedStyle(label).visibility === 'hidden')
                return false;
              const bounds = button.getBoundingClientRect();
              return [...label.children].some((part) => {
                const text = part.getBoundingClientRect();
                return (
                  text.top < bounds.top - 1 ||
                  text.bottom > bounds.bottom + 1 ||
                  text.left < bounds.left - 1 ||
                  text.right > bounds.right + 1
                );
              });
            })
            .map((label) => label.textContent),
        );
        assert.deepEqual(clippedLabels, [], `Button text clipping ${name}/${locale}`);
        const file = `${name}-${locale}.png`;
        await page.screenshot({ path: join(screenshotDir, file), fullPage: true });
        const help = page.getByRole('button', { name: /সাহায্য|Help/ });
        await help.click();
        await page.getByRole('dialog').waitFor();
        assert.deepEqual(
          await page.evaluate(async () =>
            (await globalThis.axe.run(globalThis.document)).violations.map(
              (violation) => violation.id,
            ),
          ),
          [],
          `Help accessibility ${name}/${locale}`,
        );
        await page.keyboard.press('Tab');
        assert(
          await page
            .getByRole('dialog')
            .evaluate((dialog) => dialog.contains(globalThis.document.activeElement)),
          'Help focus containment',
        );
        await page.screenshot({
          path: join(screenshotDir, `help-${name}-${locale}.png`),
          fullPage: true,
        });
        await page.keyboard.press('Escape');
        assert.equal(await page.getByRole('textbox').first().inputValue(), 'Local form check');
        assert(
          await help.evaluate((button) => button === globalThis.document.activeElement),
          'Help returns focus',
        );
        evidence.push({
          viewport: { width, height },
          locale,
          screenshot: file,
          accessibility: 'passed',
          overflow: 'none',
          help: 'preserved form and focus',
        });
      }
    }
    // Brand changes do not change semantic status colours, including portals.
    const statusColor = () =>
      page
        .locator('.cf-tone-alert')
        .first()
        .evaluate((element) => globalThis.getComputedStyle(element).color);
    const blueStatus = await statusColor();
    await page.goto('http://127.0.0.1:3210/?brand=green');
    assert.equal(await statusColor(), blueStatus);
    await page.getByRole('button', { name: /সাহায্য|Help/ }).click();
    assert.equal(
      await page
        .getByRole('dialog')
        .evaluate((dialog) =>
          globalThis.getComputedStyle(dialog).getPropertyValue('--brand-600').trim(),
        ),
      '#0c5c46',
    );
    await page.keyboard.press('Escape');
    await page.screenshot({ path: join(screenshotDir, 'green-brand.png'), fullPage: true });
    // Native text undo and modal confirmation are local UI actions only.
    await page.getByRole('textbox').first().fill('Keep until confirmed');
    await page.getByRole('button', { name: /Confirmation example/ }).click();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 1);
    await page.getByRole('button', { name: /Go back/ }).click();
    assert.equal(await page.getByRole('textbox').first().inputValue(), 'Keep until confirmed');
    // Zoom/text stress without an altered application route.
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.evaluate(() => {
      globalThis.document.body.style.zoom = '2';
    });
    assert(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
      '200% overflow',
    );
    await page.evaluate(() => {
      globalThis.document.body.style.zoom = '';
    });
    await page.goto('http://127.0.0.1:3210/?legacy=1');
    assert.deepEqual(
      await page.getByRole('button').evaluate((button) => ({
        color: globalThis.getComputedStyle(button).backgroundColor,
        radius: globalThis.getComputedStyle(button).borderRadius,
      })),
      legacyBefore,
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(remote, []);
    await writeFile(
      join(output, 'verification.json'),
      JSON.stringify(
        {
          evidence,
          errors,
          remote,
          legacy: 'unchanged',
          brand: 'scoped status and portal passed',
          confirmation: 'passed',
          zoom: 'passed',
        },
        null,
        2,
      ),
    );
    process.stdout.write(
      `Verified ${evidence.length} viewport/language combinations; screenshots: ${screenshotDir}\n`,
    );
  } finally {
    await browser.close();
    server.close();
  }
}
