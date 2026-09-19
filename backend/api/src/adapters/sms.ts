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
 * ## What is never logged
 *
 * CLAUDE.md §7: never log patient identifiers, OTPs, tokens or payment
 * references. An SMS body contains a person's serial and, for a booking, a
 * tracking link that is a credential (`FR-GST-05`). So the log provider prints
 * the body — that is its whole job, it is the demo's only delivery channel —
 * but the *structured* log line beside it carries the template key and the
 * message id and nothing else. A log aggregator ingests the structured field;
 * the printed body stays on a developer's terminal.
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
}

/** What it reports back. Recorded verbatim onto the notification row. */
export type SmsResult =
  | { readonly ok: true; readonly providerRef: string; readonly costPoisha: number }
  | { readonly ok: false; readonly error: string };

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
 * Writes the message to the log and reports success.
 *
 * Always succeeds, like `PAYMENT_PROVIDER=mock`. A provider that randomly
 * failed would make the demo unreliable to no benefit: the failure path is
 * exercised by `notifications.test.ts` with an adapter that refuses, which is
 * a better test than a dice roll in production code.
 */
export class LogSmsAdapter implements SmsAdapter {
  readonly name = 'log';

  private readonly sent: SmsMessage[] = [];

  async send(message: SmsMessage): Promise<SmsResult> {
    this.sent.push(message);

    // The body goes to stdout, unstructured, because in this version the
    // terminal *is* the recipient's handset — a demo operator reads the
    // message here. The structured line below carries no content.
    // eslint-disable-next-line no-console -- the log provider's entire purpose (CLAUDE.md §1.1)
    console.log(`\n  SMS → ${message.to}\n  ${message.body}\n`);

    logger.info(
      { notificationId: message.notificationId, templateKey: message.templateKey, channel: 'sms' },
      'sms dispatched',
    );

    return await Promise.resolve({
      ok: true,
      providerRef: `log:${message.notificationId}`,
      costPoisha: segmentsFor(message.body) * POISHA_PER_SEGMENT,
    });
  }

  /** Everything this adapter was asked to send. For tests. */
  all(): readonly SmsMessage[] {
    return this.sent;
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
