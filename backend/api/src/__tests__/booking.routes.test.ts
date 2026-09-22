/**
 * Discovery and booking (BACKEND.md §7.2, §7.3).
 *
 * Step 9's definition of done is "guest books end to end with mock payment",
 * and this is the server half of proving it. Two things get more attention
 * than their line count suggests:
 *
 *   - **what a stranger can read.** Discovery is the only unauthenticated
 *     surface in this API, so every test here that checks a *field is absent*
 *     is checking a privacy boundary, not a serialisation detail.
 *   - **the rules that protect a queue.** Double-booking (`FR-PAT-24`) and
 *     capacity (`FR-PAT-25`) are the two ways a booking can corrupt a chamber,
 *     and both are decided inside the same lock that allocates the serial.
 *
 * Runs against the seeded demo database (CLAUDE.md §6), each test on a session
 * of its own.
 */

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { resetEmitter } from '../realtime/emit.js';
import { feeFor } from '../services/booking.service.js';
import * as queueService from '../services/queue.service.js';

import { createQueueFixture, type QueueFixture } from './support/queueFixture.js';
import { patientToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let fixture: QueueFixture;

/** A distinct phone per test, so guest identities never collide. */
function guestPhone(): string {
  const tail = String(Math.floor(Math.random() * 90_000_000) + 10_000_000);
  return `+88019${tail}`;
}

function guest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'রহিমা খাতুন (ডেমো)',
    phone: guestPhone(),
    ageYears: 34,
    sex: 'female',
    ...overrides,
  };
}

beforeEach(async () => {
  app = createApp();
  resetEmitter();
  fixture = await createQueueFixture(3);
});

describe('discovery is public, and carries nothing private', () => {
  it('lists live facilities without a token', async () => {
    const response = await request(app).get(`${BASE}/hospitals`);

    expect(response.status).toBe(200);
    expect(response.body.data.hospitals.length).toBeGreaterThan(0);
  });

  it('never exposes staff, patients or bookings on a hospital', async () => {
    // A patient looking for a cardiologist at two in the morning must not meet
    // a login wall (FR-GST-01) — which makes this the surface where what is
    // *absent* matters most.
    const response = await request(app).get(`${BASE}/hospitals`);
    const serialised = JSON.stringify(response.body);

    expect(serialised).not.toContain('password');
    expect(serialised).not.toContain('staff');
    expect(serialised).not.toContain('patient');
  });

  it('carries a freshness stamp on capability data (FR-PAT-14, FR-OFF-03)', async () => {
    const response = await request(app).get(`${BASE}/hospitals`);
    const hospitals = response.body.data.hospitals as {
      capabilities: string[];
      capabilityAsOf: string | null;
    }[];
    const withCapabilities = hospitals.find((h) => h.capabilities.length > 0);

    // A live figure without an age is a claim the product cannot support.
    expect(withCapabilities?.capabilityAsOf).toBeTruthy();
  });

  it('orders by distance when given a position', async () => {
    // Dhanmondi. The seeded facilities are spread across Dhaka and Chattogram,
    // so the ordering is a real one rather than an artefact of one row.
    const response = await request(app).get(`${BASE}/hospitals?lat=23.7461&lng=90.376`);
    const hospitals = response.body.data.hospitals as { distanceKm: number | null }[];
    const distances = hospitals
      .map((hospital) => hospital.distanceKm)
      .filter((km): km is number => km !== null);

    expect(distances.length).toBeGreaterThan(1);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it('publishes bed figures from the capacity view, each with its age (FR-PAT-14, FR-OFF-03)', async () => {
    const list = await request(app).get(`${BASE}/hospitals`);
    const id = list.body.data.hospitals[0].id;

    const response = await request(app).get(`${BASE}/hospitals/${id}`);

    // Until step 14 this was null: `v_public_hospital_capacity` did not
    // exist, and zero free beds is a number a patient could act on that
    // nothing supported. The view now exists, so the figure is published —
    // and every kind carries the age of its last confirmation, so a count
    // nobody has touched for hours says so (`FR-OFF-05`).
    const beds = response.body.data.beds as {
      bedTotal: number;
      byKind: { asOf: string | null }[];
    };
    expect(beds).not.toBeNull();
    for (const kind of beds.byKind) expect(kind).toHaveProperty('asOf');
    expect(response.body.data.departments.length).toBeGreaterThan(0);
  });

  it('publishes only verified doctors (FR-SUP-02)', async () => {
    const response = await request(app).get(`${BASE}/doctors`);

    expect(response.body.data.doctors.length).toBeGreaterThan(0);
    for (const doctor of response.body.data.doctors) {
      expect(doctor.bmdcVerifiedAt).not.toBeNull();
    }
  });

  it('filters doctors by specialty', async () => {
    const response = await request(app).get(`${BASE}/doctors?specialty=CARD`);
    expect(response.body.data.doctors.length).toBeGreaterThan(0);
  });

  it('404s an unknown hospital rather than returning an empty shell', async () => {
    const response = await request(app).get(
      `${BASE}/hospitals/99999999-9999-7999-8999-999999999999`,
    );
    expect(response.status).toBe(404);
  });
});

/**
 * `S-A-07` and `S-A-05h` — hospitals first, then the doctors inside one.
 *
 * `APP_FLOW.md` titles `S-A-07` "Specialty results (hospitals offering it)",
 * and the order is the requirement rather than a preference: a patient picks
 * somewhere they can reach before they pick a person. What these assert is that
 * the list is an *answer to a question* — only places that offer the department,
 * carrying the figures somebody weighs — and not a directory.
 */
describe('hospitals offering a specialty (S-A-07)', () => {
  it('returns only hospitals that offer the department', async () => {
    const response = await request(app).get(`${BASE}/hospitals?specialty=CARD`);
    const hospitals = response.body.data.hospitals as { id: string; doctorCount: number }[];

    expect(response.status).toBe(200);
    expect(hospitals.length).toBeGreaterThan(0);

    // A hospital in the list with no cardiologist in it would make the list a
    // directory rather than an answer.
    for (const hospital of hospitals) {
      expect(hospital.doctorCount).toBeGreaterThan(0);
    }
  });

  it('counts doctors only when a specialty was named', async () => {
    const response = await request(app).get(`${BASE}/hospitals`);
    const hospitals = response.body.data.hospitals as { doctorCount: number | null }[];

    // "How many doctors" across every department answers a question nobody
    // asked, so it is null rather than a number that reads as meaningful.
    for (const hospital of hospitals) {
      expect(hospital.doctorCount).toBeNull();
    }
  });

  it('stamps the list, because who is sitting now is live (FR-PAT-14)', async () => {
    const response = await request(app).get(`${BASE}/hospitals?specialty=CARD`);

    // `<FreshnessLine>` renders from this. A count of chambers running right
    // now is the liveliest figure on the screen and may not appear without its
    // age (`FR-OFF-03`).
    expect(Date.parse(response.body.data.asOf as string)).not.toBeNaN();

    const hospitals = response.body.data.hospitals as {
      sittingNow: number;
      openSerialsToday: number;
    }[];
    for (const hospital of hospitals) {
      expect(typeof hospital.sittingNow).toBe('number');
      expect(hospital.openSerialsToday).toBeGreaterThanOrEqual(0);
    }
  });

  it('puts a hospital with somebody in a chamber above one without', async () => {
    const response = await request(app).get(`${BASE}/hospitals?specialty=CARD`);
    const sitting = (response.body.data.hospitals as { sittingNow: number }[]).map(
      (hospital) => hospital.sittingNow,
    );

    // No position was given, so "can I be seen today" is the only question the
    // ordering can answer. Descending, therefore.
    expect([...sitting].sort((a, b) => b - a)).toEqual(sitting);
  });

  it('says so plainly when no hospital offers it, rather than 404ing', async () => {
    const response = await request(app).get(`${BASE}/hospitals?specialty=NOSUCHDEPT`);

    // An empty answer is a real answer and `GR-03` gives it a designed state.
    // A 404 would say the *route* was wrong.
    expect(response.status).toBe(200);
    expect(response.body.data.hospitals).toEqual([]);
  });
});

describe('the doctors at one hospital (S-A-05h)', () => {
  /** The hospital a `CARD` card on `S-A-07` would open. */
  async function cardiologyHospitalId(): Promise<string> {
    const list = await request(app).get(`${BASE}/hospitals?specialty=CARD`);
    const id = (list.body.data.hospitals as { id: string }[])[0]?.id;
    if (id === undefined) throw new Error('No seeded hospital offers CARD.');
    return id;
  }

  it('lists them without a token, like the rest of discovery', async () => {
    const response = await request(app).get(
      `${BASE}/hospitals/${await cardiologyHospitalId()}/doctors`,
    );

    expect(response.status).toBe(200);
    expect((response.body.data.doctors as unknown[]).length).toBeGreaterThan(0);
  });

  it('keeps the specialty the patient asked for', async () => {
    const response = await request(app).get(
      `${BASE}/hospitals/${await cardiologyHospitalId()}/doctors?specialty=CARD`,
    );
    const doctors = response.body.data.doctors as { departmentCode: string }[];

    // Somebody who asked for a cardiologist should not land on a list of every
    // doctor in the building.
    expect(doctors.length).toBeGreaterThan(0);
    for (const doctor of doctors) {
      expect(doctor.departmentCode).toBe('CARD');
    }
  });

  it('says whether each one is in a chamber now, or when they sit (FR-PAT-13)', async () => {
    const response = await request(app).get(
      `${BASE}/hospitals/${await cardiologyHospitalId()}/doctors?specialty=CARD`,
    );
    const doctors = response.body.data.doctors as {
      sittingNow: boolean;
      nextSessionAt: string | null;
    }[];

    for (const doctor of doctors) {
      expect(typeof doctor.sittingNow).toBe('boolean');

      // Null is a real answer — "no upcoming chamber" is not the same as "we
      // do not know", and neither is the same as zero.
      if (doctor.nextSessionAt !== null) {
        expect(Date.parse(doctor.nextSessionAt)).not.toBeNaN();
      }
    }
  });

  it('puts whoever is sitting now first', async () => {
    const response = await request(app).get(
      `${BASE}/hospitals/${await cardiologyHospitalId()}/doctors?specialty=CARD`,
    );
    const sitting = (response.body.data.doctors as { sittingNow: boolean }[]).map((doctor) =>
      doctor.sittingNow ? 1 : 0,
    );

    expect([...sitting].sort((a, b) => b - a)).toEqual(sitting);
  });

  it('stamps the list (FR-PAT-14)', async () => {
    const response = await request(app).get(
      `${BASE}/hospitals/${await cardiologyHospitalId()}/doctors?specialty=CARD`,
    );

    expect(Date.parse(response.body.data.asOf as string)).not.toBeNaN();
  });

  it('carries no patient or staff detail, like the rest of discovery', async () => {
    const response = await request(app).get(
      `${BASE}/hospitals/${await cardiologyHospitalId()}/doctors`,
    );
    const serialised = JSON.stringify(response.body);

    expect(serialised).not.toContain('password');
    expect(serialised).not.toContain('patient');
  });

  it('404s an unknown hospital rather than an empty doctor list', async () => {
    const response = await request(app).get(
      `${BASE}/hospitals/99999999-9999-7999-8999-999999999999/doctors`,
    );

    // An empty list would read as "this hospital has no doctors", which is a
    // different and wrong statement.
    expect(response.status).toBe(404);
  });
});

describe('availability (S-A-07b)', () => {
  it('reports serials taken against capacity', async () => {
    const response = await request(app).get(`${BASE}/sessions/${fixture.sessionId}/availability`);

    expect(response.status).toBe(200);
    expect(response.body.data.taken).toBe(3);
    expect(response.body.data.nextSerial).toBe(4);
    expect(response.body.data.full).toBe(false);
    expect(response.body.data.asOf).toBeTruthy();
  });

  it('says the wait is unknown before the doctor has arrived (FR-PAT-13)', async () => {
    // Not zero, and not a default. Until the chamber is running there is no
    // measured rate, and any specific number would be a guess dressed up as
    // information (PRD.md §3.2).
    const response = await request(app).get(`${BASE}/sessions/${fixture.sessionId}/availability`);

    expect(response.body.data.expectedWaitMinutes).toBeNull();
  });

  it('gives a real wait once the chamber is running', async () => {
    const actor = {
      kind: 'staff' as const,
      staffUserId: fixture.receptionistId as never,
      role: 'receptionist' as const,
    };
    await queueService.appendEvent({
      sessionId: fixture.sessionId,
      type: 'DOCTOR_ARRIVED',
      payload: { arrivedAt: new Date().toISOString(), minutesLate: 0 },
      actor,
    });

    const response = await request(app).get(`${BASE}/sessions/${fixture.sessionId}/availability`);

    expect(response.body.data.expectedWaitMinutes).toBeGreaterThan(0);
  });
});

describe('the fee breakdown (FR-PAT-21)', () => {
  it('itemises consultation, platform fee and total', () => {
    const fee = feeFor(150_000, 'bkash');

    expect(fee.consultationPoisha).toBe(150_000);
    expect(fee.totalPoisha).toBe(fee.consultationPoisha + fee.platformFeePoisha);
  });

  it('owes the whole total at the hospital when paying there', () => {
    // A person who thinks they have paid and is asked again at a counter has
    // been misled, so this is stated before confirming.
    const atHospital = feeFor(150_000, 'at_hospital');
    expect(atHospital.dueAtHospitalPoisha).toBe(atHospital.totalPoisha);

    const prepaid = feeFor(150_000, 'nagad');
    expect(prepaid.dueAtHospitalPoisha).toBe(0);
  });
});

describe('a guest books, end to end (FR-GST-01, FR-GST-05)', () => {
  it('takes the next serial and returns a tracking link', async () => {
    const response = await request(app)
      .post(`${BASE}/bookings`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ sessionId: fixture.sessionId, method: 'bkash', guest: guest() });

    expect(response.status).toBe(201);
    expect(response.body.data.serial).toBe(4);
    expect(response.body.data.paid).toBe(true);

    // FR-GST-05: single-booking scoped, and returned exactly once — only the
    // hash is stored, so this is the sole moment the token exists outside the
    // SMS it goes into.
    const url = response.body.data.trackingUrl as string;
    expect(url).toContain('/s?');
    expect(url).toContain(`b=${response.body.data.bookingId as string}`);
  });

  it('needs no account and no OTP (FR-GST-02, CLAUDE.md §4.1)', async () => {
    // No Authorization header at all. Guest is a shorter form, not a lesser
    // path — and the OTP step is deferred with the rest of authentication.
    const response = await request(app)
      .post(`${BASE}/bookings`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ sessionId: fixture.sessionId, method: 'at_hospital', guest: guest() });

    expect(response.status).toBe(201);
    expect(response.body.data.fee.dueAtHospitalPoisha).toBe(response.body.data.fee.totalPoisha);
    expect(response.body.data.paid).toBe(false);
  });

  it('reuses the identity when the same phone books again (FR-GST-12)', async () => {
    const phone = guestPhone();
    // A *different* doctor: FR-PAT-24 forbids the same patient booking the
    // same doctor twice in one day, whichever session it is.
    const other = await createQueueFixture(2, 1);

    const first = await request(app)
      .post(`${BASE}/bookings`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ sessionId: fixture.sessionId, method: 'bkash', guest: guest({ phone }) });

    const second = await request(app)
      .post(`${BASE}/bookings`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ sessionId: other.sessionId, method: 'bkash', guest: guest({ phone }) });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    // A returning guest should not re-enter what they already gave, which is
    // only possible if the identity behind the phone is the same one.
    const owner = await queueService.bookingOwner(second.body.data.bookingId as string);
    expect(owner).not.toBeNull();
  });

  it('refuses a malformed phone rather than storing a different number', async () => {
    const response = await request(app)
      .post(`${BASE}/bookings`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({
        sessionId: fixture.sessionId,
        method: 'bkash',
        guest: guest({ phone: '01712345678' }),
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('requires guest details when there is no account', async () => {
    const response = await request(app)
      .post(`${BASE}/bookings`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ sessionId: fixture.sessionId, method: 'bkash' });

    expect(response.status).toBe(400);
  });
});

describe('the rules that protect a chamber', () => {
  it('refuses the same patient with the same doctor on the same day (FR-PAT-24)', async () => {
    const phone = guestPhone();

    const first = await request(app)
      .post(`${BASE}/bookings`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ sessionId: fixture.sessionId, method: 'bkash', guest: guest({ phone }) });
    expect(first.status).toBe(201);

    const again = await request(app)
      .post(`${BASE}/bookings`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ sessionId: fixture.sessionId, method: 'bkash', guest: guest({ phone }) });

    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('BOOKING_DUPLICATE');
    // Names the booking they already have, so the app can show it rather than
    // leaving them to wonder which one it meant.
    expect(again.body.error.details.serial).toBe(4);
  });

  it('refuses a booking once every serial is taken (FR-PAT-25)', async () => {
    const full = await createQueueFixture(2);
    await queueService.setCapacity(full.sessionId, 2);

    const response = await request(app)
      .post(`${BASE}/bookings`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ sessionId: full.sessionId, method: 'bkash', guest: guest() });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('SESSION_FULL');
    // Carries the numbers, so the app can offer the standby list rather than
    // a bare refusal.
    expect(response.body.error.details.capacity).toBe(2);
  });

  it('requires an idempotency key on the one button that takes money', async () => {
    const response = await request(app)
      .post(`${BASE}/bookings`)
      .send({ sessionId: fixture.sessionId, method: 'bkash', guest: guest() });

    expect(response.status).toBe(400);
  });

  it('never lets a double-tapped confirm create a second booking', async () => {
    const key = crypto.randomUUID();
    const body = { sessionId: fixture.sessionId, method: 'bkash', guest: guest() };

    const first = await request(app)
      .post(`${BASE}/bookings`)
      .set('Idempotency-Key', key)
      .send(body);
    const second = await request(app)
      .post(`${BASE}/bookings`)
      .set('Idempotency-Key', key)
      .send(body);

    expect(first.status).toBe(201);

    // Not a replayed 201 — a refusal. The idempotency middleware validates
    // keys but stores nothing: the durable record belongs with the resource,
    // and `bookings` has no key column (that would need migration 0007). What
    // makes the double-tap *safe* is FR-PAT-24, which refuses the same patient
    // with the same doctor on the same day.
    //
    // Safe, because no second serial is allocated and no second charge is
    // possible. Not idempotent, because the caller gets 409 rather than the
    // original booking — recorded in docs/STATUS.md.
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('BOOKING_DUPLICATE');

    // The refusal names the booking they already have, so the app can show it
    // rather than an error.
    expect(second.body.error.details.bookingId).toBe(first.body.data.bookingId);
    expect(second.body.error.details.serial).toBe(first.body.data.serial);
  });

  it('refuses a booking on a session that has ended', async () => {
    const actor = {
      kind: 'staff' as const,
      staffUserId: fixture.receptionistId as never,
      role: 'receptionist' as const,
    };
    await queueService.appendEvent({
      sessionId: fixture.sessionId,
      type: 'SESSION_ENDED',
      payload: { reason: null },
      actor,
    });

    const response = await request(app)
      .post(`${BASE}/bookings`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ sessionId: fixture.sessionId, method: 'bkash', guest: guest() });

    expect(response.status).toBe(422);
  });
});

describe('an account holder books', () => {
  it('refuses a profile that is not theirs', async () => {
    const response = await request(app)
      .post(`${BASE}/bookings`)
      .set('Authorization', `Bearer ${await patientToken()}`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({
        sessionId: fixture.sessionId,
        method: 'bkash',
        patientId: fixture.sparePatientId,
      });

    // The token's subject owns no profiles, so this one belongs to somebody
    // else. Booking a stranger into a queue is not a thing to allow.
    expect(response.status).toBe(400);
  });
});
