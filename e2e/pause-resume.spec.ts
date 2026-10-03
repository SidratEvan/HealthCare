/**
 * `e2e/pause-resume.spec.ts` — a chamber paused from the console is resumed
 * from the console (`FR-REC-05`, `BTN-B02-PAUSE`).
 *
 * The handover audit of 2 October found a Pause button and no way back: one
 * tap froze a chamber until somebody called the API by hand, and nothing in
 * the suite pressed either. `APP_FLOW.md` B1.2 always said "resume with the
 * same button"; this is that sentence, in a browser, on two devices — because
 * a break is something the waiting patient has to be told about as well.
 */

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { createConsoleSession, eventTypes, type ConsoleSession } from './support/console.js';
import { bookAsGuest, openLiveSerial } from './support/patient.js';

let demo: ConsoleSession;

test.beforeEach(async () => {
  // Its own session: `queue_events` is append-only (CLAUDE.md §6).
  demo = await createConsoleSession(8);
});

async function openConsole(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();

  // The same store `ConsolePicker` writes (CLAUDE.md §4.1).
  await page.addInitScript((token: string) => {
    window.sessionStorage.setItem(
      'console.demo-session',
      JSON.stringify({ token, hospitalId: 'e2e', staffName: 'E2E' }),
    );
  }, demo.token);

  await page.goto(`http://localhost:3100/?session=${demo.sessionId}`);
  await expect(page.getByTestId('queue-table')).toBeVisible();
  return page;
}

test.describe('pausing and resuming a chamber (FR-REC-05)', () => {
  test('reception pauses, both screens say so, and the same button starts it again', async ({
    browser,
  }) => {
    const counter = await browser.newContext();
    const corridor = await browser.newContext();

    try {
      const bookingPage = await corridor.newPage();
      const trackingUrl = await bookAsGuest(bookingPage, demo);
      await bookingPage.close();

      const patient = await openLiveSerial(corridor, trackingUrl);
      const console_ = await openConsole(counter);

      // Serial 1 is in the chamber when the fixture opens.
      await expect(patient.getByTestId('now-serving')).toHaveText('১');

      await console_.getByTestId('pause-session').click();

      // The counter is told, across the screen, and the control that would be
      // refused is off with its reason rather than left to fail.
      await expect(console_.getByTestId('paused-banner')).toBeVisible();
      await expect(console_.getByTestId('call-next')).toBeDisabled();
      await expect(console_.getByTestId('call-next')).toHaveAttribute(
        'title',
        'বিরতি চলছে। আগে আবার শুরু করুন।',
      );
      // And so is the corridor.
      await expect(patient.getByTestId('live-serial-status')).toHaveText('চেম্বারে বিরতি চলছে');

      // The way back that did not exist.
      await console_.getByTestId('resume-session').click();

      await expect(console_.getByTestId('paused-banner')).toBeHidden();
      await expect(console_.getByTestId('pause-session')).toBeEnabled();
      await expect(patient.getByTestId('live-serial-status')).not.toHaveText('চেম্বারে বিরতি চলছে');

      // The chamber really is running again: the next patient is called and
      // the phone in the corridor sees it.
      await console_.getByTestId('call-next').click();
      await expect(console_.getByTestId('now-serving')).toHaveText('২');
      await expect(patient.getByTestId('now-serving')).toHaveText('২');

      // In the log, in order, with nothing refused along the way.
      await expect
        .poll(async () => (await eventTypes(demo.sessionId)).slice(-4))
        .toEqual(['SESSION_PAUSED', 'SESSION_RESUMED', 'PATIENT_DONE', 'PATIENT_CALLED']);
    } finally {
      await counter.close();
      await corridor.close();
    }
  });

  test('P pauses and resumes, and N during a break says why nothing happened (B1.2)', async ({
    browser,
  }) => {
    const counter = await browser.newContext();

    try {
      const console_ = await openConsole(counter);
      await expect(console_.getByTestId('now-serving')).toHaveText('১');

      await console_.keyboard.press('p');
      await expect(console_.getByTestId('paused-banner')).toBeVisible();

      // The key reaches the same refusal the button shows, in words — not a
      // call sent to be rolled back as though another counter had got there.
      await console_.keyboard.press('n');
      // The toast is read out as well as shown, so its words are on the page twice.
      await expect(console_.getByText('বিরতি চলছে। আগে আবার শুরু করুন।').first()).toBeVisible();
      await expect(console_.getByTestId('now-serving')).toHaveText('১');

      await console_.keyboard.press('p');
      await expect(console_.getByTestId('paused-banner')).toBeHidden();

      await console_.keyboard.press('n');
      await expect(console_.getByTestId('now-serving')).toHaveText('২');

      // Nothing was written for the refused call.
      await expect
        .poll(async () => (await eventTypes(demo.sessionId)).slice(-4))
        .toEqual(['SESSION_PAUSED', 'SESSION_RESUMED', 'PATIENT_DONE', 'PATIENT_CALLED']);
    } finally {
      await counter.close();
    }
  });
});
