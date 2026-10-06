/**
 * The scope a request works in reaches the database, and holds
 * (`FR-SEC-11`, `FR-NET-02`; `config/dbScope.ts`, `config/db.ts`, migration
 * 0043; plan B1).
 *
 * `database/tests/tenancy.test.ts` asks the policies directly. This asks the
 * other half: that the API really does tell the database who each connection
 * is working for — on a single query, inside a transaction, across a pool
 * whose connections are handed from one hospital's request to another's, and
 * with two hospitals' requests running at once.
 *
 * Every query here is one that forgets to say which hospital it wants.
 * This suite connects as the API's own role, which the policies bind.
 */

import { sql } from 'kysely';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { currentDbScope, runInDbScope, scopeOfPrincipal } from '../config/dbScope.js';
import { signToken } from '../config/jwt.js';
import { withTransaction } from '../repositories/transaction.js';

import { staffIdFor } from './support/queueFixture.js';
import { bearer } from './support/tokens.js';

const BASE = '/api/v1';

let a: string;
let b: string;
let bedsOfA: number;
let bedsOfB: number;
let bedsInAll: number;

/** The hospitals whose beds a query with no WHERE comes back with. */
async function hospitalsSeen(): Promise<string[]> {
  const result = await sql<{ hospital_id: string }>`
    SELECT DISTINCT hospital_id FROM beds
  `.execute(db);
  return result.rows.map((row) => row.hospital_id).sort();
}

async function bedCount(): Promise<number> {
  const result = await sql<{ n: string }>`SELECT count(*)::text AS n FROM beds`.execute(db);
  return Number(result.rows[0]?.n ?? '-1');
}

beforeAll(async () => {
  const found = await sql<{ id: string; n: string }>`
    SELECT h.id, (SELECT count(*) FROM beds x WHERE x.hospital_id = h.id)::text AS n
      FROM hospitals h
     WHERE EXISTS (SELECT 1 FROM beds x WHERE x.hospital_id = h.id)
     ORDER BY h.code
     LIMIT 2
  `.execute(db);
  const [first, second] = found.rows;
  if (first === undefined || second === undefined) {
    throw new Error('The seed should give two hospitals beds (FR-DEM-04).');
  }
  a = first.id;
  b = second.id;
  bedsOfA = Number(first.n);
  bedsOfB = Number(second.n);
  bedsInAll = await bedCount();
});

describe('the API is bound by the policies, not above them', () => {
  it('connects as a role that does not bypass row-level security', async () => {
    const role = await sql<{ bypass: boolean; superuser: boolean; tenant: boolean }>`
      SELECT r.rolbypassrls AS bypass, r.rolsuper AS superuser,
             pg_has_role(current_user, 'app_tenant', 'member') AS tenant
        FROM pg_roles r WHERE r.rolname = current_user
    `.execute(db);
    expect(role.rows[0]).toEqual({ bypass: false, superuser: false, tenant: true });
  });
});

describe('a scope reaches the database and holds (FR-SEC-11)', () => {
  it('outside any request, the server’s own work sees every hospital', async () => {
    expect(currentDbScope()).toEqual({ kind: 'system' });
    expect(await bedCount()).toBe(bedsInAll);
    expect(bedsInAll).toBeGreaterThan(bedsOfA);
  });

  it('a query that forgets its hospital returns only the caller’s', async () => {
    await runInDbScope({ kind: 'hospital', hospitalId: a }, async () => {
      expect(await hospitalsSeen()).toEqual([a]);
      expect(await bedCount()).toBe(bedsOfA);
    });
    await runInDbScope({ kind: 'hospital', hospitalId: b }, async () => {
      expect(await hospitalsSeen()).toEqual([b]);
      expect(await bedCount()).toBe(bedsOfB);
    });
  });

  it('holds for every statement of a transaction', async () => {
    await runInDbScope({ kind: 'hospital', hospitalId: a }, async () => {
      await withTransaction(async (trx) => {
        const first = await sql<{ n: string }>`SELECT count(*)::text AS n FROM beds`.execute(trx);
        const second = await sql<{ n: string }>`
          SELECT count(*)::text AS n FROM beds WHERE hospital_id = ${b}::uuid
        `.execute(trx);
        expect(Number(first.rows[0]?.n)).toBe(bedsOfA);
        expect(Number(second.rows[0]?.n)).toBe(0);
      });
    });
  });

  it('a connection handed from one hospital’s work to another’s says the new one', async () => {
    // One after the other, many times: the pool hands the same connections
    // back, last used for the other hospital.
    for (let round = 0; round < 12; round += 1) {
      const mine = round % 2 === 0 ? a : b;
      await runInDbScope({ kind: 'hospital', hospitalId: mine }, async () => {
        expect(await hospitalsSeen()).toEqual([mine]);
      });
    }
    // And back to the server's own work, on those same connections.
    expect(await bedCount()).toBe(bedsInAll);
  });

  it('two hospitals’ work running at once each see their own, however it interleaves', async () => {
    const work = async (mine: string, expected: number): Promise<void> => {
      await runInDbScope({ kind: 'hospital', hospitalId: mine }, async () => {
        for (let step = 0; step < 8; step += 1) {
          expect(await bedCount()).toBe(expected);
          expect(await hospitalsSeen()).toEqual([mine]);
        }
      });
    };

    await Promise.all([
      work(a, bedsOfA),
      work(b, bedsOfB),
      work(a, bedsOfA),
      work(b, bedsOfB),
      work(a, bedsOfA),
      work(b, bedsOfB),
    ]);
  });

  it('a platform administrator’s scope shows organisations and no patient (FR-ONB-08)', async () => {
    await runInDbScope({ kind: 'national' }, async () => {
      expect(await bedCount()).toBe(bedsInAll);
      const people = await sql<{ n: string }>`SELECT count(*)::text AS n FROM patients`.execute(db);
      const bookings = await sql<{ n: string }>`SELECT count(*)::text AS n FROM bookings`.execute(
        db,
      );
      expect(Number(people.rows[0]?.n)).toBe(0);
      expect(Number(bookings.rows[0]?.n)).toBe(0);
    });
  });
});

describe('the scope comes from the principal, and from nothing a request says', () => {
  it('a member of staff is scoped to the hospital their token names', () => {
    expect(
      scopeOfPrincipal({ kind: 'staff', id: 'x', hospitalId: a, roles: ['receptionist'] }),
    ).toEqual({ kind: 'hospital', hospitalId: a });
  });

  it('a national account, a patient, a guest and nobody have theirs', () => {
    expect(scopeOfPrincipal({ kind: 'national', id: 'x', roles: ['platform_admin'] })).toEqual({
      kind: 'national',
    });
    expect(scopeOfPrincipal({ kind: 'patient', id: 'x' })).toEqual({ kind: 'open' });
    expect(scopeOfPrincipal({ kind: 'guest', id: 'x', bookingId: null })).toEqual({ kind: 'open' });
    expect(scopeOfPrincipal(undefined)).toEqual({ kind: 'open' });
  });

  it('a request naming another hospital in its path is still its own hospital’s request', async () => {
    const app = createApp();
    const token = await signToken({
      kind: 'access',
      claims: { sub: await staffIdFor(a, 'ward'), kind: 'staff', hospitalId: a, roles: ['ward'] },
    });

    // Its own board: there.
    const own = await request(app)
      .get(`${BASE}/hospitals/${a}/beds`)
      .set('Authorization', bearer(token));
    expect(own.status).toBe(200);
    expect((own.body.data.beds as unknown[]).length).toBe(bedsOfA);

    // The other hospital's: refused by the route's own check, as before. And
    // had that check been forgotten, there would have been nothing to send.
    const other = await request(app)
      .get(`${BASE}/hospitals/${b}/beds`)
      .set('Authorization', bearer(token));
    expect(other.status).toBe(403);
    expect(JSON.stringify(other.body)).not.toContain('"beds"');
  });
});
