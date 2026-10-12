import { expect, test } from '@playwright/test';
import axe from 'axe-core';

import { cinematic } from '../src/content/cinematic';
import { contactEmail, copy, demoHref } from '../src/content/copy';

import type { Page } from '@playwright/test';
import type { AxeResults } from 'axe-core';

async function jump(page: Page, top: number): Promise<void> {
  await page.evaluate((y) => {
    window.scrollTo({ top: y, behavior: 'instant' });
  }, top);
  await page.waitForTimeout(600);
}
async function accessible(page: Page): Promise<void> {
  await page.evaluate(axe.source);
  const result = await page.evaluate(async () => {
    const w = window as unknown as {
      axe: { run: (root: Document, options: object) => Promise<AxeResults> };
    };
    return await w.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    });
  });
  expect(result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual(
    [],
  );
}
async function noOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('static routes, Bangla entrance and security (S-C-01, GR-06)', async ({ request }) => {
  const entrance = await request.get('/', { maxRedirects: 0 });
  expect([302, 307]).toContain(entrance.status());
  expect(entrance.headers()['location']).toBe('/bn');
  for (const locale of ['en', 'bn'] as const) {
    const response = await request.get(`/${locale}`);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain(`<html lang="${locale}"`);
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(response.headers()['x-frame-options']).toBe('DENY');
    expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  }
  expect((await request.get('/unsupported')).status()).toBe(404);
});

for (const locale of ['en', 'bn'] as const) {
  test(`${locale}: story, destinations, images and browser errors`, async ({ page }) => {
    const errors: string[] = [],
      foreign: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('request', (request) => {
      if (!request.url().startsWith('http://localhost:3210')) foreign.push(request.url());
    });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`/${locale}`);
    await expect(page).toHaveTitle(copy[locale].title);
    await expect(page.locator('h1')).toHaveText(copy[locale].hero.map((p) => p.text).join(''));
    await expect(page.locator('#patients')).toContainText(cinematic[locale].patientStatus);
    await expect(page.locator('#bangladesh')).toContainText(cinematic[locale].mapNote);
    const demos = page.getByRole('link', { name: copy[locale].demo, exact: true });
    expect(await demos.count()).toBeGreaterThanOrEqual(4);
    for (const link of await demos.all()) await expect(link).toHaveAttribute('href', demoHref);
    for (const link of await page.locator('a[href^="#"]').all()) {
      expect(await page.locator((await link.getAttribute('href')) ?? '').count()).toBe(1);
    }
    expect(await page.locator('form, iframe, canvas').count()).toBe(0);
    expect(
      await page
        .locator('a')
        .evaluateAll((links: HTMLAnchorElement[]) =>
          links.filter((a) => /vercel|onrender|demo\.|patient\./.test(a.href)).map((a) => a.href),
        ),
    ).toEqual([]);
    const images = page.locator('main picture img');
    expect(await images.count()).toBe(6);
    for (const [index, image] of (await images.all()).entries()) {
      await expect(image).toHaveAttribute('loading', index === 0 ? 'eager' : 'lazy');
      await expect(image).toHaveAttribute('alt', /.+/);
      await expect(image).toHaveAttribute('width', '1920');
      await image.scrollIntoViewIfNeeded();
      await expect
        .poll(() => image.evaluate((i: HTMLImageElement) => i.naturalWidth))
        .toBeGreaterThan(0);
    }
    await expect(images.first()).toHaveAttribute('fetchpriority', 'high');
    await expect(page.locator('.campaign-disclosure')).toHaveText(cinematic[locale].synthetic);
    await noOverflow(page);
    expect(errors).toEqual([]);
    expect(foreign).toEqual([]);
  });

  test(`${locale}: axe desktop/mobile, menu, keyboard, anchors and language`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`/${locale}`);
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();
    await accessible(page);
    await page.setViewportSize({ width: 375, height: 812 });
    const toggle = page.locator('.menu-toggle'),
      nav = page.locator('#mobile-navigation');
    await toggle.click();
    await expect(nav).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    await expect(toggle).toBeFocused();
    await toggle.click();
    await nav.locator('a[href="#patients"]').click();
    await expect(page).toHaveURL(/#patients$/);
    await expect(nav).toBeHidden();
    await page.waitForTimeout(900);
    const anchor = await page.locator('#patients').boundingBox();
    expect(anchor?.y).toBeGreaterThanOrEqual(60);
    expect(anchor?.y).toBeLessThan(170);
    await accessible(page);
    await page.locator('.site-header .language-link').click();
    await expect(page).toHaveURL(new RegExp(`/${locale === 'en' ? 'bn' : 'en'}#patients$`));
    await expect(page.locator('html')).toHaveAttribute('lang', locale === 'en' ? 'bn' : 'en');
    await toggle.click();
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(nav).toBeHidden();
    await expect(page.locator('.desktop-nav')).toBeVisible();
  });

  for (const width of [320, 360, 375, 390, 430, 768, 1024, 1440]) {
    test(`${locale}: responsive ${String(width)}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/${locale}`);
      await noOverflow(page);
      await expect(page.locator('.site-header .brand-logo')).toBeVisible();
      expect((await page.locator('.hero-photograph').boundingBox())?.height).toBeGreaterThan(250);
      if (width <= 960) {
        expect(
          await page.locator('.audience-sticky').evaluate((el) => getComputedStyle(el).position),
        ).not.toBe('sticky');
        const a = await page.locator('.audience-hospital').boundingBox(),
          b = await page.locator('.audience-patient').boundingBox();
        expect(b?.y).toBeGreaterThan((a?.y ?? 0) + (a?.height ?? 0));
      }
      for (const selector of [
        '.pulse-hero h1',
        '.audience-copy',
        '.people-copy',
        '.bangladesh-copy',
        '.closing-content',
      ]) {
        for (const el of await page.locator(selector).all())
          expect(await el.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
      }
      if (locale === 'bn') {
        const s = await page.locator('h1').evaluate((el) => {
          const x = getComputedStyle(el);
          return {
            leading: parseFloat(x.lineHeight) / parseFloat(x.fontSize),
            spacing: x.letterSpacing,
          };
        });
        expect(s.leading).toBeGreaterThanOrEqual(1.64);
        expect(s.spacing).toBe('normal');
      }
    });
  }

  test(`${locale}: privacy and asset provenance`, async ({ page }) => {
    for (const path of ['privacy', 'credits']) {
      await page.goto(`/${locale}/${path}`);
      await expect(page.locator('h1')).toHaveText(
        path === 'privacy' ? copy[locale].privacyTitle : copy[locale].creditsTitle,
      );
      await expect(page.locator('.site-header .language-link')).toHaveAttribute(
        'href',
        `/${locale === 'en' ? 'bn' : 'en'}/${path}`,
      );
      await accessible(page);
      await page.setViewportSize({ width: 320, height: 800 });
      await noOverflow(page);
      if (path === 'credits') {
        await expect(page.locator('main')).toContainText(cinematic[locale].assetsIntro);
        expect(await page.locator('.credit-list img').count()).toBe(4);
        await expect(page.locator('main')).toContainText('CC0 1.0');
      } else await expect(page.locator('main')).toContainText(contactEmail);
    }
  });
}

test('reversible scroll, keyboard audience focus, geographic camera, responsive cleanup', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/en');
  const stage = page.locator('#experiences');
  await expect(stage).toHaveAttribute('data-motion', 'true');
  const top = await stage.evaluate((el) => el.getBoundingClientRect().top + scrollY);
  await jump(page, top - 200);
  const before = await page.locator('.layer-one').evaluate((el) => getComputedStyle(el).transform);
  await jump(page, top + 250);
  expect(
    await page.locator('.layer-one').evaluate((el) => getComputedStyle(el).transform),
  ).not.toBe(before);
  await jump(page, top - 200);
  const after = await page.locator('.layer-one').evaluate((el) => getComputedStyle(el).transform);
  const matrix = (s: string): number[] =>
    s.replace('matrix(', '').replace(')', '').split(',').map(Number);
  matrix(before).forEach((v, i) => expect(Math.abs(v - (matrix(after)[i] ?? 0))).toBeLessThan(0.8));
  const hospital = page.getByRole('button', { name: cinematic.en.hospital, exact: true });
  await hospital.focus();
  await page.keyboard.press('Enter');
  await expect(stage).toHaveAttribute('data-focus', 'hospital');
  await expect(hospital).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: cinematic.en.patient, exact: true }).click();
  await expect(stage).toHaveAttribute('data-focus', 'patient');
  await page.getByRole('button', { name: cinematic.en.reset }).click();
  await expect(stage).toHaveAttribute('data-focus', 'both');
  const mapTop = await page
    .locator('#bangladesh')
    .evaluate((el) => el.getBoundingClientRect().top + scrollY);
  await jump(page, mapTop - 850);
  const mapBefore = await page
    .locator('.country-map')
    .evaluate((el) => getComputedStyle(el).transform);
  await jump(page, mapTop);
  expect(
    await page.locator('.country-map').evaluate((el) => getComputedStyle(el).transform),
  ).not.toBe(mapBefore);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(stage).toHaveAttribute('data-motion', 'false');
  expect(
    await page.locator('.audience-sticky').evaluate((el) => getComputedStyle(el).position),
  ).not.toBe('sticky');
  await noOverflow(page);
});

test('reduced motion, including live preference changes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/bn');
  await expect(page.locator('#experiences')).toHaveAttribute('data-motion', 'false');
  expect(await page.locator('.country-map').evaluate((el) => getComputedStyle(el).transform)).toBe(
    'none',
  );
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe(
    'auto',
  );
  await accessible(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('#experiences')).toHaveAttribute('data-motion', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('#experiences')).toHaveAttribute('data-motion', 'false');
});

test('no JavaScript: complete story and contact in static HTML', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/en');
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('#experiences')).toHaveAttribute('data-motion', 'false');
  for (const heading of await page.locator('main h2, main h3').all())
    await expect(heading).toBeVisible();
  await expect(page.locator('#contact').getByRole('link', { name: contactEmail })).toHaveAttribute(
    'href',
    `mailto:${contactEmail}`,
  );
  await context.close();
});
