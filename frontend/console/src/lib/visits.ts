/**
 * The clinical calls the doctor console makes (BACKEND.md §7.6).
 *
 * Three of them, and the shapes are the API's own — `clinical.service` returns
 * exactly this, so a change there is a type error here rather than a screen that
 * silently renders nothing.
 */

import type { QueueState } from '@platform/domain';

/** What the doctor has typed but not necessarily filed. */
export interface VisitDraft {
  readonly diagnosisText: string;
  readonly adviceTextBn: string;
  /** `SEL-B05-FOLLOWUP`: 7, 14, 30, or none. */
  readonly followUpDays: number | null;
}

/** One past consultation, as `FR-DOC-03`'s history lists it. */
export interface VisitRecord {
  readonly id: string;
  readonly bookingId: string;
  readonly diagnosisText: string | null;
  readonly adviceTextBn: string | null;
  readonly followUpDate: string | null;
  readonly signedAt: string | null;
  readonly doctorNameBn: string;
  readonly departmentNameBn: string;
  readonly hospitalNameBn: string;
  readonly serial: number;
  readonly visitedAt: string;
}

/** The pre-visit answers (`MOD-A07-INTAKE`). */
export interface Intake {
  readonly complaintBn: string | null;
  readonly durationBn: string | null;
  readonly conditionsBn: readonly string[];
  readonly medicinesBn: readonly string[];
  readonly allergiesBn: readonly string[];
  /** False when the patient answered nothing before coming in. */
  readonly asked: boolean;
}

export interface PatientRecords {
  readonly patient: {
    readonly id: string;
    readonly fullName: string;
    readonly ageYears: number | null;
    readonly sex: string;
    readonly bloodGroup: string | null;
  };
  readonly intake: Intake | null;
  readonly visits: readonly VisitRecord[];
  /** What this version cannot show, so the screen can say so. */
  readonly absent: readonly string[];
}

interface Envelope<T> {
  readonly ok: boolean;
  readonly data: T;
}

async function call<T>(url: string, token: string | null, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      ...init?.headers,
    },
  });

  if (!response.ok) throw new Error(`${String(response.status)} ${url}`);

  const body = (await response.json()) as Envelope<T>;
  return body.data;
}

/**
 * `GET /patients/:id/records?booking=` — the whole patient panel in one call.
 *
 * One request rather than three, because `NFR-04` assumes a connection where
 * each round trip is felt and the doctor is waiting with a patient in the room.
 */
export async function fetchRecords(input: {
  readonly apiBaseUrl: string;
  readonly token: string | null;
  readonly patientId: string;
  readonly bookingId: string;
}): Promise<PatientRecords> {
  return await call<PatientRecords>(
    `${input.apiBaseUrl}/patients/${input.patientId}/records?booking=${encodeURIComponent(input.bookingId)}`,
    input.token,
  );
}

export interface SaveVisitResult {
  readonly visitId: string;
  readonly signed: boolean;
  /** Present when signing advanced the queue (`FR-DOC-08`). */
  readonly queue: { readonly state: QueueState } | null;
}

/**
 * `POST /visits` — `BTN-B05-DRAFT` when `sign` is false, `BTN-B05-SIGN` when true.
 *
 * The idempotency key is generated per call rather than per draft, and that is
 * correct for both buttons: two taps of *save draft* are two saves of the same
 * text and harmless, while two taps of *sign* are two requests the server must
 * collapse — which it does on this key, so only one patient is ever called.
 */
export async function saveVisit(input: {
  readonly apiBaseUrl: string;
  readonly token: string | null;
  readonly bookingId: string;
  readonly draft: VisitDraft;
  readonly sign: boolean;
}): Promise<SaveVisitResult> {
  const key = crypto.randomUUID();

  return await call<SaveVisitResult>(`${input.apiBaseUrl}/visits`, input.token, {
    method: 'POST',
    headers: { 'idempotency-key': key },
    body: JSON.stringify({
      bookingId: input.bookingId,
      // Omitted rather than sent empty: an empty string would be a diagnosis
      // that exists and says nothing.
      ...(input.draft.diagnosisText.trim() === ''
        ? {}
        : { diagnosisText: input.draft.diagnosisText.trim() }),
      ...(input.draft.adviceTextBn.trim() === ''
        ? {}
        : { adviceTextBn: input.draft.adviceTextBn.trim() }),
      ...(input.draft.followUpDays === null
        ? {}
        : { followUpDate: dhakaDateIn(input.draft.followUpDays) }),
      sign: input.sign,
      idempotencyKey: key,
    }),
  });
}

/**
 * The fee this chamber charges, for `FR-DOC-09`.
 *
 * Read from the roster rather than from the queue state, because the state is
 * the event log reduced and a fee is not an event — `sessions.fee_poisha` is
 * copied onto every booking when it is made (`DB-P5`), so any row in the session
 * carries it and a later fee change cannot alter what was charged.
 *
 * Null when the session has no bookings yet: nothing has been collected, and
 * zero taka earned is a different statement from "we do not know the fee".
 */
export async function fetchSessionFee(input: {
  readonly apiBaseUrl: string;
  readonly token: string | null;
  readonly sessionId: string;
}): Promise<number | null> {
  const data = await call<{ bookings: readonly { feePoisha: number }[] }>(
    `${input.apiBaseUrl}/sessions/${input.sessionId}/queue`,
    input.token,
  );

  return data.bookings[0]?.feePoisha ?? null;
}

/**
 * A Dhaka calendar date `days` from today, as `YYYY-MM-DD`.
 *
 * Dhaka's, not the browser's: a follow-up is a date a patient reads on a
 * calendar in Bangladesh, and a console running with its clock set to another
 * timezone must not write a different day (`DB-P4`).
 */
function dhakaDateIn(days: number): string {
  const at = new Date(Date.now() + days * 86_400_000);

  // `en-CA` formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
