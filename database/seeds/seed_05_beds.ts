/**
 * `FR-DEM-04` — bed inventory across wards with live occupancy.
 *
 * Writes the wards and beds `data/beds.ts` declares, an admission for every
 * occupied bed, the history of how each bed reached its current state, and the
 * handful of bed requests the ward board's pending list opens on.
 *
 * ## The history is written to agree with the present
 *
 * `beds.state` is the present and `bed_events` is how it got there (migration
 * 0008). A seed that wrote one without the other would produce a board whose
 * freshness stamp contradicts its tiles, so every bed here gets the events that
 * explain it: an occupied bed was admitted, a bed being cleaned was discharged,
 * a free bed was last cleaned, a reserved bed was reserved. `seeds.test.ts`
 * checks that the newest event of every bed ends in the state the bed is in.
 *
 * Each ward's newest event lands exactly `confirmedMinutesAgo` before the
 * reset, and everything else on that ward is older. That is what the public
 * freshness stamp reads (`v_public_hospital_capacity`), so the declared number
 * is the number a patient sees.
 *
 * ## Who is in the beds
 *
 * Inpatients are drawn from the two hundred seeded profiles (`FR-DEM-03`),
 * preferring people with nothing booked for today. There are not enough of
 * those to fill the wards — nearly every seeded patient holds a serial today —
 * so some inpatients also hold an outpatient serial. That overlap is a known
 * wart of a two-hundred-person demo, recorded in `docs/STATUS.md`, and the
 * alternative (a second population of inpatients) would contradict the count
 * `FR-DEM-03` states. Nobody holds two beds: `admissions_one_per_patient_key`
 * refuses it.
 *
 * ## The ERs, because they share the ward's migration and its scenario
 *
 * `emergency_cases` is 0008's table as much as `beds` is, and the emergency
 * scenario (`PRD.md` §24 step 7) is staged across both: the burn beds here and
 * the ER load in `data/emergency.ts` are the two halves of why Padma, not the
 * nearer Jamuna, is the answer to a burn case from Farmgate. So the cases are
 * written here too, after the beds, and two of them are already handed to the
 * ward (`FR-BED-07`).
 */

import { time, type Timestamp } from '@platform/domain';

import { DEMO_BED_REQUESTS, DEMO_HOLD_MINUTES, DEMO_WARDS, OOS_REASONS } from './data/beds.js';
import { DEMO_EMERGENCY_CASES } from './data/emergency.js';
import { DEMO_MARKER, demoPhone, labelBn, labelEn, taka } from './lib/demo.js';
import { insertRows } from './lib/insert.js';
import { facilityIds, staffByRole } from './lib/lookup.js';

import type { DemoWard } from './data/beds.js';
import type { Rng } from './lib/random.js';
import type { SeedContext, SeedModule, SeedSummary } from './lib/runner.js';
import type { Client } from 'pg';

type PlannedState = 'occupied' | 'cleaning' | 'reserved' | 'out_of_service' | 'free';

/** Critical-care kinds: fewer discharge forecasts, more arrivals through the ER. */
const CRITICAL = new Set(['icu', 'ccu', 'hdu', 'nicu', 'burn']);

interface Candidate {
  readonly id: string;
  readonly ownerUserId: string | null;
  readonly ownerGuestId: string | null;
}

interface PlannedBed {
  readonly ward: DemoWard;
  readonly wardId: string;
  readonly hospitalId: string;
  readonly staffId: string;
  readonly label: string;
  readonly state: PlannedState;
  /** True for the one bed whose event dates the whole ward. */
  readonly freshest: boolean;
}

interface BedEventRow {
  readonly hospitalId: string;
  readonly bedId: string;
  readonly type: string;
  readonly from: string;
  readonly to: string;
  readonly admissionId: string | null;
  readonly bedRequestId: string | null;
  readonly actor: string | null;
  readonly payload: Record<string, unknown>;
  readonly at: Timestamp;
}

export const seed05Beds: SeedModule = {
  name: 'seed_05_beds',
  title: 'wards, beds, admissions, live occupancy and the ERs',
  requirements: ['FR-DEM-04', 'FR-EMG-03', 'FR-EMG-04'],
  writes: ['wards', 'beds', 'bed_events', 'admissions', 'bed_requests', 'emergency_cases'],

  async run({ client, now, rng }: SeedContext): Promise<SeedSummary> {
    const beds = rng.stream('beds');
    const facilities = await facilityIds(client);
    const wardStaff = await staffByRole(client, 'ward');
    const erStaff = await staffByRole(client, 'emergency');
    const minutesAgo = (minutes: number): Timestamp => time.addMinutes(now, -minutes);

    // --- Wards ---------------------------------------------------------------
    const wardRows = DEMO_WARDS.map((declared) => {
      const hospitalId = required(facilities, declared.facility, 'facility');
      const staffId = required(wardStaff, declared.facility, 'ward staff');
      return [
        hospitalId,
        labelBn(declared.nameBn),
        labelEn(declared.nameEn),
        declared.floor,
        declared.kind,
        staffId,
      ];
    });

    const insertedWards = await insertRows<{ id: string }>(
      client,
      'wards',
      { columns: ['hospital_id', 'name_bn', 'name_en', 'floor', 'kind', 'created_by'] },
      wardRows,
    );

    // --- Beds, planned -------------------------------------------------------
    const planned: PlannedBed[] = DEMO_WARDS.flatMap((declared, index) => {
      const wardId = insertedWards[index]?.id;
      if (wardId === undefined) throw new Error(`No id returned for ward ${declared.key}.`);
      const hospitalId = required(facilities, declared.facility, 'facility');
      const staffId = required(wardStaff, declared.facility, 'ward staff');

      const states = beds.shuffle(statesFor(declared));
      const freshestIndex = freshestOf(states);

      return states.map((state, position) => ({
        ward: declared,
        wardId,
        hospitalId,
        staffId,
        label: `${declared.labelPrefix}${String(position + 1).padStart(2, '0')}`,
        state,
        freshest: position === freshestIndex,
      }));
    });

    // Every bed goes in free. The states that name another row — an occupied
    // bed its admission — are set once that row exists, because a bed and its
    // admission each reference the other.
    const insertedBeds = await insertRows<{ id: string }>(
      client,
      'beds',
      {
        columns: ['hospital_id', 'ward_id', 'label', 'kind', 'nightly_poisha', 'created_by'],
      },
      planned.map((bed) => [
        bed.hospitalId,
        bed.wardId,
        bed.label,
        bed.ward.kind,
        taka(bed.ward.nightlyTaka),
        bed.staffId,
      ]),
    );

    const bedIds = insertedBeds.map((row, index) => {
      if (planned[index] === undefined) throw new Error('Bed insert returned an extra row.');
      return row.id;
    });

    // --- Who is in them ------------------------------------------------------
    const candidates = await loadCandidates(client, time.toDhakaDate(now), beds);
    let nextCandidate = 0;
    const takeCandidate = (): Candidate => {
      const candidate = candidates[nextCandidate];
      nextCandidate += 1;
      if (candidate === undefined) {
        throw new Error(
          `The declared wards need more patients than the ${String(candidates.length)} seeded (FR-DEM-03). Trim data/beds.ts.`,
        );
      }
      return candidate;
    };

    // --- Admissions ----------------------------------------------------------
    const events: BedEventRow[] = [];
    const bedUpdates: {
      id: string;
      state: PlannedState;
      admissionId: string | null;
      expectedDischarge: string | null;
      reservedUntil: Timestamp | null;
      oosReason: string | null;
      lastCleanedAt: Timestamp | null;
      stateChangedAt: Timestamp;
    }[] = [];

    const admissionRows: unknown[][] = [];
    const admissionOf: {
      bedIndex: number;
      admittedAt: Timestamp;
      dischargedAt: Timestamp | null;
      expectedDischarge: string | null;
    }[] = [];

    for (const [index, bed] of planned.entries()) {
      if (bed.state !== 'occupied' && bed.state !== 'cleaning') continue;

      const patient = takeCandidate();
      const fresh = bed.ward.confirmedMinutesAgo;

      // The freshest bed on a full ward is the one admitted just now; every
      // other stay began at least a day ago.
      const admittedAt =
        bed.state === 'occupied' && bed.freshest
          ? minutesAgo(fresh)
          : minutesAgo(beds.int(1, 9) * 1440 + beds.int(0, 20) * 60);

      const dischargedAt =
        bed.state === 'cleaning'
          ? minutesAgo(bed.freshest ? fresh : fresh + beds.int(10, 50))
          : null;

      const expectedDischarge =
        bed.state === 'occupied' ? forecast(beds, now, CRITICAL.has(bed.ward.kind)) : null;

      const source = CRITICAL.has(bed.ward.kind)
        ? beds.chance(0.6)
          ? 'er'
          : 'opd'
        : beds.chance(0.8)
          ? 'opd'
          : 'er';

      admissionRows.push([
        patient.id,
        bed.hospitalId,
        bedIds[index],
        admittedAt,
        dischargedAt,
        expectedDischarge,
        source,
        bed.staffId,
      ]);
      admissionOf.push({ bedIndex: index, admittedAt, dischargedAt, expectedDischarge });
    }

    const insertedAdmissions = await insertRows<{ id: string }>(
      client,
      'admissions',
      {
        columns: [
          'patient_id',
          'hospital_id',
          'bed_id',
          'admitted_at',
          'discharged_at',
          'expected_discharge_date',
          'source',
          'created_by',
        ],
      },
      admissionRows,
    );

    const admissionIdForBed = new Map<number, string>();
    for (const [position, admission] of admissionOf.entries()) {
      const inserted = insertedAdmissions[position];
      if (inserted === undefined) throw new Error('Admission insert returned too few rows.');
      admissionIdForBed.set(admission.bedIndex, inserted.id);

      const bed = planned[admission.bedIndex];
      const bedId = bedIds[admission.bedIndex];
      if (bed === undefined || bedId === undefined) continue;

      events.push({
        hospitalId: bed.hospitalId,
        bedId,
        type: 'ADMIT',
        from: 'free',
        to: 'occupied',
        admissionId: inserted.id,
        bedRequestId: null,
        actor: bed.staffId,
        payload: { source: 'seed', ...DEMO_MARKER },
        at: admission.admittedAt,
      });
    }

    // --- Bed requests --------------------------------------------------------
    //
    // After admissions, so a family asking for a bed is never somebody already
    // lying in one.
    const requestRows: unknown[][] = [];
    const heldBedIndex: (number | null)[] = [];

    for (const request of DEMO_BED_REQUESTS) {
      const patient = takeCandidate();
      const hospitalId = required(facilities, request.facility, 'facility');
      const staffId = required(wardStaff, request.facility, 'ward staff');

      const reservedIndex =
        request.state === 'held'
          ? planned.findIndex(
              (bed, index) =>
                bed.ward.facility === request.facility &&
                bed.ward.kind === request.kind &&
                bed.state === 'reserved' &&
                !heldBedIndex.includes(index),
            )
          : -1;

      if (request.state === 'held' && reservedIndex === -1) {
        throw new Error(
          `A held request at ${request.facility} needs a reserved ${request.kind} bed in data/beds.ts.`,
        );
      }
      heldBedIndex.push(reservedIndex === -1 ? null : reservedIndex);

      requestRows.push([
        hospitalId,
        patient.id,
        request.kind,
        patient.ownerUserId,
        patient.ownerGuestId,
        request.note,
        time.addMinutes(now, request.arrivesInMinutes),
        request.state,
        reservedIndex === -1 ? null : bedIds[reservedIndex],
        request.state === 'held' ? time.addMinutes(now, DEMO_HOLD_MINUTES) : null,
        request.state === 'held' ? staffId : null,
        request.state === 'held' ? minutesAgo(request.askedMinutesAgo - 5) : null,
        minutesAgo(request.askedMinutesAgo),
      ]);
    }

    const insertedRequests = await insertRows<{ id: string }>(
      client,
      'bed_requests',
      {
        columns: [
          'hospital_id',
          'patient_id',
          'bed_kind',
          'requested_by_user_id',
          'requested_by_guest_id',
          'note',
          'expected_arrival_at',
          'state',
          'bed_id',
          'hold_expires_at',
          'responded_by',
          'responded_at',
          'created_at',
        ],
      },
      requestRows,
    );

    const requestForBed = new Map<number, { id: string; heldAt: Timestamp }>();
    for (const [position, index] of heldBedIndex.entries()) {
      const request = DEMO_BED_REQUESTS[position];
      const inserted = insertedRequests[position];
      if (index === null || request === undefined || inserted === undefined) continue;
      requestForBed.set(index, {
        id: inserted.id,
        heldAt: minutesAgo(request.askedMinutesAgo - 5),
      });
    }

    // --- Every bed's own history, and its present ----------------------------
    for (const [index, bed] of planned.entries()) {
      const bedId = bedIds[index];
      if (bedId === undefined) continue;
      const fresh = bed.ward.confirmedMinutesAgo;

      switch (bed.state) {
        case 'occupied': {
          const admission = admissionOf.find((entry) => entry.bedIndex === index);
          if (admission === undefined)
            throw new Error(`Occupied bed ${bed.label} has no admission.`);
          bedUpdates.push({
            id: bedId,
            state: 'occupied',
            admissionId: admissionIdForBed.get(index) ?? null,
            expectedDischarge: admission.expectedDischarge,
            reservedUntil: null,
            oosReason: null,
            lastCleanedAt: time.addMinutes(admission.admittedAt, -90),
            stateChangedAt: admission.admittedAt,
          });
          break;
        }

        case 'cleaning': {
          const dischargedAt =
            admissionOf.find((entry) => entry.bedIndex === index)?.dischargedAt ??
            minutesAgo(fresh);
          events.push({
            hospitalId: bed.hospitalId,
            bedId,
            type: 'DISCHARGE',
            from: 'occupied',
            to: 'cleaning',
            admissionId: admissionIdForBed.get(index) ?? null,
            bedRequestId: null,
            actor: bed.staffId,
            payload: { ...DEMO_MARKER },
            at: dischargedAt,
          });
          bedUpdates.push({
            id: bedId,
            state: 'cleaning',
            admissionId: null,
            expectedDischarge: null,
            reservedUntil: null,
            oosReason: null,
            lastCleanedAt: null,
            stateChangedAt: dischargedAt,
          });
          break;
        }

        case 'reserved': {
          const request = requestForBed.get(index);
          const reservedAt = request?.heldAt ?? minutesAgo(bed.freshest ? fresh : fresh + 15);
          const reservedUntil = time.addMinutes(
            now,
            request === undefined ? 120 : DEMO_HOLD_MINUTES,
          );
          events.push({
            hospitalId: bed.hospitalId,
            bedId,
            type: 'RESERVE',
            from: 'free',
            to: 'reserved',
            admissionId: null,
            bedRequestId: request?.id ?? null,
            actor: bed.staffId,
            payload: { reservedUntil, ...DEMO_MARKER },
            at: reservedAt,
          });
          bedUpdates.push({
            id: bedId,
            state: 'reserved',
            admissionId: null,
            expectedDischarge: null,
            reservedUntil,
            oosReason: null,
            lastCleanedAt: time.addMinutes(reservedAt, -120),
            stateChangedAt: reservedAt,
          });
          break;
        }

        case 'out_of_service': {
          const reason = beds.pick(OOS_REASONS);
          const since = bed.freshest ? minutesAgo(fresh) : minutesAgo(beds.int(1, 3) * 1440);
          events.push({
            hospitalId: bed.hospitalId,
            bedId,
            type: 'OOS',
            from: 'free',
            to: 'out_of_service',
            admissionId: null,
            bedRequestId: null,
            actor: bed.staffId,
            payload: { reason, ...DEMO_MARKER },
            at: since,
          });
          bedUpdates.push({
            id: bedId,
            state: 'out_of_service',
            admissionId: null,
            expectedDischarge: null,
            reservedUntil: null,
            oosReason: reason,
            lastCleanedAt: null,
            stateChangedAt: since,
          });
          break;
        }

        case 'free': {
          const cleanedAt = minutesAgo(bed.freshest ? fresh : fresh + beds.int(60, 600));
          events.push(
            {
              hospitalId: bed.hospitalId,
              bedId,
              type: 'CLEAN_START',
              from: 'free',
              to: 'cleaning',
              admissionId: null,
              bedRequestId: null,
              actor: bed.staffId,
              payload: { ...DEMO_MARKER },
              at: time.addMinutes(cleanedAt, -25),
            },
            {
              hospitalId: bed.hospitalId,
              bedId,
              type: 'CLEAN_DONE',
              from: 'cleaning',
              to: 'free',
              admissionId: null,
              bedRequestId: null,
              actor: bed.staffId,
              payload: { ...DEMO_MARKER },
              at: cleanedAt,
            },
          );
          bedUpdates.push({
            id: bedId,
            state: 'free',
            admissionId: null,
            expectedDischarge: null,
            reservedUntil: null,
            oosReason: null,
            lastCleanedAt: cleanedAt,
            stateChangedAt: cleanedAt,
          });
          break;
        }
      }
    }

    await applyBedStates(client, bedUpdates);

    await insertRows(
      client,
      'bed_events',
      {
        columns: [
          'hospital_id',
          'bed_id',
          'type',
          'from_state',
          'to_state',
          'admission_id',
          'bed_request_id',
          'actor_staff_id',
          'payload',
          'server_ts',
        ],
      },
      events
        .sort((a, b) => a.at.localeCompare(b.at))
        .map((event) => [
          event.hospitalId,
          event.bedId,
          event.type,
          event.from,
          event.to,
          event.admissionId,
          event.bedRequestId,
          event.actor,
          JSON.stringify(event.payload),
          event.at,
        ]),
      '',
    );

    // --- The ERs --------------------------------------------------------------
    const emergencyCases = await writeEmergencyCases(client, { facilities, erStaff, minutesAgo });

    return {
      wards: insertedWards.length,
      beds: insertedBeds.length,
      admissions: insertedAdmissions.length,
      bed_requests: insertedRequests.length,
      bed_events: events.length,
      emergency_cases: emergencyCases,
    };
  },
};

/** The declared counts, as one state per bed. */
function statesFor(declared: DemoWard): PlannedState[] {
  const free =
    declared.beds -
    declared.occupied -
    declared.cleaning -
    declared.reserved -
    declared.outOfService;

  if (free < 0) {
    throw new Error(`Ward ${declared.key} declares more beds in use than it has.`);
  }

  return [
    ...repeat('occupied', declared.occupied),
    ...repeat('cleaning', declared.cleaning),
    ...repeat('reserved', declared.reserved),
    ...repeat('out_of_service', declared.outOfService),
    ...repeat('free', free),
  ];
}

function repeat(state: PlannedState, times: number): PlannedState[] {
  return Array.from({ length: times }, () => state);
}

/**
 * Which bed's event dates the ward.
 *
 * The most ordinary thing that happens on a ward, in order: a bed being
 * turned over after a discharge, a bed finished cleaning, a patient admitted.
 * A ward of nothing but reserved or broken beds dates from those.
 */
function freshestOf(states: readonly PlannedState[]): number {
  for (const wanted of ['cleaning', 'free', 'occupied', 'reserved', 'out_of_service'] as const) {
    const index = states.indexOf(wanted);
    if (index !== -1) return index;
  }
  throw new Error('A ward with no beds cannot be dated.');
}

/**
 * An expected discharge date (`FR-BED-04`), or null.
 *
 * Critical care rarely has one — nobody forecasts an ICU stay on day two — so
 * most of those beds say nothing rather than guess. The rest land between
 * today and next week, which is what makes "free tomorrow" a figure worth
 * showing.
 */
function forecast(rng: Rng, now: Timestamp, critical: boolean): string | null {
  if (!rng.chance(critical ? 0.4 : 0.8)) return null;
  const days = critical ? rng.int(1, 5) : rng.int(0, 6);
  return time.toDhakaDate(time.addMinutes(now, days * 1440));
}

/**
 * Patients who can be in a bed, those with nothing booked today first.
 *
 * Shuffled within each group by the seeded generator, so the same reset puts
 * the same people in the same beds (`FR-DEM-06`).
 */
async function loadCandidates(client: Client, today: string, rng: Rng): Promise<Candidate[]> {
  const { rows } = await client.query<{
    id: string;
    owner_user_id: string | null;
    owner_guest_id: string | null;
    busy_today: boolean;
  }>(
    `SELECT p.id, p.owner_user_id, p.owner_guest_id,
            EXISTS (
              SELECT 1 FROM bookings b
                JOIN sessions s ON s.id = b.session_id
               WHERE b.patient_id = p.id
                 AND s.session_date = $1::date
                 AND b.status IN ('booked', 'waiting', 'in_chamber', 'late')
            ) AS busy_today
       FROM patients p
      WHERE p.deleted_at IS NULL
      ORDER BY p.id`,
    [today],
  );

  const toCandidate = (row: (typeof rows)[number]): Candidate => ({
    id: row.id,
    ownerUserId: row.owner_user_id,
    ownerGuestId: row.owner_guest_id,
  });

  return [
    ...rng.shuffle(rows.filter((row) => !row.busy_today)).map(toCandidate),
    ...rng.shuffle(rows.filter((row) => row.busy_today)).map(toCandidate),
  ];
}

/**
 * Writes `data/emergency.ts` (`FR-EMG-03`, `FR-EMG-04`).
 *
 * Tokens are numbered per ER in arrival order, oldest first, the way a desk
 * numbers the day's arrivals — so the discharged cases hold the low numbers
 * and the person who walked in four minutes ago the highest. A case still on
 * its way has no token: one is given at the door.
 *
 * Every state carries the stamps migration 0016's checks require of it, which
 * is the point of writing them out here rather than leaving them to defaults.
 */
async function writeEmergencyCases(
  client: Client,
  context: {
    readonly facilities: ReadonlyMap<string, string>;
    readonly erStaff: ReadonlyMap<string, string>;
    readonly minutesAgo: (minutes: number) => Timestamp;
  },
): Promise<number> {
  const { facilities, erStaff, minutesAgo } = context;
  const nextToken = new Map<string, number>();
  let phones = 0;

  const oldestFirst = [...DEMO_EMERGENCY_CASES].sort((a, b) => b.minutesAgo - a.minutesAgo);

  const rows = oldestFirst.map((declared) => {
    const hospitalId = required(facilities, declared.facility, 'facility');
    const at = minutesAgo(declared.minutesAgo);
    const phone = declared.phone ? demoPhone('emergency', (phones += 1)) : null;

    if (declared.state === 'acknowledged') {
      return {
        hospitalId,
        phone,
        declared,
        state: 'acknowledged',
        etaMinutes: declared.etaMinutes ?? null,
        inboundAt: at,
        acknowledgedAt: time.addMinutes(at, 1),
        arrivedAt: null,
        token: null,
        closedAt: null,
        // Nobody on the staff created an alert a family sent.
        createdBy: null,
        createdAt: at,
      };
    }

    const token = (nextToken.get(declared.facility) ?? 0) + 1;
    nextToken.set(declared.facility, token);

    return {
      hospitalId,
      phone,
      declared,
      state: declared.state,
      etaMinutes: null,
      inboundAt: null,
      acknowledgedAt: null,
      arrivedAt: at,
      token: `ER-${String(token)}`,
      closedAt:
        declared.state === 'discharged' ? time.addMinutes(at, declared.stayedMinutes ?? 60) : null,
      createdBy: required(erStaff, declared.facility, 'emergency staff'),
      createdAt: at,
    };
  });

  await insertRows(
    client,
    'emergency_cases',
    {
      columns: [
        'hospital_id',
        'contact_phone',
        'problem_type',
        'state',
        'triage',
        'inbound_eta_minutes',
        'inbound_at',
        'acknowledged_at',
        'arrived_at',
        'token_label',
        'patient_age_years',
        'patient_sex',
        'closed_at',
        'admit_bed_kind',
        'admit_requested_at',
        'created_by',
        'created_at',
      ],
    },
    rows.map((row) => [
      row.hospitalId,
      row.phone,
      row.declared.problem,
      row.state,
      row.declared.triage,
      row.etaMinutes,
      row.inboundAt,
      row.acknowledgedAt,
      row.arrivedAt,
      row.token,
      row.declared.ageYears,
      row.declared.sex,
      row.closedAt,
      row.declared.handoff?.kind ?? null,
      row.declared.handoff === undefined ? null : minutesAgo(row.declared.handoff.minutesAgo),
      row.createdBy,
      row.createdAt,
    ]),
    '',
  );

  return rows.length;
}

/** Sets every bed's present in one statement. */
async function applyBedStates(
  client: Client,
  updates: readonly {
    id: string;
    state: PlannedState;
    admissionId: string | null;
    expectedDischarge: string | null;
    reservedUntil: Timestamp | null;
    oosReason: string | null;
    lastCleanedAt: Timestamp | null;
    stateChangedAt: Timestamp;
  }[],
): Promise<void> {
  if (updates.length === 0) return;

  await client.query(
    `UPDATE beds b
        SET state                   = u.state::bed_state,
            current_admission_id    = u.admission_id,
            expected_discharge_date = u.expected_discharge,
            reserved_until          = u.reserved_until,
            oos_reason              = u.oos_reason,
            last_cleaned_at         = u.last_cleaned_at,
            state_changed_at        = u.state_changed_at
       FROM unnest(
              $1::uuid[], $2::text[], $3::uuid[], $4::date[],
              $5::timestamptz[], $6::text[], $7::timestamptz[], $8::timestamptz[]
            ) AS u(id, state, admission_id, expected_discharge,
                   reserved_until, oos_reason, last_cleaned_at, state_changed_at)
      WHERE b.id = u.id`,
    [
      updates.map((update) => update.id),
      updates.map((update) => update.state),
      updates.map((update) => update.admissionId),
      updates.map((update) => update.expectedDischarge),
      updates.map((update) => update.reservedUntil),
      updates.map((update) => update.oosReason),
      updates.map((update) => update.lastCleanedAt),
      updates.map((update) => update.stateChangedAt),
    ],
  );
}

function required(map: ReadonlyMap<string, string>, key: string, what: string): string {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`No ${what} for "${key}". Have seed_01 and seed_03 run?`);
  }
  return value;
}
