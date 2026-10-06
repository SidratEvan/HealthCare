/**
 * Importing a hospital's own data (`S-B-14`, pilot step 24, `PRD.md` §14b,
 * `FR-IMP-01`…`11`).
 *
 * A hospital keeps its own system; this takes, set by set, what the Platform
 * runs on. One CSV file per set, against a published template (`FR-IMP-09`).
 *
 * ## The four moves
 *
 * - **Check** reads every row, writes nothing but the batch and its rows, and
 *   answers with the preview: how many rows add, update, skip, and every error
 *   with its row number and field (`FR-IMP-05`).
 * - **Commit** is an administrator's approval, written all or nothing
 *   (`FR-IMP-06`). A batch with any error cannot be committed.
 * - **Undo** removes what a committed batch added and puts back what it
 *   changed, unless something has since been built on one of its rows — a
 *   booking, a visit, a bed the ward has used — and then it names those rows
 *   and changes nothing (`FR-IMP-07`).
 * - **Discard** drops a checked batch and its rows.
 *
 * Every one is audited (`FR-IMP-08`). The rows' contents are kept while a batch
 * is open and cleared 30 days after it closes (`purgeExpired`, hourly).
 *
 * ## Rules a reader would not guess
 *
 * - Every row keeps the hospital's own identifier (`external_refs`); the same
 *   row imported again updates what it made rather than duplicating it
 *   (`FR-IMP-04`). A department whose code already exists here, or a doctor
 *   whose BMDC number is already known, is adopted rather than duplicated.
 * - Template example rows (`ref` beginning `EXAMPLE`) are skipped, so a
 *   template imported as downloaded writes nothing.
 * - A staff account whose email already exists here is skipped: an import
 *   never changes a signed-in person's access. A new account has no password
 *   (`FR-IMP-02`: never imported) until an administrator issues one from
 *   `S-B-11`.
 * - Beds arrive out of service, as settings' do: occupancy is never imported
 *   (`FR-IMP-03`), and the ward confirms each bed on the day.
 * - Imported patients belong to the hospital (`FR-IMP-10`). Appointments need
 *   their patients and doctors imported first, a chamber on that date, and a
 *   free serial; "paid" is kept on the booking as the hospital's word, because
 *   a payment row needs a payer and an imported patient has none yet.
 */

import { createHash } from 'node:crypto';

import {
  IMPORT_COLUMNS,
  columnIndex,
  missingColumns,
  parseCsv,
  readRow,
  refKindOf,
  templateCsv,
  time,
  BED_UNCONFIRMED_REASON,
  type AppointmentRecord,
  type ImportError,
  type ImportSet,
  type PatientRecord,
  type StructureRecord,
} from '@platform/domain';

import { AppError, notFound } from '../errors/AppError.js';
import * as settingsRepo from '../repositories/hospitalSettings.repo.js';
import * as repo from '../repositories/import.repo.js';
import * as staffAuthRepo from '../repositories/staffAuth.repo.js';
import { withTransaction, type Tx } from '../repositories/transaction.js';

import { broadcastRoster } from './queue.service.js';
import { materialise } from './sessionMaterialise.service.js';

export interface ImportActor {
  readonly staffId: string;
  readonly hospitalId: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

/** What the screen shows for one batch. */
export interface BatchView extends repo.BatchRow {
  readonly errors: readonly {
    readonly rowNumber: number;
    readonly field: string;
    readonly code: string;
  }[];
}

/** The largest file taken, and the most rows. A hospital's register is split by year beyond that. */
export const MAX_IMPORT_ROWS = 20_000;

/** An account created by an import holds no password until an administrator issues one. */
const NO_PASSWORD = '!disabled:imported';

type AnyRecord = StructureRecord | PatientRecord | AppointmentRecord;

interface Decision {
  readonly action: repo.NewRow['action'];
  readonly errors: readonly ImportError[];
  readonly targetKind: string | null;
  readonly targetId: string | null;
}

const refused = (reason: string, extra: Record<string, unknown> = {}): AppError =>
  new AppError('IMPORT_FILE', { details: { reason, ...extra } });

const wrongState = (reason: string): AppError =>
  new AppError('IMPORT_STATE', { details: { reason } });

function fail(field: string, code: ImportError['code']): Decision {
  return { action: 'error', errors: [{ field, code }], targetKind: null, targetId: null };
}

function isExample(record: AnyRecord): boolean {
  return record.ref.toUpperCase().startsWith('EXAMPLE');
}

/** A record's key in `external_refs`: `kind:ref`. */
function keyOf(record: AnyRecord): string {
  return `${refKindOf(record)}:${record.ref}`;
}

function today(): string {
  return time.toDhakaDate(time.fromDate(new Date()));
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export function template(set: ImportSet): string {
  return templateCsv(set);
}

export async function list(hospitalId: string): Promise<repo.BatchRow[]> {
  return await repo.batchesOf(hospitalId);
}

export async function view(hospitalId: string, batchId: string): Promise<BatchView> {
  const batch = await repo.batchOf(hospitalId, batchId);
  if (batch === null) throw notFound('import');
  const rows = await repo.rowsOf(batchId);
  return {
    ...batch,
    errors: rows.flatMap((row) =>
      row.errors.map((error) => ({
        rowNumber: row.rowNumber,
        field: error.field,
        code: error.code,
      })),
    ),
  };
}

// ---------------------------------------------------------------------------
// Check (FR-IMP-05)
// ---------------------------------------------------------------------------

export async function check(
  actor: ImportActor,
  input: {
    readonly set: ImportSet;
    readonly fileName: string;
    readonly csv: string;
    /**
     * The fingerprint of the file the hospital uploaded, when `csv` is that
     * file rewritten into the template's shape by a confirmed mapping
     * (`importMapping.service`). The batch records the file that was given
     * (`FR-IMP-08`), not the rewriting of it.
     */
    readonly fileSha256?: string | undefined;
  },
): Promise<BatchView> {
  const table = parseCsv(input.csv);
  if (table === 'empty' || table === 'unterminated_quote') throw refused(table);
  const missing = missingColumns(input.set, table.header);
  if (missing.length > 0) throw refused('missing_columns', { columns: missing });
  if (table.rows.length > MAX_IMPORT_ROWS) throw refused('too_many_rows', { max: MAX_IMPORT_ROWS });

  const index = columnIndex(input.set, table.header);
  const refs = await repo.refsOf(actor.hospitalId);

  // First pass: every row read on its own, so a doctor may name a department
  // further down the file.
  const read = table.rows.map((row) => {
    const raw: Record<string, string> = {};
    for (const column of IMPORT_COLUMNS[input.set]) {
      const at = index[column] ?? -1;
      const value = at < 0 ? '' : (row.cells[at] ?? '').trim();
      if (value !== '') raw[column] = value;
    }
    return { rowNumber: row.rowNumber, raw, result: readRow(input.set, row.cells, index) };
  });
  const inFile = new Set<string>();
  for (const entry of read) {
    if (entry.result.ok && !isExample(entry.result.record)) inFile.add(keyOf(entry.result.record));
  }

  // Second pass: what each row would do.
  const seen = new Set<string>();
  const rows: repo.NewRow[] = [];
  for (const entry of read) {
    let decision: Decision;
    if (!entry.result.ok) {
      decision = { action: 'error', errors: entry.result.errors, targetKind: null, targetId: null };
    } else if (isExample(entry.result.record)) {
      decision = { action: 'skip', errors: [], targetKind: null, targetId: null };
    } else if (seen.has(keyOf(entry.result.record))) {
      decision = fail('ref', 'duplicate_in_file');
    } else {
      seen.add(keyOf(entry.result.record));
      decision = await decide(actor.hospitalId, entry.result.record, refs, inFile);
    }
    rows.push({ rowNumber: entry.rowNumber, raw: entry.raw, ...decision });
  }

  const counts = { add: 0, update: 0, skip: 0, error: 0 };
  for (const row of rows) counts[row.action] += 1;
  const fileSha256 =
    input.fileSha256 ?? createHash('sha256').update(input.csv, 'utf8').digest('hex');

  const batchId = await withTransaction(async (trx) => {
    const id = await repo.createBatch(trx, {
      hospitalId: actor.hospitalId,
      setKind: input.set,
      fileName: input.fileName,
      fileSha256,
      counts,
      createdBy: actor.staffId,
      rows,
    });
    await repo.audit(trx, {
      actorStaffId: actor.staffId,
      hospitalId: actor.hospitalId,
      batchId: id,
      event: 'checked',
      meta: { set: input.set, fileName: input.fileName, fileSha256, counts },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return id;
  });
  return await view(actor.hospitalId, batchId);
}

/** Whether a reference resolves: already imported, or in this file. */
function resolves(
  kind: string,
  ref: string,
  refs: Map<string, string>,
  inFile: Set<string>,
): boolean {
  return refs.has(`${kind}:${ref}`) || inFile.has(`${kind}:${ref}`);
}

async function decide(
  hospitalId: string,
  record: AnyRecord,
  refs: Map<string, string>,
  inFile: Set<string>,
): Promise<Decision> {
  const kind = refKindOf(record);
  const existing = refs.get(keyOf(record)) ?? null;
  const update = (targetId: string): Decision => ({
    action: 'update',
    errors: [],
    targetKind: kind,
    targetId,
  });
  const add: Decision = { action: 'add', errors: [], targetKind: kind, targetId: null };

  if (!('type' in record)) {
    if ('patientRef' in record) return await decideAppointment(hospitalId, record, refs, existing);
    return existing === null ? add : update(existing);
  }

  switch (record.type) {
    case 'department': {
      if (existing !== null) return update(existing);
      const adopted = await repo.departmentIdByCode(hospitalId, record.code);
      return adopted === null ? add : update(adopted);
    }
    case 'doctor':
      if (!resolves('department', record.departmentRef, refs, inFile)) {
        return fail('department_ref', 'unknown_ref');
      }
      return existing === null ? add : update(existing);
    case 'schedule':
      if (!resolves('doctor', record.doctorRef, refs, inFile))
        return fail('doctor_ref', 'unknown_ref');
      return existing === null ? add : update(existing);
    case 'ward':
      return existing === null ? add : update(existing);
    case 'bed': {
      if (!resolves('ward', record.wardRef, refs, inFile)) return fail('ward_ref', 'unknown_ref');
      const holder = await repo.bedIdByLabel(hospitalId, record.label);
      if (holder !== null && holder !== existing) return fail('bed_label', 'conflict');
      return existing === null ? add : update(existing);
    }
    case 'staff': {
      if (existing !== null) return update(existing);
      const account = await repo.staffIdByEmail(hospitalId, record.email);
      return account === null
        ? add
        : { action: 'skip', errors: [], targetKind: null, targetId: null };
    }
  }
}

async function decideAppointment(
  hospitalId: string,
  record: AppointmentRecord,
  refs: Map<string, string>,
  existing: string | null,
): Promise<Decision> {
  if (!refs.has(`patient:${record.patientRef}`)) return fail('patient_ref', 'unknown_ref');
  const doctorHospitalId = refs.get(`doctor:${record.doctorRef}`) ?? null;
  if (doctorHospitalId === null) return fail('doctor_ref', 'unknown_ref');
  if (record.date < today()) return fail('date', 'out_of_range');
  const chamber = await settingsRepo.chamberOfDoctor(hospitalId, doctorHospitalId);
  if (chamber === null) return fail('doctor_ref', 'unknown_ref');
  const session = await repo.chamberFor(repo.readOnly, {
    hospitalId,
    doctorId: chamber.doctorId,
    departmentId: chamber.departmentId,
    date: record.date,
    startTime: record.startTime,
  });
  if (session === null) return fail('date', 'no_chamber');
  if (await repo.serialHeld(repo.readOnly, session.id, record.serial, existing)) {
    return fail('serial', 'serial_taken');
  }
  return existing === null
    ? { action: 'add', errors: [], targetKind: 'appointment', targetId: null }
    : { action: 'update', errors: [], targetKind: 'appointment', targetId: existing };
}

// ---------------------------------------------------------------------------
// Commit (FR-IMP-06)
// ---------------------------------------------------------------------------

/** Structure rows are written in the order they depend on each other, whatever the file's order. */
const STRUCTURE_ORDER = ['department', 'doctor', 'schedule', 'ward', 'bed', 'staff'] as const;

export async function commit(actor: ImportActor, batchId: string): Promise<BatchView> {
  const touchedSessions = new Set<string>();
  let wroteSchedules = false;

  await withTransaction(async (trx) => {
    const batch = await repo.batchOf(actor.hospitalId, batchId, trx);
    if (batch === null) throw notFound('import');
    if (batch.state !== 'checked') throw wrongState(batch.state);
    if (batch.counts.error > 0) throw wrongState('has_errors');

    const set = batch.setKind as ImportSet;
    const refs = await repo.refsOf(actor.hospitalId, trx);
    const index = Object.fromEntries(IMPORT_COLUMNS[set].map((column, at) => [column, at]));
    const pending = (await repo.rowsOf(batchId, trx))
      .filter((row) => row.action === 'add' || row.action === 'update')
      .map((row) => {
        const cells = IMPORT_COLUMNS[set].map((column) => row.raw?.[column] ?? '');
        const result = readRow(set, cells, index);
        if (!result.ok) throw wrongState('row_changed');
        return { row, record: result.record };
      });
    const rank = (record: AnyRecord): number =>
      'type' in record ? STRUCTURE_ORDER.indexOf(record.type) : 0;
    pending.sort((a, b) => rank(a.record) - rank(b.record) || a.row.rowNumber - b.row.rowNumber);

    for (const { row, record } of pending) {
      try {
        const written = await write(trx, actor, record, refs);
        refs.set(keyOf(record), written.entityId);
        await repo.upsertRef(trx, {
          hospitalId: actor.hospitalId,
          kind: refKindOf(record),
          externalRef: record.ref,
          entityId: written.entityId,
          batchId,
        });
        await repo.markRowWritten(trx, row.id, {
          targetKind: refKindOf(record),
          targetId: written.entityId,
          previous: written.previous,
        });
        if (written.sessionId !== null) touchedSessions.add(written.sessionId);
        if ('type' in record && record.type === 'schedule') wroteSchedules = true;
      } catch (cause: unknown) {
        if (cause instanceof AppError) throw cause;
        // A constraint the check could not foresee — another administrator
        // changed something between the preview and the approval. Nothing is
        // written (FR-IMP-06); the row is named so the file can be fixed.
        throw new AppError('IMPORT_STATE', {
          details: { reason: 'conflict', rowNumber: row.rowNumber },
          cause,
        });
      }
    }

    await repo.setState(trx, batchId, 'committed', actor.staffId);
    await repo.audit(trx, {
      actorStaffId: actor.staffId,
      hospitalId: actor.hospitalId,
      batchId,
      event: 'committed',
      meta: { counts: batch.counts },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  });

  // After the commit: schedules become chambers, and every chamber that
  // gained an appointment tells its screens (as a booking does).
  if (wroteSchedules) await materialise();
  for (const sessionId of touchedSessions) await broadcastRoster(sessionId);
  return await view(actor.hospitalId, batchId);
}

interface Written {
  readonly entityId: string;
  readonly previous: Record<string, unknown> | null;
  readonly sessionId: string | null;
}

async function write(
  trx: Tx,
  actor: ImportActor,
  record: AnyRecord,
  refs: Map<string, string>,
): Promise<Written> {
  const existing = refs.get(keyOf(record)) ?? null;
  const done = (entityId: string, previous: Record<string, unknown> | null = null): Written => ({
    entityId,
    previous,
    sessionId: null,
  });

  if (!('type' in record)) {
    if ('patientRef' in record) return await writeAppointment(trx, actor, record, refs, existing);
    const values = {
      fullName: record.fullName,
      dateOfBirth: record.dateOfBirth,
      ageYears: record.ageYears,
      sex: record.sex,
      phone: record.phone,
      bloodGroup: record.bloodGroup,
    };
    if (existing === null) {
      return done(
        await repo.insertHospitalPatient(trx, { hospitalId: actor.hospitalId, ...values }),
      );
    }
    const previous = await repo.currentValues(trx, 'patients', existing, [
      'full_name',
      'date_of_birth',
      'age_years',
      'sex',
      'phone',
      'blood_group',
    ]);
    await repo.updateHospitalPatient(trx, existing, values);
    return done(existing, previous);
  }

  switch (record.type) {
    case 'department': {
      const adopted = existing ?? (await repo.departmentIdByCode(actor.hospitalId, record.code));
      if (adopted === null) {
        return done(
          await settingsRepo.createDepartment(trx, {
            hospitalId: actor.hospitalId,
            nameBn: record.nameBn,
            nameEn: record.nameEn,
            code: record.code,
            sortOrder: 0,
            createdBy: actor.staffId,
          }),
        );
      }
      const previous = await repo.currentValues(trx, 'departments', adopted, [
        'name_bn',
        'name_en',
      ]);
      await settingsRepo.updateDepartment(trx, actor.hospitalId, adopted, {
        nameBn: record.nameBn,
        nameEn: record.nameEn,
      });
      return done(adopted, previous);
    }
    case 'doctor': {
      const departmentId = refs.get(`department:${record.departmentRef}`);
      if (departmentId === undefined) throw wrongState('unknown_department');
      if (existing !== null) {
        const previous = await repo.currentValues(trx, 'doctor_hospitals', existing, [
          'fee_poisha',
          'room',
        ]);
        await settingsRepo.updateDoctorHospital(trx, existing, {
          feePoisha: record.feePoisha,
          room: record.room,
        });
        const chamber = await settingsRepo.chamberOfDoctor(actor.hospitalId, existing);
        if (chamber !== null) {
          await settingsRepo.carryToScheduledSessions(trx, {
            hospitalId: actor.hospitalId,
            doctorId: chamber.doctorId,
            departmentId: chamber.departmentId,
            feePoisha: record.feePoisha,
            room: record.room,
          });
        }
        return done(existing, previous);
      }
      const known = await settingsRepo.doctorByBmdc(record.bmdcNumber);
      const doctorId =
        known?.id ??
        (await settingsRepo.createDoctor(trx, {
          nameBn: record.nameBn,
          nameEn: record.nameEn,
          bmdcNumber: record.bmdcNumber,
          degrees: record.degrees,
          specialties: record.specialties,
          defaultConsultMinutes: 15,
          createdBy: actor.staffId,
        }));
      const linked = await repo.doctorHospitalFor(trx, {
        hospitalId: actor.hospitalId,
        doctorId,
        departmentId,
      });
      if (linked !== null) return done(linked);
      return done(
        await settingsRepo.linkDoctor(trx, {
          doctorId,
          hospitalId: actor.hospitalId,
          departmentId,
          feePoisha: record.feePoisha,
          room: record.room,
          createdBy: actor.staffId,
        }),
      );
    }
    case 'schedule': {
      const doctorHospitalId = refs.get(`doctor:${record.doctorRef}`);
      if (doctorHospitalId === undefined) throw wrongState('unknown_doctor');
      // A changed schedule is a new one: the old one ends, taking its unbooked
      // chambers with it, and the new one makes its own (as in S-B-11).
      if (existing !== null) await settingsRepo.endTemplate(trx, existing);
      const templateId = await settingsRepo.createTemplate(trx, {
        doctorHospitalId,
        weekday: record.weekday,
        startTime: record.startTime,
        endTime: record.endTime,
        capacity: record.capacity,
        createdBy: actor.staffId,
      });
      return done(templateId, existing === null ? null : { replacedTemplateId: existing });
    }
    case 'ward': {
      if (existing === null) {
        return done(
          await settingsRepo.createWard(trx, {
            hospitalId: actor.hospitalId,
            nameBn: record.nameBn,
            nameEn: record.nameEn,
            floor: record.floor,
            kind: record.kind,
            createdBy: actor.staffId,
          }),
        );
      }
      const previous = await repo.currentValues(trx, 'wards', existing, [
        'name_bn',
        'name_en',
        'floor',
        'kind',
      ]);
      await repo.restoreValues(trx, 'wards', existing, {
        name_bn: record.nameBn,
        name_en: record.nameEn,
        floor: record.floor,
        kind: record.kind,
      });
      return done(existing, previous);
    }
    case 'bed': {
      const wardId = refs.get(`ward:${record.wardRef}`);
      if (wardId === undefined) throw wrongState('unknown_ward');
      if (existing === null) {
        return done(
          await settingsRepo.createBed(trx, {
            hospitalId: actor.hospitalId,
            wardId,
            label: record.label,
            kind: record.kind,
            nightlyPoisha: record.nightlyPoisha,
            unconfirmedReason: BED_UNCONFIRMED_REASON,
            createdBy: actor.staffId,
          }),
        );
      }
      const previous = await repo.currentValues(trx, 'beds', existing, ['label', 'nightly_poisha']);
      await settingsRepo.updateBed(trx, actor.hospitalId, existing, {
        label: record.label,
        nightlyPoisha: record.nightlyPoisha,
      });
      return done(existing, previous);
    }
    case 'staff': {
      if (existing !== null) {
        const previous = await repo.currentValues(trx, 'staff_users', existing, ['full_name']);
        await settingsRepo.updateStaff(trx, existing, { fullName: record.fullName });
        await settingsRepo.setRoles(trx, {
          staffId: existing,
          hospitalId: actor.hospitalId,
          roles: [record.role],
          by: actor.staffId,
        });
        return done(existing, previous);
      }
      const staffId = await staffAuthRepo.createStaffAccount(trx, {
        hospitalId: actor.hospitalId,
        email: record.email,
        fullName: record.fullName,
        staffCode: null,
        passwordHash: NO_PASSWORD,
        createdBy: actor.staffId,
      });
      await settingsRepo.setRoles(trx, {
        staffId,
        hospitalId: actor.hospitalId,
        roles: [record.role],
        by: actor.staffId,
      });
      return done(staffId);
    }
  }
}

async function writeAppointment(
  trx: Tx,
  actor: ImportActor,
  record: AppointmentRecord,
  refs: Map<string, string>,
  existing: string | null,
): Promise<Written> {
  const patientId = refs.get(`patient:${record.patientRef}`);
  const doctorHospitalId = refs.get(`doctor:${record.doctorRef}`);
  if (patientId === undefined || doctorHospitalId === undefined) throw wrongState('unknown_ref');
  const chamber = await settingsRepo.chamberOfDoctor(actor.hospitalId, doctorHospitalId);
  if (chamber === null) throw wrongState('unknown_doctor');
  const session = await repo.chamberFor(trx, {
    hospitalId: actor.hospitalId,
    doctorId: chamber.doctorId,
    departmentId: chamber.departmentId,
    date: record.date,
    startTime: record.startTime,
  });
  if (session === null) throw wrongState('no_chamber');

  if (existing !== null) {
    const previous = await repo.currentValues(trx, 'bookings', existing, [
      'serial_number',
      'intake',
    ]);
    await repo.updateImportedBooking(trx, existing, { serial: record.serial, paid: record.paid });
    return { entityId: existing, previous, sessionId: session.id };
  }
  const bookingId = await repo.insertImportedBooking(trx, {
    sessionId: session.id,
    patientId,
    serial: record.serial,
    feePoisha: session.feePoisha,
    paid: record.paid,
    createdBy: actor.staffId,
  });
  return { entityId: bookingId, previous: null, sessionId: session.id };
}

// ---------------------------------------------------------------------------
// Undo (FR-IMP-07) and discard
// ---------------------------------------------------------------------------

/** Where each kind's rows live, for the soft delete and the restore. */
const TABLE_OF: Readonly<Record<string, repo.ImportTable>> = {
  department: 'departments',
  doctor: 'doctor_hospitals',
  schedule: 'session_templates',
  ward: 'wards',
  bed: 'beds',
  staff: 'staff_users',
  patient: 'patients',
  appointment: 'bookings',
};

/** Undone in the reverse of the order they were written. */
const UNDO_ORDER = [
  'appointment',
  'staff',
  'bed',
  'ward',
  'schedule',
  'doctor',
  'department',
  'patient',
];

export async function undo(actor: ImportActor, batchId: string): Promise<BatchView> {
  const touchedSessions = new Set<string>();
  await withTransaction(async (trx) => {
    const batch = await repo.batchOf(actor.hospitalId, batchId, trx);
    if (batch === null) throw notFound('import');
    if (batch.state !== 'committed') throw wrongState(batch.state);

    const written = (await repo.rowsOf(batchId, trx)).filter(
      (row) =>
        row.targetId !== null &&
        row.targetKind !== null &&
        (row.action === 'add' || row.action === 'update'),
    );
    const own = written.map((row) => row.targetId ?? '');

    // Anything built on an added row since stops the whole undo.
    const blocking: { rowNumber: number; kind: string }[] = [];
    for (const kind of UNDO_ORDER) {
      const added = written.filter((row) => row.action === 'add' && row.targetKind === kind);
      const held = new Set(
        await repo.heldByOthers(trx, { kind, ids: added.map((row) => row.targetId ?? ''), own }),
      );
      for (const row of added) {
        if (held.has(row.targetId ?? '')) blocking.push({ rowNumber: row.rowNumber, kind });
      }
    }
    if (blocking.length > 0) {
      throw new AppError('IMPORT_UNDO_BLOCKED', {
        details: { blocking: blocking.sort((a, b) => a.rowNumber - b.rowNumber) },
      });
    }

    for (const kind of UNDO_ORDER) {
      const rows = written.filter((row) => row.targetKind === kind);
      const table = TABLE_OF[kind];
      if (table === undefined) continue;
      for (const row of rows) {
        const id = row.targetId ?? '';
        if (kind === 'appointment') {
          const session = await repo.sessionOfBooking(trx, id);
          if (session !== null) touchedSessions.add(session);
        }
        if (row.action === 'add') {
          if (kind === 'schedule') await settingsRepo.endTemplate(trx, id);
          else if (kind === 'staff') await repo.retireStaff(trx, id);
          else await repo.softDelete(trx, table, [id]);
        } else if (kind === 'schedule') {
          // An updated schedule was a replacement: end the new, bring back the old.
          await settingsRepo.endTemplate(trx, id);
          const replaced = row.previous?.['replacedTemplateId'];
          if (typeof replaced === 'string') await repo.reviveTemplate(trx, replaced);
        } else if (row.previous !== null) {
          await repo.restoreValues(trx, table, id, row.previous);
        }
      }
    }

    await repo.dropRefsOf(trx, batchId);
    await repo.setState(trx, batchId, 'undone', actor.staffId);
    await repo.audit(trx, {
      actorStaffId: actor.staffId,
      hospitalId: actor.hospitalId,
      batchId,
      event: 'undone',
      meta: { rows: written.length },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  });
  await materialise();
  for (const sessionId of touchedSessions) await broadcastRoster(sessionId);
  return await view(actor.hospitalId, batchId);
}

export async function discard(actor: ImportActor, batchId: string): Promise<BatchView> {
  await withTransaction(async (trx) => {
    const batch = await repo.batchOf(actor.hospitalId, batchId, trx);
    if (batch === null) throw notFound('import');
    if (batch.state !== 'checked') throw wrongState(batch.state);
    await repo.setState(trx, batchId, 'discarded', actor.staffId);
    await repo.audit(trx, {
      actorStaffId: actor.staffId,
      hospitalId: actor.hospitalId,
      batchId,
      event: 'discarded',
      meta: {},
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  });
  return await view(actor.hospitalId, batchId);
}

/** Clears the rows of batches closed more than 30 days ago (`FR-IMP-08`); run hourly. */
export async function purgeExpired(): Promise<number> {
  return await repo.purgeExpired();
}
