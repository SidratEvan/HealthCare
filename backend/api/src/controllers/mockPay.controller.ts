/**
 * The simulated provider's page (plan H3). See `routes/mockPay.routes.ts`.
 *
 * Plain HTML from the API: a page of its own, labelled as a simulation in
 * both languages so nobody takes it for bKash or Nagad. It imitates neither.
 */

import { formatTaka, tp } from '@platform/i18n';

import { notFound } from '../errors/AppError.js';
import * as payments from '../services/payment.service.js';

import type { Request, Response } from 'express';

/** Only what the page itself needs: its own small style, no script, no form. */
const PAGE_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

function checkoutOf(req: Request): string {
  const value = req.params['checkoutId'];
  if (typeof value !== 'string' || value === '') throw notFound('route parameter');
  return value;
}

/** `GET /mock-pay/:checkoutId`. */
export function page(req: Request, res: Response): void {
  const checkoutId = checkoutOf(req);
  const attempt = payments.mockAttempt(checkoutId);
  if (attempt === null) throw notFound('payment');

  const amount = `${formatTaka(attempt.amountPoisha, 'bengali')} · ${formatTaka(attempt.amountPoisha, 'latin')}`;
  const link = (outcome: string, key: 'mockPayPay' | 'mockPayFail' | 'mockPayCancel'): string =>
    `<a class="${outcome}" href="${encodeURI(`${checkoutId}/${outcome}`)}">${tp(key, 'bn')}<br><small>${tp(key, 'en')}</small></a>`;

  res.setHeader('Content-Security-Policy', PAGE_POLICY);
  res.type('html').send(`<!doctype html>
<html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${tp('mockPayTitle', 'bn')}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:28rem;margin:2rem auto;padding:0 1rem;line-height:1.7;color:#1b2430;background:#fff}
.note{border:2px dashed #b45309;padding:.75rem 1rem;border-radius:.5rem;background:#fff7ed}
a{display:block;text-align:center;padding:.9rem;margin:.75rem 0;border-radius:.5rem;text-decoration:none;font-weight:600;color:#fff}
.paid{background:#1d4ed8}.failed{background:#b91c1c}.cancelled{background:#4b5563}
small{font-weight:400}
</style></head><body>
<p class="note"><strong>${tp('mockPayTitle', 'bn')}</strong><br>${tp('mockPayNote', 'bn')}<br><small>${tp('mockPayNote', 'en')}</small></p>
<p>${tp('mockPayAmount', 'bn')}: <strong>${amount}</strong></p>
${attempt.outcome === 'initiated' ? `${link('paid', 'mockPayPay')}${link('failed', 'mockPayFail')}${link('cancelled', 'mockPayCancel')}` : `<p>${tp('mockPayDone', 'bn')}</p>`}
</body></html>`);
}

/** `GET /mock-pay/:checkoutId/:outcome`: recorded, then back to the patient app. */
export function settle(req: Request, res: Response): void {
  const outcome = req.params['outcome'];
  if (outcome !== 'paid' && outcome !== 'failed' && outcome !== 'cancelled') {
    throw notFound('route parameter');
  }
  const back = payments.mockSettle(checkoutOf(req), outcome);
  if (back === null) throw notFound('payment');
  res.redirect(303, back);
}
