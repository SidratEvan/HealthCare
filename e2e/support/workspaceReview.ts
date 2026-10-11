/** Representative visual/accessibility evidence; does not alter browser assertions. */
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { expect, type Page } from '@playwright/test';

export async function reviewWorkspace(page: Page, relativePath: string): Promise<void> {
  const source = await readFile(resolve('node_modules/axe-core/axe.min.js'), 'utf8');
  await page.evaluate((code) => {
    const script = document.createElement('script');
    script.nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce ?? '';
    script.textContent = code;
    document.head.appendChild(script);
  }, source);
  const violations = await page.evaluate(async () =>
    (
      await (
        window as unknown as {
          axe: { run: (root: Document) => Promise<{ violations: { id: string }[] }> };
        }
      ).axe.run(document)
    ).violations.map((item) => item.id),
  );
  expect(violations).toEqual([]);
  const path = resolve(relativePath);
  await mkdir(dirname(path), { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path, fullPage: true });
}
