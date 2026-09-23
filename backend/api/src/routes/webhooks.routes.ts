/**
 * Provider callback routes (BACKEND.md §7.7).
 *
 * No `requireAuth`: a payment provider holds no token of ours. The signature
 * over the raw body is the authentication, and `webhooks.controller` checks
 * it before anything else happens — see there for why, and for why a replayed
 * callback still answers 200.
 *
 * `text()` rather than `json()`, because the signature is over the bytes as
 * sent: `express.json()` would hand back an object whose re-serialisation is
 * not byte-identical to what the provider signed.
 *
 * ## `/webhooks/sms-dlr` is not here
 *
 * BACKEND.md §7.7 lists it beside these two. It belongs to notifications — a
 * delivery receipt updates `notifications.state` — and `SMS_PROVIDER=log` has
 * no receipts to send. It arrives with a real aggregator.
 */

import { Router, text } from 'express';

import * as webhooks from '../controllers/webhooks.controller.js';

export const webhookRoutes: Router = Router();

/** Small: a callback is a status, not a document. */
const rawBody = text({ type: '*/*', limit: '64kb' });

webhookRoutes.post('/webhooks/bkash', rawBody, webhooks.callback('bkash'));
webhookRoutes.post('/webhooks/nagad', rawBody, webhooks.callback('nagad'));
