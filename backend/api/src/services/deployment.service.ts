/**
 * What this deployment offers, for the apps to shape their screens by
 * (pilot step 26, `GET /config`).
 *
 * A patient app that offered bKash on a server with no merchant account would
 * be promising a payment nobody can take; one that asked for a code on a
 * demonstration would be asking for an SMS nobody sends. So the apps ask, and
 * only offer what is true here. Nothing in the answer is a secret.
 */

import type { PaymentMethod } from '@platform/domain';

import { availableMethods } from '../adapters/payments/index.js';
import { env } from '../env.js';

import { guestPhoneCheckRequired } from './patientAuth.service.js';

/**
 * False where no online method can be taken: `PAYMENT_PROVIDER=off`, or `live`
 * with neither bKash's nor Nagad's settings complete. Only paying at the
 * hospital is offered then.
 */
export function onlinePaymentsAvailable(): boolean {
  return availableMethods().length > 0;
}

/** Whether this deployment can take a payment by this method (plan H3). */
export function methodAvailable(method: PaymentMethod): boolean {
  return method === 'at_hospital' || method === 'cash' || availableMethods().includes(method);
}

export function publicConfig(): {
  readonly demo: boolean;
  readonly onlinePayments: boolean;
  /** The online methods offered here (plan H3): card only with a provider for it. */
  readonly paymentMethods: readonly PaymentMethod[];
  readonly guestPhoneCheck: boolean;
} {
  return {
    demo: env.DEMO_MODE,
    onlinePayments: onlinePaymentsAvailable(),
    paymentMethods: availableMethods(),
    guestPhoneCheck: guestPhoneCheckRequired(),
  };
}
