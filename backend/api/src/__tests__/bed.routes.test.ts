/**
 * The bed board's endpoints (BACKEND.md §7.5, `FR-BED-01`…`07`, `FR-PAT-52`).
 *
 * Three things are proven here that nothing else proves:
 *
 *   - **Who may touch a bed.** Reading the board is any staff role at the
 *     hospital; changing a bed is the ward's; another hospital's ward is
 *     nobody's (`FR-ROLE-01`).
 *   - **A bed cannot say something untrue.** Two admits into one bed, one
 *     patient into two beds, a replay that admits twice, a hold that lapses and
 *     keeps hiding a bed — each is attempted and each is refused or corrected.
 *   - **The mirror matches.** What the ward board counts from its own tiles and
 *     what the public view publishes are the same numbers (`FR-BED-06`). That
 *     is step 14's definition of done in `CLAUDE.md` §4.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  tallyByKind,
  BED_KINDS,
  type BedView,
  type PublicCapacity,
  type Timestamp,
} from '@platform/domain';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { resetEmitter, type RecordingEmitter } from '../realtime/emit.js';
import { ROOMS } from '../realtime/rooms.js';

import {
  bedEventsOf,
  createBedFixture,
  deskPatient,
  otherWardToken,
  type BedFixture,
} from './support/bedFixture.js';
import { bearer, patientToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let emitted: RecordingEmitter;
let fixture: BedFixture;

beforeEach(async () => {
  app = createApp();
  emitted = resetEmitter();
  fixture = await createBedFixture();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bedAt(index: number): string {
  const id = fixture.bedIds[index];
  if (id === undefined) throw new Error(`The fixture has no bed ${String(index)}.`);
  return id;
}

/** A ward action, with an idempotency key and a client event id. */
async function act(
  path: string,
  body: Record<string, unknown> = {},
  token = fixture.wardToken,
  clientEventId: string = randomUUID(),
): Promise<request.Response> {
  return await request(app)
    .post(`${BASE}${path}`)
    .set('Authorization', bearer(token))
    .set('Idempotency-Key', randomUUID())
    .send({ clientEventId, clientTs: new Date().toISOString(), ...body });
}

async function boardOf(hospitalId = fixture.hospitalId): Promise<{
  beds: BedView[];
  published: PublicCapacity;
}> {
  const response = await request(app)
    .get(`${BASE}/hospitals/${hospitalId}/beds`)
    .set('Authorization', bearer(fixture.wardToken));
  expect(response.status).toBe(200);
  return response.body.data as { beds: BedView[]; published: PublicCapacity };
}

function freeOf(published: PublicCapacity, kind: string): number {
  return published.byKind.find((entry) => entry.kind === kind)?.free ?? 0;
}

async function bedRow(bedId: string): Promise<{
  state: string;
  current_admission_id: string | null;
  reserved_until: Date | null;
  last_cleaned_at: Date | null;
  expected_discharge_date: string | null;
}> {
  const result = await sql<{
    state: string;
    current_admission_id: string | null;
    reserved_until: Date | null;
    last_cleaned_at: Date | null;
    expected_discharge_date: string | null;
  }>`
    SELECT state::text AS state, current_admission_id, reserved_until, last_cleaned_at,
           expected_discharge_date::text AS expected_discharge_date
      FROM beds WHERE id = ${bedId}::uuid
  `.execute(db);
  const row = result.rows[0];
  if (row === undefined) throw new Error('no such bed');
  return row;
}

/** Tomorrow in Dhaka, `YYYY-MM-DD`. */
function dhakaDate(offsetDays: number): string {
  const shifted = new Date(Date.now() + 6 * 3_600_000 + offsetDays * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// FR-ROLE-01
// ---------------------------------------------------------------------------

describe('who may read and change the board (FR-ROLE-01)', () => {
  it('lets any staff role at the hospital read the board, and nobody else', async () => {
    const path = `${BASE}/hospitals/${fixture.hospitalId}/beds`;

    expect((await request(app).get(path)).status).toBe(401);
    expect(
      (
        await request(app)
          .get(path)
          .set('Authorization', bearer(await patientToken()))
      ).status,
    ).toBe(403);
    expect(
      (await request(app).get(path).set('Authorization', bearer(fixture.receptionistToken))).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get(path)
          .set('Authorization', bearer(await otherWardToken(fixture.hospitalId)))
      ).status,
    ).toBe(403);
  });

  it("lets only this hospital's ward change a bed", async () => {
    const path = `/beds/${bedAt(0)}/clean-start`;

    expect(
      (await request(app).post(`${BASE}${path}`).set('Idempotency-Key', randomUUID()).send({}))
        .status,
    ).toBe(401);
    expect((await act(path, {}, fixture.receptionistToken)).status).toBe(403);
    expect((await act(path, {}, await otherWardToken(fixture.hospitalId))).status).toBe(403);

    // The bed is untouched by every refusal above.
    expect((await bedRow(bedAt(0))).state).toBe('free');
  });

  it('requires an idempotency key on every write (FR-OFF-01)', async () => {
    const response = await request(app)
      .post(`${BASE}/beds/${bedAt(0)}/clean-start`)
      .set('Authorization', bearer(fixture.wardToken))
      .send({});
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('keeps the bed panel and the pending list to the ward, because they name patients', async () => {
    const panel = await request(app)
      .get(`${BASE}/beds/${bedAt(0)}`)
      .set('Authorization', bearer(fixture.receptionistToken));
    expect(panel.status).toBe(403);

    const pending = await request(app)
      .get(`${BASE}/hospitals/${fixture.hospitalId}/bed-requests`)
      .set('Authorization', bearer(fixture.receptionistToken));
    expect(pending.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// FR-BED-02
// ---------------------------------------------------------------------------

describe('an admit, and what it changes (FR-BED-02, FR-BED-05)', () => {
  it('occupies the bed, attributes it, and drops the public count by one at once', async () => {
    const before = freeOf((await boardOf()).published, 'general');

    const response = await act(`/beds/${bedAt(0)}/admit`, { patient: deskPatient() });

    expect(response.status).toBe(200);
    expect(response.body.data.beds[0]).toMatchObject({ id: bedAt(0), state: 'occupied' });
    // `APP_FLOW.md` B3: "public counters drop by one instantly".
    expect(freeOf(response.body.data.published as PublicCapacity, 'general')).toBe(before - 1);

    const events = await bedEventsOf(bedAt(0));
    expect(events.at(-1)).toMatchObject({
      type: 'ADMIT',
      to_state: 'occupied',
      actor_staff_id: fixture.wardStaffId,
    });
  });

  it('broadcasts the bed and the published figure to the board room, naming nobody', async () => {
    const patient = deskPatient('নাসরিন আক্তার (ডেমো)');
    await act(`/beds/${bedAt(0)}/admit`, { patient });

    const room = emitted.forRoom(ROOMS.beds(fixture.hospitalId));
    expect(room.map((entry) => entry.event)).toEqual(
      expect.arrayContaining(['bed.updated', 'capacity.updated']),
    );
    const serialised = JSON.stringify(room);
    expect(serialised).not.toContain(patient.name);
    expect(serialised).not.toContain(patient.phone);
  });

  it('answers a replay with what already happened, and admits once (SY-02)', async () => {
    const clientEventId = randomUUID();
    const first = await act(
      `/beds/${bedAt(0)}/admit`,
      { patient: deskPatient() },
      undefined,
      clientEventId,
    );
    const again = await act(
      `/beds/${bedAt(0)}/admit`,
      { patient: deskPatient() },
      undefined,
      clientEventId,
    );

    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.body.data.duplicate).toBe(true);

    const admissions = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM admissions WHERE bed_id = ${bedAt(0)}::uuid
    `.execute(db);
    expect(admissions.rows[0]?.n).toBe('1');
  });

  it('refuses to put one patient in two beds', async () => {
    const patient = deskPatient();
    expect((await act(`/beds/${bedAt(0)}/admit`, { patient })).status).toBe(200);

    const second = await act(`/beds/${bedAt(1)}/admit`, { patient });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({
      code: 'BED_CONFLICT',
      details: { reason: 'patient_already_admitted', bedId: bedAt(0) },
    });
    expect((await bedRow(bedAt(1))).state).toBe('free');
  });

  it('gives the last bed to exactly one of two consoles tapping at once', async () => {
    const [a, b] = await Promise.all([
      act(`/beds/${bedAt(0)}/admit`, { patient: deskPatient() }),
      act(`/beds/${bedAt(0)}/admit`, { patient: deskPatient() }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 422]);
    const loser = a.status === 422 ? a : b;
    expect(loser.body.error.code).toBe('BED_TRANSITION_INVALID');
  });

  it('discharges into cleaning, and frees the bed only when the cleaning is done', async () => {
    await act(`/beds/${bedAt(0)}/admit`, { patient: deskPatient() });
    const admissionId = (await bedRow(bedAt(0))).current_admission_id;

    const discharged = await act(`/beds/${bedAt(0)}/discharge`);
    expect(discharged.status).toBe(200);
    expect((await bedRow(bedAt(0))).state).toBe('cleaning');

    const closed = await sql<{ discharged_at: Date | null }>`
      SELECT discharged_at FROM admissions WHERE id = ${admissionId}::uuid
    `.execute(db);
    expect(closed.rows[0]?.discharged_at).not.toBeNull();

    // A dirty bed is not a free bed.
    expect((await act(`/beds/${bedAt(0)}/admit`, { patient: deskPatient() })).status).toBe(422);

    expect((await act(`/beds/${bedAt(0)}/clean-done`)).status).toBe(200);
    const cleaned = await bedRow(bedAt(0));
    expect(cleaned.state).toBe('free');
    expect(cleaned.last_cleaned_at).not.toBeNull();
  });

  it('moves a patient, and the stay and its forecast go with them', async () => {
    await act(`/beds/${bedAt(0)}/admit`, {
      patient: deskPatient(),
      expectedDischargeDate: dhakaDate(2),
    });
    const admissionId = (await bedRow(bedAt(0))).current_admission_id;

    const moved = await act(`/beds/${bedAt(0)}/transfer`, { toBedId: bedAt(1) });
    expect(moved.status).toBe(200);
    expect((moved.body.data.beds as BedView[]).map((bed) => bed.id).sort()).toEqual(
      [bedAt(0), bedAt(1)].sort(),
    );

    expect((await bedRow(bedAt(0))).state).toBe('cleaning');
    const target = await bedRow(bedAt(1));
    expect(target).toMatchObject({
      state: 'occupied',
      current_admission_id: admissionId,
      expected_discharge_date: dhakaDate(2),
    });
    expect((await bedEventsOf(bedAt(1))).at(-1)?.type).toBe('TRANSFER');
  });
});

// ---------------------------------------------------------------------------
// BTN-B06-RESERVE, BTN-B06-OOS, SEL-B06-EXPDIS
// ---------------------------------------------------------------------------

describe('holds, and a hold that lapses (BTN-B06-RESERVE)', () => {
  it('hides a held bed from the public, and gives it back the moment the hold lapses', async () => {
    const before = freeOf((await boardOf()).published, 'general');

    expect((await act(`/beds/${bedAt(0)}/reserve`, { minutes: 60 })).status).toBe(200);
    expect(freeOf((await boardOf()).published, 'general')).toBe(before - 1);

    // Run the clock forward by moving the deadline back.
    await sql`
      UPDATE beds SET reserved_until = now() - interval '1 minute' WHERE id = ${bedAt(0)}::uuid
    `.execute(db);

    // Public first: a family searching now is told the bed is free, before
    // anything has written the release.
    const published = await request(app).get(`${BASE}/hospitals/${fixture.hospitalId}`);
    expect(freeOf(published.body.data.beds as PublicCapacity, 'general')).toBe(before);

    // Then the board opens, and the release is written — by nobody.
    await boardOf();
    expect(await bedRow(bedAt(0))).toMatchObject({ state: 'free', reserved_until: null });
    expect((await bedEventsOf(bedAt(0))).at(-1)).toMatchObject({
      type: 'RELEASE',
      actor_staff_id: null,
    });
  });

  it('refuses a hold longer than the board offers', async () => {
    expect((await act(`/beds/${bedAt(0)}/reserve`, { minutes: 24 * 60 })).status).toBe(400);
  });
});

describe('out of service (BTN-B06-OOS)', () => {
  it('needs a reason, leaves the public total, and comes back on restore', async () => {
    const before = (await boardOf()).published.byKind.find((entry) => entry.kind === 'general');

    expect((await act(`/beds/${bedAt(0)}/oos`, { reason: '   ' })).status).toBe(400);
    expect((await act(`/beds/${bedAt(0)}/oos`, { reason: 'অক্সিজেন লাইন নষ্ট' })).status).toBe(200);

    const during = (await boardOf()).published.byKind.find((entry) => entry.kind === 'general');
    expect(during?.total).toBe((before?.total ?? 0) - 1);
    expect(during?.free).toBe((before?.free ?? 0) - 1);

    // A broken bed is not one to admit into.
    expect((await act(`/beds/${bedAt(0)}/admit`, { patient: deskPatient() })).status).toBe(422);

    expect((await act(`/beds/${bedAt(0)}/restore`)).status).toBe(200);
    expect((await bedRow(bedAt(0))).state).toBe('free');
  });
});

describe('expected discharge (FR-BED-04)', () => {
  it('is set on an occupied bed for today or later, and never in the past', async () => {
    await act(`/beds/${bedAt(0)}/admit`, { patient: deskPatient() });

    const past = await act(`/beds/${bedAt(0)}/expected-discharge`, { date: dhakaDate(-1) });
    expect(past.status).toBe(422);
    expect(past.body.error.details.guard).toBe('DISCHARGE_DATE_PAST');

    expect((await act(`/beds/${bedAt(0)}/expected-discharge`, { date: dhakaDate(1) })).status).toBe(
      200,
    );
    expect((await bedRow(bedAt(0))).expected_discharge_date).toBe(dhakaDate(1));

    expect((await act(`/beds/${bedAt(1)}/expected-discharge`, { date: dhakaDate(1) })).status).toBe(
      422,
    );
  });
});

// ---------------------------------------------------------------------------
// DB-P7
// ---------------------------------------------------------------------------

describe('reads that name a patient are audited (DB-P7, FR-SEC-03)', () => {
  it('writes a row when the bed panel shows who is in the bed', async () => {
    const patient = deskPatient('সেলিনা বেগম (ডেমো)');
    await act(`/beds/${bedAt(0)}/admit`, { patient });

    const panel = await request(app)
      .get(`${BASE}/beds/${bedAt(0)}`)
      .set('Authorization', bearer(fixture.wardToken));

    expect(panel.status).toBe(200);
    expect(panel.body.data.occupant.fullName).toBe(patient.name);

    const audit = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM audit_log
       WHERE action = 'RECORD_VIEW' AND subject_table = 'admissions'
         AND subject_id = ${panel.body.data.occupant.admissionId as string}::uuid
         AND actor_staff_id = ${fixture.wardStaffId}::uuid
    `.execute(db);
    expect(audit.rows[0]?.n).toBe('1');
  });

  it('writes nothing for an empty bed, because nobody was read', async () => {
    const panel = await request(app)
      .get(`${BASE}/beds/${bedAt(0)}`)
      .set('Authorization', bearer(fixture.wardToken));
    expect(panel.status).toBe(200);
    expect(panel.body.data.occupant).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FR-PAT-52, FR-BED-07
// ---------------------------------------------------------------------------

describe('a bed request, from the phone to the bed (FR-PAT-52, FR-BED-07)', () => {
  async function ask(
    kind = fixture.kind,
    patient = deskPatient('আমিনুল হক (ডেমো)'),
  ): Promise<{
    id: string;
    token: string;
    response: request.Response;
  }> {
    const response = await request(app)
      .post(`${BASE}/bed-requests`)
      .set('Idempotency-Key', randomUUID())
      .send({
        hospitalId: fixture.hospitalId,
        bedKind: kind,
        patient,
        note: 'রাতে পৌঁছাব',
        expectedArrivalAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
    return {
      id: response.body.data?.request?.id as string,
      token: response.body.data?.token as string,
      response,
    };
  }

  async function track(token: string): Promise<request.Response> {
    return await request(app).get(`${BASE}/bed-requests/track/${encodeURIComponent(token)}`);
  }

  it('is filed with no account and tracked by its link, and a second tap is the same request', async () => {
    const patient = deskPatient('মোস্তফা কামাল (ডেমো)');
    const first = await ask(fixture.kind, patient);

    expect(first.response.status).toBe(201);
    expect(first.response.body.data.trackUrl).toContain('/beds/request?t=');
    expect((await track(first.token)).body.data).toMatchObject({
      id: first.id,
      state: 'requested',
    });

    const again = await ask(fixture.kind, patient);
    expect(again.response.status).toBe(200);
    expect(again.id).toBe(first.id);
    expect(again.response.body.data.duplicate).toBe(true);
  });

  it('refuses a link that is not one', async () => {
    expect((await track('not.a.token-at-all-really')).status).toBe(401);
  });

  it('refuses a kind of bed the hospital does not have', async () => {
    const meghna = await sql<{ id: string }>`
      SELECT id FROM hospitals WHERE name_en LIKE 'Meghna Diagnostic Centre%' LIMIT 1
    `.execute(db);
    const response = await request(app)
      .post(`${BASE}/bed-requests`)
      .set('Idempotency-Key', randomUUID())
      .send({ hospitalId: meghna.rows[0]?.id, bedKind: 'icu', patient: deskPatient() });
    expect(response.status).toBe(400);
  });

  it('reaches the pending list, and reading the list is audited', async () => {
    const asked = await ask();

    const list = await request(app)
      .get(`${BASE}/hospitals/${fixture.hospitalId}/bed-requests`)
      .set('Authorization', bearer(fixture.wardToken));

    expect(list.status).toBe(200);
    const mine = (list.body.data.requests as { id: string; patientName: string }[]).find(
      (entry) => entry.id === asked.id,
    );
    expect(mine?.patientName).toBe('আমিনুল হক (ডেমো)');

    const audit = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM audit_log
       WHERE subject_table = 'bed_requests' AND subject_id = ${asked.id}::uuid
    `.execute(db);
    expect(Number(audit.rows[0]?.n)).toBeGreaterThanOrEqual(1);

    // The ward heard about it the moment it was filed.
    expect(emitted.forRoom(ROOMS.beds(fixture.hospitalId)).map((entry) => entry.event)).toContain(
      'bedrequest.updated',
    );
  });

  it('holds a real bed of the kind asked for, tells the family, and keeps the bed for them', async () => {
    const asked = await ask();

    const held = await act(`/bed-requests/${asked.id}/respond`, {
      action: 'hold',
      bedId: bedAt(0),
      minutes: 60,
    });
    expect(held.status).toBe(200);
    expect(held.body.data.request).toMatchObject({ state: 'held' });
    expect((await bedRow(bedAt(0))).state).toBe('reserved');

    const told = await sql<{ template_key: string }>`
      SELECT template_key FROM notifications WHERE params ->> 'bedRequestId' = ${asked.id}
    `.execute(db);
    expect(told.rows.map((row) => row.template_key)).toContain('bed.request_held');

    expect((await track(asked.token)).body.data.state).toBe('held');

    // The bed is the family's: not released by hand, not given to a walk-in.
    const released = await act(`/beds/${bedAt(0)}/release`);
    expect(released.status).toBe(422);
    expect(released.body.error.details.guard).toBe('HELD_FOR_REQUEST');
    expect((await act(`/beds/${bedAt(0)}/admit`, { patient: deskPatient() })).status).toBe(422);
  });

  it('refuses to hold a bed of a different kind from the one asked for', async () => {
    const icu = await createBedFixture(1, 'icu');
    const asked = await ask('icu');

    const response = await act(`/bed-requests/${asked.id}/respond`, {
      action: 'hold',
      bedId: bedAt(0),
      minutes: 60,
    });
    expect(response.status).toBe(422);
    expect(response.body.error.details.guard).toBe('KIND_MISMATCH');
    expect(icu.bedIds).toHaveLength(1);
  });

  it('confirms by admitting the family into the held bed', async () => {
    const asked = await ask();
    await act(`/bed-requests/${asked.id}/respond`, {
      action: 'hold',
      bedId: bedAt(0),
      minutes: 60,
    });

    const confirmed = await act(`/bed-requests/${asked.id}/respond`, {
      action: 'confirm',
      bedId: null,
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.request.state).toBe('confirmed');

    const stay = await sql<{ source: string; bed_request_id: string | null }>`
      SELECT a.source, a.bed_request_id FROM beds b
        JOIN admissions a ON a.id = b.current_admission_id
       WHERE b.id = ${bedAt(0)}::uuid
    `.execute(db);
    expect(stay.rows[0]).toEqual({ source: 'app_request', bed_request_id: asked.id });
  });

  it('declines, gives the held bed back to the public, and tells the family', async () => {
    const asked = await ask();
    await act(`/bed-requests/${asked.id}/respond`, {
      action: 'hold',
      bedId: bedAt(0),
      minutes: 60,
    });

    const declined = await act(`/bed-requests/${asked.id}/respond`, { action: 'decline' });
    expect(declined.status).toBe(200);
    expect(declined.body.data.request.state).toBe('declined');
    expect((await bedRow(bedAt(0))).state).toBe('free');

    const told = await sql<{ template_key: string }>`
      SELECT template_key FROM notifications WHERE params ->> 'bedRequestId' = ${asked.id}
    `.execute(db);
    expect(told.rows.map((row) => row.template_key)).toContain('bed.request_declined');

    // Answered once. A second answer is to a request no longer waiting.
    expect((await act(`/bed-requests/${asked.id}/respond`, { action: 'decline' })).status).toBe(
      409,
    );
  });

  it('tells the family their hold has run out, the moment it runs out', async () => {
    const asked = await ask();
    await act(`/bed-requests/${asked.id}/respond`, {
      action: 'hold',
      bedId: bedAt(0),
      minutes: 30,
    });

    await sql`
      UPDATE bed_requests SET hold_expires_at = now() - interval '1 minute' WHERE id = ${asked.id}::uuid
    `.execute(db);
    await sql`
      UPDATE beds SET reserved_until = now() - interval '1 minute' WHERE id = ${bedAt(0)}::uuid
    `.execute(db);

    // No board has opened; the family is told the truth anyway.
    expect((await track(asked.token)).body.data.state).toBe('expired');

    // And when the board does open, the log catches up.
    await boardOf();
    const stored = await sql<{ state: string }>`
      SELECT state FROM bed_requests WHERE id = ${asked.id}::uuid
    `.execute(db);
    expect(stored.rows[0]?.state).toBe('expired');
  });
});

// ---------------------------------------------------------------------------
// FR-BED-06 — step 14's definition of done
// ---------------------------------------------------------------------------

describe('the mirror matches what the public is shown (FR-BED-06)', () => {
  it('counts the same free and total, kind by kind, after every kind of change', async () => {
    await act(`/beds/${bedAt(0)}/admit`, { patient: deskPatient() });
    await act(`/beds/${bedAt(1)}/reserve`, { minutes: 30 });
    await act(`/beds/${bedAt(2)}/oos`, { reason: 'জানালার কাচ ভাঙা' });
    await act(`/beds/${bedAt(3)}/clean-start`);

    const { beds, published } = await boardOf();
    const board = tallyByKind(beds, new Date().toISOString() as Timestamp, BED_KINDS);

    // The board's own count, from its tiles, against the view's published row.
    expect(board.map(({ kind, total, free }) => ({ kind, total, free }))).toEqual(
      published.byKind.map(({ kind, total, free }) => ({ kind, total, free })),
    );
  });
});

// ---------------------------------------------------------------------------
// FR-PAT-14, FR-PAT-50
// ---------------------------------------------------------------------------

describe('what discovery publishes (FR-PAT-14, FR-PAT-50)', () => {
  it('puts beds and ICU on every hospital card, with their age', async () => {
    const response = await request(app).get(`${BASE}/hospitals`);
    const hospitals = response.body.data.hospitals as {
      nameEn: string;
      beds: PublicCapacity | null;
    }[];

    const shapla = hospitals.find((entry) => entry.nameEn.startsWith('Shapla'));
    expect(shapla?.beds?.icuTotal).toBeGreaterThan(0);
    expect(shapla?.beds?.bedsAsOf).not.toBeUndefined();

    // A diagnostic centre has no inpatient beds, which is not the same as
    // none free, and not the same as not knowing.
    const meghna = hospitals.find((entry) => entry.nameEn.startsWith('Meghna'));
    expect(meghna?.beds).toMatchObject({ bedTotal: 0, byKind: [], icuTotal: null });
  });

  it('narrows to hospitals that have the kind of bed asked for, full or not', async () => {
    const response = await request(app).get(`${BASE}/hospitals?bedKind=burn`);
    const names = (response.body.data.hospitals as { nameEn: string }[])
      .map((entry) => entry.nameEn)
      .sort();

    expect(names).toHaveLength(2);
    expect(names[0]).toMatch(/^Jamuna/);
    expect(names[1]).toMatch(/^Padma/);
  });
});
