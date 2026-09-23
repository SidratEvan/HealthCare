/**
 * Provider callback routes (BACKEND.md §7.7).
 *
 * No `requireAuth`: a payment provider holds no token of ours. The signature
 * over the raw body is the authentication, and `webhooks.controller` checks
 * it before anything else happens — see there for why, and for why a replayed
 * callback still answers 200.
 *
 * The signature is over the bytes as sent, and those are captured by the
 * global JSON parser's `verify` hook (`app.ts`) rather than by a parser
 * mounted here — `express.json()` runs first and consumes the stream, so a
 * route-level `text()` would find nothing left to read.
 *
 * ## `/webhooks/sms-dlr` is not here
 *
 * BACKEND.md §7.7 lists it beside these two. It belongs to notifications — a
 * delivery receipt updates `notifications.state` — and `SMS_PROVIDER=log` has
 * no receipts to send. It arrives with a real aggregator.
 */

import { Router } from 'express';

import * as webhooks from '../controllers/webhooks.controller.js';

export const webhookRoutes: Router = Router();

webhookRoutes.post('/webhooks/bkash', webhooks.callback('bkash'));
webhookRoutes.post('/webhooks/nagad', webhooks.callback('nagad'));
