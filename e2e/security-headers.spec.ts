/**
 * The headers every page and every API answer carries (plan A7; `NFR-08`;
 * handover finding 22).
 *
 * Asked of the running servers, not of the configuration: a header that is
 * declared and not sent protects nobody. The pages are then opened, because a
 * policy that is sent and breaks the screen is worse than none.
 */

import { expect, test } from '@playwright/test';

const PATIENT = 'http://localhost:3000';
const CONSOLE = 'http://localhost:3100';
const API = 'http://localhost:4000';

test.describe('security headers (NFR-08)', () => {
  for (const [name, origin, geolocation] of [
    ['the patient app', PATIENT, 'geolocation=(self)'],
    ['the console', CONSOLE, 'geolocation=()'],
  ] as const) {
    test(`${name} sends them on its pages`, async ({ request }) => {
      const response = await request.get(origin);
      expect(response.ok()).toBe(true);
      const headers = response.headers();

      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['x-frame-options']).toBe('DENY');
      expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(headers['strict-transport-security']).toContain('max-age=');
      expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(headers['content-security-policy']).toContain("object-src 'none'");
      // What each app may ask the device for, and nothing else.
      expect(headers['permissions-policy']).toContain(geolocation);
      expect(headers['permissions-policy']).toContain('camera=()');
      expect(headers['x-powered-by']).toBeUndefined();
    });
  }

  for (const [name, origin] of [
    ['the patient app', PATIENT],
    ['the console', CONSOLE],
  ] as const) {
    test(`${name} lets a page run only the scripts it was given a nonce for (plan I2d)`, async ({
      request,
      page,
    }) => {
      const nonceOf = (header: string | undefined): string | null =>
        /'nonce-([^']+)'/.exec(header ?? '')?.[1] ?? null;

      const first = nonceOf((await request.get(origin)).headers()['content-security-policy']);
      const second = nonceOf((await request.get(origin)).headers()['content-security-policy']);
      expect(first).not.toBeNull();
      // A new one for every page: a nonce that repeats is one an attacker can copy.
      expect(second).not.toBe(first);

      const response = await page.goto(origin);
      const nonce = nonceOf(response?.headers()['content-security-policy']);
      expect(response?.headers()['content-security-policy']).toContain("'strict-dynamic'");
      // Every script Next wrote into the page's text carries it. A chunk one of
      // those loads later is trusted through it ('strict-dynamic') and has none.
      // (An empty one, which runs nothing, is left out.)
      const inline = await page
        .locator('script:not([src])')
        .evaluateAll((elements) =>
          elements
            .filter((element) => (element.textContent ?? '').trim() !== '')
            .map((element) => (element as HTMLScriptElement).nonce),
        );
      expect(inline.length).toBeGreaterThan(0);
      for (const given of inline) expect(given).toBe(nonce);

      // And what an injection looks like — markup with a handler in it, the
      // way text that was never escaped gets in — does not run.
      const ran = await page.evaluate(async () => {
        const marker = `__injected_${String(Date.now())}`;
        const holder = document.createElement('div');
        holder.innerHTML = `<img src="/no-such-image-${marker}" onerror="window['${marker}'] = true">`;
        document.body.appendChild(holder);
        await new Promise((resolve) => setTimeout(resolve, 500));
        return (window as unknown as Record<string, unknown>)[marker] === true;
      });
      expect(ran).toBe(false);
    });
  }

  test('the API sends them on an answer, and leaves nothing to be cached by default', async ({
    request,
  }) => {
    const response = await request.get(`${API}/api/v1/hospitals`);
    expect(response.ok()).toBe(true);
    const headers = response.headers();

    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['content-security-policy']).toContain("default-src 'none'");
    expect(headers['cache-control']).toBe('no-store');
  });

  test('the pages still work under them, with nothing refused by the policy', async ({ page }) => {
    const refused: string[] = [];
    page.on('console', (message) => {
      if (/Content Security Policy|Refused to/i.test(message.text())) refused.push(message.text());
    });

    await page.goto(PATIENT);
    await expect(page.getByTestId('app-name')).toBeVisible();
    await page.getByTestId('home-search').click();
    await expect(page).toHaveURL(/\/search/);

    await page.goto(CONSOLE);
    await expect(page.getByTestId('console-picker')).toBeVisible();

    expect(refused).toEqual([]);
  });
});
