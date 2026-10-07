/**
 * The notification sender (`PRD.md` `FR-NOT-06`, `FR-NOT-07`; `BACKEND.md` §8
 * `notify.send`, `notify.retry`; plan H1).
 *
 * Sending used to happen inside the request that caused the message: a
 * receptionist's *next* waited for a gateway, a gateway that refused once was
 * never asked again, and a message held for quiet hours was never sent in the
 * morning. Now a request writes its messages in its own transaction, as it
 * always did, hands them here once it has committed, and answers. This sends
 * them, tries again when a gateway fails, and gives up where trying further
 * would only deliver a message too late to be true
 * (`shared/domain` `messaging/sending`).
 *
 * ## It works from the table, not from what it was handed
 *
 * Every send starts by taking rows that are due (`claimDue`: `FOR UPDATE SKIP
 * LOCKED`, with a two-minute claim). So two processes never send one message;
 * a row a dead process left is sent by the next one; and a message due at
 * seven in the morning is sent at seven by whoever is running then. What it
 * is handed is only the full text of messages this process has just written,
 * kept in memory so that the first try, and the retries of the next twenty
 * minutes, go out with the link they were written with.
 *
 * ## A row has no link
 *
 * A link is a credential and is never stored (0035). A message sent from its
 * row alone has a fresh one issued (`messageLink.service`); where none can
 * be, it is failed, visibly, and not sent with a hole in it.
 *
 * ## Never in a request's scope
 *
 * The first send is woken by a request, and `AsyncLocalStorage` would carry
 * that request's database scope into everything this does next, which is
 * other hospitals' messages. It runs as `system`, the server's own work
 * (`config/dbScope.ts`), whoever woke it.
 *
 * ## At least once
 *
 * A sender that dies after the gateway took a message and before the row was
 * marked sends it again when the claim runs out. A patient told twice that
 * their serial is called is the cheaper mistake than one never told.
 */

import { SEND_CLAIM_SECONDS, afterFailedSend, type Timestamp } from '@platform/domain';

import { push } from '../adapters/push.js';
import { sms } from '../adapters/sms.js';
import { runInDbScope } from '../config/dbScope.js';
import { logger } from '../config/logger.js';
import * as notificationRepo from '../repositories/notification.repo.js';

import { reissueLink } from './messageLink.service.js';

/** One message as it leaves: the words in full, link and all. */
export interface Outgoing {
  readonly id: string;
  readonly channel: 'sms' | 'push';
  readonly to: string | null;
  readonly body: string;
  readonly templateKey: string;
  readonly recipient: notificationRepo.Recipient;
}

/** How often the sender looks for work nobody woke it for: a retry, a morning. */
export const SENDER_TICK_MS = 5_000;

/** Rows taken at a time. A slow gateway holds up this many, not the table. */
const CLAIM_BATCH = 20;

/**
 * How long a message's full text is kept in memory. Longer than the whole
 * retry schedule; after it, a row still unsent is sent from the row.
 */
const KEEP_IN_MEMORY_MS = 30 * 60_000;

const inMemory = new Map<string, { readonly message: Outgoing; readonly since: number }>();

let running: Promise<void> | null = null;
let wokenMeanwhile = false;

/**
 * Takes the messages a request has just committed, and starts sending.
 *
 * Returns at once. Nothing a request does waits for a gateway.
 */
export function hand(messages: readonly Outgoing[]): void {
  if (messages.length === 0) return;
  const since = Date.now();
  for (const message of messages) inMemory.set(message.id, { message, since });
  wake();
}

/** Starts a pass over what is due, unless one is running, in which case it runs once more after. */
export function wake(): void {
  if (running !== null) {
    wokenMeanwhile = true;
    return;
  }
  running = runInDbScope({ kind: 'system' }, drain)
    .catch((error: unknown) => {
      logger.error({ err: error }, 'notification sender failed; the next tick tries again');
    })
    .finally(() => {
      running = null;
      if (wokenMeanwhile) {
        wokenMeanwhile = false;
        wake();
      }
    });
}

/**
 * Resolves when nothing is being sent and nothing was asked for meanwhile.
 *
 * For a shutdown, which lets a send in progress finish, and for a test, which
 * has to know that what a call caused has happened before it reads the table.
 * A message due later (a retry, a morning) is not waited for.
 */
export async function idle(): Promise<void> {
  while (running !== null) await running;
}

/** Looks for work on an interval. Returns what stops it. */
export function startSender(): () => void {
  wake();
  const timer = setInterval(wake, SENDER_TICK_MS);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}

async function drain(): Promise<void> {
  forgetOld();
  for (;;) {
    const claimed = await notificationRepo.claimDue(CLAIM_BATCH, SEND_CLAIM_SECONDS);
    if (claimed.length === 0) return;
    for (const row of claimed) await sendOne(row);
  }
}

function forgetOld(): void {
  const before = Date.now() - KEEP_IN_MEMORY_MS;
  for (const [id, held] of inMemory) {
    if (held.since < before) inMemory.delete(id);
  }
}

type Outcome =
  | { readonly kind: 'sent'; readonly providerRef: string; readonly costPoisha: number | null }
  /** A decision, not a failure: nowhere to send it. Not tried again. */
  | { readonly kind: 'skipped'; readonly reason: string }
  | { readonly kind: 'failed'; readonly error: string; readonly retryable: boolean };

async function sendOne(row: notificationRepo.ClaimedRow): Promise<void> {
  let outcome: Outcome;
  try {
    const message = inMemory.get(row.id)?.message ?? (await fromRow(row));
    outcome =
      typeof message === 'string'
        ? { kind: 'failed', error: message, retryable: false }
        : await attempt(message);
  } catch (error: unknown) {
    logger.error(
      { err: error, notificationId: row.id, templateKey: row.templateKey },
      'sending a notification threw',
    );
    outcome = { kind: 'failed', error: 'dispatch_threw', retryable: true };
  }

  try {
    if (outcome.kind === 'sent') {
      await notificationRepo.markSent(row.id, outcome);
    } else if (outcome.kind === 'skipped') {
      await notificationRepo.markNotSent(row.id, 'skipped', outcome.reason);
    } else {
      const next = afterFailedSend({
        attempts: row.attempts,
        now: new Date().toISOString() as Timestamp,
        retryable: outcome.retryable,
      });
      if (next.kind === 'retry') {
        await notificationRepo.retryAt(row.id, new Date(next.at), outcome.error);
        // Its words stay in memory for the next try.
        return;
      }
      await notificationRepo.markNotSent(row.id, 'failed', outcome.error);
      logger.warn(
        { notificationId: row.id, templateKey: row.templateKey, attempts: row.attempts },
        'notification given up on',
      );
    }
    inMemory.delete(row.id);
  } catch (error: unknown) {
    // The row keeps its claim and is offered again when that runs out.
    logger.error({ err: error, notificationId: row.id }, 'recording a send failed');
  }
}

/**
 * The message as the row can give it: the kept words, with a fresh link where
 * one went. A string is why it cannot be sent.
 */
async function fromRow(row: notificationRepo.ClaimedRow): Promise<Outgoing | string> {
  const kept = row.params['body'];
  // Cleared after ninety days (DATABASE.md §8). Nothing that old is still due.
  if (typeof kept !== 'string' || kept === '') return 'words_not_kept';

  let body = kept;
  if (kept.includes('{link}')) {
    const link = await reissueLink(row.params, row.phone);
    if (link === null) return 'link_unavailable';
    body = kept.split('{link}').join(link);
  }

  return {
    id: row.id,
    channel: row.channel,
    to: row.channel === 'sms' ? row.phone : null,
    body,
    templateKey: row.templateKey,
    recipient: row.recipient,
  };
}

async function attempt(message: Outgoing): Promise<Outcome> {
  if (message.channel === 'sms') {
    if (message.to === null) return { kind: 'skipped', reason: 'no_phone_number' };

    const result = await sms().send({
      to: message.to,
      body: message.body,
      notificationId: message.id,
      templateKey: message.templateKey,
    });
    return result.ok
      ? { kind: 'sent', providerRef: result.providerRef, costPoisha: result.costPoisha }
      : { kind: 'failed', error: result.error, retryable: result.retryable ?? true };
  }

  const tokens = await notificationRepo.deviceTokensFor(message.recipient);
  const result = await push().send({
    tokens,
    body: message.body,
    notificationId: message.id,
    templateKey: message.templateKey,
    url: null,
  });
  if (result.ok) return { kind: 'sent', providerRef: result.providerRef, costPoisha: null };

  // A recipient with no registered device is not a failure to retry; it is a
  // person who has not installed the app.
  return result.error === 'no_device_token'
    ? { kind: 'skipped', reason: result.error }
    : { kind: 'failed', error: result.error, retryable: true };
}

/** Forgets everything held in memory. For a test that stands in for a restart. */
export function forgetInMemory(): void {
  inMemory.clear();
}
