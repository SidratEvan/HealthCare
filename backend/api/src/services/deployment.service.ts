/**
 * What this deployment offers, for the apps to shape their screens by
 * (pilot step 26, `GET /config`).
 *
 * A patient app that offered bKash on a server with no merchant account would
 * be promising a payment nobody can take; one that asked for a code on a
 * demonstration would be asking for an SMS nobody sends. So the apps ask, and
 * only offer what is true here. Nothing in the answer is a secret.
 */

import { env } from '../env.js';

import { guestPhoneCheckRequired } from './patientAuth.service.js';

/** False under `PAYMENT_PROVIDER=off`: only paying at the hospital is offered. */
export function onlinePaymentsAvailable(): boolean {
  return env.PAYMENT_PROVIDER !== 'off';
}

export function publicConfig(): {
  readonly demo: boolean;
  readonly onlinePayments: boolean;
  readonly guestPhoneCheck: boolean;
} {
  return {
    demo: env.DEMO_MODE,
    onlinePayments: onlinePaymentsAvailable(),
    guestPhoneCheck: guestPhoneCheckRequired(),
  };
}
