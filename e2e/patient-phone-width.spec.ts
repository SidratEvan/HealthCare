/**
 * `e2e/patient-phone-width.spec.ts` — no patient screen scrolls sideways on a
 * phone (`FR-LOC-07`: usable one-handed; `FRONTEND.md`: layouts at phone width).
 *
 * Found by the guidebook capture of 10 November 2026: the bed search was
 * 600 px wide on a 390 px phone, because its row of bed types sat in a
 * `<fieldset>`, whose minimum width is its content's. The row is meant to
 * scroll inside itself, as the search page's does; the page never should.
 */

import { expect, test } from '@playwright/test';

const PATIENT = 'http://localhost:3000';

const SCREENS = [
  '/',
  '/search',
  '/book?specialty=CARD',
  '/emergency',
  '/emergency/results?problem=burn',
  '/beds',
  '/medicines',
  '/records',
  '/serials',
  '/profile',
];

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test.describe('the patient app at phone width (FR-LOC-07)', () => {
  for (const path of SCREENS) {
    test(`${path} is no wider than the phone`, async ({ page }) => {
      await page.goto(`${PATIENT}${path}`);
      await expect(page.getByTestId('bottom-nav')).toBeVisible();
      await page.waitForLoadState('networkidle');
      const width = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth,
        screen: window.innerWidth,
      }));
      expect(width.page).toBeLessThanOrEqual(390);
      expect(width.screen).toBe(390);
    });
  }
});
