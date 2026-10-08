/**
 * Nagad online checkout (BACKEND.md §8, *Payments by being sent away and
 * coming back*; plan H3).
 *
 * **Written against what Nagad publishes and never run against Nagad.** No
 * merchant account exists yet (`docs/PLATFORM_PLAN.md` X2). It is proven
 * against a stand-in server in the test process that encrypts and signs as
 * Nagad does (`paymentProviders.test.ts`); `DEPLOY.md` (*bKash and Nagad*)
 * has the sandbox checklist. There is no default address.
 *
 * ## The flow
 *
 * 1. **Initialise**: `POST check-out/initialize/{merchantId}/{orderId}` with
 *    `sensitiveData` (the merchant id, a timestamp, the order id and a
 *    challenge) encrypted to **Nagad's public key** and `signature`, the same
 *    JSON signed SHA-256 with **the merchant's private key**. Nagad answers
 *    its own `sensitiveData`, encrypted to the merchant's public key, holding
 *    `paymentReferenceId` and a challenge.
 * 2. **Complete**: `POST check-out/complete/{paymentReferenceId}` with the
 *    amount, currency `050` and Nagad's challenge, encrypted and signed the
 *    same way, and the return address. It answers `callBackUrl`; the patient
 *    goes there.
 * 3. **Verify**: `GET verify/payment/{paymentReferenceId}`. As with bKash
 *    **the return is not the payment**: `status: "Success"` here is, and
 *    `issuerPaymentRefNo` is what goes in `payments.provider_ref`.
 *
 * ## Two things that bite
 *
 * **The timestamp is Dhaka local, `yyyyMMddHHmmss`**, and Nagad rejects one
 * far from its own clock with an error that says nothing about clocks.
 *
 * **Refunds are not in the checkout interface** as published. Until Nagad
 * gives the account one, money goes back through Nagad's merchant panel and is
 * recorded here by hand with its reference (`refundsByApi` false; `FR-PAY-12`).
 */

import { constants, createSign, privateDecrypt, publicEncrypt, randomBytes } from 'node:crypto';

import { logger } from '../../config/logger.js';
import { env } from '../../env.js';

import type {
  ChargeRequest,
  ChargeResult,
  ConfirmRequest,
  ConfirmResult,
  PaymentProvider,
  RefundResult,
} from './index.js';

/** Every setting Nagad needs, or it is not offered. */
export function nagadConfigured(): boolean {
  return [
    env.NAGAD_BASE_URL,
    env.NAGAD_MERCHANT_ID,
    env.NAGAD_MERCHANT_NUMBER,
    env.NAGAD_PUBLIC_KEY,
    env.NAGAD_PRIVATE_KEY,
  ].every((value) => value !== '');
}

/** A key as PEM, whether it was given whole or as its base64 body. */
export function pem(key: string, kind: 'PUBLIC KEY' | 'PRIVATE KEY'): string {
  const trimmed = key.trim().replace(/\\n/g, '\n');
  if (trimmed.startsWith('-----BEGIN')) return trimmed;
  const body =
    trimmed
      .replace(/\s+/g, '')
      .match(/.{1,64}/g)
      ?.join('\n') ?? '';
  return `-----BEGIN ${kind}-----\n${body}\n-----END ${kind}-----`;
}

/** Nagad's clock: Dhaka wall time, `yyyyMMddHHmmss`. */
export function nagadDateTime(at: Date): string {
  const dhaka = new Date(at.getTime() + 6 * 3_600_000);
  return dhaka.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

/** The order id Nagad keys an attempt by: our payment's id, letters and digits only. */
export function nagadOrderId(paymentId: string): string {
  return paymentId.replace(/-/g, '');
}

const TIMEOUT_MS = 15_000;

type Answer = Readonly<Record<string, unknown>>;

function text(answer: Answer, key: string): string | null {
  const value = answer[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

export class NagadProvider implements PaymentProvider {
  readonly name = 'nagad';
  readonly refundsByApi = false;

  private readonly base: string;
  private readonly nagadPublic: string;
  private readonly merchantPrivate: string;

  constructor(settings?: {
    readonly base: string;
    readonly nagadPublicKey: string;
    readonly merchantPrivateKey: string;
  }) {
    this.base = (settings?.base ?? env.NAGAD_BASE_URL).replace(/\/+$/, '');
    this.nagadPublic = pem(settings?.nagadPublicKey ?? env.NAGAD_PUBLIC_KEY, 'PUBLIC KEY');
    this.merchantPrivate = pem(
      settings?.merchantPrivateKey ?? env.NAGAD_PRIVATE_KEY,
      'PRIVATE KEY',
    );
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    try {
      const orderId = nagadOrderId(request.paymentId);
      const dateTime = nagadDateTime(new Date());
      const opening = {
        merchantId: env.NAGAD_MERCHANT_ID,
        datetime: dateTime,
        orderId,
        challenge: randomBytes(20).toString('hex'),
      };
      const initialised = await this.send(
        'POST',
        `/check-out/initialize/${env.NAGAD_MERCHANT_ID}/${orderId}`,
        {
          accountNumber: env.NAGAD_MERCHANT_NUMBER,
          dateTime,
          sensitiveData: this.seal(opening),
          signature: this.sign(opening),
        },
      );
      const sealed = text(initialised, 'sensitiveData');
      if (sealed === null) return { ok: false, error: 'nagad_initialize_refused' };
      const inner = this.open(sealed);
      const reference = text(inner, 'paymentReferenceId');
      const challenge = text(inner, 'challenge');
      if (reference === null || challenge === null) {
        return { ok: false, error: 'nagad_initialize_unreadable' };
      }

      const order = {
        merchantId: env.NAGAD_MERCHANT_ID,
        orderId,
        currencyCode: '050',
        amount: (request.amountPoisha / 100).toFixed(2),
        challenge,
      };
      const completed = await this.send('POST', `/check-out/complete/${reference}`, {
        sensitiveData: this.seal(order),
        signature: this.sign(order),
        merchantCallbackURL: request.returnUrl,
        additionalMerchantInfo: {},
      });
      const url = text(completed, 'callBackUrl');
      if (text(completed, 'status') !== 'Success' || url === null) {
        return { ok: false, error: 'nagad_complete_refused' };
      }
      return {
        ok: true,
        checkoutId: reference,
        providerRef: null,
        settled: false,
        redirectUrl: url,
      };
    } catch (cause: unknown) {
      logger.warn({ paymentId: request.paymentId, err: describe(cause) }, 'nagad charge failed');
      return { ok: false, error: 'nagad_unreachable' };
    }
  }

  async confirm(request: ConfirmRequest): Promise<ConfirmResult> {
    try {
      const answer = await this.send('GET', `/verify/payment/${request.checkoutId}`);
      const status = text(answer, 'status');
      if (status === 'Success') {
        const ref = text(answer, 'issuerPaymentRefNo');
        const amount = Number(answer['amount']);
        if (ref === null || !Number.isFinite(amount)) {
          return { status: 'unreachable', error: 'nagad_verify_unreadable' };
        }
        return { status: 'paid', providerRef: ref, amountPoisha: Math.round(amount * 100) };
      }
      if (status === 'Aborted' || status === 'Cancelled') {
        return { status: 'failed', reason: 'cancelled' };
      }
      if (status === 'Failed' || status === 'Expired' || status === 'Declined') {
        return { status: 'failed', reason: 'declined' };
      }
      return { status: 'pending' };
    } catch (cause: unknown) {
      logger.warn({ paymentId: request.paymentId, err: describe(cause) }, 'nagad verify failed');
      return { status: 'unreachable', error: 'nagad_unreachable' };
    }
  }

  async refund(): Promise<RefundResult> {
    return await Promise.resolve({ ok: false, error: 'nagad_refund_by_merchant_panel' });
  }

  /** Nagad's return is a browser redirect, not a signed callback. */
  verifyWebhook(): boolean {
    return false;
  }

  /** JSON encrypted to Nagad's public key, base64. */
  private seal(value: Readonly<Record<string, string>>): string {
    return publicEncrypt(
      { key: this.nagadPublic, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(JSON.stringify(value)),
    ).toString('base64');
  }

  /** The same JSON signed SHA-256 with the merchant's private key, base64. */
  private sign(value: Readonly<Record<string, string>>): string {
    return createSign('SHA256').update(JSON.stringify(value)).sign(this.merchantPrivate, 'base64');
  }

  /** Nagad's sealed answer, opened with the merchant's private key. */
  private open(sealed: string): Answer {
    const plain = privateDecrypt(
      { key: this.merchantPrivate, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(sealed, 'base64'),
    ).toString('utf8');
    const parsed: unknown = JSON.parse(plain);
    if (parsed === null || typeof parsed !== 'object') throw new Error('nagad_sealed_unreadable');
    return parsed as Answer;
  }

  private async send(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Answer> {
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-KM-Api-Version': 'v-0.2.0',
        'X-KM-Client-Type': 'PC_WEB',
        'X-KM-IP-V4': '127.0.0.1',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const parsed: unknown = await response.json().catch(() => null);
    if (parsed === null || typeof parsed !== 'object')
      throw new Error(`nagad_http_${response.status}`);
    return parsed as Answer;
  }
}

/** A failure's kind, never its message, which may quote a reference. */
function describe(cause: unknown): string {
  return cause instanceof Error ? cause.name : 'unknown';
}
