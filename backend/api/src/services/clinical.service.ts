/**
 * The clinical record: writing a visit, and deciding who may read one
 * (BACKEND.md §7.6, `FR-DOC-03`, `FR-DOC-08`, `FR-DOC-10`).
 *
 * ## The rule this file exists to enforce
 *
 * `FR-DOC-10`: "Doctor may only view records of patients in their own sessions,
 * or with explicit patient consent." That is two questions — has this patient
 * ever been booked into a chamber here, and has this patient granted this
 * hospital access — and one of them is answered before a single record is
 * returned. A patient reading their own wallet needs neither.
 *
 * "Their own sessions" is enforced at hospital grain rather than per clinician,
 * because no column joins a console account to a `doctors` row. The why is in
 * `treatedAtHospital`; the ruling it needs is in `docs/STATUS.md`.
 *
 * Every read that passes writes an `audit_log` row (`DB-P7`, `FR-SEC-03`). Not
 * as a courtesy: the reason a hospital can be trusted with a shared record is
 * that looking at one leaves a mark, and a trail assembled later is one that can
 * be quietly not assembled.
 *
 * ## Signing, and what it is allowed to fail
 *
 * `BTN-B05-SIGN` writes the record *then* advances the queue, in that order,
 * because `APP_FLOW.md` B2 fixes the failure mode: "if the prescription fails to
 * save, the consultation is **not** marked done". Doing it the other way round
 * would end a consultation whose record was lost.
 *
 * The two are not one transaction. `callNext` owns its own lock and dispatches
 * notifications after committing (`FR-QUE-53`), and reaching inside it would
 * mean two places deciding who is next. So the window is: record committed,
 * queue not yet advanced. A doctor who taps again lands on the same visit —
 * `upsertVisit` is idempotent on the booking and keeps the original `signed_at`
 * — and the queue advances on the second tap. The recoverable order was chosen
 * over the atomic one deliberately; the alternative loses a record.
 */

import type { CreateVisitBody, QueueActor } from '@platform/domain';

import { forbiddenScope, guardFailed, notFound } from '../errors/AppError.js';
import * as clinicalRepo from '../repositories/clinical.repo.js';
import { withTransaction } from '../repositories/transaction.js';

import * as queueService from './queue.service.js';

import type { Principal } from '../types/express.js';

/** What `S-B-05`'s patient panel and `S-A-12`'s wallet both render. */
export interface PatientRecords {
  readonly patient: clinicalRepo.PatientIdentity;
  /** Present only when a booking was named — the visit being consulted on. */
  readonly intake: clinicalRepo.Intake | null;
  readonly visits: readonly clinicalRepo.VisitRecord[];
  /**
   * What this version cannot show, named rather than omitted.
   *
   * `FR-DOC-03` asks for previous prescriptions and recent test results as well.
   * Prescriptions were dropped from this version (`FR-DOC-04`) and reports
   * arrive with the lab at step 17, so the panel says so instead of rendering an
   * empty area that reads as "this patient has none" (`PRD.md` §3.2).
   */
  readonly absent: readonly ('prescriptions' | 'reports')[];
}

/**
 * The records a caller is allowed to read.
 *
 * `bookingId` is what makes one call enough for the doctor's screen: the intake
 * lives on the booking and the history lives on `visits`, and `NFR-04` assumes a
 * connection where a second round trip is felt.
 */
export async function patientRecords(input: {
  readonly principal: Principal;
  readonly patientId: string;
  readonly bookingId?: string | undefined;
}): Promise<PatientRecords> {
  const patient = await clinicalRepo.findPatient(input.patientId);
  if (patient === null) throw notFound('patient');

  await assertMayRead(input.principal, input.patientId);

  let intake: clinicalRepo.Intake | null = null;
  if (input.bookingId !== undefined) {
    const booking = await clinicalRepo.findChamberBooking(input.bookingId);
    if (booking === null) throw notFound('booking');

    // A booking belonging to somebody else is not a 404 — the booking exists —
    // but reading its intake under another patient's id would be a way to walk
    // the table.
    if (booking.patientId !== input.patientId) throw forbiddenScope({ reason: 'booking_patient' });

    intake = await clinicalRepo.findIntake(input.bookingId);
  }

  const visits = await clinicalRepo.findVisits(input.patientId);

  // After the read succeeded, so a refusal leaves no row claiming it happened.
  await audit(input.principal, input.patientId, {
    subjectTable: 'visits',
    subjectId: null,
    meta: {
      visits: visits.length,
      ...(input.bookingId === undefined ? {} : { bookingId: input.bookingId }),
    },
  });

  return {
    patient,
    intake,
    visits,
    absent: ['prescriptions', 'reports'],
  };
}

/** What `POST /visits` gives back. */
export interface SignVisitResult {
  readonly visitId: string;
  readonly signed: boolean;
  /** Present when signing advanced the queue (`FR-DOC-08`). */
  readonly queue: queueService.AppendEventResult | null;
}

/**
 * `POST /visits` — save a draft, or sign and finish (`BTN-B05-DRAFT`/`-SIGN`).
 *
 * The doctor is taken from the *session*, never from the request: a console
 * cannot claim a consultation on somebody else's behalf, and `visits.doctor_id`
 * is what `FR-DOC-10` reads afterwards to decide who may look.
 */
export async function saveVisit(input: {
  readonly principal: Principal;
  readonly actor: QueueActor;
  readonly body: CreateVisitBody;
}): Promise<SignVisitResult> {
  const { body } = input;

  const booking = await clinicalRepo.findChamberBooking(body.bookingId);
  if (booking === null) throw notFound('booking');

  if (input.principal.kind !== 'staff') throw forbiddenScope({ reason: 'staff_only' });
  if (input.principal.hospitalId !== booking.hospitalId) {
    throw forbiddenScope({ reason: 'hospital_scope' });
  }

  // `FR-DOC-08` makes signing equivalent to reception's *done*, and *done*
  // applies to whoever is in the chamber. Signing for a patient who was never
  // called would end a consultation that never started and would advance the
  // queue past somebody waiting.
  if (body.sign && booking.status !== 'in_chamber') {
    throw guardFailed(
      'PATIENT_NOT_IN_CHAMBER',
      'Only the patient currently in the chamber can be signed off.',
    );
  }

  const visit = await withTransaction(
    async (trx) =>
      await clinicalRepo.upsertVisit(trx, {
        bookingId: booking.bookingId,
        patientId: booking.patientId,
        hospitalId: booking.hospitalId,
        doctorId: booking.doctorId,
        diagnosisText: blankToNull(body.diagnosisText),
        adviceTextBn: blankToNull(body.adviceTextBn),
        followUpDate: body.followUpDate ?? null,
        symptomSignal: body.symptomSignal ?? null,
        sign: body.sign,
        staffUserId: input.principal.id,
      }),
  );

  if (!body.sign) {
    return { visitId: visit.id, signed: false, queue: null };
  }

  // The record is committed. Now the queue (see the header for why this order).
  const queue = await queueService.callNext({
    sessionId: booking.sessionId,
    actor: input.actor,
    // Derived from the visit rather than generated, so a doctor tapping sign
    // twice on a bad connection replays one `next` instead of calling two
    // patients (CLAUDE.md §7).
    clientEventId: body.idempotencyKey,
  });

  return { visitId: visit.id, signed: true, queue };
}

// ---------------------------------------------------------------------------

/**
 * `FR-DOC-10`, in the order the requirement states it.
 *
 * The doctor branch is hospital-scoped rather than clinician-scoped, because
 * nothing in the schema joins a console account to a `doctors` row — see
 * `treatedAtHospital` for why, and `docs/STATUS.md` for the ruling it needs.
 *
 * A patient reading their own record needs no permission and leaves no
 * question. A guest is refused outright: a tracking link is scoped to one
 * booking's queue position (`FR-GST-05`) and is not consent to a medical
 * history — the two are different grants and conflating them would make an SMS
 * a key to a record.
 */
async function assertMayRead(principal: Principal, patientId: string): Promise<void> {
  switch (principal.kind) {
    case 'patient': {
      // Ownership is the patient's own profile or one they hold
      // (`patients.owner_user_id`), which `findOwnedBy` answers.
      const owns = await clinicalRepo.patientBelongsToUser(patientId, principal.id);
      if (!owns) throw forbiddenScope({ reason: 'not_your_record' });
      return;
    }

    case 'staff': {
      if (!principal.roles.includes('doctor')) {
        // `DATABASE.md` §8 gives hospital admin aggregate access only, and no
        // other console role has a reason to open a record.
        throw forbiddenScope({ reason: 'role_not_permitted' });
      }

      const treats = await clinicalRepo.treatedAtHospital(principal.hospitalId, patientId);
      if (treats) return;

      const consented = await clinicalRepo.hasLiveConsent(patientId, principal.hospitalId);
      if (consented) return;

      throw forbiddenScope({ reason: 'no_treatment_relationship_or_consent' });
    }

    case 'guest':
      throw forbiddenScope({ reason: 'guest_link_is_not_consent' });

    case 'national':
      // `FR-ROLE-04`: R11 never reaches a row that identifies a patient, and
      // R10's work is onboarding facilities, not reading their patients.
      throw forbiddenScope({ reason: 'aggregate_only' });
  }
}

async function audit(
  principal: Principal,
  patientId: string,
  entry: {
    readonly subjectTable: string;
    readonly subjectId: string | null;
    readonly meta: Record<string, unknown>;
  },
): Promise<void> {
  await clinicalRepo.recordRecordView({
    staffUserId: principal.kind === 'staff' ? principal.id : null,
    userId: principal.kind === 'patient' ? principal.id : null,
    hospitalId: principal.kind === 'staff' ? principal.hospitalId : null,
    patientId,
    subjectTable: entry.subjectTable,
    subjectId: entry.subjectId,
    meta: entry.meta,
  });
}

/**
 * An empty box is not an answer.
 *
 * A doctor who clears a field means the field is blank, and `''` in a clinical
 * column would render as a diagnosis that exists and says nothing.
 */
function blankToNull(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
