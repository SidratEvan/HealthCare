/**
 * `FR-DEM-05` — eight ambulances, thirty blood donors, fifty pharmacy items.
 *
 * Unblocked at step 17 by migration `0011_ancillary.sql`. Until that landed
 * this module declared what it was waiting for and the runner skipped it,
 * printing the migration's name; the declaration is gone because the tables
 * are there.
 *
 * ## Only one of the three has a screen in this version
 *
 * `pharmacy_stock` is read by `S-B-09` and the patient's medicine search
 * (`FR-PHR-02`, step 17). The ambulances and the donors have none — `S-A-16`
 * and `S-A-17` are later steps — and they are written anyway, because
 * `FR-DEM-05` is a requirement about the demo *database* and the rows are
 * what a hospital director looking at Supabase's table editor is shown.
 *
 * ## What was blocked on more than a table, and how it is handled
 *
 * A blood donor is a real person's phone number and blood group, which is the
 * category `FR-SEC-08` forbids inventing carelessly. Every donor here is a
 * declared demo person: the name is Bangladeshi and invented, the number comes
 * from the synthetic `donor` block (`lib/demo.ts`), and `FR-DEM-07`'s label is
 * on the row. Nothing is drawn from anywhere real.
 *
 * A pharmacy item is a medicine, and the formulary is clinical content that
 * arrived with `0007` (`seed_04_history.insertFormulary`). This module writes
 * no medicine of its own: it puts the ten that exist on five shelves, which
 * is `FR-DEM-05`'s fifty.
 */

import { time, type Timestamp } from '@platform/domain';

import { DEMO_AMBULANCES, DEMO_DONORS, DEMO_SHELVES } from './data/ancillary.js';
import { demoPhone, labelBn, taka } from './lib/demo.js';
import { insertRows } from './lib/insert.js';
import { facilityIds, staffByRole } from './lib/lookup.js';

import type { SeedContext, SeedModule, SeedSummary } from './lib/runner.js';
import type { Client } from 'pg';

export const seed06Ancillary: SeedModule = {
  name: 'seed_06_ancillary',
  title: 'ambulances, blood donors and pharmacy stock',
  requirements: ['FR-DEM-05'],
  writes: [
    'ambulances',
    'blood_donors',
    'pharmacy_stock',
    'patient_documents',
    'reception_desks',
    'reception_desk_doctors',
  ],

  async run({ client, now, log }: SeedContext): Promise<SeedSummary> {
    const facilities = await facilityIds(client);

    const ambulances = await insertAmbulances(client, facilities);
    const donors = await insertDonors(client, now);
    const stock = await insertStock(client, facilities, now);
    const papers = await insertPatientPapers(client);
    const desks = await insertDesks(client, facilities);

    log(
      `      ${String(ambulances)} ambulances, ${String(donors)} blood donors, ` +
        `${String(stock)} pharmacy items across ${String(DEMO_SHELVES.length)} shelves`,
    );
    log('      no ambulance or blood requests: S-A-16 and S-A-17 are later steps');
    log(`      ${String(papers)} old papers patients added to their own records (FR-PAT-62)`);
    log(
      `      ${String(desks.desks)} reception desks at Padma, ${String(desks.doctors)} doctors assigned (FR-REC-32)`,
    );

    return {
      ambulances,
      blood_donors: donors,
      pharmacy_stock: stock,
      patient_documents: papers,
      reception_desks: desks.desks,
      reception_desk_doctors: desks.doctors,
    };
  },
};

/**
 * The vehicles (`FR-PAT-74`).
 *
 * The operator's name carries the demo label, because it is the string a
 * family would read on a card. The driver's number comes from the `staff`
 * block: a driver is not a patient and not a donor, and the block exists so
 * that adding a person of a new kind cannot collide with either.
 */
async function insertAmbulances(
  client: Client,
  facilities: ReadonlyMap<string, string>,
): Promise<number> {
  const rows = DEMO_AMBULANCES.map((ambulance, index) => [
    ambulance.facilitySlug === null ? null : required(facilities, ambulance.facilitySlug),
    labelBn(ambulance.operator),
    ambulance.kind,
    ambulance.plate,
    ambulance.driver,
    demoPhone('staff', 100 + index),
    taka(ambulance.baseFare),
    taka(ambulance.perKm),
    ambulance.available,
  ]);

  const inserted = await insertRows<{ id: string }>(
    client,
    'ambulances',
    {
      columns: [
        'hospital_id',
        'operator_name',
        'kind',
        'plate',
        'driver_name',
        'driver_phone',
        'base_fare_poisha',
        'per_km_poisha',
        'is_available',
      ],
    },
    rows,
  );

  return inserted.length;
}

/**
 * The donors (`FR-PAT-75`).
 *
 * `user_id` is null for every one: none of them has an account, because this
 * version has no accounts (`CLAUDE.md` §4.1). The column is there for the
 * donor who registers through the app once Supabase Auth lands.
 */
async function insertDonors(client: Client, now: Timestamp): Promise<number> {
  const rows = DEMO_DONORS.map((donor, index) => [
    labelBn(donor.name),
    demoPhone('donor', index + 1),
    donor.group,
    donor.district,
    donor.lastDonationDaysAgo === null ? null : dateDaysAgo(now, donor.lastDonationDaysAgo),
    donor.available,
  ]);

  const inserted = await insertRows<{ id: string }>(
    client,
    'blood_donors',
    {
      columns: ['name', 'phone', 'blood_group', 'district', 'last_donation_date', 'is_available'],
    },
    rows,
  );

  return inserted.length;
}

/**
 * The shelves (`FR-PHR-02`).
 *
 * Every medicine in the formulary, on every facility that keeps a dispensary,
 * flagged in stock except what `DEMO_SHELVES` says that pharmacy has run out
 * of. `updated_at` is set explicitly to the declared age, because it is not
 * bookkeeping here: it is the freshness the patient app renders, and one
 * shelf is deliberately two days old so the lapse to "জানা নেই" is visible in
 * the demo rather than only in a test.
 *
 * `created_by` is the pharmacy's own staff account where the facility has
 * one, which is what a flag confirmed by a person looks like.
 */
async function insertStock(
  client: Client,
  facilities: ReadonlyMap<string, string>,
  now: Timestamp,
): Promise<number> {
  const medicines = await loadMedicines(client);
  if (medicines.length === 0) {
    throw new Error('No medicines to stock; seed_04_history must run first.');
  }

  const pharmacists = await staffByRole(client, 'pharmacy');

  const rows: unknown[][] = [];
  for (const shelf of DEMO_SHELVES) {
    const hospitalId = required(facilities, shelf.facilitySlug);
    const confirmedAt = time.addMinutes(now, -shelf.confirmedHoursAgo * 60);

    for (const medicine of medicines) {
      rows.push([
        hospitalId,
        medicine.id,
        !shelf.outOfStock.includes(medicine.generic),
        pharmacists.get(shelf.facilitySlug) ?? null,
        confirmedAt,
      ]);
    }
  }

  const inserted = await insertRows<{ id: string }>(
    client,
    'pharmacy_stock',
    { columns: ['hospital_id', 'medicine_id', 'in_stock', 'created_by', 'updated_at'] },
    rows,
  );

  return inserted.length;
}

async function loadMedicines(client: Client): Promise<{ id: string; generic: string }[]> {
  const { rows } = await client.query<{ id: string; generic_name: string }>(
    `SELECT id, generic_name FROM medicines WHERE deleted_at IS NULL ORDER BY generic_name`,
  );
  return rows.map((row) => ({ id: row.id, generic: row.generic_name }));
}

/** A `YYYY-MM-DD` date that many days before now, in Dhaka. */
function dateDaysAgo(now: Timestamp, days: number): string {
  // Dhaka, not UTC: `blood_donors_last_donation_not_future` compares against
  // `current_date`, and a donation "today" written in UTC is tomorrow's date
  // for the first six hours of a Dhaka day.
  return time.toDhakaDate(time.addMinutes(now, -days * 24 * 60));
}

function required(map: ReadonlyMap<string, string>, key: string): string {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`No facility for "${key}". Has seed_01 run?`);
  }
  return value;
}

/**
 * Old papers patients added to their own records (`FR-PAT-62`; plan R3).
 *
 * One each for the first profiles held by demo accounts, so a signed-in demo
 * patient has something under "old papers" and a doctor shown their consent
 * code sees it labelled as the patient's. The file is the store's demo
 * placeholder (`documents/demo/`), a page that says it is demonstration
 * data, as the seeded lab reports are. The doctors named are invented and
 * labelled; nothing here is a real person's paper (`FR-SEC-08`).
 */
const DEMO_PAPERS = [
  { docType: 'prescription', doctorName: 'ডা. আনোয়ার হোসেন (ডেমো)', daysAgo: 420 },
  { docType: 'report', doctorName: null, daysAgo: 210 },
  { docType: 'discharge', doctorName: 'ডা. নাসরিন সুলতানা (ডেমো)', daysAgo: 760 },
] as const;

async function insertPatientPapers(client: Client): Promise<number> {
  const result = await client.query(
    `WITH held AS (
       SELECT p.id, p.owner_user_id, row_number() OVER (ORDER BY p.id) AS n
         FROM patients p
        WHERE p.owner_user_id IS NOT NULL AND p.deleted_at IS NULL
        ORDER BY p.id
        LIMIT 12
     ), kinds AS (
       SELECT * FROM jsonb_to_recordset($1::jsonb)
         AS k(i int, "docType" text, "doctorName" text, "daysAgo" int)
     ), papers AS (
       -- One id per row: a volatile function in a select list is evaluated for
       -- each row, where an uncorrelated LATERAL subquery is evaluated once.
       SELECT uuid_generate_v7() AS id, held.id AS patient_id, held.owner_user_id,
              k."docType", k."doctorName", k."daysAgo"
         FROM held
         JOIN kinds k ON k.i = (held.n - 1) % $2
     )
     INSERT INTO patient_documents
       (id, patient_id, file_url, doc_type, doc_date, doctor_name_text, content_type,
        uploaded_by_user, uploaded_at)
     SELECT p.id, p.patient_id, 'documents/demo/' || p.id || '.pdf', p."docType",
            (now() AT TIME ZONE 'Asia/Dhaka')::date - p."daysAgo",
            p."doctorName", 'application/pdf', p.owner_user_id, now() - interval '3 days'
       FROM papers p`,
    [JSON.stringify(DEMO_PAPERS.map((paper, i) => ({ i, ...paper }))), DEMO_PAPERS.length],
  );
  return result.rowCount ?? 0;
}

/**
 * Two reception desks at Padma (`FR-REC-32`; plan R4), its doctors split
 * between them, so the picker shows a desk's chambers first. The other five
 * hospitals have none, which is the ordinary state: one common workspace.
 */
async function insertDesks(
  client: Client,
  facilities: ReadonlyMap<string, string>,
): Promise<{ desks: number; doctors: number }> {
  const hospitalId = required(facilities, 'padma-specialised');
  const made = await client.query<{ id: string }>(
    `INSERT INTO reception_desks (hospital_id, name_bn, name_en)
     VALUES ($1, 'নিচতলা কাউন্টার (ডেমো)', 'Ground-floor counter (Demo)'),
            ($1, 'দোতলা কাউন্টার (ডেমো)', 'First-floor counter (Demo)')
     RETURNING id`,
    [hospitalId],
  );
  const [ground, first] = made.rows;
  if (ground === undefined || first === undefined) throw new Error('desk insert returned no rows.');
  const assigned = await client.query(
    `INSERT INTO reception_desk_doctors (desk_id, doctor_id, hospital_id)
     SELECT CASE WHEN here.n % 2 = 1 THEN $2::uuid ELSE $3::uuid END, here.doctor_id, $1
       FROM (SELECT doctor_id, row_number() OVER (ORDER BY doctor_id) AS n
               FROM (SELECT DISTINCT doctor_id FROM doctor_hospitals
                      WHERE hospital_id = $1) AS distinct_doctors) AS here`,
    [hospitalId, ground.id, first.id],
  );
  return { desks: made.rowCount ?? 0, doctors: assigned.rowCount ?? 0 };
}
