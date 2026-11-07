/**
 * `POST /bookings/:id/slip` — the token slip the counter prints (`FR-REC-21`,
 * `BTN-B02-SLIP`).
 *
 * With no SMS, the QR code on the slip is how a patient served at the counter
 * follows their serial on their own phone, so the link it carries must open
 * that booking and no other (`FR-GST-05`), and only the counter of the
 * booking's own hospital may print one.
 */

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';

import { createQueueFixture, otherHospitalId, type QueueFixture } from './support/queueFixture.js';
import { bearer, patientToken, staffToken } from './support/tokens.js';

let fixture: QueueFixture;
let key = 0;

beforeEach(async () => {
  fixture = await createQueueFixture(2);
});

function slip(bookingId: string, token: string | null): request.Test {
  key += 1;
  const call = request(createApp())
    .post(`/api/v1/bookings/${bookingId}/slip`)
    .set('Idempotency-Key', `slip-${String(key)}-${String(Date.now())}`)
    .send({});
  return token === null ? call : call.set('authorization', bearer(token));
}

function bookingOf(serial: number): string {
  const id = fixture.bookingIds[serial - 1];
  if (id === undefined) throw new Error(`no serial ${String(serial)}`);
  return id;
}

describe('the token slip (FR-REC-21)', () => {
  it('gives the counter the serial, the chamber and a live-serial link', async () => {
    const response = await slip(
      bookingOf(2),
      await staffToken(['receptionist'], fixture.hospitalId),
    );
    expect(response.status).toBe(200);
    const data = response.body.data as Record<string, unknown>;
    expect(data['serial']).toBe(2);
    expect(data['bookingId']).toBe(bookingOf(2));
    expect(typeof data['doctorNameBn']).toBe('string');
    expect(typeof data['hospitalNameEn']).toBe('string');
    expect(typeof data['plannedStart']).toBe('string');
    // The live page's own estimate, or none: never a time it cannot support.
    const estimate = data['estimate'] as { etaAt: string; patientsAhead: number } | null;
    if (estimate !== null) {
      expect(Number.isNaN(Date.parse(estimate.etaAt))).toBe(false);
      expect(estimate.patientsAhead).toBeGreaterThanOrEqual(0);
    }
    expect(String(data['trackingUrl'])).toMatch(/\/s\?b=[0-9a-f-]{36}&t=[A-Za-z0-9_-]{43}$/);
  });

  it('the printed link opens that booking, as the patient would open it', async () => {
    const response = await slip(
      bookingOf(2),
      await staffToken(['receptionist'], fixture.hospitalId),
    );
    const url = new URL(String((response.body.data as { trackingUrl: string }).trackingUrl));
    const token = url.searchParams.get('t') ?? '';

    const opened = await request(createApp()).get(`/api/v1/guest/link/${token}`);
    expect(opened.status).toBe(200);
    expect(JSON.stringify(opened.body.data)).toContain(bookingOf(2));
    expect(JSON.stringify(opened.body.data)).not.toContain(bookingOf(1));
  });

  it('is refused to another hospital’s counter, which cannot see the booking', async () => {
    const foreign = await otherHospitalId(fixture.hospitalId);
    const response = await slip(bookingOf(1), await staffToken(['receptionist'], foreign));
    // The tenant policies hide another hospital's booking, so it is not found
    // rather than forbidden, as on every cross-hospital read (FR-SEC-11).
    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('trackingUrl');
  });

  it('is reception’s: a doctor, a patient and nobody are refused', async () => {
    expect(
      (await slip(bookingOf(1), await staffToken(['doctor'], fixture.hospitalId))).status,
    ).toBe(403);
    expect((await slip(bookingOf(1), await patientToken())).status).toBe(403);
    expect((await slip(bookingOf(1), null)).status).toBe(401);
  });

  it('needs an idempotency key, like every write', async () => {
    const response = await request(createApp())
      .post(`/api/v1/bookings/${bookingOf(1)}/slip`)
      .set('authorization', bearer(await staffToken(['receptionist'], fixture.hospitalId)))
      .send({});
    expect(response.status).toBe(400);
  });
});
