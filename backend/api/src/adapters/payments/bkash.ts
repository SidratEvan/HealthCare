/**
 * bKash tokenized checkout (BACKEND.md §8, *Payments by being sent away and
 * coming back*; plan H3).
 *
 * **Written against what bKash publishes and never run against bKash.** No
 * merchant account exists yet (`docs/PLATFORM_PLAN.md` X2). It is proven
 * against a stand-in server in the test process that speaks the same requests
 * and answers (`paymentProviders.test.ts`), and `DEPLOY.md` (*bKash and
 * Nagad*) has the checklist that must pass on bKash's own sandbox before a
 * real taka moves. There is no default address: bKash is not offered until
 * `BKASH_BASE_URL` and the four credentials are set.
 *
 * ## The flow
 *
 * 1. `POST /tokenized/checkout/token/grant` with the username and password
 *    headers and the app key and secret; the `id_token` is kept for its life
 *    and renewed with `token/refresh`, because bKash limits grants.
 * 2. `POST /tokenized/checkout/create` (mode `0011`, a checkout without a
 *    saved agreement): our payment's id as `merchantInvoiceNumber`, which is
 *    unique per merchant forever and so must be a uuid of ours, never the
 *    caller's key; the return address as `callbackURL`. It answers
 *    `paymentID` and `bkashURL`; the patient goes to the second.
 * 3. On the return, `POST /tokenized/checkout/execute` with the `paymentID`.
 *    **Execute is what means the money moved**: the return address alone
 *    does not, and treating it as payment is how a merchant is charged back.
 * 4. `POST /tokenized/checkout/payment/status` when execute cannot answer
 *    (already executed, or the return never came).
 *
 * `trxID` is what goes in `payments.provider_ref`; `paymentID` in
 * `provider_checkout_id`. Neither is ever logged (CLAUDE.md §7).
 */

import { logger } from '../../config/logger.js';
import { env } from '../../env.js';

import type {
  ChargeRequest,
  ChargeResult,
  ConfirmRequest,
  ConfirmResult,
  PaymentProvider,
  RefundRequest,
  RefundResult,
} from './index.js';

/** Every setting bKash needs, or it is not offered. */
export function bkashConfigured(): boolean {
  return [
    env.BKASH_BASE_URL,
    env.BKASH_APP_KEY,
    env.BKASH_APP_SECRET,
    env.BKASH_USERNAME,
    env.BKASH_PASSWORD,
  ].every((value) => value !== '');
}

/** Poisha to bKash's amount, a decimal string in taka. */
export function bkashAmount(poisha: number): string {
  return (poisha / 100).toFixed(2);
}

/** bKash's decimal string back to poisha; NaN for anything else. */
function poishaOf(amount: unknown): number {
  if (typeof amount !== 'string' && typeof amount !== 'number') return Number.NaN;
  const value = Number(amount);
  return Number.isFinite(value) ? Math.round(value * 100) : Number.NaN;
}

const TIMEOUT_MS = 15_000;

type Answer = Readonly<Record<string, unknown>>;

function text(answer: Answer, key: string): string | null {
  const value = answer[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

export class BkashProvider implements PaymentProvider {
  readonly name = 'bkash';
  readonly refundsByApi = true;

  private token: { idToken: string; refreshToken: string; renewAt: number } | null = null;

  constructor(private readonly base: string = env.BKASH_BASE_URL.replace(/\/+$/, '')) {}

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    try {
      const answer = await this.call('/tokenized/checkout/create', {
        mode: '0011',
        payerReference: request.paymentId,
        callbackURL: request.returnUrl,
        amount: bkashAmount(request.amountPoisha),
        currency: 'BDT',
        intent: 'sale',
        merchantInvoiceNumber: request.paymentId,
      });
      const paymentId = text(answer, 'paymentID');
      const url = text(answer, 'bkashURL');
      if (text(answer, 'statusCode') !== '0000' || paymentId === null || url === null) {
        return { ok: false, error: `bkash_create_${text(answer, 'statusCode') ?? 'unreadable'}` };
      }
      return {
        ok: true,
        checkoutId: paymentId,
        providerRef: null,
        settled: false,
        redirectUrl: url,
      };
    } catch (cause: unknown) {
      logger.warn({ paymentId: request.paymentId, err: describe(cause) }, 'bkash create failed');
      return { ok: false, error: 'bkash_unreachable' };
    }
  }

  async confirm(request: ConfirmRequest): Promise<ConfirmResult> {
    try {
      // The patient's word chooses only how to ask: after a cancel or a
      // failure there is nothing to execute, so the status is read instead.
      if (request.hint === null || request.hint === 'success') {
        const executed = await this.call('/tokenized/checkout/execute', {
          paymentID: request.checkoutId,
        });
        const read = this.read(executed);
        if (read !== null && read.status !== 'pending') return read;
      }
      const status = await this.call('/tokenized/checkout/payment/status', {
        paymentID: request.checkoutId,
      });
      return this.read(status) ?? { status: 'unreachable', error: 'bkash_status_unreadable' };
    } catch (cause: unknown) {
      logger.warn({ paymentId: request.paymentId, err: describe(cause) }, 'bkash confirm failed');
      return { status: 'unreachable', error: 'bkash_unreachable' };
    }
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    if (request.checkoutId === null || request.providerRef === null) {
      return { ok: false, error: 'bkash_refund_without_references' };
    }
    try {
      const answer = await this.call('/tokenized/checkout/payment/refund', {
        paymentID: request.checkoutId,
        trxID: request.providerRef,
        amount: bkashAmount(request.amountPoisha),
        sku: 'serial',
        reason: request.reason.slice(0, 255),
      });
      const refundRef = text(answer, 'refundTrxID');
      if (text(answer, 'transactionStatus') !== 'Completed' || refundRef === null) {
        return { ok: false, error: `bkash_refund_${text(answer, 'statusCode') ?? 'refused'}` };
      }
      return { ok: true, providerRef: refundRef };
    } catch (cause: unknown) {
      logger.warn({ paymentId: request.paymentId, err: describe(cause) }, 'bkash refund failed');
      return { ok: false, error: 'bkash_unreachable' };
    }
  }

  /** bKash sends no signed callback for a checkout; nothing is believed. */
  verifyWebhook(): boolean {
    return false;
  }

  /**
   * What an execute or status answer says, or null when it says nothing a
   * decision can stand on. `Completed` is paid and nothing else is.
   */
  private read(answer: Answer): ConfirmResult | null {
    const status = text(answer, 'transactionStatus');
    if (status === 'Completed') {
      const ref = text(answer, 'trxID');
      const amount = poishaOf(answer['amount']);
      if (ref === null || Number.isNaN(amount)) return null;
      return { status: 'paid', providerRef: ref, amountPoisha: amount };
    }
    if (status === 'Initiated' || status === 'Pending Authorized') return { status: 'pending' };
    if (status === 'Cancelled') return { status: 'failed', reason: 'cancelled' };
    if (status === 'Failed' || status === 'Expired' || status === 'Declined') {
      return { status: 'failed', reason: 'declined' };
    }
    return null;
  }

  /** One authorised request; the token is fetched or renewed first. */
  private async call(path: string, body: Readonly<Record<string, string>>): Promise<Answer> {
    const idToken = await this.idToken();
    return await this.post(path, body, {
      Authorization: idToken,
      'X-APP-Key': env.BKASH_APP_KEY,
    });
  }

  private async idToken(): Promise<string> {
    const now = Date.now();
    if (this.token !== null && now < this.token.renewAt) return this.token.idToken;

    const credentials = { username: env.BKASH_USERNAME, password: env.BKASH_PASSWORD };
    const answer =
      this.token === null
        ? await this.post(
            '/tokenized/checkout/token/grant',
            { app_key: env.BKASH_APP_KEY, app_secret: env.BKASH_APP_SECRET },
            credentials,
          )
        : await this.post(
            '/tokenized/checkout/token/refresh',
            {
              app_key: env.BKASH_APP_KEY,
              app_secret: env.BKASH_APP_SECRET,
              refresh_token: this.token.refreshToken,
            },
            credentials,
          );

    const idToken = text(answer, 'id_token');
    const refreshToken = text(answer, 'refresh_token');
    if (idToken === null || refreshToken === null) {
      this.token = null;
      throw new Error('bkash_token_refused');
    }
    const lifeSeconds = typeof answer['expires_in'] === 'number' ? answer['expires_in'] : 3600;
    // Renewed five minutes early, so a request never carries a token that
    // runs out on the way.
    this.token = { idToken, refreshToken, renewAt: now + Math.max(60, lifeSeconds - 300) * 1000 };
    return idToken;
  }

  private async post(
    path: string,
    body: Readonly<Record<string, string>>,
    headers: Readonly<Record<string, string>>,
  ): Promise<Answer> {
    const response = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const parsed: unknown = await response.json().catch(() => null);
    if (parsed === null || typeof parsed !== 'object')
      throw new Error(`bkash_http_${response.status}`);
    return parsed as Answer;
  }
}

/** A failure's kind, never its message, which may quote a reference. */
function describe(cause: unknown): string {
  return cause instanceof Error ? cause.name : 'unknown';
}
