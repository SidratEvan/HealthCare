/**
 * A hospital's portal installs as that hospital's app (`PRD.md` `FR-BRD-08`;
 * plan C3).
 *
 * What a phone is told when the app is added to its home screen is read from
 * `/manifest.webmanifest`. It is the same address for everybody and a
 * different answer by whose portal it is asked at: the hospital's name, its
 * colour, its logo as the icon. And the page itself says whose it is, in its
 * title and in what an iPhone takes for the name and the icon.
 *
 * On this machine the platform's domain is `localhost`
 * (`playwright.config.ts`), so `padma.localhost` is Padma's portal.
 */

import { expect, test } from '@playwright/test';

const NETWORK = 'http://localhost:3000';
const PADMA_PORTAL = 'http://padma.localhost:3000';
const KARNAPHULI_PORTAL = 'http://karnaphuli.localhost:3000';
const API = 'http://localhost:4000/api/v1';

interface Manifest {
  readonly name: string;
  readonly short_name: string;
  readonly description: string;
  readonly start_url: string;
  readonly display: string;
  readonly theme_color: string;
  readonly background_color: string;
  readonly icons: readonly { src: string; sizes: string; type: string; purpose: string }[];
}

async function manifestAt(address: string): Promise<{ type: string; manifest: Manifest }> {
  const response = await fetch(`${address}`);
  expect(response.status).toBe(200);
  return {
    type: response.headers.get('content-type') ?? '',
    manifest: (await response.json()) as Manifest,
  };
}

test.describe('what a phone is told when the app is installed', () => {
  test('at the network’s address it is the network’s own app', async () => {
    const { type, manifest } = await manifestAt(`${NETWORK}/manifest.webmanifest`);
    expect(type).toContain('application/manifest+json');
    expect(manifest).toMatchObject({
      name: 'MedLiveBD',
      short_name: 'MedLiveBD',
      start_url: '/',
      display: 'standalone',
    });
    expect(manifest.icons.map((icon) => icon.src)).toEqual(['/icon.svg', '/icon-maskable.svg']);
  });

  test('at Padma’s portal it is Padma’s: its name, its colour, its logo as the icon', async () => {
    const { manifest } = await manifestAt(`${PADMA_PORTAL}/manifest.webmanifest`);
    expect(manifest.name).toContain('পদ্মা');
    expect(manifest.short_name).toBe('পদ্মা');
    expect(manifest.description).toContain('উত্তরার');
    expect(manifest.theme_color).toBe('#17507f');
    // At its own address the installed app opens at the root, and is Padma's
    // because of where it is.
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');

    expect(manifest.icons).toHaveLength(1);
    const icon = manifest.icons[0];
    expect(icon?.type).toBe('image/png');
    expect(icon?.sizes).toBe('512x512');
    expect(icon?.src).toMatch(new RegExp(`^${API}/hospitals/[0-9a-f-]{36}/logo\\?v=[0-9a-f]{16}$`));

    // And the icon is there, and is the size it is said to be.
    const image = await fetch(icon?.src ?? '');
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    const head = Buffer.from(await image.arrayBuffer()).subarray(16, 24);
    expect([head.readUInt32BE(0), head.readUInt32BE(4)]).toEqual([512, 512]);
  });

  test('a hospital with no logo installs under its own name and the platform’s icon', async () => {
    const { manifest } = await manifestAt(`${KARNAPHULI_PORTAL}/manifest.webmanifest`);
    expect(manifest.name).toContain('কর্ণফুলী');
    expect(manifest.start_url).toBe('/');
    expect(manifest.icons.map((icon) => icon.src)).toEqual(['/icon.svg', '/icon-maskable.svg']);
  });

  test('opened by a parameter, the parameter goes with the icon', async () => {
    const { manifest } = await manifestAt(`${NETWORK}/manifest.webmanifest?scope=PADMA`);
    expect(manifest.name).toContain('পদ্মা');
    // Or the installed app would open as the network.
    expect(manifest.start_url).toBe('/?scope=PADMA');
  });

  test('a code nobody has still installs: as the network’s app, never an error', async () => {
    const unknownPortal = await manifestAt(
      'http://nosuchplace.localhost:3000/manifest.webmanifest',
    );
    expect(unknownPortal.manifest.name).toBe('MedLiveBD');
    const unknownScope = await manifestAt(`${NETWORK}/manifest.webmanifest?scope=NOSUCH`);
    expect(unknownScope.manifest.name).toBe('MedLiveBD');
    const notACode = await manifestAt(`${NETWORK}/manifest.webmanifest?scope=%3Cscript%3E`);
    expect(notACode.manifest.name).toBe('MedLiveBD');
  });
});

test.describe('the page says whose app it is', () => {
  test('the network’s own: its title, its install description, its icon', async ({ page }) => {
    await page.goto(NETWORK);
    await expect(page).toHaveTitle('MedLiveBD');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest',
    );
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
      'content',
      'MedLiveBD',
    );
  });

  test('at Padma’s portal: Padma’s title, name and icon, and the same install address', async ({
    page,
  }) => {
    await page.goto(PADMA_PORTAL);
    await expect(page).toHaveTitle(/পদ্মা/);
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
      'content',
      /পদ্মা/,
    );
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      /\/hospitals\/[0-9a-f-]{36}\/logo\?v=[0-9a-f]{16}$/,
    );
    // The address says whose it is, so nothing is added to it.
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest',
    );

    // English is a switch away, and the title follows it.
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page).toHaveTitle(/Padma/);
  });

  test('opened by a parameter: the install description is asked for with it', async ({ page }) => {
    await page.goto(`${NETWORK}/?scope=PADMA`);
    await expect(page).toHaveTitle(/পদ্মা/);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest?scope=PADMA',
    );
  });
});
