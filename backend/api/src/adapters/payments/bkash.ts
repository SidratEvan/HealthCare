/**
 * bKash (BACKEND.md §1: `adapters/payments/bkash.ts`).
 *
 * **Not implemented, and deliberately so.** bKash's checkout needs a merchant
 * account, an app key and secret, a username and password, and a sandbox
 * granted per merchant — five credentials this repository does not hold and
 * cannot obtain before there is a signed hospital to arrange them with
 * (CLAUDE.md §1.1). Writing the integration against the published docs
 * without any of them would produce code nobody has ever seen run, which is
 * worse than an honest absence: it would look finished.
 *
 * What this file is instead is the **shape of the work**, so that whoever
 * does it has the seam, the failure modes and the ordering already decided.
 *
 * ## What the real one has to do
 *
 * 1. `POST /tokenized/checkout/token/grant` with the app key/secret and the
 *    username/password headers, cache the `id_token` for its ~55 minutes, and
 *    refresh with the `refresh_token` rather than re-granting — bKash rate
 *    limits grants hard.
 * 2. `POST /tokenized/checkout/create` with the amount, the merchant invoice
 *    number (our `payments.id`) and the callback URL. It answers with
 *    `paymentID` and `bkashURL`; the patient goes to the second.
 * 3. On the callback, `POST /tokenized/checkout/execute` with the `paymentID`.
 *    **Execute is the only thing that means the money moved** — a callback
 *    alone does not, and treating it as payment is how a merchant gets
 *    charged back.
 * 4. `POST /tokenized/checkout/payment/status` is the reconciliation path for
 *    a callback that never arrived, which happens often enough to plan for.
 *
 * `trxID` from the execute response is what goes in `payments.provider_ref`.
 * It is never logged (CLAUDE.md §7).
 *
 * ## The one thing not to get wrong
 *
 * bKash's idempotency is the merchant invoice number, and it is **per
 * merchant, forever**. Our `payments.id` is a uuid v7, so it is unique and
 * monotonic and cannot collide — which is why `payment.service` sends it
 * rather than the caller's idempotency key, whose uniqueness is only ours.
 */

import type { ChargeResult, PaymentProvider, RefundResult } from './index.js';

export class BkashProvider implements PaymentProvider {
  readonly name = 'bkash';

  async charge(): Promise<ChargeResult> {
    return await Promise.resolve({ ok: false, error: 'bkash_not_implemented' });
  }

  async refund(): Promise<RefundResult> {
    return await Promise.resolve({ ok: false, error: 'bkash_not_implemented' });
  }

  verifyWebhook(): boolean {
    // Fails closed. An endpoint that marks money received must never trust a
    // callback it cannot check, and there is no key here to check one with.
    return false;
  }
}
