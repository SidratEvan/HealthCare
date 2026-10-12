import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import axe from 'axe-core';

import { contactEmail, copy, demoHref } from '../src/content/copy';

import type { Page } from '@playwright/test';
import type { AxeResults } from 'axe-core';

async function expectAccessible(page: Page): Promise<void> {
  // Sections rise into place as they are reached; check them as a reader sees them.
  await page.evaluate(() => {
    for (const element of document.querySelectorAll('.reveal')) element.scrollIntoView();
  });
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.reveal')].every((element) =>
      element.classList.contains('is-visible'),
    ),
  );
  await page.waitForTimeout(900);
  await page.evaluate(axe.source);
  const results = await page.evaluate(async () => {
    const context = window as unknown as Window & {
      axe: { run: (root: Document, options: object) => Promise<AxeResults> };
    };
    return await context.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    });
  });
  expect(results.violations).toEqual([]);
}

async function expectNoOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

async function capture(page: Page, name: string): Promise<void> {
  if (process.env['SITE_CAPTURE'] !== '1') return;
  const directory = new URL('../../../docs/design/company-site/', import.meta.url);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL(name, directory)), fullPage: true });
}

test('Bangla entrance, server-rendered languages, invalid locale and security headers (GR-06)', async ({
  request,
}) => {
  const entrance = await request.get('/', { maxRedirects: 0 });
  expect(entrance.status()).toBe(307);
  expect(entrance.headers()['location']).toBe('/bn');
  for (const locale of ['bn', 'en'] as const) {
    const response = await request.get(`/${locale}`);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain(`<html lang="${locale}"`);
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(response.headers()['x-frame-options']).toBe('DENY');
    expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  }
  expect((await request.get('/unsupported')).status()).toBe(404);
});

for (const locale of ['bn', 'en'] as const) {
  const t = copy[locale];
  test(`${locale}: company sections, workflow controls, real contact and keyboard access (S-C-01/02/04/05)`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${locale}`);
    await expect(page).toHaveTitle(t.title);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      t.description,
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.hero.join(''));
    await expect(page.locator('#platform')).toContainText(t.intro);
    await expect(page.locator('#hospitals')).toContainText(t.hospitalBody);
    await expect(page.locator('#about')).toContainText(t.aboutBody);
    await expect(page.locator('#contact')).toContainText(t.contactNote);
    await expect(page.getByText(t.illustrative, { exact: true })).toBeVisible();
    await expect(
      page.locator('#contact').getByRole('link', { name: contactEmail }),
    ).toHaveAttribute('href', `mailto:${contactEmail}`);
    await expect(
      page.locator('.site-footer').getByRole('link', { name: contactEmail }),
    ).toHaveAttribute('href', `mailto:${contactEmail}`);
    for (const link of await page.getByRole('link', { name: t.demo, exact: true }).all()) {
      await expect(link).toHaveAttribute('href', demoHref);
    }
    const logo = page.locator('.site-header .brand-logo');
    expect(await logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: t.skip })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
    for (const feature of t.features) {
      const button = page.getByRole('button', { name: feature.label, exact: true });
      await button.focus();
      await page.keyboard.press('Enter');
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#workflow-view h3')).toHaveText(feature.title);
      await expect(page.locator('#workflow-view')).toContainText(feature.detail);
    }
    await expectAccessible(page);
    await expectNoOverflow(page);
    expect(errors).toEqual([]);
    if (locale === 'en') await capture(page, 'en-desktop.png');
  });

  test(`${locale}: mobile navigation, language switch, tablet layout and resize safety (GR-06)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/${locale}`);
    const toggle = page.locator('.menu-toggle');
    const nav = page.locator('#mobile-navigation');
    await expect(nav).toBeHidden();
    await toggle.click();
    await expect(nav).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    await expect(toggle).toBeFocused();
    await toggle.click();
    await nav.locator('a[href="#contact"]').click();
    await expect(nav).toBeHidden();
    await expect(page).toHaveURL(/#contact$/);
    await expectNoOverflow(page);
    await expectAccessible(page);
    if (locale === 'bn') await capture(page, 'bn-mobile.png');
    await toggle.click();
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(nav).toBeHidden();
    await expect(page.locator('.desktop-nav')).toBeVisible();
    await expectNoOverflow(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await page.locator('.language-link').click();
    const target = locale === 'bn' ? 'en' : 'bn';
    await expect(page).toHaveURL(new RegExp(`/${target}$`));
    await expect(page.locator('html')).toHaveAttribute('lang', target);
  });
}

test('reduced motion and readable Bangla display (GR-06)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/bn');
  const styles = await page.evaluate(() => {
    const heading = document.querySelector('h1');
    if (!heading) throw new Error('Missing heading');
    const style = getComputedStyle(heading);
    return {
      scroll: getComputedStyle(document.documentElement).scrollBehavior,
      animation: getComputedStyle(document.querySelector('.live-badge') ?? heading).animationName,
      leading: Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize),
      spacing: style.letterSpacing,
    };
  });
  expect(styles.scroll).toBe('auto');
  expect(styles.animation).toBe('none');
  expect(styles.leading).toBeGreaterThanOrEqual(1.35);
  expect(styles.spacing).toBe('normal');
  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoOverflow(page);
});

for (const locale of ['bn', 'en'] as const) {
  const t = copy[locale];
  test(`${locale}: privacy notice is reachable from the footer and names the real contact`, async ({
    page,
  }) => {
    await page.goto(`/${locale}`);
    await page.locator('.site-footer').getByRole('link', { name: t.privacy }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/privacy$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.privacyTitle);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    for (const section of t.privacySections) {
      await expect(page.getByRole('heading', { level: 2, name: section.heading })).toBeVisible();
    }
    await expect(page.locator('main')).toContainText(contactEmail);
    await expectAccessible(page);
    await expectNoOverflow(page);
  });
}

test('product screens load in both languages and say they are demonstration data', async ({
  page,
}) => {
  for (const locale of ['bn', 'en'] as const) {
    await page.goto(`/${locale}`);
    for (const image of await page.locator('.stage img').all()) {
      expect(
        await image.evaluate((element: HTMLImageElement) => element.naturalWidth),
      ).toBeGreaterThan(0);
      expect(await image.getAttribute('alt')).toMatch(/demonstration data|ডেমো তথ্য/);
    }
    for (const feature of copy[locale].features) {
      await page.getByRole('button', { name: feature.label, exact: true }).click();
      const image = page.locator('#workflow-view img');
      await expect(image).toHaveAttribute('alt', feature.alt);
      await expect
        .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
        .toBeGreaterThan(0);
    }
  }
});
