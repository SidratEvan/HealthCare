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
 * ## Which records, once the caller may read at all (`FR-NET-02`, plan A8)
 *
 * Being allowed to open a patient's record is not being allowed to read all
 * of it. A doctor at a hospital that has treated the patient reads **that
 * hospital's** visits. The visits another hospital made are read only under
 * the patient's consent — "something crosses between hospitals only by a
 * deliberate act": a consent, a referral — and never because the patient once
 * held a serial here. Until this was written, one booking at a hospital opened
 * the patient's history at every hospital to every doctor there.
 *
 * The answer says which it was (`visitsFrom`), so that the screen can tell a
 * doctor that what they see is this hospital's part and not the whole, without
 * saying whether there is any more: that there is a record elsewhere is itself
 * something another hospital is not told.
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
 * `upsertVisit` is idempotent on the booking and leaves a signed visit exactly
 * as it was — and the queue advances on the second tap. The recoverable order was chosen
 * over the atomic one deliberately; the alternative loses a record.
 */

import { randomUUID } from 'node:crypto';

import { documentKey, MAX_DOCUMENT_BYTES, sniffDocument, time } from '@platform/domain';
import type { CreateVisitBody, QueueActor, UploadDocumentBody } from '@platform/domain';

import { storage } from '../adapters/storage.js';
import { logger } from '../config/logger.js';
import { AppError, forbiddenScope, guardFailed, notFound } from '../errors/AppError.js';
import * as clinicalRepo from '../repositories/clinical.repo.js';
import { withTransaction } from '../repositories/transaction.js';

import * as queueService from './queue.service.js';

import type { Principal } from '../types/express.js';

/** How much of a patient's history a reader is shown. */
export type VisitsFrom = 'everywhere' | 'this_hospital';

/** What `S-B-05`'s patient panel and `S-A-12`'s wallet both render. */
export interface PatientRecords {
  readonly patient: clinicalRepo.PatientIdentity;
  /** Present only when a booking was named — the visit being consulted on. */
  readonly intake: clinicalRepo.Intake | null;
  readonly visits: readonly clinicalRepo.VisitRecord[];
  /**
   * Whose visits these are: every hospital's (the patient reading their own,
   * or a doctor under the patient's consent), or only the reader's own
   * hospital's (`FR-NET-02`).
   */
  readonly visitsFrom: VisitsFrom;
  /**
   * The patient's own papers (`FR-PAT-62`, plan R3), each labelled as the
   * patient's. Only for the patient and for a doctor under consent: they are
   * not a hospital's record, so having treated the patient does not open them.
   */
  readonly documents: readonly clinicalRepo.PatientDocument[];
  /**
   * What this read cannot show, named rather than omitted.
   *
   * `FR-DOC-03` asks for previous prescriptions and recent test results as well.
   * Prescriptions are on each visit since plan R2; reports are not part of
   * this read, so the panel says so instead of rendering an empty area that
   * reads as "this patient has none" (`PRD.md` §3.2).
   */
  readonly absent: readonly 'reports'[];
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

  const visitsFrom = await readScope(input.principal, input.patientId);

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

  // Narrowed in the query, by the reader's own hospital, unless the reader
  // is the patient or holds their consent.
  const visits = await clinicalRepo.findVisits(
    input.patientId,
    visitsFrom === 'this_hospital' && input.principal.kind === 'staff'
      ? input.principal.hospitalId
      : null,
  );

  const documents =
    visitsFrom === 'everywhere' ? await clinicalRepo.listDocuments(input.patientId) : [];

  // After the read succeeded, so a refusal leaves no row claiming it happened.
  await audit(input.principal, input.patientId, {
    subjectTable: 'visits',
    subjectId: null,
    meta: {
      visits: visits.length,
      documents: documents.length,
      // What was opened: this hospital's part, or everything under consent.
      visitsFrom,
      ...(input.bookingId === undefined ? {} : { bookingId: input.bookingId }),
    },
  });

  return {
    patient,
    intake,
    visits,
    visitsFrom,
    documents,
    absent: ['reports'],
  };
}

// ---------------------------------------------------------------------------
// A patient's own old papers (`FR-PAT-62`; plan R3)
// ---------------------------------------------------------------------------

/**
 * Only a signed-in patient, for a profile their account holds. A tracking
 * link is never enough: an SMS that was forwarded must not add papers to
 * somebody's record (`PRD.md` `FR-PAT-62`).
 */
async function assertOwnProfile(principal: Principal, patientId: string): Promise<string> {
  if (principal.kind !== 'patient') throw forbiddenScope({ reason: 'patient_only' });
  const owns = await clinicalRepo.patientBelongsToUser(patientId, principal.id);
  if (!owns) throw forbiddenScope({ reason: 'not_your_record' });
  return principal.id;
}

/** `POST /me/documents`: stores the file, then the row; a file with no row is never shown. */
export async function uploadDocument(
  principal: Principal,
  body: UploadDocumentBody,
): Promise<clinicalRepo.PatientDocument> {
  const userId = await assertOwnProfile(principal, body.patientId);

  const bytes = Buffer.from(body.dataBase64, 'base64');
  // The bytes decide, not the name and not what the sender said it was.
  const kind = bytes.length === 0 ? null : sniffDocument(bytes);
  if (kind === null || kind !== body.contentType || bytes.length > MAX_DOCUMENT_BYTES) {
    throw new AppError('DOCUMENT_NOT_SUPPORTED');
  }
  if (body.docDate !== undefined && body.docDate > time.toDhakaDate(time.fromDate(new Date()))) {
    throw guardFailed('DOCUMENT_DATE_IN_FUTURE', 'A paper cannot be dated after today.');
  }

  const id = randomUUID();
  const key = documentKey(body.patientId, id, kind);
  try {
    await storage().put({ key, contentType: kind, bytes });
  } catch (cause) {
    logger.error({ documentId: id, err: cause }, 'document upload failed');
    throw new AppError('DOCUMENT_STORAGE_FAILED', { cause });
  }

  return await clinicalRepo.insertDocument({
    id,
    patientId: body.patientId,
    key,
    docType: body.docType,
    docDate: body.docDate ?? null,
    doctorName: blankToNull(body.doctorName),
    contentType: kind,
    byteSize: bytes.length,
    userId,
  });
}

/** `GET /me/documents?patient=`. */
export async function listOwnDocuments(
  principal: Principal,
  patientId: string,
): Promise<readonly clinicalRepo.PatientDocument[]> {
  await assertOwnProfile(principal, patientId);
  return await clinicalRepo.listDocuments(patientId);
}

/** `DELETE /me/documents/:id`. An unknown paper and somebody else's are the same 404. */
export async function removeOwnDocument(principal: Principal, documentId: string): Promise<void> {
  const found = await clinicalRepo.findDocument(documentId);
  if (found === null) throw notFound('document');
  if (principal.kind !== 'patient') throw forbiddenScope({ reason: 'patient_only' });
  if (!(await clinicalRepo.patientBelongsToUser(found.patientId, principal.id))) {
    throw notFound('document');
  }
  await clinicalRepo.removeDocument(documentId);
}

/**
 * `GET /patients/:id/documents/:docId/url`: a fresh signed link.
 *
 * The patient opens their own. A doctor opens one only under the patient's
 * live consent, and the opening is an audited read (`DB-P7`, `FR-SEC-03`)
 * the patient sees in their access log (`FR-PAT-64`). Treating the patient
 * is not enough: the paper is the patient's, not the hospital's.
 */
export async function documentUrl(input: {
  readonly principal: Principal;
  readonly patientId: string;
  readonly documentId: string;
}): Promise<string> {
  const { principal } = input;
  if (principal.kind === 'patient') {
    await assertOwnProfile(principal, input.patientId);
  } else if (principal.kind === 'staff') {
    if (!principal.roles.includes('doctor')) {
      throw forbiddenScope({ reason: 'role_not_permitted' });
    }
    if (!(await clinicalRepo.hasLiveConsent(input.patientId, principal.hospitalId))) {
      throw forbiddenScope({ reason: 'patient_document_needs_consent' });
    }
  } else {
    throw forbiddenScope({ reason: 'patient_only' });
  }

  const found = await clinicalRepo.findDocument(input.documentId);
  if (found?.patientId !== input.patientId) throw notFound('document');

  const url = await storage().signedUrl(found.key);
  if (principal.kind === 'staff') {
    await audit(principal, input.patientId, {
      subjectTable: 'patient_documents',
      subjectId: input.documentId,
      meta: { opened: 'patient_document' },
    });
  }
  return url;
}

/** What `POST /visits` gives back. */
/** `GET /formulary?q=` (`FR-DOC-05`): what a doctor may pick from as they type. */
export async function formulary(query: string): Promise<readonly clinicalRepo.FormularyEntry[]> {
  return await clinicalRepo.searchFormulary(query);
}

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
  // A clinical record is a doctor's (`BACKEND.md` §7.6). The route requires
  // the role too; this is the same rule for any other caller of the service.
  if (!input.principal.roles.includes('doctor')) {
    throw forbiddenScope({ reason: 'role_not_permitted' });
  }
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

  const staffUserId = input.principal.id;
  const visit = await withTransaction(async (trx) => {
    const written = await clinicalRepo.upsertVisit(trx, {
      bookingId: booking.bookingId,
      patientId: booking.patientId,
      hospitalId: booking.hospitalId,
      doctorId: booking.doctorId,
      diagnosisText: blankToNull(body.diagnosisText),
      adviceTextBn: blankToNull(body.adviceTextBn),
      followUpDate: body.followUpDate ?? null,
      symptomSignal: body.symptomSignal ?? null,
      sign: body.sign,
      staffUserId,
    });
    // `FR-DOC-04` (plan R2): the medicines go with the visit, in its
    // transaction, and only while it is a draft. A signed visit's rows are as
    // final as the visit; the refusal below says so.
    if (!written.alreadySigned && body.medicines !== undefined) {
      await clinicalRepo.replaceMedicines(trx, {
        visitId: written.id,
        staffUserId,
        medicines: body.medicines.map((medicine) => ({
          medicineId: medicine.medicineId ?? null,
          name: medicine.name,
          strength: blankToNull(medicine.strength),
          schedule: blankToNull(medicine.schedule),
          durationDays: medicine.durationDays ?? null,
          instructionBn: blankToNull(medicine.instructionBn),
        })),
      });
    }
    return written;
  });

  // Signed is final. A sign sent again is the same act replayed and goes on to
  // the queue's own replay below; anything else against a signed record is an
  // edit, and is refused rather than written under the doctor's signature.
  if (visit.alreadySigned && !body.sign) {
    throw guardFailed('VISIT_ALREADY_SIGNED', 'A signed visit record cannot be changed.');
  }

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
 *
 * What comes back is how much the caller reads: a refusal is thrown.
 */
async function readScope(principal: Principal, patientId: string): Promise<VisitsFrom> {
  switch (principal.kind) {
    case 'patient': {
      // Ownership is the patient's own profile or one they hold
      // (`patients.owner_user_id`), which `findOwnedBy` answers.
      const owns = await clinicalRepo.patientBelongsToUser(patientId, principal.id);
      if (!owns) throw forbiddenScope({ reason: 'not_your_record' });
      // Their own record, wherever it was written.
      return 'everywhere';
    }

    case 'staff': {
      if (!principal.roles.includes('doctor')) {
        // `DATABASE.md` §8 gives hospital admin aggregate access only, and no
        // other console role has a reason to open a record.
        throw forbiddenScope({ reason: 'role_not_permitted' });
      }

      // Consent is asked first because it is the wider grant: with it the
      // patient has said this hospital may read their record, all of it.
      const consented = await clinicalRepo.hasLiveConsent(patientId, principal.hospitalId);
      if (consented) return 'everywhere';

      // Without it, having treated the patient opens what this hospital
      // itself wrote, and nothing another hospital did (`FR-NET-02`).
      const treats = await clinicalRepo.treatedAtHospital(principal.hospitalId, patientId);
      if (treats) return 'this_hospital';

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
