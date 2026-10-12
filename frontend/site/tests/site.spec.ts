import { expect, test } from '@playwright/test';
import axe from 'axe-core';

import { contactEmail, copy, demoHref, patientAppHref } from '../src/content/copy';
import { founders } from '../src/content/founders';

import type { Page } from '@playwright/test';
import type { AxeResults } from 'axe-core';

/*
 * The company site as built for Cloudflare Pages (`SITE_EXPORT=1`), served
 * from `out/` (S-C-01–05, GR-06, FR-SEC-08). Redesign of 12 October 2026.
 */

async function jump(page: Page, top: number): Promise<void> {
  await page.evaluate((y) => {
    window.scrollTo({ top: y, behavior: 'instant' });
  }, top);
  await page.waitForTimeout(500);
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
const other = (locale: 'bn' | 'en'): 'bn' | 'en' => (locale === 'en' ? 'bn' : 'en');

test('static routes, Bangla entrance and security (S-C-01, GR-06)', async ({ request }) => {
  const entrance = await request.get('/', { maxRedirects: 0 });
  expect([302, 307]).toContain(entrance.status());
  expect(entrance.headers()['location']).toBe('/bn');
  for (const locale of ['en', 'bn']) {
    for (const path of ['', '/hospitals', '/about', '/privacy', '/credits']) {
      const response = await request.get(`/${locale}${path}`);
      expect(response.status(), `/${locale}${path}`).toBe(200);
      expect(await response.text()).toContain(`<html lang="${locale}"`);
      expect(response.headers()['x-content-type-options']).toBe('nosniff');
      expect(response.headers()['x-frame-options']).toBe('DENY');
      expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    }
  }
  const sitemap = await (await request.get('/sitemap.xml')).text();
  for (const path of ['/bn/hospitals', '/en/about']) expect(sitemap).toContain(path);
  expect(sitemap).not.toContain('/founders');
  expect((await request.get('/unsupported')).status()).toBe(404);
});

for (const locale of ['en', 'bn'] as const) {
  const t = copy[locale];

  test(`${locale}: homepage story, destinations, images and browser errors`, async ({ page }) => {
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
    await expect(page).toHaveTitle(t.title);
    await expect(page.locator('h1')).toHaveText(t.hero.title.map((p) => p.text).join(''));
    for (const [id, title] of [
      ['#idea', t.idea.statement],
      ['#hospitals', t.forHospitals.title],
      ['#patients', t.forPatients.title],
      ['#bangladesh', t.vision.title],
      ['#people', founders[locale].heading],
      ['#contact', t.closing.title],
    ] as const)
      await expect(page.locator(`${id} h2`)).toHaveAccessibleName(title);
    await expect(page.locator('#bangladesh')).toContainText(t.vision.note);
    await expect(page.locator('#patients')).toContainText(t.demoNotice);

    // Every Request a Demo is the same real destination.
    const demos = page.getByRole('link', { name: t.demo });
    expect(await demos.count()).toBeGreaterThanOrEqual(4);
    for (const link of await demos.all()) await expect(link).toHaveAttribute('href', demoHref);

    // Nothing scrolls: the only in-page links are the skip link and back-to-top.
    const hashes = await page
      .locator('a[href^="#"]')
      .evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect([...new Set(hashes)].sort()).toEqual(['#main', '#top']);

    // The staff console is never linked; the patient app only ever as itself, in a new tab.
    const outbound = await page
      .locator('a')
      .evaluateAll((links: HTMLAnchorElement[]) =>
        links
          .filter((a) => /vercel|onrender|console/.test(a.href))
          .map((a) => ({ href: a.href.replace(/\/$/, ''), target: a.target, rel: a.rel })),
      );
    expect(outbound.length).toBeGreaterThanOrEqual(4);
    for (const link of outbound)
      expect(link).toEqual({ href: patientAppHref, target: '_blank', rel: 'noopener noreferrer' });
    expect(await page.locator('form, iframe').count()).toBe(0);

    // Each photograph once, the hero first and eager.
    const images = page.locator('main picture img');
    expect(await images.count()).toBe(4);
    const sources = await images.evaluateAll((list) =>
      list.map((i) => (i as HTMLImageElement).src.replace(/^.*\/campaign\/([a-z]+)-.*$/, '$1')),
    );
    expect(sources).toEqual(['hero', 'team', 'patient', 'atmosphere']);
    for (const [index, image] of (await images.all()).entries()) {
      await expect(image).toHaveAttribute('loading', index === 0 ? 'eager' : 'lazy');
      await expect(image).toHaveAttribute('alt', /.+/);
      await image.scrollIntoViewIfNeeded();
      await expect
        .poll(() => image.evaluate((i: HTMLImageElement) => i.naturalWidth))
        .toBeGreaterThan(0);
    }
    await expect(images.first()).toHaveAttribute('fetchpriority', 'high');
    await expect(page.locator('.footer-base p')).toHaveText(t.footer.synthetic);
    await noOverflow(page);
    expect(errors).toEqual([]);
    expect(foreign).toEqual([]);
  });

  test(`${locale}: For Hospitals and For Patients are real links to their destinations`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${locale}`);
    const doors = page.locator('.hero-doors a');
    await expect(doors).toHaveCount(2);
    await expect(doors.nth(0)).toContainText(t.hero.hospitals);
    await expect(doors.nth(0)).toContainText(t.hero.hospitalsSub);
    await expect(doors.nth(0)).toHaveAttribute('href', `/${locale}/hospitals`);
    await expect(doors.nth(1)).toContainText(t.hero.patients);
    await expect(doors.nth(1)).toContainText(t.hero.patientsSub);
    await expect(doors.nth(1)).toHaveAttribute('href', patientAppHref);
    await expect(doors.nth(1).locator('.demo-tag')).toBeVisible();
    for (const door of await doors.all()) await expect(door).toBeInViewport();
    await expect(page.locator('.hero-note')).toHaveText(t.demoNotice);
    const nav = page.locator('.primary-nav');
    await expect(nav.locator(`a[href="/${locale}/hospitals"]`)).toHaveText(t.nav.hospitals);
    await expect(nav.locator(`a[href="${patientAppHref}"]`)).toContainText(t.nav.patients);
    await expect(nav.locator(`a[href="/${locale}/about"]`)).toHaveText(t.nav.about);
    await expect(page.locator('#hospitals a[data-door="hospitals"]')).toHaveAttribute(
      'href',
      `/${locale}/hospitals`,
    );
    await expect(page.locator('#patients a[data-door="patients"]')).toHaveAttribute(
      'href',
      patientAppHref,
    );
    // Keyboard: both doors are reachable and show their focus.
    await doors.nth(0).focus();
    await page.keyboard.press('Tab');
    await expect(doors.nth(1)).toBeFocused();
    expect(await doors.nth(1).evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
    // For Hospitals opens its page; For Patients opens the app in a new tab.
    await doors.nth(0).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/hospitals$`));
    await expect(page.locator('h1')).toHaveText(t.hospitalsPage.heading);
    await page.goBack();
    const [tab] = await Promise.all([
      page.context().waitForEvent('page'),
      page.locator('.hero-doors a').nth(1).click(),
    ]);
    await tab.waitForLoadState('domcontentloaded');
    expect(tab.url().replace(/\/$/, '')).toBe(patientAppHref);
    await tab.close();
  });

  test(`${locale}: hospitals page — case, demo request, no console link`, async ({ page }) => {
    const h = t.hospitalsPage;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${locale}/hospitals`);
    await expect(page).toHaveTitle(h.title);
    await expect(page.locator('h1')).toHaveText(h.heading);
    for (const [title] of [...h.capabilities, ...h.steps, ...h.trust])
      await expect(page.locator('main')).toContainText(title);
    for (const link of await page.locator('main').getByRole('link', { name: t.demo }).all())
      await expect(link).toHaveAttribute('href', demoHref);
    await expect(page.locator('.primary-nav a[aria-current="page"]')).toHaveAttribute(
      'href',
      `/${locale}/hospitals`,
    );
    await expect(page.locator('.header-bar .lang-switch a')).toHaveAttribute(
      'href',
      `/${other(locale)}/hospitals`,
    );
    expect(await page.locator('a[href*="console"], a[href*="onrender"]').count()).toBe(0);
    await accessible(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await noOverflow(page);
  });

  test(`${locale}: about page — founders, emails and phones only`, async ({ page }) => {
    const f = founders[locale];
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/${locale}/about`);
    await expect(page.locator('h1')).toHaveText(f.heading);
    for (const person of f.founders) {
      await expect(page.getByRole('heading', { name: person.name })).toBeVisible();
      await expect(page.locator(`a[href="tel:${person.phone}"]`)).toHaveText(person.phoneDisplay);
    }
    for (const person of f.founders)
      await expect(page.locator(`main a[href="mailto:${person.email}"]`)).toHaveText(person.email);
    await expect(page.locator('main')).toContainText(contactEmail);
    await accessible(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await noOverflow(page);
  });

  test(`${locale}: axe desktop and mobile, menu, keyboard and language`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`/${locale}`);
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();
    await accessible(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const toggle = page.locator('.menu-toggle'),
      menu = page.locator('#mobile-menu');
    await toggle.click();
    await expect(menu).toBeVisible();
    await expect(menu.locator(`a[href="/${locale}/hospitals"]`)).toBeVisible();
    await expect(menu.locator(`a[href="${patientAppHref}"]`)).toHaveAttribute('target', '_blank');
    await expect(menu.locator(`a[href="/${locale}/about"]`)).toBeVisible();
    await accessible(page);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(toggle).toBeFocused();
    await accessible(page);
    await page.locator('.site-header .header-bar .lang-switch a').click();
    await expect(page).toHaveURL(new RegExp(`/${other(locale)}$`));
    await expect(page.locator('html')).toHaveAttribute('lang', other(locale));
    await toggle.click();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(menu).toBeHidden();
    await expect(page.locator('.primary-nav')).toBeVisible();
  });

  for (const [width, height] of [
    [390, 844],
    [768, 1024],
  ] as const) {
    // toBeVisible() passes for a 1px panel; measure it and tap where a finger would.
    test(`${locale}: mobile menu panel is usable at ${String(width)}px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/${locale}`);
      await page.locator('.menu-toggle').click();
      const menu = page.locator('#mobile-menu');
      await expect(menu).toBeVisible();
      await page.waitForTimeout(500);
      const panel = await menu.boundingBox();
      const header = await page.locator('.header-bar').boundingBox();
      expect(panel?.y).toBeCloseTo((header?.y ?? 0) + (header?.height ?? 0), 0);
      expect((panel?.y ?? 0) + (panel?.height ?? 0)).toBeGreaterThanOrEqual(height - 1);
      const links = menu.locator('a');
      expect(await links.count()).toBeGreaterThanOrEqual(5);
      for (const link of await links.all()) {
        await link.scrollIntoViewIfNeeded();
        const hit = await link.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return top !== null && el.contains(top);
        });
        expect(hit, (await link.getAttribute('href')) ?? '').toBe(true);
      }
      const about = menu.locator(`a[href="/${locale}/about"]`);
      await about.scrollIntoViewIfNeeded();
      const box = await about.boundingBox();
      await page.mouse.click(
        (box?.x ?? 0) + (box?.width ?? 0) / 2,
        (box?.y ?? 0) + (box?.height ?? 0) / 2,
      );
      await expect(page).toHaveURL(new RegExp(`/${locale}/about$`));
    });
  }

  for (const [width, height] of [
    [360, 740],
    [390, 844],
    [768, 1024],
    [1024, 768],
    [1440, 900],
  ] as const) {
    test(`${locale}: responsive ${String(width)}px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/${locale}`);
      await noOverflow(page);
      await expect(page.locator('.site-header .logo')).toBeVisible();
      // Both doors on the first screen, easy to tap, nothing clipped.
      for (const door of await page.locator('.hero-doors a').all()) {
        await expect(door).toBeInViewport({ ratio: 1 });
        expect((await door.boundingBox())?.height).toBeGreaterThanOrEqual(56);
        expect(await door.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
      }
      for (const selector of [
        'h1',
        '.door-title',
        '.section-head',
        '.spread-copy',
        '.vision-copy',
        '.closing-inner',
      ])
        for (const el of await page.locator(selector).all())
          expect(await el.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
      if (locale === 'bn') {
        // TYP-01: display ≥ 1.35, reading text ≥ 1.65, never letter-spaced.
        for (const [selector, min] of [
          ['h1', 1.35],
          ['#hospitals-title', 1.35],
          ['.hero-lead', 1.65],
          ['.hero-note', 1.65],
          ['.capabilities-row p', 1.65],
        ] as const) {
          const s = await page
            .locator(selector)
            .first()
            .evaluate((el) => {
              const x = getComputedStyle(el);
              return {
                leading: parseFloat(x.lineHeight) / parseFloat(x.fontSize),
                spacing: x.letterSpacing,
              };
            });
          expect(s.leading, selector).toBeGreaterThanOrEqual(min - 0.01);
          expect(['normal', '0px']).toContain(s.spacing);
        }
      }
    });
  }

  test(`${locale}: privacy and credits`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const path of ['privacy', 'credits'] as const) {
      await page.goto(`/${locale}/${path}`);
      await expect(page.locator('h1')).toHaveText(
        path === 'privacy' ? t.privacyTitle : t.creditsTitle,
      );
      await expect(page.locator('.header-bar .lang-switch a')).toHaveAttribute(
        'href',
        `/${other(locale)}/${path}`,
      );
      await accessible(page);
      if (path === 'credits') {
        await expect(page.locator('main')).toContainText(t.assetsIntro);
        expect(await page.locator('.credit-list img').count()).toBe(5);
        await expect(page.locator('main')).toContainText('CC0 1.0');
      } else await expect(page.locator('main')).toContainText(contactEmail);
      await page.setViewportSize({ width: 360, height: 800 });
      await noOverflow(page);
      await page.setViewportSize({ width: 1280, height: 800 });
    }
  });
}

test('scroll lights the idea, draws the connection and the map, and undoes it in reverse', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/en');
  const word = page.locator('.idea-word').last();
  const ink = page.locator('.motif-rail-right .motif-ink');
  const opacity = (): Promise<number> =>
    word.evaluate((el) => Number(getComputedStyle(el).opacity));
  const scaleX = (): Promise<number> =>
    ink.evaluate((el) => {
      const m = getComputedStyle(el).transform;
      return m === 'none' ? 1 : Number(m.replace('matrix(', '').split(',')[0]);
    });
  expect(await opacity()).toBeLessThan(0.3);
  expect(await scaleX()).toBeLessThan(0.05);
  const idea = await topOf(page, '#idea');
  await jump(page, idea + 500);
  expect(await opacity()).toBeGreaterThan(0.95);
  expect(await scaleX()).toBeGreaterThan(0.95);
  await jump(page, 0);
  expect(await opacity()).toBeLessThan(0.3);
  expect(await scaleX()).toBeLessThan(0.05);

  // The map holds on screen while it draws (sticky, not hijacked), then lets go.
  await expect(page.locator('#bangladesh')).toHaveAttribute('data-pinned', 'true');
  const map = await topOf(page, '#bangladesh');
  const spoke = page.locator('.map-spoke').last();
  const drawn = (): Promise<number> =>
    spoke.evaluate((el) => parseFloat(getComputedStyle(el).strokeDasharray.split(',')[0] ?? '0'));
  await jump(page, map);
  const early = await drawn();
  const stage = (): Promise<number> =>
    page.locator('.vision-stage').evaluate((el) => el.getBoundingClientRect().top);
  expect(Math.abs(await stage())).toBeLessThan(2);
  await jump(page, map + 1300);
  expect(Math.abs(await stage())).toBeLessThan(2);
  const late = await drawn();
  expect(late).toBeGreaterThan(early);
  await jump(page, map);
  expect(await drawn()).toBeLessThan(late);

  // The hero photograph eases back as the page leaves it.
  await jump(page, 0);
  const still = await page.locator('.hero-media').evaluate((el) => getComputedStyle(el).transform);
  await jump(page, 500);
  expect(
    await page.locator('.hero-media').evaluate((el) => getComputedStyle(el).transform),
  ).not.toBe(still);

  // On a phone nothing is pinned.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#bangladesh')).toHaveAttribute('data-pinned', 'false');
  await noOverflow(page);
});

test('reduced motion: everything complete and still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/bn');
  await expect(page.locator('#bangladesh')).toHaveAttribute('data-pinned', 'false');
  expect(
    await page
      .locator('.idea-word')
      .first()
      .evaluate((el) => getComputedStyle(el).opacity),
  ).toBe('1');
  expect(
    await page
      .locator('.map-spoke')
      .first()
      .evaluate((el) => getComputedStyle(el).strokeDasharray),
  ).toBe('none');
  expect(
    await page.locator('.hero-media img').evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none');
  await accessible(page);
});

test('no JavaScript: the whole story, both doors and contact in static HTML', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/en');
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('.hero-doors a')).toHaveCount(2);
  for (const heading of await page.locator('main h2, main h3').all())
    await expect(heading).toBeVisible();
  expect(
    await page
      .locator('.idea-word')
      .first()
      .evaluate((el) => getComputedStyle(el).opacity),
  ).toBe('1');
  await expect(page.locator('#contact').getByRole('link', { name: contactEmail })).toHaveAttribute(
    'href',
    `mailto:${contactEmail}`,
  );
  await page.goto('/en/hospitals');
  await expect(page.locator('.hp-grid li')).toHaveCount(6);
  await context.close();
});
