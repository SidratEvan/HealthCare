import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import axe from 'axe-core';

import { contactEmail, copy, demoHref } from '../src/content/copy';

import type { Page } from '@playwright/test';
import type { AxeResults } from 'axe-core';

/** Sections rise into place as they are reached; check them as a reader sees them, fully in. */
async function revealAll(page: Page): Promise<void> {
  const count = await page.locator('[data-reveal]').count();
  for (let index = 0; index < count; index += 1) {
    await page.locator('[data-reveal]').nth(index).scrollIntoViewIfNeeded();
  }
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-reveal]')].every(
      (element) => getComputedStyle(element).opacity === '1',
    ),
  );
  await page.waitForTimeout(600);
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
    // The argument is in the server HTML, not only after script runs.
    expect(html).toContain(copy[locale].problemBody);
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(response.headers()['x-frame-options']).toBe('DENY');
    expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  }
  expect((await request.get('/unsupported')).status()).toBe(404);
});

for (const locale of ['bn', 'en'] as const) {
  const t = copy[locale];
  test(`${locale}: every section, the real contact, keyboard access and axe (S-C-01/02/04/05)`, async ({
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
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      t.hero.map((part) => part.text).join(''),
    );
    await expect(page.locator('#why')).toContainText(t.problemBody);
    await expect(page.locator('#how')).toContainText(t.howBody);
    await expect(page.locator('#product')).toContainText(t.productBody);
    await expect(page.locator('#hospitals')).toContainText(t.capBody);
    await expect(page.locator('#patients')).toContainText(t.patientBody);
    await expect(page.locator('#network')).toContainText(t.networkBody);
    await expect(page.locator('#trust')).toContainText(t.trustBody);
    await expect(page.locator('#start')).toContainText(t.startBody);
    await expect(page.locator('#contact')).toContainText(t.contactNote);
    await expect(page.getByText(t.live.caption, { exact: true })).toBeVisible();
    await expect(
      page.locator('#contact').getByRole('link', { name: contactEmail }),
    ).toHaveAttribute('href', `mailto:${contactEmail}`);
    await expect(
      page.locator('.site-footer').getByRole('link', { name: contactEmail }),
    ).toHaveAttribute('href', `mailto:${contactEmail}`);
    for (const name of [t.demo, t.demoShort]) {
      for (const link of await page.getByRole('link', { name, exact: true }).all()) {
        await expect(link).toHaveAttribute('href', demoHref);
      }
    }
    // No other address is published.
    const mailtos = await page
      .locator('a[href^="mailto:"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
    for (const href of mailtos) expect(href.startsWith(`mailto:${contactEmail}`)).toBe(true);
    const logo = page.locator('.site-header .brand-logo');
    expect(await logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);

    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: t.skip })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);

    // Workspaces: a tab list; arrow keys move and select.
    const first = t.features[0];
    if (first === undefined) throw new Error('No workspaces');
    await expect(page.getByRole('tab')).toHaveCount(t.features.length);
    await page.getByRole('tab', { name: first.label, exact: true }).focus();
    for (const [index, feature] of t.features.entries()) {
      const tab = page.getByRole('tab', { name: feature.label, exact: true });
      await expect(tab).toBeFocused();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#workflow-view h3')).toHaveText(feature.title);
      await expect(page.locator('#workflow-view')).toContainText(feature.detail);
      if (index < t.features.length - 1) await page.keyboard.press('ArrowRight');
    }
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: first.label, exact: true })).toBeFocused();

    // How it works: each step can be chosen directly.
    for (const step of t.howSteps) {
      const button = page.locator('#how').getByRole('button', { name: step.title });
      await button.click();
      await expect(button).toHaveAttribute('aria-current', 'step');
    }

    // Questions open and show their answer.
    const question = t.faq[0];
    if (question === undefined) throw new Error('No questions');
    await page.getByText(question.q, { exact: true }).click();
    await expect(page.getByText(question.a, { exact: true })).toBeVisible();

    await expectAccessible(page);
    await expectNoOverflow(page);
    expect(errors).toEqual([]);
    if (locale === 'en') await capture(page, 'en-desktop.png');
  });

  test(`${locale}: the live illustration answers "call next" and can be paused (S-C-01, WCAG 2.2.2)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${locale}`);
    await page.getByRole('button', { name: t.live.pause }).click();
    await expect(page.getByRole('button', { name: t.live.play })).toBeVisible();
    const serving = page.locator('.chamber-serial');
    const before = (await serving.textContent()) ?? '';
    await page.getByRole('button', { name: t.live.tryIt }).click();
    await expect(serving).not.toHaveText(before);
    // Paused means paused: nothing moves on its own.
    await page.waitForTimeout(800);
    const after = (await serving.textContent()) ?? '';
    await page.waitForTimeout(3200);
    await expect(serving).toHaveText(after);
    await expect(page.locator('#live-description')).toHaveText(t.live.description);
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
    await nav.locator('a[href="#faq"]').click();
    await expect(nav).toBeHidden();
    await expect(page).toHaveURL(/#faq$/);
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
    await expect(page).toHaveURL(new RegExp(`/${target}#faq$`));
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
      marquee: getComputedStyle(document.querySelector('.modules-track') ?? heading).animationName,
      leading: Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize),
      spacing: style.letterSpacing,
    };
  });
  expect(styles.scroll).toBe('auto');
  expect(styles.pulse).toBe('none');
  expect(styles.marquee).toBe('none');
  expect(styles.leading).toBeGreaterThanOrEqual(1.35);
  expect(styles.spacing).toBe('normal');
  // The illustration still answers a press; it just does not move by itself.
  const serving = page.locator('.chamber-serial');
  const before = (await serving.textContent()) ?? '';
  await page.waitForTimeout(3000);
  await expect(serving).toHaveText(before);
  await page.getByRole('button', { name: copy.bn.live.tryIt }).click();
  await expect(serving).not.toHaveText(before);
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
}

test('product screens load in both languages and say they are demonstration data', async ({
  page,
}) => {
  for (const locale of ['bn', 'en'] as const) {
    await page.goto(`/${locale}`);
    const patient = page.locator('#patients img');
    await patient.scrollIntoViewIfNeeded();
    await expect(patient).toHaveAttribute('alt', copy[locale].patientAlt);
    await expect
      .poll(() => patient.evaluate((element: HTMLImageElement) => element.naturalWidth))
      .toBeGreaterThan(0);
    for (const feature of copy[locale].features) {
      await page.getByRole('tab', { name: feature.label, exact: true }).click();
      // The outgoing screen fades while the new one arrives; wait for the hand-over.
      await expect(page.locator('#workflow-view img')).toHaveCount(1);
      const image = page.locator('#workflow-view img');
      await expect(image).toHaveAttribute('alt', feature.alt);
      expect(feature.alt).toMatch(/demonstration data|ডেমো তথ্য/);
      await expect
        .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
        .toBeGreaterThan(0);
    }
  }
});
