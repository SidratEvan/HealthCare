/**
 * An SMS aggregator reached over HTTPS (`SMS_PROVIDER=http`; `PRD.md`
 * `FR-NOT-06`; `BACKEND.md` §0, §7.7; plan H2).
 *
 * The adapter the pilot's messages will leave through, built before there is
 * an account to send with (`CLAUDE.md` §1.1), and proven against a stand-in
 * aggregator in `smsDelivery.test.ts`. **No real aggregator's wire format is
 * claimed here.** Each one names its fields its own way, and none has been
 * chosen (`docs/PLATFORM_PLAN.md` X1). What this fixes is everything that
 * does not depend on which one it is:
 *
 * - a message goes out once, with a time limit, and the answer says whether
 *   asking again could help (`retryable`), which is what the sender's retry
 *   schedule reads (`shared/domain` `messaging/sending`);
 * - a delivery receipt is believed only with a valid signature over the
 *   bytes as sent, and is read into three outcomes whatever the aggregator
 *   calls them;
 * - nothing here prints or keeps a number or a text (`CLAUDE.md` §7).
 *
 * The request and the receipt it speaks are written in `DEPLOY.md` (*SMS*).
 * An aggregator that speaks otherwise gets a file of its own beside this
 * one, implementing the same four members; nothing that calls an adapter
 * changes.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '../env.js';

import {
  POISHA_PER_SEGMENT,
  segmentsFor,
  type SmsAdapter,
  type SmsMessage,
  type SmsReceipt,
  type SmsResult,
} from './sms.js';

/** How long the aggregator is given to answer. The sender tries again after. */
export const SMS_SEND_TIMEOUT_MS = 10_000;

/** What an aggregator says for "it reached the handset", in the words they use. */
const DELIVERED = new Set(['delivered', 'delivrd', 'success', 'successful']);

/** And for "it will not". Anything else is not final and is waited on. */
const FAILED = new Set(['failed', 'undelivered', 'undeliv', 'rejected', 'rejectd', 'expired']);

/** Statuses that say the request itself was wrong: asking again cannot help. */
const NOT_WORTH_RETRYING = (status: number): boolean =>
  status >= 400 && status < 500 && status !== 408 && status !== 429;

/** What an aggregator gives a deployment: where, with what key, as whom, and its receipts' secret. */
export interface HttpSmsConfig {
  readonly url: string;
  readonly apiKey: string;
  readonly senderId: string;
  readonly receiptSecret: string;
  readonly timeoutMs: number;
}

function fromEnvironment(): HttpSmsConfig {
  return {
    url: env.SMS_API_URL,
    apiKey: env.SMS_API_KEY,
    senderId: env.SMS_SENDER_ID,
    receiptSecret: env.SMS_DLR_SECRET,
    timeoutMs: SMS_SEND_TIMEOUT_MS,
  };
}

export class HttpSmsAdapter implements SmsAdapter {
  readonly name = 'http';
  readonly reportsDelivery = true;

  /** The environment's, unless a test stands an aggregator of its own up. */
  constructor(private readonly config: HttpSmsConfig = fromEnvironment()) {}

  async send(message: SmsMessage): Promise<SmsResult> {
    let response: Response;
    try {
      response = await fetch(this.config.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          to: message.to,
          text: message.body,
          senderId: this.config.senderId,
          // Ours, so that the aggregator's answer and its receipt can be
          // matched to the row even where it mints an id of its own.
          reference: message.notificationId,
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error: unknown) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      return { ok: false, error: timedOut ? 'gateway_timeout' : 'gateway_unreachable' };
    }

    if (!response.ok) {
      return {
        ok: false,
        error: `gateway_http_${String(response.status)}`,
        retryable: !NOT_WORTH_RETRYING(response.status),
      };
    }

    const id = readId(await response.json().catch(() => null));
    // Taken, but with nothing to match a receipt by. Sent is still true.
    return {
      ok: true,
      providerRef: id ?? `http:${message.notificationId}`,
      costPoisha: segmentsFor(message.body) * POISHA_PER_SEGMENT,
    };
  }

  /**
   * Whether a receipt is the aggregator's: HMAC-SHA256 of the bytes as sent,
   * hex, under `SMS_DLR_SECRET`. Fails closed where no secret is set, as the
   * payment adapters do: an endpoint that changes what a hospital is told
   * about its messages does not believe a caller it cannot check.
   */
  verifyReceipt(rawBody: string, signature: string | undefined): boolean {
    const secret = this.config.receiptSecret;
    if (secret === '' || signature === undefined || signature === '') return false;

    const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'));
    const presented = Buffer.from(signature);
    // Length first: timingSafeEqual throws on a mismatch, and the length of a
    // signature is not a secret.
    return expected.length === presented.length && timingSafeEqual(expected, presented);
  }

  readReceipt(body: unknown): SmsReceipt | null {
    if (typeof body !== 'object' || body === null) return null;
    const fields = body as Record<string, unknown>;

    const providerRef = readId(body);
    const status =
      typeof fields['status'] === 'string' ? fields['status'].trim().toLowerCase() : '';
    if (providerRef === null || status === '') return null;

    const reason = typeof fields['reason'] === 'string' ? fields['reason'].trim() : '';
    return {
      providerRef,
      outcome: DELIVERED.has(status) ? 'delivered' : FAILED.has(status) ? 'failed' : 'pending',
      reason: reason === '' ? null : reason,
    };
  }
}

/** The signature the stand-in aggregator sends, for tests. */
export function httpReceiptSignature(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

function readId(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)['id'];
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id === '' || id.length > 200 ? null : id;
}
