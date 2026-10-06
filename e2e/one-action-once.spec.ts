/**
 * One action, shown once (`BACKEND.md` `SY-08`, `FRONTEND.md` §11.1).
 *
 * The server states the result of a console's tap by two roads: the answer to
 * the request, and a broadcast on the socket. They are two connections, and
 * either can be the first, or never come. `offline-console.spec.ts` holds the
 * socket and proves the answer alone is enough. These hold the other road:
 *
 * - the answer is held, so the broadcast is first;
 * - the answer is lost, so the broadcast is all there is;
 * - the answer is lost and the broadcast was missed, so the catch-up after a
 *   reconnect is all there is.
 *
 * In each the action is on screen once from the tap onwards, and in the log
 * once. Before `applied` and `unanswered` existed, the first drew a declared
 * thirty minutes as sixty until the answer came, and the last two waited on a
 * push that might never get through.
 *
 * On one machine the broadcast usually beats the answer anyway (the answer
 * waits for messages to be sent), which is why the routes below hold the
 * answer outright instead of hoping for an order.
 */

import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';

import { createConsoleSession, eventTypes, type ConsoleSession } from './support/console.js';
import { putReceptionistInTab } from './support/consoleSession.js';

const SYNC = '**/sync/events';

let demo: ConsoleSession;

test.beforeEach(async () => {
  demo = await createConsoleSession(6);
});

async function openReception(page: Page): Promise<void> {
  await putReceptionistInTab(page, demo);
  await page.goto(`/?session=${demo.sessionId}`);
  await expect(page.getByTestId('queue-table')).toBeVisible();
  await expect(page.getByTestId('offline-block')).toHaveAttribute('data-connected', 'true', {
    timeout: 30_000,
  });
}

async function openDoctor(page: Page): Promise<void> {
  await page.addInitScript(
    ([token, hospitalId]) => {
      sessionStorage.setItem(
        'console.demo-session',
        JSON.stringify({ token, hospitalId, staffName: 'Doctor (Demo)', role: 'doctor' }),
      );
    },
    [demo.doctorToken, demo.hospitalId],
  );
  await page.goto(`/?session=${demo.sessionId}`);
  await expect(page.getByRole('button', { name: 'দেরি ঘোষণা' })).toBeVisible();
  await expect(page.getByTestId('offline-block')).toHaveAttribute('data-connected', 'true', {
    timeout: 30_000,
  });
}

test.describe('one action, shown once (SY-08)', () => {
  test('the broadcast arrives before the answer: thirty minutes is thirty, never sixty', async ({
    page,
  }) => {
    await openDoctor(page);

    // The answer to the push is held at a gate. The server has taken the
    // action and broadcast it; only the console's own request is unanswered.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(SYNC, async (route) => {
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response });
    });

    // Every delay the header shows from here on, in order.
    await page.evaluate(() => {
      const read = (): string =>
        /দেরিতে চলছে · ([০-৯]+)/.exec(document.body.textContent)?.[1] ?? '';
      const shown: string[] = [];
      new MutationObserver(() => {
        const now = read();
        if (now !== '' && now !== shown[shown.length - 1]) shown.push(now);
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
      (globalThis as unknown as { delays: string[] }).delays = shown;
    });
    const delays = async (): Promise<string[]> =>
      await page.evaluate(() => (globalThis as unknown as { delays: string[] }).delays);

    await page.getByRole('button', { name: 'দেরি ঘোষণা' }).click();

    // The server has it, and has said so on the socket.
    await expect.poll(async () => (await eventTypes(demo.sessionId)).at(-1)).toBe('DELAY_DECLARED');
    await expect(page.getByText('দেরিতে চলছে · ৩০ মিনিট')).toBeVisible();

    // The broadcast named the action, so the console is waiting for nothing,
    // though its request is still unanswered.
    await expect(page.getByTestId('pending-count')).toBeHidden();
    expect(await delays()).toEqual(['৩০']);

    // The answer arrives late and changes nothing.
    const answered = page.waitForResponse((response) => response.url().endsWith('/sync/events'));
    release();
    await answered;
    await expect(page.getByText('দেরিতে চলছে · ৩০ মিনিট')).toBeVisible();
    expect(await delays()).toEqual(['৩০']);

    // One declaration, in the log once.
    expect(
      (await eventTypes(demo.sessionId)).filter((type) => type === 'DELAY_DECLARED'),
    ).toHaveLength(1);
  });

  test('the answer is lost: the broadcast settles the tap, and nothing is sent twice', async ({
    page,
  }) => {
    await openReception(page);
    await expect(page.getByTestId('now-serving')).toHaveText('১');

    // The first push reaches the server and its answer never comes back.
    let pushes = 0;
    await page.route(SYNC, async (route) => {
      pushes += 1;
      if (pushes === 1) {
        await route.fetch();
        await route.abort('failed');
        return;
      }
      await route.continue();
    });

    await page.getByTestId('call-next').click();

    await expect(page.getByTestId('now-serving')).toHaveText('২');
    // Named by the broadcast: nothing is waiting to be sent.
    await expect(page.getByTestId('pending-count')).toBeHidden();

    // Past the first retry (one second): the console had nothing to resend.
    await page.waitForTimeout(3_000);
    expect(pushes).toBe(1);
    expect((await eventTypes(demo.sessionId)).slice(-2)).toEqual([
      'PATIENT_DONE',
      'PATIENT_CALLED',
    ]);
    await expect(page.getByTestId('now-serving')).toHaveText('২');
  });

  test('reconnecting with a tap unanswered: the catch-up names it, and it is drawn once', async ({
    page,
  }) => {
    // Everything the server says on the socket is held, then dropped.
    let held = false;
    let current: WebSocketRoute | null = null;
    await page.routeWebSocket(/socket\.io/, (socket) => {
      current = socket;
      const server = socket.connectToServer();
      socket.onMessage((message) => {
        server.send(message);
      });
      server.onMessage((message) => {
        if (!held) socket.send(message);
      });
    });

    await openReception(page);
    await expect(page.getByTestId('now-serving')).toHaveText('১');
    const before = (await eventTypes(demo.sessionId)).length;

    // The first push reaches the server and is never answered; after it the
    // server cannot be reached by a push at all. Only the socket is left.
    let pushes = 0;
    await page.route(SYNC, async (route) => {
      pushes += 1;
      if (pushes === 1) await route.fetch();
      await route.abort('failed');
    });

    held = true;
    await page.getByTestId('call-next').click();

    // The server took the tap. The console has heard nothing: no answer, and
    // the broadcast was dropped. It still shows its own drawing, and waits.
    await expect.poll(async () => (await eventTypes(demo.sessionId)).length).toBe(before + 2);
    await expect(page.getByTestId('now-serving')).toHaveText('২');
    await expect(page.getByTestId('pending-count')).toBeVisible();

    // The connection drops and comes back. The console says which actions it
    // is still waiting on, and the catch-up names them.
    held = false;
    await (current as WebSocketRoute | null)?.close();

    await expect(page.getByTestId('pending-count')).toBeHidden({ timeout: 30_000 });
    await expect(page.getByTestId('now-serving')).toHaveText('২');

    // Once in the log, whatever the console went on trying to send.
    expect((await eventTypes(demo.sessionId)).slice(before)).toEqual([
      'PATIENT_DONE',
      'PATIENT_CALLED',
    ]);
  });
});
