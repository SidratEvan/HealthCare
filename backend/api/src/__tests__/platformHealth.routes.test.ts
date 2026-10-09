/**
 * How a hospital is doing, and what was done to it, on the platform's screen
 * (`PRD.md` `FR-SUP-06`, `FR-ONB-07`; `S-B-12`; migration 0052; plan G2).
 *
 * Three figures about an organisation (the age of what it publishes, what
 * became of a week's messages, how late its consoles' work arrived) and its
 * trail of changes. What must hold beside them: only a platform administrator
 * reads any of it; what is flagged is what the rule says and nothing more;
 * and no patient is in any answer, the trail included, though the same table
 * holds rows about patients (`FR-ONB-08`).
 *
 * Runs against the seeded demo database (CLAUDE.md §6). The seed gives
 * Karnaphuli a counter whose line drops and a provider that fails a few
 * messages; the other five have neither.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { sql } from 'kysely';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { AUDIT_CHANGES, isAuditChange } from '@platform/domain';
import { AUDIT_CHANGE_NAMES, AUDIT_CHANGE_UNNAMED, auditChangeName } from '@platform/i18n';

import { createApp } from '../app.js';
import { signToken } from '../config/jwt.js';

import { asOwner } from './support/ownerDb.js';
import { seededPlatformAdminId } from './support/queueFixture.js';
import { bearer, nationalToken, patientToken, staffToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

/** The seed's hospital with a poor line (`seed_04_history`). */
const POOR_LINE = 'KARNAPHULI';
/** One the seed gives neither. Other suites work its chambers while this one runs. */
const ORDINARY = 'SHAPLA';

let app: Express;
let platform: string;
let platformStaffId: string;
let poorLine: string;
let ordinary: string;

interface Health {
  readonly figures: readonly {
    readonly figure: string;
    readonly shared: boolean;
    readonly asOf: string | null;
    readonly ageMinutes: number | null;
    readonly stale: boolean;
  }[];
  readonly messages: { sent: number; failed: number; held: number; waiting: number };
  readonly sync: { lateActions: number; slowestSeconds: number; lastLateAt: string | null };
  readonly attention: readonly string[];
  readonly stalest: { readonly figure: string; readonly ageMinutes: number } | null;
  readonly staleAfterMinutes: number;
  readonly asOf: string;
}

async function hospitalByCode(code: string): Promise<string> {
  const row = await asOwner(
    async (owner) =>
      await sql<{ id: string }>`
        SELECT id FROM hospitals WHERE code = ${code} AND deleted_at IS NULL
      `.execute(owner),
  );
  const id = row.rows[0]?.id;
  if (id === undefined) throw new Error(`The seed has no hospital coded ${code}.`);
  return id;
}

async function get(path: string, token: string | null = platform): Promise<request.Response> {
  const pending = request(app).get(`${BASE}${path}`);
  return await (token === null ? pending : pending.set('Authorization', bearer(token)));
}

/**
 * What the tables hold for a hospital now, counted as the owner by the
 * definitions `fn_workspace_health` uses. Other suites send messages and sync
 * late work at the seeded hospitals while this one runs, so a figure is
 * checked against the count on either side of the read, not against a number.
 */
async function counted(
  id: string,
): Promise<{ sent: number; failed: number; held: number; late: number }> {
  const result = await asOwner(
    async (owner) =>
      await sql<{ sent: number; failed: number; held: number; late: number }>`
        WITH msgs AS (
          SELECT n.state
            FROM notifications n
            JOIN bookings b ON b.id = (n.params ->> 'bookingId')::uuid
            JOIN sessions s ON s.id = b.session_id
           WHERE s.hospital_id = ${id}::uuid AND n.queued_at >= now() - interval '7 days'
        )
        SELECT
          (SELECT count(*)::int FROM msgs WHERE state IN ('sent', 'delivered')) AS sent,
          (SELECT count(*)::int FROM msgs WHERE state = 'failed') AS failed,
          (SELECT count(*)::int FROM msgs WHERE state = 'skipped') AS held,
          (SELECT count(*)::int
             FROM queue_events e JOIN sessions s ON s.id = e.session_id
            WHERE s.hospital_id = ${id}::uuid
              AND e.server_ts >= now() - interval '7 days'
              AND e.server_ts - e.client_ts > interval '60 seconds') AS late
      `.execute(owner),
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('nothing counted');
  return row;
}

async function healthOf(id: string): Promise<Health> {
  const response = await get(`/platform/hospitals/${id}`);
  expect(response.status).toBe(200);
  return response.body.data.health as Health;
}

beforeAll(async () => {
  app = createApp();

  const account = { id: await seededPlatformAdminId() };
  platformStaffId = account.id;
  platform = await signToken({
    kind: 'access',
    claims: { sub: account.id, kind: 'staff', roles: ['platform_admin'] },
  });

  poorLine = await hospitalByCode(POOR_LINE);
  ordinary = await hospitalByCode(ORDINARY);
});

describe('who reads an organisation’s trail (FR-ROLE-01, FR-ONB-08)', () => {
  it('needs a token', async () => {
    expect((await get(`/platform/hospitals/${ordinary}/audit`, null)).status).toBe(401);
  });

  it('refuses the hospital’s own administrator, its staff, a government viewer and a patient', async () => {
    for (const token of [
      await staffToken(['hospital_admin'], ordinary),
      await staffToken(['receptionist', 'doctor'], ordinary),
      await nationalToken(['gov_viewer']),
      await patientToken(),
    ]) {
      expect((await get(`/platform/hospitals/${ordinary}/audit`, token)).status).toBe(403);
    }
  });

  it('answers 404 for a hospital that is not there', async () => {
    expect((await get(`/platform/hospitals/${randomUUID()}/audit`)).status).toBe(404);
  });
});

describe('how a hospital is doing (FR-SUP-06)', () => {
  it('gives each figure it publishes an age, measured against its own threshold', async () => {
    for (const id of [poorLine, ordinary]) {
      const health = await healthOf(id);
      expect(health.staleAfterMinutes).toBeGreaterThan(0);
      // Both run beds and an emergency desk in the seed.
      expect(health.figures.map((entry) => entry.figure).sort()).toEqual(['beds', 'capabilities']);
      for (const figure of health.figures) {
        // Stale by the rule a patient's screen uses, and by nothing else.
        expect(figure.stale).toBe(
          figure.ageMinutes === null || figure.ageMinutes >= health.staleAfterMinutes,
        );
        if (figure.asOf !== null) expect(figure.ageMinutes).toBeGreaterThanOrEqual(0);
      }
      expect(Date.parse(health.asOf)).toBeGreaterThan(Date.now() - 60_000);
    }
  });

  it('reports no figure for a module the hospital does not run', async () => {
    // Buriganga, a clinic the seed gives no ward: beds are off there.
    const health = await healthOf(await hospitalByCode('BURIGANGA'));
    expect(health.figures.map((entry) => entry.figure)).not.toContain('beds');
  });

  it('counts a week’s messages by what became of them', async () => {
    // The seed's own: some went, the provider failed a few, a few had no
    // number to go to. Nothing un-fails a message, so these hold whatever
    // else this suite does to the database meanwhile.
    const poor = await healthOf(poorLine);
    expect(poor.messages.sent).toBeGreaterThan(0);
    expect(poor.messages.failed).toBeGreaterThan(0);
    expect(poor.messages.held).toBeGreaterThan(0);

    // And each count is the table's own, for a hospital other suites are
    // writing to as this runs: no lower than it was before the read, no
    // higher than it is after.
    for (const id of [poorLine, ordinary]) {
      const before = await counted(id);
      const { messages } = await healthOf(id);
      const after = await counted(id);
      for (const key of ['sent', 'failed', 'held'] as const) {
        expect(messages[key], key).toBeGreaterThanOrEqual(before[key]);
        expect(messages[key], key).toBeLessThanOrEqual(after[key]);
      }
    }
  });

  it('counts the actions that reached the server late, and how late the slowest was', async () => {
    const poor = await healthOf(poorLine);
    // The seed's stretch of an evening offline.
    expect(poor.sync.lateActions).toBeGreaterThan(0);
    expect(poor.sync.slowestSeconds).toBeGreaterThan(60);
    expect(poor.sync.slowestSeconds).toBeLessThanOrEqual(7 * 86_400);
    expect(poor.sync.lastLateAt).not.toBeNull();

    for (const id of [poorLine, ordinary]) {
      const before = await counted(id);
      const { sync } = await healthOf(id);
      const after = await counted(id);
      expect(sync.lateActions).toBeGreaterThanOrEqual(before.late);
      expect(sync.lateActions).toBeLessThanOrEqual(after.late);
      // None late is said as none: no delay and no time of one.
      if (sync.lateActions === 0) {
        expect(sync).toEqual({ lateActions: 0, slowestSeconds: 0, lastLateAt: null });
      }
    }
  });

  it('flags a message that did not go, a figure never confirmed, and nothing else', async () => {
    const poor = await healthOf(poorLine);
    expect(poor.attention).toContain('messages');

    for (const health of [poor, await healthOf(ordinary)]) {
      // By its own figures, whichever suite wrote them.
      expect(health.attention.includes('messages')).toBe(
        health.messages.failed > 0 || health.messages.waiting > 0,
      );
      // A figure that is merely stale is not flagged: it is ranked, by its age.
      expect(health.attention).not.toContain('stale_figures');
      const neverConfirmed = health.figures.some((figure) => figure.shared && figure.asOf === null);
      expect(health.attention.includes('unconfirmed_figures')).toBe(neverConfirmed);

      const staleAges = health.figures
        .filter((figure) => figure.shared && figure.stale && figure.ageMinutes !== null)
        .map((figure) => figure.ageMinutes ?? 0);
      if (staleAges.length === 0) {
        expect(health.stalest).toBeNull();
      } else {
        expect(health.stalest?.ageMinutes).toBe(Math.max(...staleAges));
      }
      // Late work, however much, is in no flag.
      expect(health.attention.every((entry) => !entry.includes('sync'))).toBe(true);
    }
  });

  it('says in the list which hospital needs attention, and keeps the figures for the opened one', async () => {
    const list = await get('/platform/hospitals');
    const rows = list.body.data.workspaces as {
      id: string;
      attention: string[];
      health?: unknown;
    }[];
    for (const row of rows) {
      expect(Array.isArray(row.attention)).toBe(true);
      expect(row.health).toBeUndefined();
      // The offender's age is in the list, to be read against the others'.
      expect(row).toHaveProperty('stalest');
    }
    expect(rows.find((row) => row.id === poorLine)?.attention).toContain('messages');
    // A row says what its opened workspace says.
    const opened = await healthOf(ordinary);
    const listed = rows.find((row) => row.id === ordinary)?.attention ?? [];
    if (!opened.attention.includes('messages')) expect(listed).not.toContain('messages');
  });
});

describe('what was done to an organisation (FR-ONB-07)', () => {
  it('lists what the platform just did, with who did it and that they were the platform', async () => {
    const began = Date.now() - 5_000;
    const set = await request(app)
      .put(`${BASE}/platform/hospitals/${ordinary}/agreement`)
      .set('Authorization', bearer(platform))
      .set('Idempotency-Key', randomUUID())
      .send({ state: 'active' });
    expect(set.status).toBe(200);

    const response = await get(`/platform/hospitals/${ordinary}/audit`);
    expect(response.status).toBe(200);
    const entries = response.body.data.entries as Record<string, unknown>[];
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.length).toBeLessThanOrEqual(50);
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual(['actorName', 'at', 'byPlatform', 'change', 'id']);
    }

    // Among the newest lines: other suites change this hospital's settings
    // while this one runs, so it is looked for and not assumed to be first.
    const mine = entries.find(
      (entry) =>
        entry['change'] === 'agreement_active' && Date.parse(entry['at'] as string) >= began,
    );
    expect(mine).toBeDefined();
    expect(mine?.['byPlatform']).toBe(true);
    expect(typeof mine?.['actorName']).toBe('string');
    expect(Date.parse(response.body.data.asOf as string)).toBeGreaterThan(Date.now() - 60_000);

    // Newest first.
    const times = entries.map((entry) => Date.parse(entry['at'] as string));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('holds how the hospital was brought on, by the platform and by its own administrator', async () => {
    // Read as the owner: fifty newer lines from other suites may stand in
    // front of the seed's on the screen, and the question here is the seed's.
    const seeded = await asOwner(
      async (owner) =>
        await sql<{ change: string; by_platform: boolean }>`
          SELECT a.meta ->> 'change' AS change, su.hospital_id IS NULL AS by_platform
            FROM audit_log a JOIN staff_users su ON su.id = a.actor_staff_id
           WHERE a.hospital_id = ${ordinary}::uuid AND a.meta ->> 'demo' = 'true'
           ORDER BY a.created_at
        `.execute(owner),
    );
    const changes = seeded.rows.map((row) => row.change);
    expect(changes[0]).toBe('workspace_created');
    expect(changes.indexOf('workspace_approve')).toBeGreaterThan(
      changes.indexOf('review_requested'),
    );
    expect(seeded.rows.find((row) => row.change === 'workspace_approve')?.by_platform).toBe(true);
    expect(seeded.rows.find((row) => row.change === 'department_added')?.by_platform).toBe(false);
  });

  it('holds nothing done for a patient, though the same table does (FR-ONB-08)', async () => {
    // A record opened, and a row that names a patient under an action the
    // trail does list: neither may arrive. Written as the owner, as the two
    // services that write them would.
    const patient = await asOwner(
      async (owner) =>
        await sql<{ id: string }>`
          SELECT b.patient_id AS id FROM bookings b
            JOIN sessions s ON s.id = b.session_id
           WHERE s.hospital_id = ${ordinary}::uuid LIMIT 1
        `.execute(owner),
    );
    const patientId = patient.rows[0]?.id ?? '';
    expect(patientId).not.toBe('');
    const marker = `probe_${randomUUID().slice(0, 8)}`;
    await asOwner(async (owner) => {
      await sql`
        INSERT INTO audit_log (actor_staff_id, hospital_id, action, subject_table, patient_id, meta)
        VALUES
          (${platformStaffId}::uuid, ${ordinary}::uuid, 'RECORD_VIEW', 'visits', ${patientId}::uuid,
           ${JSON.stringify({ change: marker })}::jsonb),
          (${platformStaffId}::uuid, ${ordinary}::uuid, 'SETTINGS_CHANGE', 'patients', ${patientId}::uuid,
           ${JSON.stringify({ change: marker })}::jsonb)
      `.execute(owner);
    });

    const response = await get(`/platform/hospitals/${ordinary}/audit`);
    const text = JSON.stringify(response.body);
    expect(text).not.toContain(marker);
    expect(text).not.toContain(patientId);
  });

  it('is one organisation’s: another hospital’s changes are not in it', async () => {
    const mine = (await get(`/platform/hospitals/${ordinary}/audit`)).body.data.entries as {
      id: string;
    }[];
    const theirs = (await get(`/platform/hospitals/${poorLine}/audit`)).body.data.entries as {
      id: string;
    }[];
    const ids = new Set(mine.map((entry) => entry.id));
    expect(theirs.some((entry) => ids.has(entry.id))).toBe(false);
  });
});

describe('no patient is in what the platform is sent (FR-ONB-08)', () => {
  it('not in a workspace’s health, and not in its trail', async () => {
    const people = await asOwner(
      async (owner) =>
        await sql<{ id: string }>`
          SELECT DISTINCT b.patient_id AS id
            FROM bookings b JOIN sessions s ON s.id = b.session_id
           WHERE s.hospital_id = ${poorLine}::uuid
           LIMIT 40
        `.execute(owner),
    );
    expect(people.rows.length).toBeGreaterThan(0);
    const text =
      JSON.stringify((await get(`/platform/hospitals/${poorLine}`)).body) +
      JSON.stringify((await get(`/platform/hospitals/${poorLine}/audit`)).body);
    for (const person of people.rows) expect(text).not.toContain(person.id);
  });
});

describe('every change a service writes has a name (AUDIT_CHANGES)', () => {
  it('a code written as a settings change and missing from the list fails here', () => {
    const services = resolve(import.meta.dirname, '../services');
    const written = new Set<string>();
    for (const file of readdirSync(services).filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(join(services, file), 'utf8');
      // `change: 'x'`, both arms of `change: cond ? 'x' : 'y'`, and the two
      // that are built: `workspace_${action}` and `agreement_${state}`.
      for (const match of source.matchAll(/change:\s*([^,\n]+)/g)) {
        for (const literal of (match[1] ?? '').matchAll(/'([a-z_0-9]+)'/g)) {
          if (literal[1] !== undefined) written.add(literal[1]);
        }
      }
    }
    // The scan found the ones it is known to find; an empty scan proves nothing.
    expect(written.has('department_added')).toBe(true);
    expect(written.has('portal_domain_removed')).toBe(true);
    expect([...written].filter((code) => !isAuditChange(code))).toEqual([]);

    for (const built of [
      'workspace_approve',
      'workspace_send_back',
      'workspace_suspend',
      'workspace_reinstate',
      'workspace_close',
      'agreement_trial',
      'agreement_active',
      'agreement_overdue',
      'agreement_ended',
      'import_checked',
      'import_committed',
      'import_undone',
      'import_discarded',
      'export',
    ]) {
      expect(isAuditChange(built), built).toBe(true);
    }
    expect(new Set(AUDIT_CHANGES).size).toBe(AUDIT_CHANGES.length);
  });

  it('and every code has a sentence in both languages, and no sentence is without a code', () => {
    expect(Object.keys(AUDIT_CHANGE_NAMES).sort()).toEqual([...AUDIT_CHANGES].sort());
    for (const code of AUDIT_CHANGES) {
      expect(auditChangeName(code, 'bn'), code).not.toBe(AUDIT_CHANGE_UNNAMED.bn);
      expect(auditChangeName(code, 'en'), code).not.toBe(AUDIT_CHANGE_UNNAMED.en);
    }
    // A code nobody knows is still said, and never as its code.
    expect(auditChangeName('something_new', 'bn')).toBe(AUDIT_CHANGE_UNNAMED.bn);
  });
});
