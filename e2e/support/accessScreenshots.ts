/** Real integrated authentication screenshots; mask credential regions. */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Page } from '@playwright/test';

export async function accessScreenshot(
  page: Page,
  name: string,
  maskedIds: readonly string[] = [],
): Promise<void> {
  const directory = resolve('docs/design/console-access');
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: resolve(directory, `${name}.png`),
    fullPage: true,
    mask: maskedIds.map((id) => page.getByTestId(id)),
    maskColor: '#c3cedc',
  });
}
