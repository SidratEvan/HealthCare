/**
 * The payment provider seam (BACKEND.md §0, §1: `adapters/payments/`).
 *
 * ## `PAYMENT_PROVIDER=mock` is the implementation, not a placeholder
 *
 * CLAUDE.md §1.1 says it outright: the mock "always succeeds", and that is
 * what the demo runs on. There are no bKash or Nagad merchant credentials to
 * talk to until there is a signed hospital to arrange them with, and a
 * half-integrated gateway with no keys would be worse than an honest mock
 * that records every charge.
 *
 * So the seam is the point. `charge` and `refund` return the same shapes
 * whatever is behind them, `payment.service` records those shapes, and
 * swapping in a real aggregator is a new file and an environment variable —
 * not a change to anything that decides *whether* to charge.
 *
 * It is refused in production (`env.ts`), as `STORAGE_PROVIDER=mock` is.
 *
 * ## What is never logged
 *
 * CLAUDE.md §7: never log payment references. A `providerRef` identifies a
 * real transaction against a real person's wallet, so it is recorded on the
 * `payments` row and never written to a log line — the structured field
 * beside a payment log carries the payment's own id, which is ours.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { logger } from '../../config/logger.js';
import { env } from '../../env.js';

/** What a provider is asked to take. */
export interface ChargeRequest {
  /** Our payment row's id — the correlation key, safe to log. */
  readonly paymentId: string;
  readonly amountPoisha: number;
  /** `FR-PAY-06`: the provider must refuse a second charge under this key. */
  readonly idempotencyKey: string;
  /** Where the provider sends the patient back to, for a redirect flow. */
  readonly returnUrl: string;
}

/**
 * What it reports back.
 *
 * `redirectUrl` is how a real provider works — the patient leaves for bKash
 * and comes back — and is null for the mock, which settles inline. A caller
 * has to handle both, because the shape of the demo and the shape of
 * production differ here in a way no adapter can hide.
 */
export type ChargeResult =
  | {
      readonly ok: true;
      readonly providerRef: string;
      /** True when the money moved now; false when the patient must go and pay. */
      readonly settled: boolean;
      readonly redirectUrl: string | null;
    }
  | { readonly ok: false; readonly error: string };

export interface RefundRequest {
  readonly paymentId: string;
  readonly providerRef: string;
  readonly amountPoisha: number;
  readonly idempotencyKey: string;
}

export type RefundResult =
  | { readonly ok: true; readonly providerRef: string }
  | { readonly ok: false; readonly error: string };

export interface PaymentProvider {
  readonly name: string;
  charge(request: ChargeRequest): Promise<ChargeResult>;
  refund(request: RefundRequest): Promise<RefundResult>;
  /**
   * Whether a callback really came from this provider.
   *
   * Every real provider signs its webhooks, and a webhook that is trusted
   * without checking is an endpoint anybody can use to mark a payment paid.
   */
  verifyWebhook(rawBody: string, signature: string | undefined): boolean;
}

/**
 * Settles every charge, immediately.
 *
 * Always succeeds, like `SMS_PROVIDER=log`. A provider that failed at random
 * would make the demo unreliable to no benefit: the failure path is exercised
 * by `payment.routes.test.ts` with an adapter that refuses, which is a better
 * test than a dice roll in production code.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  private readonly charged = new Map<string, string>();

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    // `FR-PAY-06` at the adapter as well as the database: a replayed key gets
    // the reference it got the first time, never a second transaction.
    const existing = this.charged.get(request.idempotencyKey);
    const providerRef = existing ?? `mock_${randomUUID()}`;
    this.charged.set(request.idempotencyKey, providerRef);

    // The payment's own id, never the provider reference (CLAUDE.md §7).
    logger.info(
      { paymentId: request.paymentId, amountPoisha: request.amountPoisha, provider: 'mock' },
      existing === undefined ? 'payment charged' : 'payment charge replayed',
    );

    return await Promise.resolve({ ok: true, providerRef, settled: true, redirectUrl: null });
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    logger.info(
      { paymentId: request.paymentId, amountPoisha: request.amountPoisha, provider: 'mock' },
      'payment refunded',
    );
    return await Promise.resolve({ ok: true, providerRef: `mock_refund_${randomUUID()}` });
  }

  /**
   * Signed with `JWT_ACCESS_SECRET`, the same trust root the mock file store
   * uses — so a webhook test exercises a real signature check rather than a
   * branch that returns true.
   */
  verifyWebhook(rawBody: string, signature: string | undefined): boolean {
    if (signature === undefined || signature === '') return false;

    const expected = Buffer.from(
      createHmac('sha256', env.JWT_ACCESS_SECRET).update(rawBody).digest('hex'),
    );
    const presented = Buffer.from(signature);

    // Length first: timingSafeEqual throws on a mismatch, and the length of a
    // signature is not a secret.
    return expected.length === presented.length && timingSafeEqual(expected, presented);
  }
}

/** The signature the mock expects, for tests and for the demo's own webhook. */
export function mockWebhookSignature(rawBody: string): string {
  return createHmac('sha256', env.JWT_ACCESS_SECRET).update(rawBody).digest('hex');
}

/**
 * Refuses everything, with the reason.
 *
 * `PAYMENT_PROVIDER=live` names bKash and Nagad, which need merchant
 * credentials this repository does not hold. Rather than construct a client
 * that throws on first use — at the moment a patient taps pay — this fails
 * the charge with a named reason the route turns into an error somebody can
 * read. The same honesty `UnconfiguredSmsAdapter` has.
 */
export class UnconfiguredPaymentProvider implements PaymentProvider {
  readonly name = 'unconfigured';

  async charge(): Promise<ChargeResult> {
    return await Promise.resolve({ ok: false, error: 'no_payment_provider_configured' });
  }

  async refund(): Promise<RefundResult> {
    return await Promise.resolve({ ok: false, error: 'no_payment_provider_configured' });
  }

  verifyWebhook(): boolean {
    // Nothing configured means no key to verify against, so nothing is
    // trusted. Failing closed is the only safe answer for an endpoint that
    // marks money as received.
    return false;
  }
}

let current: PaymentProvider | null = null;

/** The provider this process charges through. */
export function payments(): PaymentProvider {
  current ??=
    env.PAYMENT_PROVIDER === 'mock' ? new MockPaymentProvider() : new UnconfiguredPaymentProvider();
  return current;
}

/** Replaces it. Called by tests; nothing in production calls this. */
export function setPaymentProvider(provider: PaymentProvider): void {
  current = provider;
}

/** Restores the environment's choice. */
export function resetPaymentProvider(): PaymentProvider {
  current = null;
  return payments();
}
