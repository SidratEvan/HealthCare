/**
 * The admin dashboard (BACKEND.md §7.7, `S-B-10`, `FR-ADM-01`..`FR-ADM-10`).
 *
 * What is proven here and nowhere else:
 *
 *   - **A caller cannot name a hospital.** The scope comes off the principal
 *     and there is no parameter to tamper with — which matters more on this
 *     router than on any other, because one read answers everything about a
 *     facility at once.
 *   - **No patient reaches the wire.** `DATABASE.md` §5 says an admin reads
 *     aggregates only, and this is the endpoint where a stray join would show.
 *   - **A figure nobody measured is null, not zero.** A wait that was never
 *     recorded must not arrive as 0 — it is the most flattering lie this
 *     screen could tell, and the one nobody would notice.
 *   - **An export is audited**, and the row names the view and the window.
 *   - **A CSV cannot execute.** A field beginning with `=` is quoted so a
 *     spreadsheet treats it as text.
 */

import { sql } from 'kysely';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import type { StaffRole } from '@platform/domain';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';
import { toCsv } from '../services/admin.service.js';

import {
  createQueueFixture,
  otherHospitalId,
  staffIdFor,
  type QueueFixture,
} from './support/queueFixture.js';
import { bearer, patientToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let fixture: QueueFixture;
let admin: string;

/** A wide window, so the seeded history is inside it. */
const FROM = '2026-01-01';
const TO = '2026-12-31';

beforeEach(async () => {
  app = createApp();
  fixture = await createQueueFixture(3);
  admin = await staff(['hospital_admin'], fixture.hospitalId);
});

async function staff(
  roles: readonly StaffRole[],
  hospitalId: string,
  sub?: string,
): Promise<string> {
  return await signToken({
    kind: 'access',
    claims: {
      sub: sub ?? (await staffIdFor(hospitalId, roles[0] ?? 'hospital_admin')),
      kind: 'staff',
      hospitalId,
      roles,
    },
  });
}

async function dashboard(token = admin, query = `from=${FROM}&to=${TO}`) {
  return await request(app)
    .get(`${BASE}/admin/dashboard?${query}`)
    .set('Authorization', bearer(token));
}

describe('who may open the dashboard (FR-ROLE-01)', () => {
  it('is an administrator', async () => {
    const response = await dashboard();
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it('is not a receptionist', async () => {
    const token = await staff(['receptionist'], fixture.hospitalId, fixture.receptionistId);
    await request(app)
      .get(`${BASE}/admin/dashboard`)
      .set('Authorization', bearer(token))
      .expect(403);
  });

  it('is not a doctor', async () => {
    const token = await staff(['doctor'], fixture.hospitalId, fixture.doctorStaffId);
    await request(app)
      .get(`${BASE}/admin/dashboard`)
      .set('Authorization', bearer(token))
      .expect(403);
  });

  it('is not a patient', async () => {
    await request(app)
      .get(`${BASE}/admin/dashboard`)
      .set('Authorization', bearer(await patientToken()))
      .expect(403);
  });

  it('is nobody at all without a token', async () => {
    await request(app).get(`${BASE}/admin/dashboard`).expect(401);
  });
});

describe('a caller cannot choose the hospital', () => {
  it('ignores a hospitalId in the query and answers for the caller’s own', async () => {
    // The whole reason this router takes no hospital parameter. An endpoint
    // that answered `?hospitalId=` would let one administrator read another
    // facility's revenue by editing a URL, with every query doing exactly as
    // it was told.
    const elsewhere = await otherHospitalId(fixture.hospitalId);

    const mine = await dashboard();
    const spoofed = await request(app)
      .get(`${BASE}/admin/dashboard?from=${FROM}&to=${TO}&hospitalId=${elsewhere}`)
      .set('Authorization', bearer(admin));

    expect(spoofed.status).toBe(200);
    expect(spoofed.body.data.revenue.byDoctor).toEqual(mine.body.data.revenue.byDoctor);
  });

  it('answers differently for two different hospitals', async () => {
    // Proves the scope is doing something, rather than every caller seeing the
    // same rows for a reason nothing here would catch.
    const elsewhere = await otherHospitalId(fixture.hospitalId);
    const theirs = await dashboard(await staff(['hospital_admin'], elsewhere));

    const mine = await dashboard();

    expect(theirs.status).toBe(200);
    expect(JSON.stringify(theirs.body.data.revenue.byDoctor)).not.toBe(
      JSON.stringify(mine.body.data.revenue.byDoctor),
    );
  });
});

describe('no patient reaches the wire (DATABASE.md §5)', () => {
  it('carries no patient id, name or phone number anywhere in the payload', async () => {
    const response = await dashboard();
    const body = JSON.stringify(response.body);

    const patients = await sql<{ id: string; full_name: string; phone: string | null }>`
      SELECT p.id, p.full_name, p.phone
        FROM patients p
        JOIN bookings b ON b.patient_id = p.id
        JOIN sessions s ON s.id = b.session_id
       WHERE s.hospital_id = ${fixture.hospitalId}
       LIMIT 20
    `.execute(db);

    expect(patients.rows.length).toBeGreaterThan(0);
    for (const patient of patients.rows) {
      expect(body).not.toContain(patient.id);
      expect(body).not.toContain(patient.full_name);
      if (patient.phone !== null) expect(body).not.toContain(patient.phone);
    }
  });
});

describe('the today view (FR-ADM-01)', () => {
  it('splits every booking into walk-in or booked', async () => {
    const response = await dashboard();
    const today = response.body.data.today;

    expect(today.walkin + today.bookedAhead).toBe(today.booked);
  });

  it('reports no wait rather than a zero one when nothing was measured', async () => {
    // The seeds record no `arrived_at` for a stretch of history, and a queue
    // nobody checked patients into has no wait. Zero would read as instant
    // service.
    const response = await dashboard();
    const today = response.body.data.today;

    if (today.waitsMeasured === 0) {
      expect(today.avgWaitMinutes).toBeNull();
      expect(today.longestWaitMinutes).toBeNull();
    } else {
      expect(today.avgWaitMinutes).not.toBeNull();
    }
  });

  it('defaults to today when no range is given', async () => {
    const response = await request(app)
      .get(`${BASE}/admin/dashboard`)
      .set('Authorization', bearer(admin))
      .expect(200);

    expect(response.body.data.range.from).toBe(response.body.data.range.to);
  });
});

describe('the range is checked, not quietly corrected', () => {
  it('refuses a range that ends before it starts', async () => {
    // Silently swapping them would answer a question nobody asked, and a
    // dashboard you cannot check is a dashboard you cannot trust.
    const response = await dashboard(admin, 'from=2026-06-01&to=2026-05-01');
    expect(response.status).toBe(400);
  });

  it('refuses a range wider than the limit', async () => {
    const response = await dashboard(admin, 'from=2000-01-01&to=2026-12-31');
    expect(response.status).toBe(400);
  });

  it('refuses a date that is not a date', async () => {
    const response = await dashboard(admin, 'from=last-tuesday&to=2026-12-31');
    expect(response.status).toBe(400);
  });
});

describe('loss and recovery (FR-ADM-03)', () => {
  it('reports prepaid money separately from what was actually lost', async () => {
    const response = await dashboard();
    const loss = response.body.data.loss;

    expect(loss.uncollectedPoisha).toBe(Math.max(0, loss.forgonePoisha - loss.prepaidPoisha));
    expect(loss.netLossPoisha).toBe(loss.uncollectedPoisha - loss.recoveredPoisha);
  });

  it('has no recovery rate on a window with nothing to recover', async () => {
    const response = await dashboard(admin, 'from=2020-01-01&to=2020-01-02');
    const loss = response.body.data.loss;

    expect(loss.noShowCount).toBe(0);
    expect(loss.recoveryRate).toBeNull();
  });
});

describe('revenue (FR-ADM-04)', () => {
  it('declares a zero for every service type nothing charges for', async () => {
    // Three of the four cannot have money in this version. A missing line
    // reads as "we did not look"; a zero says "we looked".
    const response = await dashboard();
    const services = response.body.data.revenue.byService as { label: string }[];

    expect(services.map((service) => service.label)).toEqual([
      'consultation',
      'test',
      'bed',
      'ambulance',
    ]);
  });

  it('reports what was billed as well as what was collected', async () => {
    // A hospital taking cash at the counter has billings a payment row never
    // sees. Reporting only collections would understate the window by most of
    // it.
    const response = await dashboard();
    expect(response.body.data.revenue.billedPoisha).toBeGreaterThan(0);
  });
});

describe('freshness (PRD.md §3.2)', () => {
  it('states the age of the snapshot, the referrals and the feedback separately', async () => {
    // Three different ages on one screen. One combined stamp would have to be
    // one of them and would lie about the others.
    const response = await dashboard();
    const freshness = response.body.data.freshness;

    expect(freshness).toHaveProperty('snapshotAt');
    expect(freshness).toHaveProperty('referralsAt');
    expect(freshness).toHaveProperty('feedbackAt');
    expect(typeof freshness.serverTs).toBe('string');
  });

  it('rebuilds the snapshot when it is stale, and stamps it', async () => {
    await sql`
      INSERT INTO analytics_refresh (view_name, refreshed_at)
      VALUES ('v_admin_daily', now() - interval '1 hour')
      ON CONFLICT (view_name) DO UPDATE SET refreshed_at = now() - interval '1 hour'
    `.execute(db);

    const response = await dashboard();
    const stamped = Date.parse(response.body.data.freshness.snapshotAt as string);

    expect(Date.now() - stamped).toBeLessThan(60_000);
  });
});

describe('export (FR-ADM-10)', () => {
  it('returns CSV as an attachment named for the view and the window', async () => {
    const response = await request(app)
      .get(`${BASE}/admin/export?view=trend&from=${FROM}&to=${TO}`)
      .set('Authorization', bearer(admin))
      .expect(200);

    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain(`trend-${FROM}-to-${TO}.csv`);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.text.split('\r\n')[0]).toContain('date');
  });

  it('writes an audit row naming the view and the window (DB-P7)', async () => {
    const before = new Date();

    await request(app)
      .get(`${BASE}/admin/export?view=revenue-doctor&from=${FROM}&to=${TO}`)
      .set('Authorization', bearer(admin))
      .expect(200);

    const rows = await sql<{ subject_table: string; meta: Record<string, unknown> }>`
      SELECT subject_table, meta FROM audit_log
       WHERE action = 'EXPORT'
         AND hospital_id = ${fixture.hospitalId}
         AND created_at >= ${before}
    `.execute(db);

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.subject_table).toBe('revenue-doctor');
    expect(rows.rows[0]?.meta['from']).toBe(FROM);
    expect(rows.rows[0]?.meta['to']).toBe(TO);
  });

  it('refuses a view that does not exist', async () => {
    await request(app)
      .get(`${BASE}/admin/export?view=everything`)
      .set('Authorization', bearer(admin))
      .expect(400);
  });

  it('is not open to a receptionist', async () => {
    const token = await staff(['receptionist'], fixture.hospitalId, fixture.receptionistId);
    await request(app)
      .get(`${BASE}/admin/export?view=trend`)
      .set('Authorization', bearer(token))
      .expect(403);
  });

  it('exports every view the screen offers', async () => {
    // A tab whose export 500s is a tab nobody finds out about until a director
    // clicks it in front of a room.
    const views = [
      'today',
      'trend',
      'loss',
      'revenue-doctor',
      'revenue-department',
      'revenue-method',
      'revenue-service',
      'staff',
      'beds',
      'referrals',
      'feedback',
      'forecast',
    ];

    for (const view of views) {
      const response = await request(app)
        .get(`${BASE}/admin/export?view=${view}&from=${FROM}&to=${TO}`)
        .set('Authorization', bearer(admin));

      expect(response.status, `${view} failed to export`).toBe(200);
    }
  });
});

describe('the CSV itself', () => {
  it('starts with a byte-order mark, so Excel reads Bangla', () => {
    // Without it Excel on Windows decodes the file as the system code page and
    // every doctor's name becomes mojibake — which makes the export useless
    // to the one person it exists for.
    const csv = toCsv(['name'], [['ডা. আনিসুর রহমান']]);
    expect(csv.codePointAt(0)).toBe(0xfeff);
    expect(csv).toContain('ডা. আনিসুর রহমান');
  });

  it('writes an empty field for a null, never a zero', () => {
    // A wait that was never measured must not arrive in a spreadsheet as 0 and
    // get averaged into somebody's board paper.
    const csv = toCsv(['a', 'b'], [[null, 0]]);
    expect(csv).toContain('\r\n,0\r\n');
  });

  it('quotes a field a spreadsheet would treat as a formula', () => {
    const csv = toCsv(['name'], [['=1+1']]);
    expect(csv).toContain(`"'=1+1"`);
  });

  it('escapes a quote by doubling it', () => {
    const csv = toCsv(['name'], [['Dr "Bob" Rahman']]);
    expect(csv).toContain('"Dr ""Bob"" Rahman"');
  });
});
