/**
 * The pages run under their script policy as built (plan I2d; `NFR-08`).
 *
 * Each page's Content-Security-Policy allows only the scripts carrying the
 * nonce minted for it (`src/proxy.ts`). In development the policy also allows
 * React's refresh to evaluate code, so the browser suite against the dev
 * servers cannot say whether a built page would be refused something. This
 * one opens the apps as a hospital's server runs them and asks the browser.
 *
 * `security-headers.spec.ts` proves an injected handler does not run; this
 * proves the product's own scripts do.
 */

import { expect, test } from '@playwright/test';

const PATIENT = 'http://localhost:3000';
const CONSOLE = 'http://localhost:3100';

const PATIENT_PAGES = [
  '/',
  '/search',
  '/book',
  '/emergency',
  '/beds',
  '/medicines',
  '/records',
  '/serials',
  '/profile',
];

test('the patient app and the console run their own scripts and nothing is refused', async ({
  page,
}) => {
  const refused: string[] = [];
  const thrown: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) refused.push(message.text());
  });
  page.on('pageerror', (error) => {
    thrown.push(error.message);
  });

  for (const path of PATIENT_PAGES) {
    const response = await page.goto(`${PATIENT}${path}`);
    expect(response?.headers()['content-security-policy'], path).toContain("'nonce-");
    expect(response?.headers()['content-security-policy'], path).not.toContain('unsafe-eval');
    await page.waitForLoadState('networkidle');
    // Hydrated: the bottom navigation is drawn by the app, not the server.
    await expect(page.getByTestId('bottom-nav'), path).toBeVisible();
  }

  // The console as a hospital's server runs it: the sign-in screen.
  await page.goto(CONSOLE);
  await expect(page.getByTestId('login-email')).toBeVisible();
  await page.getByTestId('login-email').fill('nobody@example.invalid');
  await expect(page.getByTestId('login-email')).toHaveValue('nobody@example.invalid');

  expect(refused).toEqual([]);
  expect(thrown).toEqual([]);
});
