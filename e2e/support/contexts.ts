/**
 * Closing the second devices a test opened.
 *
 * The browser belongs to the worker, not the test, and there is one worker
 * (`playwright.config.ts`), so a context made with `browser.newContext()` —
 * the patient's phone, the ward's screen, the other ER — lives until the whole
 * run ends unless the test closes it. Left open, its page keeps its socket and
 * its polling: an ER console asks for emergency search every few seconds, a
 * standby page every five. By the last twenty specs of a full run dozens of
 * them were loading the API, the console took seventeen seconds to open, the
 * API went six seconds without answering, and whichever spec came next failed
 * — the canary one run, standby and the wallet the next.
 *
 * So every spec that opens a second device closes whatever it left open after
 * each test, keeping only the test's own context for Playwright to close
 * (and to save the trace and video from).
 */

import type { Browser, BrowserContext } from '@playwright/test';

export async function closeOtherContexts(browser: Browser, keep: BrowserContext): Promise<void> {
  for (const opened of browser.contexts()) {
    if (opened !== keep) await opened.close();
  }
}
