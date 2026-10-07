/**
 * The SMS adapter (BACKEND.md §0: "Aggregator behind an adapter interface").
 *
 * ## `SMS_PROVIDER=log` is the implementation, not a placeholder
 *
 * CLAUDE.md §1.1 is explicit about this: the log provider "writes to the
 * console and the notifications table", and that is what the demo runs on.
 * There is no Bangladeshi SMS aggregator to talk to until there is a signed
 * hospital to arrange one with, and a half-integrated gateway with no
 * credentials would be worse than an honest one that records everything.
 *
 * So the seam is the point. `send` returns the same shape whatever is behind
 * it, the service records that shape, and swapping in a real aggregator is a
 * new file and an environment variable — not a change to anything that
 * decides *whether* to send.
 *
 * ## What the log provider writes, and what it does not
 *
 * One structured line per message: which notification, which template, how
 * many segments. Never the number and never the text.
 *
 * CLAUDE.md §7: never log patient identifiers, OTPs or tokens — and an SMS is
 * all three at once. It is addressed to a patient's phone, it names their
 * serial, and a booking's carries a tracking link that is a credential
 * (`FR-GST-05`). This provider used to print both with `console.log`, on the
 * reasoning that the terminal was the demo's handset. But `log` is also what a
 * hospital's own server runs until an aggregator exists (`DEPLOY.md` Part S),
 * and there the same line put working links and phone numbers into container
 * logs — kept, rotated and backed up, and past the logger's redaction, which
 * `console.log` never goes through (`docs/HANDOVER.md` §12 item 11).
 *
 * What a message said is in its `notifications` row, with the link left out
 * (`notification.service` `forTheRecord`). A demonstration reads its link from
 * the booking screen, which is where a patient reads it too.
 *
 * It keeps nothing either. A test that wants to read what was sent uses an
 * adapter of its own (`__tests__/support/recordingSms.ts`); a process that
 * runs for months must not hold every message it has handed over.
 */

import { logger } from '../config/logger.js';
import { env } from '../env.js';

/** What an SMS provider is asked to do. */
export interface SmsMessage {
  /** Normalised `+8801…` (`DB-P6`). */
  readonly to: string;
  readonly body: string;
  /** The notification row this belongs to, for correlation. */
  readonly notificationId: string;
  readonly templateKey: string;
  /**
   * The body holds a secret — a sign-in code (pilot step 25). Sent as written.
   * No provider may print or log any body (CLAUDE.md §7); this marks the ones
   * a provider must not keep for its own debugging or delivery reports either.
   */
  readonly sensitive?: boolean;
}

/** What it reports back. Recorded verbatim onto the notification row. */
export type SmsResult =
  | { readonly ok: true; readonly providerRef: string; readonly costPoisha: number }
  | {
      readonly ok: false;
      readonly error: string;
      /**
       * False where asking again cannot help: the number does not exist, the
       * sender is barred. Absent means it may (`shared/domain`
       * `messaging/sending`): a gateway that is down is the ordinary failure.
       */
      readonly retryable?: boolean;
    };

export interface SmsAdapter {
  readonly name: string;
  send(message: SmsMessage): Promise<SmsResult>;
}

/**
 * What one SMS costs, in poisha.
 *
 * A placeholder figure until an aggregator quotes one, and it is recorded per
 * message so `FR-NOT-06`'s budget reporting has something to sum. Bangla is
 * UCS-2, so a message over 70 characters is billed as two — which is why
 * `templates.test.ts` counts characters.
 */
const POISHA_PER_SEGMENT = 35;
const UCS2_SEGMENT = 70;

export function segmentsFor(body: string): number {
  return Math.max(1, Math.ceil(body.length / UCS2_SEGMENT));
}

/**
 * Records that a message was handed over, and reports success.
 *
 * Always succeeds, like `PAYMENT_PROVIDER=mock`. A provider that randomly
 * failed would make the demo unreliable to no benefit: the failure path is
 * exercised by `notifications.test.ts` with an adapter that refuses, which is
 * a better test than a dice roll in production code.
 */
export class LogSmsAdapter implements SmsAdapter {
  readonly name = 'log';

  async send(message: SmsMessage): Promise<SmsResult> {
    const segments = segmentsFor(message.body);

    // Which message, never whose or what: no number, no text (see the top of
    // this file). The words are in the notification row this id names.
    logger.info(
      {
        notificationId: message.notificationId,
        templateKey: message.templateKey,
        channel: 'sms',
        segments,
      },
      'sms recorded, not sent: SMS_PROVIDER=log has no aggregator behind it',
    );

    return await Promise.resolve({
      ok: true,
      providerRef: `log:${message.notificationId}`,
      costPoisha: segments * POISHA_PER_SEGMENT,
    });
  }
}

/**
 * Refuses everything, with the reason the environment gives.
 *
 * `SMS_PROVIDER=local` names a real aggregator that does not exist yet. Rather
 * than pretend, this records a failure the notification row can carry — which
 * is the honest state and keeps the outbox's `queued` rows meaningful for a
 * retry once the provider arrives.
 */
export class UnconfiguredSmsAdapter implements SmsAdapter {
  readonly name = 'unconfigured';

  async send(): Promise<SmsResult> {
    return await Promise.resolve({
      ok: false,
      error: 'no_sms_provider_configured',
    });
  }
}

let current: SmsAdapter | null = null;

/** The adapter this process sends through. */
export function sms(): SmsAdapter {
  current ??= env.SMS_PROVIDER === 'log' ? new LogSmsAdapter() : new UnconfiguredSmsAdapter();
  return current;
}

/** Replaces it. Called by tests; nothing in production calls this. */
export function setSmsAdapter(adapter: SmsAdapter): void {
  current = adapter;
}

/** Restores the environment's choice. */
export function resetSmsAdapter(): SmsAdapter {
  current = null;
  return sms();
}
