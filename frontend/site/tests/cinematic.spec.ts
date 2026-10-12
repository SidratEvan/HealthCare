import { expect, test } from '@playwright/test';
import axe from 'axe-core';

import { cinematic } from '../src/content/cinematic';
import { contactEmail, copy, demoHref } from '../src/content/copy';
import { founders } from '../src/content/founders';

import type { Page } from '@playwright/test';
import type { AxeResults } from 'axe-core';

async function jump(page: Page, top: number): Promise<void> {
  await page.evaluate((y) => {
    window.scrollTo({ top: y, behavior: 'instant' });
  }, top);
  await page.waitForTimeout(600);
}
async function topOf(page: Page, selector: string): Promise<number> {
  return await page.locator(selector).evaluate((el) => el.getBoundingClientRect().top + scrollY);
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
/** How far the care thread's ink is drawn (its scaleY), 1 when it carries no transform. */
async function threadDrawn(page: Page, selector: string): Promise<number> {
  return await page.locator(`${selector} .thread-ink`).evaluate((el) => {
    const t = getComputedStyle(el).transform;
    return t === 'none' ? 1 : Number(t.replace('matrix(', '').split(',')[3]);
  });
}

test('static routes, Bangla entrance and security (S-C-01, GR-06)', async ({ request }) => {
  const entrance = await request.get('/', { maxRedirects: 0 });
  expect([302, 307]).toContain(entrance.status());
  expect(entrance.headers()['location']).toBe('/bn');
  for (const path of ['/en', '/bn', '/en/founders', '/bn/founders']) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain(`<html lang="${path.slice(1, 3)}"`);
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(response.headers()['x-frame-options']).toBe('DENY');
    expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  }
  expect(await (await request.get('/sitemap.xml')).text()).toContain('/bn/founders');
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
    for (const [title] of [
      ...cinematic[locale].hospitalFeatures,
      ...cinematic[locale].patientFeatures,
    ])
      await expect(page.locator('#experiences')).toContainText(title);
    const demos = page.getByRole('link', { name: copy[locale].demo, exact: true });
    expect(await demos.count()).toBeGreaterThanOrEqual(4);
    for (const link of await demos.all()) await expect(link).toHaveAttribute('href', demoHref);
    for (const link of await page.locator('a[href^="#"]').all()) {
      expect(await page.locator((await link.getAttribute('href')) ?? '').count()).toBe(1);
    }
    await expect(page.locator('.closing-founders')).toHaveAttribute('href', `/${locale}/founders`);
    expect(await page.locator('form, iframe, canvas').count()).toBe(0);
    expect(
      await page
        .locator('a')
        .evaluateAll((links: HTMLAnchorElement[]) =>
          links.filter((a) => /vercel|onrender|demo\.|patient\./.test(a.href)).map((a) => a.href),
        ),
    ).toEqual([]);
    const images = page.locator('main picture img');
    expect(await images.count()).toBe(4);
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
    await expect(nav.locator(`a[href="/${locale}/founders"]`)).toBeVisible();
    await nav.locator('a[href="#patients"]').click();
    await expect(page).toHaveURL(/#patients$/);
    await expect(nav).toBeHidden();
    await page.waitForTimeout(900);
    // The anchor lands just below the compact header, never under it.
    const header = await page.locator('.site-header').boundingBox();
    const anchor = await page.locator('#patients').boundingBox();
    expect(anchor?.y).toBeGreaterThanOrEqual((header?.height ?? 0) - 1);
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
      const a = await page.locator('#hospitals').boundingBox(),
        b = await page.locator('#patients').boundingBox();
      if (width <= 960) expect(b?.y).toBeGreaterThanOrEqual((a?.y ?? 0) + (a?.height ?? 0));
      else expect(Math.abs((b?.y ?? 0) - (a?.y ?? 0))).toBeLessThan(200);
      for (const selector of [
        '.pulse-hero h1',
        '.audience-copy',
        '.feature-list',
        '.bangladesh-copy',
        '.closing-content',
      ]) {
        for (const el of await page.locator(selector).all())
          expect(await el.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
      }
      if (locale === 'bn') {
        for (const selector of ['h1', '#audience-title', '#bangladesh-title']) {
          const s = await page.locator(selector).evaluate((el) => {
            const x = getComputedStyle(el);
            return {
              leading: parseFloat(x.lineHeight) / parseFloat(x.fontSize),
              spacing: x.letterSpacing,
            };
          });
          expect(s.leading).toBeGreaterThanOrEqual(1.64);
          expect(s.spacing).toBe('normal');
        }
      }
    });
  }

  test(`${locale}: founders, privacy and asset provenance`, async ({ page }) => {
    const t = founders[locale];
    await page.goto(`/${locale}/founders`);
    await expect(page.locator('h1')).toHaveText(t.heading);
    for (const person of t.founders) {
      await expect(page.getByRole('heading', { name: person.name })).toBeVisible();
      await expect(page.locator(`a[href="mailto:${person.email}"]`)).toBeVisible();
      await expect(page.locator(`a[href="tel:${person.phone}"]`)).toHaveText(person.phoneDisplay);
    }
    await expect(page.locator('.desktop-nav a[aria-current="page"]')).toHaveAttribute(
      'href',
      `/${locale}/founders`,
    );
    await expect(page.locator('.site-header .language-link')).toHaveAttribute(
      'href',
      `/${locale === 'en' ? 'bn' : 'en'}/founders`,
    );
    await expect(page.locator('main')).toContainText(contactEmail);
    await accessible(page);
    await page.setViewportSize({ width: 320, height: 800 });
    await noOverflow(page);
    await page.setViewportSize({ width: 1280, height: 800 });
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
      await page.setViewportSize({ width: 1280, height: 800 });
      if (path === 'credits') {
        await expect(page.locator('main')).toContainText(cinematic[locale].assetsIntro);
        expect(await page.locator('.credit-list img').count()).toBe(4);
        await expect(page.locator('main')).toContainText('CC0 1.0');
      } else await expect(page.locator('main')).toContainText(contactEmail);
    }
  });
}

/* The three faults the owner named on 12 October 2026, kept from returning. */
for (const width of [1440, 390]) {
  test(`each photograph appears once in a visit (${String(width)}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/en');
    const sources = await page
      .locator('main picture img')
      .evaluateAll((images) =>
        images
          .filter((i) => i.getBoundingClientRect().width > 0)
          .map((i) => (i as HTMLImageElement).src.replace(/^.*\/campaign\/([a-z]+)-.*$/, '$1')),
      );
    expect(sources.sort()).toEqual(['atmosphere', 'hero', 'patient', 'team']);
  });
}

test('connecting lines are visible strokes, not hairlines', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/en');
  for (const selector of ['.fork-ink', '.map-spoke', '.country-outline']) {
    for (const path of await page.locator(selector).all()) {
      const style = await path.evaluate((el) => {
        const s = getComputedStyle(el);
        return { width: parseFloat(s.strokeWidth), effect: s.vectorEffect, opacity: s.opacity };
      });
      expect(style.width).toBeGreaterThanOrEqual(1.5);
      expect(style.effect).toBe('non-scaling-stroke');
      expect(style.opacity).toBe('1');
    }
  }
  expect(await page.locator('.map-spoke').count()).toBe(7);
  expect(
    await page.locator('.token-layer, .hero-signal, .closing-signal, .photo-edge').count(),
  ).toBe(0);
});

test('scroll draws the thread and the map, and scrolling back undraws them', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/en');
  await expect(page.locator('#experiences')).toHaveAttribute('data-motion', 'true');
  await expect(page.locator('#experiences')).toHaveAttribute('data-lines', 'true');
  const vision = await topOf(page, '#vision');
  await jump(page, 0);
  expect(await threadDrawn(page, '.thread-top')).toBeLessThan(0.05);
  await jump(page, vision);
  expect(await threadDrawn(page, '.thread-top')).toBeGreaterThan(0.95);
  await jump(page, 0);
  expect(await threadDrawn(page, '.thread-top')).toBeLessThan(0.05);

  const offset = (): Promise<number> =>
    page
      .locator('.map-spoke')
      .last()
      .evaluate((el) => {
        const length = parseFloat(getComputedStyle(el).strokeDasharray.split(',')[0] ?? '1');
        return length;
      });
  const map = await topOf(page, '#bangladesh');
  await jump(page, map - 900);
  const before = await offset();
  await jump(page, map);
  const drawn = await offset();
  expect(drawn).toBeGreaterThan(before);
  await jump(page, map - 900);
  expect(await offset()).toBeLessThan(drawn);

  const hero = await page
    .locator('.hero-photograph')
    .evaluate((el) => getComputedStyle(el).transform);
  await jump(page, 500);
  expect(
    await page.locator('.hero-photograph').evaluate((el) => getComputedStyle(el).transform),
  ).not.toBe(hero);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#experiences')).toHaveAttribute('data-motion', 'false');
  await expect(page.locator('#experiences')).toHaveAttribute('data-lines', 'true');
  await noOverflow(page);
});

test('the header logo is legible at the top and compact once scrolled', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/en');
  const width = (): Promise<number> =>
    page.locator('.site-header .brand-logo').evaluate((el) => el.getBoundingClientRect().width);
  expect(await width()).toBeGreaterThanOrEqual(160);
  const heroTop = (await page.locator('.pulse-hero').boundingBox())?.y ?? 0;
  await jump(page, 600);
  await page.waitForTimeout(500);
  expect(await width()).toBeLessThan(120);
  await jump(page, 0);
  expect((await page.locator('.pulse-hero').boundingBox())?.y).toBe(heroTop);
});

test('reduced motion, including live preference changes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/bn');
  await expect(page.locator('#experiences')).toHaveAttribute('data-motion', 'false');
  await expect(page.locator('#experiences')).toHaveAttribute('data-lines', 'false');
  expect(await page.locator('.country-map').evaluate((el) => getComputedStyle(el).transform)).toBe(
    'none',
  );
  expect(await threadDrawn(page, '.thread-top')).toBe(1);
  expect(
    await page
      .locator('.map-spoke')
      .first()
      .evaluate((el) => getComputedStyle(el).strokeDasharray),
  ).toBe('none');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe(
    'auto',
  );
  await accessible(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('#experiences')).toHaveAttribute('data-motion', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('#experiences')).toHaveAttribute('data-motion', 'false');
});

test('no JavaScript: complete story, drawn lines and contact in static HTML', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/en');
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('#experiences')).toHaveAttribute('data-motion', 'false');
  for (const heading of await page.locator('main h2, main h3, main h4').all())
    await expect(heading).toBeVisible();
  expect(await threadDrawn(page, '.thread-bottom')).toBe(1);
  await expect(page.locator('#contact').getByRole('link', { name: contactEmail })).toHaveAttribute(
    'href',
    `mailto:${contactEmail}`,
  );
  await page.goto('/en/founders');
  await expect(page.locator('.founder')).toHaveCount(2);
  await context.close();
});
