/**
 * A phone proved the way the patient app proves it (`FR-GST-03`): `POST
 * /guest/start`, then the code at `POST /guest/verify`.
 *
 * Through the real endpoints rather than a signed token, so what comes back is
 * the guest token the app would hold, for the identity the server keeps for
 * that number. Needs the check on (`GUEST_BOOKING_OTP`); on a demonstration the
 * code comes back in the answer, which is how the test reads it.
 */

import request from 'supertest';

import type { Express } from 'express';

export async function proveGuestPhone(app: Express, phone: string, name: string): Promise<string> {
  const start = await request(app).post('/api/v1/guest/start').send({ phone, name });
  const started = start.body.data as
    | { needsOtp: false; guestToken: string | null }
    | { needsOtp: true; demoCode?: string }
    | undefined;

  if (started === undefined) {
    throw new Error(`/guest/start failed: ${String(start.status)} ${JSON.stringify(start.body)}`);
  }
  if (!started.needsOtp) {
    if (started.guestToken === null)
      throw new Error('the phone check is off: set GUEST_BOOKING_OTP');
    return started.guestToken;
  }

  const verified = await request(app)
    .post('/api/v1/guest/verify')
    .send({ phone, name, code: started.demoCode });
  const token = (verified.body.data as { guestToken?: string } | undefined)?.guestToken;
  if (token === undefined) {
    throw new Error(
      `/guest/verify failed: ${String(verified.status)} ${JSON.stringify(verified.body)}`,
    );
  }
  return token;
}
