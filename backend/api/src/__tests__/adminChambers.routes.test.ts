/** Counts, tenant isolation and bounded query work (FR-ADM-12, FR-SEC-11). */
import { sql } from 'kysely';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import {
  chambersToday,
  CHAMBER_LIMIT,
  type ChamberSummary,
} from '../repositories/adminChambers.repo.js';
import { overview } from '../services/admin.service.js';

import { createQueueFixture, otherHospitalId, type QueueFixture } from './support/queueFixture.js';
import { bearer, nationalToken, patientToken, staffToken } from './support/tokens.js';

let fixture: QueueFixture;
beforeEach(async () => {
  fixture = await createQueueFixture(3);
  // The full suite appends hundreds of today's sessions. Put this fixture
  // inside the ordered board window; truncation is asserted separately.
  await sql`UPDATE sessions
    SET planned_start = date_trunc('day', now() AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'Asia/Dhaka'
    WHERE id = ${fixture.sessionId}::uuid`.execute(db);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function read(hospitalId = fixture.hospitalId) {
  return await request(createApp())
    .get('/api/v1/admin/overview')
    .set('authorization', bearer(await staffToken(['hospital_admin'], hospitalId)));
}
function chamberRows(response: { body: unknown }): readonly ChamberSummary[] {
  return (response.body as { data: { chambers: ChamberSummary[] } }).data.chambers;
}
describe('administration chamber summary', () => {
  it('includes scheduled/paused/ended/cancelled chambers and counts without a queue cache', async () => {
    await sql`UPDATE bookings SET status = CASE serial_number WHEN 1 THEN 'done'::booking_status
      WHEN 2 THEN 'no_show'::booking_status ELSE 'waiting'::booking_status END
      WHERE session_id = ${fixture.sessionId}::uuid`.execute(db);
    for (const status of ['scheduled', 'paused', 'ended', 'cancelled']) {
      await sql`UPDATE sessions SET status = ${status}::session_status WHERE id = ${fixture.sessionId}::uuid`.execute(
        db,
      );
      const response = await read();
      expect(response.status).toBe(200);
      const data = response.body.data as { chambers: ChamberSummary[]; date: string };
      expect(data.chambers.find((c) => c.sessionId === fixture.sessionId)).toMatchObject({
        status,
        waiting: 1,
        seen: 1,
        noShows: 1,
      });
      expect(data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(JSON.stringify(data)).not.toMatch(
        /patientId|bookingId|patientName|fullName|\+8801|diagnosis|intake|nowServingSerial/,
      );
    }
  });
  it('never switches scope from a hospital query parameter and excludes yesterday/deleted sessions', async () => {
    const foreign = await otherHospitalId(fixture.hospitalId);
    const own = await read();
    expect(chamberRows(own).some((c) => c.sessionId === fixture.sessionId)).toBe(true);
    const response = await request(createApp())
      .get(`/api/v1/admin/overview?hospitalId=${fixture.hospitalId}`)
      .set('authorization', bearer(await staffToken(['hospital_admin'], foreign)));
    expect(response.status).toBe(200);
    expect(chamberRows(response).some((c) => c.sessionId === fixture.sessionId)).toBe(false);
    await sql`UPDATE sessions SET session_date = session_date - 1 WHERE id = ${fixture.sessionId}::uuid`.execute(
      db,
    );
    expect(chamberRows(await read()).some((c) => c.sessionId === fixture.sessionId)).toBe(false);
    await sql`UPDATE sessions SET session_date = session_date + 1, deleted_at = now() WHERE id = ${fixture.sessionId}::uuid`.execute(
      db,
    );
    expect(chamberRows(await read()).some((c) => c.sessionId === fixture.sessionId)).toBe(false);
  });
  it('returns only own-hospital desks and represents multiple memberships', async () => {
    const foreign = await otherHospitalId(fixture.hospitalId);
    const desks = await sql<{ id: string; hospital_id: string }>`
      INSERT INTO reception_desks (hospital_id, name_bn, name_en)
      VALUES (${fixture.hospitalId}::uuid, 'ডেমো এক', 'Demo one'),
             (${fixture.hospitalId}::uuid, 'ডেমো দুই', 'Demo two'),
             (${foreign}::uuid, 'অন্য হাসপাতাল', 'Foreign desk')
      RETURNING id, hospital_id`.execute(db);
    try {
      for (const desk of desks.rows)
        await sql`INSERT INTO reception_desk_doctors (desk_id, doctor_id, hospital_id)
          VALUES (${desk.id}::uuid, ${fixture.doctorId}::uuid, ${desk.hospital_id}::uuid)`.execute(
          db,
        );
      const row = chamberRows(await read()).find((c) => c.sessionId === fixture.sessionId);
      expect(row).toBeDefined();
      for (const desk of desks.rows)
        expect(row?.desks.some((d) => d.id === desk.id)).toBe(
          desk.hospital_id === fixture.hospitalId,
        );
    } finally {
      await sql`DELETE FROM reception_desk_doctors WHERE desk_id = ANY(${desks.rows.map((d) => d.id)}::uuid[])`.execute(
        db,
      );
      await sql`UPDATE reception_desks SET deleted_at = now() WHERE id = ANY(${desks.rows.map((d) => d.id)}::uuid[])`.execute(
        db,
      );
    }
  });
  it.each(['receptionist', 'doctor', 'ward', 'emergency', 'lab', 'pharmacy'] as const)(
    'refuses %s',
    async (role) => {
      expect(
        (
          await request(createApp())
            .get('/api/v1/admin/overview')
            .set('authorization', bearer(await staffToken([role], fixture.hospitalId)))
        ).status,
      ).toBe(403);
    },
  );
  it('refuses anonymous, patient and national callers', async () => {
    expect((await request(createApp()).get('/api/v1/admin/overview')).status).toBe(401);
    for (const token of [await patientToken(), await nationalToken()]) {
      expect(
        (
          await request(createApp())
            .get('/api/v1/admin/overview')
            .set('authorization', bearer(token))
        ).status,
      ).toBe(403);
    }
  });
  it('uses the Bangladesh calendar day on either side of UTC 18:00, including New Year', async () => {
    await sql`UPDATE sessions SET session_date = '2026-12-31' WHERE id = ${fixture.sessionId}::uuid`.execute(
      db,
    );
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-31T17:59:59.999Z'));
    const before = await overview(fixture.hospitalId);
    expect(before.date).toBe('2026-12-31');
    expect(before.chambers.some((c) => c.sessionId === fixture.sessionId)).toBe(true);
    vi.setSystemTime(new Date('2026-12-31T18:00:00.000Z'));
    const after = await overview(fixture.hospitalId);
    expect(after.date).toBe('2027-01-01');
    expect(after.chambers.some((c) => c.sessionId === fixture.sessionId)).toBe(false);
  });
  it('keeps one SQL execution for hundreds of chambers, with an explicit response bound', async () => {
    const inserted = await sql<{ id: string }>`INSERT INTO sessions
      (hospital_id, doctor_id, department_id, room, session_date, planned_start, planned_end, capacity, fee_poisha)
      SELECT hospital_id, doctor_id, department_id, 'TEST', session_date, planned_start, planned_end, capacity, fee_poisha
      FROM sessions CROSS JOIN generate_series(1, ${CHAMBER_LIMIT + 1}) WHERE id = ${fixture.sessionId}::uuid
      RETURNING id`.execute(db);
    try {
      const execution = vi.spyOn(db.getExecutor(), 'executeQuery');
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
      const result = await chambersToday(fixture.hospitalId, date);
      expect(execution).toHaveBeenCalledTimes(1);
      expect(result.chambers).toHaveLength(CHAMBER_LIMIT);
      expect(result.chambersTruncated).toBe(true);
    } finally {
      vi.restoreAllMocks();
      await sql`UPDATE sessions SET deleted_at = now() WHERE id = ANY(${inserted.rows.map((r) => r.id)}::uuid[])`.execute(
        db,
      );
    }
  });
});
