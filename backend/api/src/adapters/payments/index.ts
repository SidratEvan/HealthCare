/**
 * The payment provider seam (BACKEND.md §0, §1, §8: `adapters/payments/`).
 *
 * ## `PAYMENT_PROVIDER=mock` is the implementation, not a placeholder
 *
 * CLAUDE.md §1.1 says it outright: the mock "always succeeds", and that is
 * what the demo runs on. There are no bKash or Nagad merchant credentials to
 * talk to until there is a signed hospital to arrange them with.
 *
 * So the seam is the point. `charge`, `confirm` and `refund` return the same
 * shapes whatever is behind them, `payment.service` records those shapes, and
 * switching on a real provider is its settings — not a change to anything
 * that decides *whether* to charge.
 *
 * ## Four members (plan H3)
 *
 * - `charge` begins: the provider's id for the attempt, whether money moved on
 *   the spot, and where the patient goes to pay.
 * - `confirm` asks the provider, server to server, what became of an attempt.
 *   **This is the only way a payment becomes paid** (`FR-PAY-09`): a browser
 *   returning with "success" in its address proves nothing.
 * - `refund` returns money through the provider, given the provider's own
 *   references; `refundsByApi` false means it cannot, and the refund is
 *   recorded by hand (`FR-PAY-12`).
 * - `verifyWebhook`, for a provider that signs callbacks. Only the mock's
 *   own test hook uses it; neither bKash's checkout nor Nagad's sends one.
 *
 * ## What is never logged
 *
 * CLAUDE.md §7: never log payment references. A checkout id or a provider
 * reference identifies a real transaction against a real person's wallet, so
 * they are written on the `payments` row and never to a log line.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import type { PaymentMethod } from '@platform/domain';

import { logger } from '../../config/logger.js';
import { env } from '../../env.js';

import { BkashProvider, bkashConfigured } from './bkash.js';
import { NagadProvider, nagadConfigured } from './nagad.js';

/** What a provider is asked to take. */
export interface ChargeRequest {
  /** Our payment row's id — the correlation key, safe to log. */
  readonly paymentId: string;
  readonly amountPoisha: number;
  /** `FR-PAY-06`: the provider must refuse a second charge under this key. */
  readonly idempotencyKey: string;
  /** Where the provider sends the patient back to (`S-A-07p`). */
  readonly returnUrl: string;
}

/**
 * What it reports back.
 *
 * `checkoutId` is the provider's name for the attempt (bKash's `paymentID`,
 * Nagad's `paymentReferenceId`); `providerRef` is the reference for money that
 * moved, known only when it settled on the spot.
 */
export type ChargeResult =
  | {
      readonly ok: true;
      readonly checkoutId: string;
      readonly providerRef: string | null;
      /** True when the money moved now; false when the patient must go and pay. */
      readonly settled: boolean;
      readonly redirectUrl: string | null;
    }
  | { readonly ok: false; readonly error: string };

/** What the patient's return said, which chooses only how to ask. */
export type ReturnHint = 'success' | 'failure' | 'cancel';

export interface ConfirmRequest {
  readonly paymentId: string;
  readonly checkoutId: string;
  readonly amountPoisha: number;
  readonly hint: ReturnHint | null;
}

/**
 * What the provider says became of an attempt.
 *
 * `unreachable` is not `failed`: a provider we could not ask has said nothing,
 * and the payment stays as it was until it is asked again.
 */
export type ConfirmResult =
  | { readonly status: 'paid'; readonly providerRef: string; readonly amountPoisha: number }
  | { readonly status: 'pending' }
  | { readonly status: 'failed'; readonly reason: 'declined' | 'cancelled' }
  | { readonly status: 'unreachable'; readonly error: string };

export interface RefundRequest {
  readonly paymentId: string;
  readonly checkoutId: string | null;
  readonly providerRef: string | null;
  readonly amountPoisha: number;
  readonly idempotencyKey: string;
  readonly reason: string;
}

export type RefundResult =
  | { readonly ok: true; readonly providerRef: string }
  | { readonly ok: false; readonly error: string };

export interface PaymentProvider {
  readonly name: string;
  /** False where money goes back only by hand (`FR-PAY-12`). */
  readonly refundsByApi: boolean;
  charge(request: ChargeRequest): Promise<ChargeResult>;
  confirm(request: ConfirmRequest): Promise<ConfirmResult>;
  refund(request: RefundRequest): Promise<RefundResult>;
  /**
   * Whether a callback really came from this provider. Fails closed for a
   * provider that sends none: an endpoint that marks money received must
   * never trust what it cannot check.
   */
  verifyWebhook(rawBody: string, signature: string | undefined): boolean;
}

/** The methods that are paid online, and so go through a provider. */
export const ONLINE_METHODS = [
  'bkash',
  'nagad',
  'card',
] as const satisfies readonly PaymentMethod[];

export function isOnline(method: PaymentMethod): boolean {
  return (ONLINE_METHODS as readonly PaymentMethod[]).includes(method);
}

/** One simulated attempt, as the mock's own page left it. */
type MockOutcome = 'initiated' | 'paid' | 'failed' | 'cancelled';

/**
 * The simulated provider.
 *
 * `MOCK_PAYMENT_FLOW=inline` (the default, and the demonstration) settles
 * every charge on the spot, like `SMS_PROVIDER=log` always succeeds.
 * `redirect` sends the patient to `GET /mock-pay/:checkoutId`, a page of the
 * API's own that says it is a simulation and offers pay, fail and cancel, and
 * answers `confirm` with what was pressed there. Refused in production
 * (`env.ts`), as `STORAGE_PROVIDER=mock` is.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  readonly refundsByApi = true;

  private readonly charged = new Map<string, string>();
  private readonly attempts = new Map<
    string,
    { outcome: MockOutcome; amountPoisha: number; returnUrl: string }
  >();

  constructor(private readonly flow: 'inline' | 'redirect' = env.MOCK_PAYMENT_FLOW) {}

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    // `FR-PAY-06` at the adapter as well as the database: a replayed key gets
    // the attempt it got the first time, never a second one.
    const existing = this.charged.get(request.idempotencyKey);
    const checkoutId = existing ?? `mock_${randomUUID()}`;
    this.charged.set(request.idempotencyKey, checkoutId);

    // The payment's own id, never the provider's (CLAUDE.md §7).
    logger.info(
      { paymentId: request.paymentId, amountPoisha: request.amountPoisha, provider: 'mock' },
      existing === undefined ? 'payment charged' : 'payment charge replayed',
    );

    if (this.flow === 'inline') {
      return await Promise.resolve({
        ok: true,
        checkoutId,
        providerRef: checkoutId,
        settled: true,
        redirectUrl: null,
      });
    }

    if (!this.attempts.has(checkoutId)) {
      this.attempts.set(checkoutId, {
        outcome: 'initiated',
        amountPoisha: request.amountPoisha,
        returnUrl: request.returnUrl,
      });
    }
    return await Promise.resolve({
      ok: true,
      checkoutId,
      providerRef: null,
      settled: false,
      redirectUrl: new URL(`/api/v1/mock-pay/${checkoutId}`, env.API_BASE_URL).toString(),
    });
  }

  async confirm(request: ConfirmRequest): Promise<ConfirmResult> {
    const attempt = this.attempts.get(request.checkoutId);
    // Inline attempts settled when they were made.
    if (attempt === undefined) {
      return await Promise.resolve(
        this.flow === 'inline' && request.checkoutId.startsWith('mock_')
          ? { status: 'paid', providerRef: request.checkoutId, amountPoisha: request.amountPoisha }
          : { status: 'failed', reason: 'declined' },
      );
    }
    switch (attempt.outcome) {
      case 'paid':
        return {
          status: 'paid',
          providerRef: `mock_trx_${request.checkoutId.slice(5)}`,
          amountPoisha: attempt.amountPoisha,
        };
      case 'failed':
        return { status: 'failed', reason: 'declined' };
      case 'cancelled':
        return { status: 'failed', reason: 'cancelled' };
      case 'initiated':
        return { status: 'pending' };
    }
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    logger.info(
      { paymentId: request.paymentId, amountPoisha: request.amountPoisha, provider: 'mock' },
      'payment refunded',
    );
    return await Promise.resolve({ ok: true, providerRef: `mock_refund_${randomUUID()}` });
  }

  /** What the simulated page shows, or null for an attempt it never made. */
  attempt(
    checkoutId: string,
  ): { readonly amountPoisha: number; readonly outcome: MockOutcome } | null {
    const found = this.attempts.get(checkoutId);
    return found === undefined
      ? null
      : { amountPoisha: found.amountPoisha, outcome: found.outcome };
  }

  /**
   * What pressing a button on the simulated page does: records the outcome and
   * answers where the browser goes back to, with the provider's own word in
   * the address as bKash's return carries it. Nothing in that address is
   * believed (`FR-PAY-09`).
   */
  settle(checkoutId: string, outcome: 'paid' | 'failed' | 'cancelled'): string | null {
    const found = this.attempts.get(checkoutId);
    if (found === undefined) return null;
    if (found.outcome === 'initiated') found.outcome = outcome;
    const back = new URL(found.returnUrl);
    back.searchParams.set(
      'status',
      outcome === 'paid' ? 'success' : outcome === 'failed' ? 'failure' : 'cancel',
    );
    return back.toString();
  }

  /** Signed with `JWT_ACCESS_SECRET`, so a webhook test exercises a real check. */
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
 * Rather than construct a client that throws on first use — at the moment a
 * patient taps pay — this fails with a named reason the route turns into an
 * error somebody can read.
 */
export class UnconfiguredPaymentProvider implements PaymentProvider {
  readonly name = 'unconfigured';
  readonly refundsByApi = false;

  async charge(): Promise<ChargeResult> {
    return await Promise.resolve({ ok: false, error: 'no_payment_provider_configured' });
  }

  async confirm(): Promise<ConfirmResult> {
    return await Promise.resolve({
      status: 'unreachable',
      error: 'no_payment_provider_configured',
    });
  }

  async refund(): Promise<RefundResult> {
    return await Promise.resolve({ ok: false, error: 'no_payment_provider_configured' });
  }

  verifyWebhook(): boolean {
    return false;
  }
}

let override: PaymentProvider | null = null;
let mock: MockPaymentProvider | null = null;
let bkash: BkashProvider | null = null;
let nagad: NagadProvider | null = null;

/** The simulated provider this process holds, for its own page. */
export function mockProvider(): MockPaymentProvider {
  mock ??= new MockPaymentProvider();
  return mock;
}

/**
 * The provider a method is paid through, or null where this deployment takes
 * no such payment.
 *
 * `mock`: every online method is the simulated provider. `live`: bKash and
 * Nagad each when their settings are complete; card has no adapter. `off`:
 * none. A test's `setPaymentProvider` stands in for every online method.
 */
export function providerFor(method: PaymentMethod): PaymentProvider | null {
  if (!isOnline(method)) return null;
  if (override !== null) return override;
  switch (env.PAYMENT_PROVIDER) {
    case 'mock':
      return mockProvider();
    case 'live':
      if (method === 'bkash' && bkashConfigured()) return (bkash ??= new BkashProvider());
      if (method === 'nagad' && nagadConfigured()) return (nagad ??= new NagadProvider());
      return null;
    case 'off':
      return null;
  }
}

/** The online methods this deployment can take (`GET /config`). */
export function availableMethods(): readonly PaymentMethod[] {
  return ONLINE_METHODS.filter((method) => providerFor(method) !== null);
}

/**
 * The provider for callbacks that name no method: the mock's signed test hook.
 * Kept for `POST /webhooks/:provider`.
 */
export function payments(): PaymentProvider {
  return (
    override ??
    (env.PAYMENT_PROVIDER === 'mock' ? mockProvider() : new UnconfiguredPaymentProvider())
  );
}

/** Replaces every online method's provider. Called by tests; nothing in production calls this. */
export function setPaymentProvider(provider: PaymentProvider): void {
  override = provider;
}

/** Restores the environment's choice. */
export function resetPaymentProvider(): PaymentProvider {
  override = null;
  mock = null;
  bkash = null;
  nagad = null;
  return payments();
}
