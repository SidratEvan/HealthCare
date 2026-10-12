import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import axe from 'axe-core';

import { contactEmail, copy, demoHref } from '../src/content/copy';
import { PHOTO_ORDER, PHOTOS } from '../src/content/photos';

import type { Page } from '@playwright/test';
import type { AxeResults } from 'axe-core';

/** Sections rise into place as they are reached; check them as a reader sees them, fully in. */
async function revealAll(page: Page): Promise<void> {
  const count = await page.locator('[data-reveal]').count();
  for (let index = 0; index < count; index += 1) {
    await page.locator('[data-reveal]').nth(index).scrollIntoViewIfNeeded();
  }
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-reveal]')].every(
      (element) => getComputedStyle(element).opacity === '1',
    ),
  );
  await page.waitForTimeout(900);
}

async function expectAccessible(page: Page): Promise<void> {
  await revealAll(page);
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
    const html = await response.text();
    expect(html).toContain(`<html lang="${locale}"`);
    // The story is in the server HTML, not only after script runs.
    expect(html).toContain(copy[locale].patientsStatus);
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(response.headers()['x-frame-options']).toBe('DENY');
    expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  }
  expect((await request.get('/unsupported')).status()).toBe(404);
});

for (const locale of ['bn', 'en'] as const) {
  const t = copy[locale];
  test(`${locale}: the company story, both audiences, the real contact, keyboard and axe (S-C-01/02/04/05)`, async ({
    page,
  }) => {
    const errors: string[] = [];
    const foreign: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (!request.url().startsWith('http://localhost:3200')) foreign.push(request.url());
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${locale}`);
    await expect(page).toHaveTitle(t.title);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      t.description,
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      t.hero.map((part) => part.text).join(''),
    );
    await expect(page.locator('#vision')).toContainText(t.pillars[0]?.title ?? '');
    await expect(page.locator('#experiences')).toContainText(t.experiences.hospitals.title);
    await expect(page.locator('#experiences')).toContainText(t.experiences.patients.title);
    await expect(page.locator('#hospitals')).toContainText(t.hospitalsBody);
    await expect(page.locator('#patients')).toContainText(t.patientsBody);
    await expect(page.locator('#bangladesh')).toContainText(t.mapLegend);
    await expect(page.locator('#trust')).toContainText(t.trust[0]?.body ?? '');
    await expect(page.locator('#contact')).toContainText(t.contactNote);

    // Hospitals: a demo request, by email to the public address.
    for (const name of [t.demo, t.demoPrivate]) {
      for (const link of await page.getByRole('link', { name, exact: true }).all()) {
        await expect(link).toHaveAttribute('href', demoHref);
      }
    }
    await expect(
      page.locator('#contact').getByRole('link', { name: contactEmail }),
    ).toHaveAttribute('href', `mailto:${contactEmail}`);
    const mailtos = await page
      .locator('a[href^="mailto:"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
    for (const href of mailtos) expect(href.startsWith(`mailto:${contactEmail}`)).toBe(true);

    // Patients: said truthfully to be not yet open; nowhere to enter details.
    await expect(page.locator('#patients')).toContainText(t.comingSoon);
    await expect(page.locator('form, input, textarea')).toHaveCount(0);
    const external = await page
      .locator('a[href^="http"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
    expect(external).toEqual([]);

    // The two experiences lead to their sections.
    await page.getByRole('link', { name: t.experiences.patients.cta }).click();
    await expect(page).toHaveURL(/#patients$/);
    await page.getByRole('link', { name: t.experiences.hospitals.cta }).click();
    await expect(page).toHaveURL(/#hospitals$/);

    // The map is drawn, named for assistive technology, and labelled a concept.
    await expect(page.getByRole('img', { name: t.mapAria })).toBeVisible();
    await expect(page.locator('#bangladesh').getByText(t.mapConcept).first()).toBeVisible();

    const logo = page.locator('.site-header .brand-logo');
    expect(await logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await page.goto(`/${locale}`);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: t.skip })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
    for (const link of t.nav) {
      await expect(page.locator(`#${link.id}`)).toHaveCount(1);
    }

    await expectAccessible(page);
    await expectNoOverflow(page);
    expect(errors).toEqual([]);
    expect(foreign).toEqual([]);
    if (locale === 'en') await capture(page, 'en-desktop.png');
  });

  test(`${locale}: photographs are this site's own, licensed, described and lazily loaded`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${locale}`);
    const photos = page.locator('main picture img');
    const count = await photos.count();
    expect(count).toBe(PHOTO_ORDER.length);
    for (let index = 0; index < count; index += 1) {
      const image = photos.nth(index);
      const src = (await image.getAttribute('src')) ?? '';
      expect(src).toMatch(/^\/photos\/[a-z]+-\d+\.webp$/);
      expect((await image.getAttribute('alt')) ?? '').not.toBe('');
      expect(await image.getAttribute('width')).not.toBeNull();
      expect(await image.getAttribute('loading')).toBe(index === 0 ? 'eager' : 'lazy');
    }
    // Each one carries its photographer and licence on the page.
    for (const key of PHOTO_ORDER) {
      await expect(
        page.getByText(`${PHOTOS[key].author} · ${PHOTOS[key].licence}`).first(),
      ).toBeAttached();
    }
    await revealAll(page);
    for (let index = 0; index < count; index += 1) {
      await expect
        .poll(() => photos.nth(index).evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBeGreaterThan(0);
    }
  });

  test(`${locale}: the hero illustration can be paused (WCAG 2.2.2)`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${locale}`);
    await page.getByRole('button', { name: t.pause }).click();
    await expect(page.getByRole('button', { name: t.play })).toBeVisible();
    const ahead = page.locator('.glimpse-ahead .rolling');
    await page.waitForTimeout(800);
    const before = (await ahead.textContent()) ?? '';
    await page.waitForTimeout(3600);
    await expect(ahead).toHaveText(before);
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
    await nav.locator('a[href="#trust"]').click();
    await expect(nav).toBeHidden();
    await expect(page).toHaveURL(/#trust$/);
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
    await page.locator('.site-header .language-link').click();
    const target = locale === 'bn' ? 'en' : 'bn';
    // The reader's place comes along.
    await expect(page).toHaveURL(new RegExp(`/${target}#trust$`));
    await expect(page.locator('html')).toHaveAttribute('lang', target);
  });
}

test('reduced motion: nothing loops, no pause control is needed, Bangla stays readable (GR-06)', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/bn');
  await expect(page.locator('.stage-toggle')).toHaveCount(0);
  const styles = await page.evaluate(() => {
    const heading = document.querySelector('h1');
    const dot = document.querySelector('.live-dot');
    if (!heading || !dot) throw new Error('Missing heading or live dot');
    const style = getComputedStyle(heading);
    return {
      scroll: getComputedStyle(document.documentElement).scrollBehavior,
      pulse: getComputedStyle(dot, '::after').animationName,
      leading: Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize),
      spacing: style.letterSpacing,
    };
  });
  expect(styles.scroll).toBe('auto');
  expect(styles.pulse).toBe('none');
  expect(styles.leading).toBeGreaterThanOrEqual(1.35);
  expect(styles.spacing).toBe('normal');
  // The patient glimpse holds still.
  const ahead = page.locator('.glimpse-ahead .rolling');
  const before = (await ahead.textContent()) ?? '';
  await page.waitForTimeout(3600);
  await expect(ahead).toHaveText(before);
  // The map's pulses are not drawn at all.
  await expect(page.locator('.bd-pulse')).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoOverflow(page);
});

test('without script every section is visible (GR-06)', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/en');
  const hidden = await page
    .locator('[data-reveal]')
    .evaluateAll(
      (elements) => elements.filter((element) => getComputedStyle(element).opacity !== '1').length,
    );
  expect(hidden).toBe(0);
  const clipped = await page
    .locator('[data-reveal]')
    .evaluateAll(
      (elements) =>
        elements.filter((element) => !['none', ''].includes(getComputedStyle(element).clipPath))
          .length,
    );
  expect(clipped).toBe(0);
  await expect(page.locator('#contact').getByRole('link', { name: contactEmail })).toBeVisible();
  await context.close();
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
    await expect(page.locator('.site-header .language-link')).toHaveAttribute(
      'href',
      `/${locale === 'bn' ? 'en' : 'bn'}/privacy`,
    );
    await expectAccessible(page);
    await expectNoOverflow(page);
  });

  test(`${locale}: image credits name every photograph, its author, source and licence`, async ({
    page,
  }) => {
    await page.goto(`/${locale}`);
    await page.locator('.site-footer').getByRole('link', { name: t.credits }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/credits$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.creditsTitle);
    for (const key of PHOTO_ORDER) {
      const photo = PHOTOS[key];
      const row = page.locator('.credit-list li').filter({ hasText: photo.title });
      await expect(row).toContainText(photo.author);
      await expect(row.getByRole('link', { name: t.creditsSource })).toHaveAttribute(
        'href',
        photo.source,
      );
      await expect(row.getByRole('link', { name: photo.licence })).toHaveAttribute(
        'href',
        photo.licenceUrl,
      );
    }
    await expect(page.locator('main')).toContainText('CC BY 3.0 IGO');
    await expectAccessible(page);
    await expectNoOverflow(page);
  });
}
