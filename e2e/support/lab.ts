/**
 * What `lab-report.spec.ts` needs that `console.ts` does not already give it
 * (`FR-LAB-*`, `FR-PHR-02`, step 17).
 *
 * The same rules as the rest of `e2e/support`: real seeded rows, real
 * endpoints, real tokens. Nothing here inserts a test order or a report
 * directly — the spec's whole point is that the product writes them.
 */

import { Client } from 'pg';

import { signToken } from '../../backend/api/src/config/jwt.js';

import { E2E_DATABASE_URL } from './database.js';

const DATABASE_URL = E2E_DATABASE_URL;

/** The lab and pharmacy principals at one hospital. */
export interface LabSession {
  readonly labToken: string;
  readonly labStaffId: string;
  readonly pharmacyToken: string;
}

async function withClient<T>(body: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    connectionString: DATABASE_URL,
    options: '-c search_path=public,extensions',
  });
  await client.connect();
  try {
    return await body(client);
  } finally {
    await client.end();
  }
}

async function staffAt(client: Client, hospitalId: string, role: string): Promise<string> {
  const staff = await client.query<{ id: string }>(
    `SELECT su.id
       FROM staff_users su
       JOIN staff_roles sr ON sr.staff_user_id = su.id
      WHERE su.hospital_id = $1 AND sr.role = $2::staff_role AND su.deleted_at IS NULL
      LIMIT 1`,
    [hospitalId, role],
  );

  const id = staff.rows[0]?.id;
  if (id === undefined) throw new Error(`No ${role} seeded at hospital ${hospitalId}.`);
  return id;
}

/** The bench and the counter at a hospital, as the picker would hand them over. */
export async function labSession(hospitalId: string): Promise<LabSession> {
  return await withClient(async (client) => {
    const labStaffId = await staffAt(client, hospitalId, 'lab');
    const pharmacyStaffId = await staffAt(client, hospitalId, 'pharmacy');

    return {
      labStaffId,
      labToken: await signToken({
        kind: 'access',
        claims: { sub: labStaffId, kind: 'staff', hospitalId, roles: ['lab'] },
      }),
      pharmacyToken: await signToken({
        kind: 'access',
        claims: { sub: pharmacyStaffId, kind: 'staff', hospitalId, roles: ['pharmacy'] },
      }),
    };
  });
}

/** The test orders a booking's consultation produced, as the database has them. */
export async function ordersForBooking(bookingId: string): Promise<
  {
    readonly id: string;
    readonly testCode: string;
    readonly state: string;
    readonly reportDeliveredAt: Date | null;
  }[]
> {
  return await withClient(async (client) => {
    const result = await client.query<{
      id: string;
      test_code: string;
      state: string;
      delivered_to_wallet_at: Date | null;
    }>(
      `SELECT t.id, t.test_code, t.state::text AS state, r.delivered_to_wallet_at
         FROM test_orders t
         JOIN visits v ON v.id = t.visit_id
         LEFT JOIN reports r ON r.test_order_id = t.id AND r.deleted_at IS NULL
        WHERE v.booking_id = $1 AND t.deleted_at IS NULL
        ORDER BY t.created_at`,
      [bookingId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      testCode: row.test_code,
      state: row.state,
      reportDeliveredAt: row.delivered_to_wallet_at,
    }));
  });
}

/** A medicine this hospital's shelf carries, for the pharmacy spec. */
export async function stockedMedicine(hospitalId: string): Promise<{
  readonly medicineId: string;
  readonly genericName: string;
}> {
  return await withClient(async (client) => {
    const result = await client.query<{ medicine_id: string; generic_name: string }>(
      `SELECT s.medicine_id, m.generic_name
         FROM pharmacy_stock s
         JOIN medicines m ON m.id = s.medicine_id
        WHERE s.hospital_id = $1 AND s.deleted_at IS NULL
        ORDER BY m.generic_name
        LIMIT 1`,
      [hospitalId],
    );

    const row = result.rows[0];
    if (row === undefined) {
      throw new Error(`No pharmacy stock seeded at ${hospitalId} (FR-DEM-05).`);
    }
    return { medicineId: row.medicine_id, genericName: row.generic_name };
  });
}

/** What the public availability search says about one medicine at one pharmacy. */
export async function publishedAnswer(
  medicineId: string,
  hospitalId: string,
  genericName: string,
): Promise<string | null> {
  const response = await fetch(
    `http://localhost:4000/api/v1/medicines?q=${encodeURIComponent(genericName)}`,
  );
  if (!response.ok) throw new Error(`/medicines failed: ${String(response.status)}`);

  const body = (await response.json()) as {
    data: {
      medicines: {
        medicineId: string;
        pharmacies: { hospitalId: string; answer: string }[];
      }[];
    };
  };

  const medicine = body.data.medicines.find((entry) => entry.medicineId === medicineId);
  return medicine?.pharmacies.find((entry) => entry.hospitalId === hospitalId)?.answer ?? null;
}
