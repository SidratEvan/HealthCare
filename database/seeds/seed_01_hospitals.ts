/**
 * `FR-DEM-01` — the six demo facilities, and everything that belongs to a
 * facility rather than to a doctor: settings, departments, published
 * capabilities and staff.
 *
 * The facilities themselves are declared in `data/hospitals.ts`, which is the
 * demo set CLAUDE.md §8 refers to. This module writes them.
 *
 * Two details here are demo *content* rather than bookkeeping, and both exist
 * to make the emergency scenario an honest one (`PRD.md` §24 step 7):
 *
 *   - a capability is published with an `updated_at` of its own, staggered, so
 *     one facility's capacity data is deliberately stale. `FR-PAT-45` de-ranks
 *     a stale facility and `FR-OFF-04` labels it; a demo where every row was
 *     written a second ago cannot show either.
 *   - two declared capabilities are marked unavailable, so a burn case has a
 *     real choice between two hospitals instead of one obvious answer.
 */

import { DEMO_FACILITIES } from './data/hospitals.js';
import { composeName, rosterFor } from './data/people.js';
import { isDeclaredDistrict, specialty } from './data/reference.js';
import { DEMO_MARKER, DISABLED_PASSWORD, demoEmail, labelBn, labelEn } from './lib/demo.js';
import { insertRows } from './lib/insert.js';
import { facilityIds } from './lib/lookup.js';

import type { SeedContext, SeedModule, SeedSummary } from './lib/runner.js';

/**
 * Capabilities a facility has but cannot take a patient for right now.
 *
 * `capabilities.is_available` is a live operational fact, not a statement about
 * what the building contains — a burn unit with every bed occupied is a burn
 * unit that cannot accept the next burn case, and sending one there anyway is
 * the failure `FR-EMG-05` exists to prevent.
 */
const UNAVAILABLE: readonly { hospitalSlug: string; kind: string }[] = [
  // The cath lab is down, so a cardiac case routes to Shapla instead.
  { hospitalSlug: 'jamuna-medical-college', kind: 'cath_lab' },
  // Isolation is full at the larger private hospital.
  { hospitalSlug: 'shapla-general', kind: 'isolation' },
];

/**
 * How long ago each facility last confirmed its capability rows, in minutes.
 *
 * `hospital_settings.stale_threshold_minutes` defaults to 10 (`FR-OFF-04`), so
 * Karnaphuli's three-hour-old data reads as stale and Meghna's is on the edge.
 * That is the point: the patient-facing rule is that a live number always
 * carries its freshness and a stale one says so (`PRD.md` §3.2).
 */
const CAPABILITY_AGE_MINUTES: Readonly<Record<string, number>> = {
  'shapla-general': 3,
  'padma-specialised': 2,
  'karnaphuli-general': 190,
  'jamuna-medical-college': 7,
  'meghna-diagnostic': 45,
  'buriganga-clinic': 9,
};

/** Per-role email local part and ID-card code, in roster order. */
const ROLE_CODES: Readonly<Record<string, string>> = {
  hospital_admin: 'ADM',
  receptionist: 'REC',
  doctor: 'DOC',
  ward: 'WRD',
  emergency: 'EMR',
  lab: 'LAB',
  pharmacy: 'PHR',
};

export const seed01Hospitals: SeedModule = {
  name: 'seed_01_hospitals',
  title: 'six demo facilities, departments, capabilities and staff',
  requirements: ['FR-DEM-01', 'FR-DEM-07', 'FR-EMG-05'],
  writes: [
    'hospitals',
    'hospital_settings',
    'departments',
    'capabilities',
    'staff_users',
    'staff_roles',
  ],

  async run({ client, now, rng, log }: SeedContext): Promise<SeedSummary> {
    const names = rng.stream('staff-names');

    // --- hospitals ---------------------------------------------------------
    //
    // A district is checked against the declared list before it is written.
    // `hospitals.district` is an indexed text column that discovery search
    // filters on, so a typo there does not fail — it produces a facility
    // nobody can find, which is the worst kind of wrong (CLAUDE.md §8).
    for (const facility of DEMO_FACILITIES) {
      if (!isDeclaredDistrict(facility.division, facility.district)) {
        throw new Error(
          `${facility.slug} is in ${facility.district}, ${facility.division}, which is not in DEMO_DISTRICTS (data/reference.ts).`,
        );
      }
    }

    // `created_by` stays null. It references `staff_users`, which cannot exist
    // before the facility does, and more honestly: a seeded facility was not
    // created by a person. DB-P3 asks for `created_by` on rows a human made.
    const hospitalRows = DEMO_FACILITIES.map((facility) => [
      labelBn(facility.nameBn),
      labelEn(facility.nameEn),
      facility.kind,
      facility.division,
      facility.district,
      facility.thana,
      facility.addressBn,
      facility.addressEn,
      facility.lat,
      facility.lng,
      facility.phone,
      facility.emergencyPhone,
    ]);

    await insertRows(
      client,
      'hospitals',
      {
        columns: [
          'name_bn',
          'name_en',
          'kind',
          'division',
          'district',
          'thana',
          'address_bn',
          'address_en',
          'lat',
          'lng',
          'phone',
          'emergency_phone',
          'is_live',
          'onboarded_at',
        ],
        // Every demo facility is published and onboarded: an unverified
        // facility never appears in search (`hospitals_live_requires_onboarding`),
        // and a demo whose hospitals are invisible shows nothing.
        expressions: { is_live: 'true', onboarded_at: 'now()' },
      },
      hospitalRows,
      '',
    );

    const facilities = await facilityIds(client);

    // --- staff_users and staff_roles ---------------------------------------
    //
    // No authentication is built in this version (CLAUDE.md §4.1), so
    // `password_hash` gets a value that is deliberately not a hash and
    // `totp_secret` stays null. Nothing can authenticate as these people;
    // under `DEMO_MODE=true` the console selects a hospital and a role.
    const staffRows: unknown[][] = [];
    const staffKeys: { slug: string; role: string; counter: number }[] = [];

    for (const facility of DEMO_FACILITIES) {
      const hospitalId = facilities.get(facility.slug);
      if (hospitalId === undefined) throw new Error(`No id for ${facility.slug}.`);

      const prefix = facilityPrefix(facility.slug);

      for (const { role, count } of rosterFor(facility.kind)) {
        for (let n = 1; n <= count; n += 1) {
          const local = count === 1 ? role.replace('hospital_', '') : `${role}${String(n)}`;
          const code = ROLE_CODES[role];
          if (code === undefined) throw new Error(`No ID-card code for role ${role}.`);

          staffRows.push([
            hospitalId,
            demoEmail(local, facility.slug),
            `${prefix}-${code}-${String(n).padStart(2, '0')}`,
            labelBn(composeName(names, names.chance(0.55) ? 'female' : 'male')),
            DISABLED_PASSWORD,
          ]);
          staffKeys.push({ slug: facility.slug, role, counter: n });
        }
      }
    }

    const staffIds = await insertRows<{ id: string }>(
      client,
      'staff_users',
      {
        columns: ['hospital_id', 'email', 'staff_code', 'full_name', 'password_hash'],
      },
      staffRows,
    );

    /** Facility slug → that facility's hospital_admin, for `created_by`. */
    const admins = new Map<string, string>();
    const roleRows: unknown[][] = [];

    for (const [index, key] of staffKeys.entries()) {
      const staffId = staffIds[index]?.id;
      const hospitalId = facilities.get(key.slug);
      if (staffId === undefined || hospitalId === undefined) {
        throw new Error(`staff_users returned no id for ${key.slug}/${key.role}.`);
      }
      if (key.role === 'hospital_admin') admins.set(key.slug, staffId);

      roleRows.push([
        staffId,
        hospitalId,
        key.role,
        JSON.stringify(
          key.role === 'receptionist'
            ? { ...DEMO_MARKER, counters: [`R${String(key.counter)}`] }
            : DEMO_MARKER,
        ),
      ]);
    }

    // `FR-ROLE-02`: a staff member may hold several roles. The clinic's
    // administrator also works the counter, which is how a four-person clinic
    // actually runs — and it is the case a role check has to get right.
    const clinicAdmin = admins.get('buriganga-clinic');
    const clinicId = facilities.get('buriganga-clinic');
    if (clinicAdmin !== undefined && clinicId !== undefined) {
      roleRows.push([
        clinicAdmin,
        clinicId,
        'receptionist',
        JSON.stringify({ ...DEMO_MARKER, counters: ['R2'] }),
      ]);
    }

    await insertRows(
      client,
      'staff_roles',
      { columns: ['staff_user_id', 'hospital_id', 'role', 'scope'] },
      roleRows,
      '',
    );

    // --- hospital_settings -------------------------------------------------
    //
    // Only `numeral_style` is set per facility. Every queue policy default is
    // left alone deliberately: the defaults in migration 0004 are the values
    // the requirements name (`FR-QUE-20`, `FR-QUE-21`, `FR-OFF-04`), and a
    // seed that overrode them would demo behaviour the product does not have.
    const settingsRows = DEMO_FACILITIES.map((facility) => {
      const hospitalId = facilities.get(facility.slug);
      if (hospitalId === undefined) throw new Error(`No id for ${facility.slug}.`);
      return [hospitalId, facility.numeralStyle, admins.get(facility.slug) ?? null];
    });

    await insertRows(
      client,
      'hospital_settings',
      { columns: ['hospital_id', 'numeral_style', 'created_by'] },
      settingsRows,
      '',
    );

    // --- departments -------------------------------------------------------
    const departmentRows: unknown[][] = [];
    for (const facility of DEMO_FACILITIES) {
      const hospitalId = facilities.get(facility.slug);
      if (hospitalId === undefined) throw new Error(`No id for ${facility.slug}.`);

      for (const [order, code] of facility.departments.entries()) {
        const entry = specialty(code);
        departmentRows.push([
          hospitalId,
          entry.nameBn,
          entry.nameEn,
          entry.code,
          order,
          admins.get(facility.slug) ?? null,
        ]);
      }
    }

    await insertRows(
      client,
      'departments',
      {
        columns: ['hospital_id', 'name_bn', 'name_en', 'code', 'sort_order', 'created_by'],
      },
      departmentRows,
      '',
    );

    // --- capabilities ------------------------------------------------------
    const capabilityRows: unknown[][] = [];
    for (const facility of DEMO_FACILITIES) {
      const hospitalId = facilities.get(facility.slug);
      if (hospitalId === undefined) throw new Error(`No id for ${facility.slug}.`);

      const ageMinutes = CAPABILITY_AGE_MINUTES[facility.slug] ?? 5;
      const confirmedAt = new Date(Date.parse(now) - ageMinutes * 60_000).toISOString();

      for (const kind of facility.capabilities) {
        const unavailable = UNAVAILABLE.some(
          (entry) => entry.hospitalSlug === facility.slug && entry.kind === kind,
        );
        capabilityRows.push([
          hospitalId,
          kind,
          !unavailable,
          // Whoever confirmed it: the emergency desk where there is one, the
          // administrator otherwise. `capabilities.updated_by` is read by the
          // freshness line a patient sees, so it is not decoration.
          admins.get(facility.slug) ?? null,
          confirmedAt,
          confirmedAt,
        ]);
      }
    }

    await insertRows(
      client,
      'capabilities',
      {
        columns: ['hospital_id', 'kind', 'is_available', 'updated_by', 'created_at', 'updated_at'],
      },
      capabilityRows,
      '',
    );

    log(
      `      burn units: ${DEMO_FACILITIES.filter((f) => f.capabilities.includes('burn_unit'))
        .map((f) => f.nameEn)
        .join(', ')}`,
    );

    return {
      hospitals: hospitalRows.length,
      hospital_settings: settingsRows.length,
      departments: departmentRows.length,
      capabilities: capabilityRows.length,
      staff_users: staffRows.length,
      staff_roles: roleRows.length,
    };
  },
};

/** Three letters for an ID card, derived from the slug so it cannot drift. */
function facilityPrefix(slug: string): string {
  const first = slug.split('-')[0] ?? slug;
  return first.slice(0, 3).toUpperCase();
}
