/**
 * Provider callbacks (BACKEND.md §7.7: `POST /webhooks/bkash | /nagad`).
 *
 * ## No authentication, and no trust either
 *
 * A payment provider has no token of ours. What it has is a shared secret it
 * signs each callback with, so the signature *is* the authentication — and an
 * endpoint that marks money as received without checking one is an endpoint
 * anybody on the internet can use to mark a booking paid.
 *
 * Every adapter implements `verifyWebhook`, the unconfigured one returns
 * false, and a callback that fails the check gets a 401 and changes nothing.
 * The **raw body** is what is signed. `express.json()` consumes the stream
 * before any route sees it, so the bytes are captured by its own `verify`
 * hook in `app.ts` and read here — a re-serialisation of the parsed object is
 * not byte-identical to what the provider signed, and would fail every
 * genuine callback.
 *
 * ## Idempotent, because providers retry
 *
 * Every provider re-sends a callback it did not get a 2xx for, often several
 * times, sometimes days later. `applyProviderCallback` finds the payment by
 * its reference and does nothing to one already settled — and this answers
 * 200 either way, because a 4xx would make the provider keep retrying
 * something that has already happened.
 */

import { logger } from '../config/logger.js';
import { rawBodyOf } from '../config/rawBody.js';
import * as notifications from '../services/notification.service.js';
import * as paymentService from '../services/payment.service.js';

import type { Request, Response } from 'express';

/** The statuses that mean the money moved, across both providers' vocabularies. */
const PAID_STATUSES = new Set(['success', 'completed', 'paid', 'settled']);

/**
 * One handler for both providers.
 *
 * bKash and Nagad differ in what they sign and what they call a status, and
 * both of those live in the adapter. What is the same is the shape of the
 * decision — is this really them, which payment, did it work — and that is
 * this function.
 */
export function callback(providerName: 'bkash' | 'nagad') {
  return async (req: Request, res: Response): Promise<void> => {
    // The bytes as sent — see `config/rawBody.ts`. Never
    // `JSON.stringify(req.body)`: a re-serialisation does not reproduce a
    // provider's whitespace or key order, so it would fail every signature
    // that is actually valid.
    const raw = rawBodyOf(req) ?? '';
    const signature = req.get('x-signature');

    if (!paymentService.verifyProviderSignature(raw, signature)) {
      // Never says why. A caller probing for the difference between "bad
      // signature" and "unknown payment" learns which references are real.
      logger.warn({ provider: providerName }, 'webhook signature rejected');
      res.status(401).json({
        ok: false,
        error: { code: 'AUTH_TOKEN_INVALID', message: 'Signature is not valid.' },
      });
      return;
    }

    const body = safeJson(raw);
    const providerRef = readString(body, 'providerRef');
    const status = readString(body, 'status');

    if (providerRef === null || status === null) {
      res.status(400).json({
        ok: false,
        error: { code: 'VALIDATION_FAILED', message: 'Unrecognised callback body.' },
      });
      return;
    }

    const result = await paymentService.applyProviderCallback({
      providerRef,
      paid: PAID_STATUSES.has(status.toLowerCase()),
    });

    // 200 whether or not anything changed — see the header.
    res.json({ ok: true, data: { applied: result.applied } });
  };
}

/**
 * `POST /webhooks/sms-dlr` — an aggregator's delivery receipt (`FR-NOT-06`,
 * plan H2).
 *
 * The same shape as a payment callback and for the same reasons: the
 * signature over the bytes as sent is the authentication, and a receipt that
 * fails it gets a 401 and changes nothing; the provider's vocabulary is the
 * adapter's to read; and a receipt already recorded, or for a message this
 * system does not know, still answers 200, because a 4xx makes an aggregator
 * send it again for days.
 *
 * What a forged receipt could do, if it were believed, is tell a hospital
 * its messages arrived when they did not, or the reverse. Nobody's record is
 * opened by it and no money moves; it is refused all the same.
 */
export async function smsDelivery(req: Request, res: Response): Promise<void> {
  const raw = rawBodyOf(req) ?? '';

  if (!notifications.verifyReceiptSignature(raw, req.get('x-signature'))) {
    logger.warn({ provider: 'sms' }, 'delivery receipt signature rejected');
    res.status(401).json({
      ok: false,
      error: { code: 'AUTH_TOKEN_INVALID', message: 'Signature is not valid.' },
    });
    return;
  }

  const result = await notifications.applyDeliveryReceipt(safeJson(raw));
  if (!result.recognised) {
    res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'Unrecognised receipt body.' },
    });
    return;
  }

  // 200 whether or not anything changed — see above.
  res.json({ ok: true, data: { applied: result.applied } });
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * One field out of a provider's callback.
 *
 * Read by hand rather than through a schema, deliberately: a provider's shape
 * is theirs, and rejecting a body because they added a field next quarter
 * would fail every callback until somebody noticed. What is required is the
 * two things this API acts on — which transaction, and what happened to it.
 */
function readString(body: unknown, key: string): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' || trimmed.length > 200 ? null : trimmed;
}
