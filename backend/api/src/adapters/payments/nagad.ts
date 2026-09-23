/**
 * Nagad (BACKEND.md §1: `adapters/payments/nagad.ts`).
 *
 * **Not implemented, for the reason `bkash.ts` gives.** Nagad's merchant API
 * needs a merchant id, a merchant number, and an RSA key pair registered with
 * them — `NAGAD_PUBLIC_KEY` and `NAGAD_PRIVATE_KEY` in `.env.example` are
 * placeholders for credentials that arrive with an agreement, not before
 * (CLAUDE.md §1.1).
 *
 * The shape of the work, so it is not rediscovered:
 *
 * 1. **Initialise**: `POST /api/dfs/check-out/initialize/{merchantId}/{orderId}`
 *    with a `sensitiveData` blob — the order id, a challenge, the merchant id
 *    and a timestamp — RSA-encrypted with *Nagad's public key* and signed
 *    with *ours*. The response returns `paymentReferenceId` and a challenge
 *    of their own, encrypted the other way.
 * 2. **Complete**: `POST /api/dfs/check-out/complete/{paymentReferenceId}`
 *    with the amount and the challenge echoed back. It answers with
 *    `callBackUrl`; the patient goes there.
 * 3. **Verify**: `GET /api/dfs/verify/payment/{orderId}` after the callback.
 *    As with bKash, **the callback is not the payment** — the verify response
 *    with `status: "Success"` is, and `issuerPaymentRefNo` is what belongs in
 *    `payments.provider_ref`.
 *
 * ## Two things that bite
 *
 * **The timestamp is Dhaka local, formatted `yyyyMMddHHmmss`, and Nagad
 * rejects anything more than a minute out.** A server on UTC that formats it
 * naively fails every request with a signature error that says nothing about
 * clocks. `shared/domain/src/util/time.ts` has the Dhaka helpers.
 *
 * **Refunds are not in the checkout API.** Nagad handles them through the
 * merchant portal or a separate agreement, so `refund` here may well stay
 * unimplemented even after `charge` works — in which case
 * `payment.service.refund` records the intent and an administrator settles it
 * by hand. That is worth knowing before the refund flow is promised to a
 * hospital as automatic for every method.
 */

import type { ChargeResult, PaymentProvider, RefundResult } from './index.js';

export class NagadProvider implements PaymentProvider {
  readonly name = 'nagad';

  async charge(): Promise<ChargeResult> {
    return await Promise.resolve({ ok: false, error: 'nagad_not_implemented' });
  }

  async refund(): Promise<RefundResult> {
    return await Promise.resolve({ ok: false, error: 'nagad_not_implemented' });
  }

  verifyWebhook(): boolean {
    return false;
  }
}
