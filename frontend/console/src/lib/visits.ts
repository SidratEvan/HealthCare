/**
 * The clinical calls the doctor console makes (BACKEND.md §7.6).
 *
 * Three of them, and the shapes are the API's own — `clinical.service` returns
 * exactly this, so a change there is a type error here rather than a screen that
 * silently renders nothing.
 */

import type { QueueState, SymptomSignal } from '@platform/domain';

/** What the doctor has typed but not necessarily filed. */
export interface VisitDraft {
  readonly diagnosisText: string;
  readonly adviceTextBn: string;
  /** `SEL-B05-FOLLOWUP`: 7, 14, 30, or none. */
  readonly followUpDays: number | null;
  /** `BTN-B05-TEST`: the chips ticked, by catalogue code (`FR-DOC-06`). */
  readonly testCodes: readonly string[];
  /**
   * `CHIP-B05-SIGNAL`: dengue, diarrhoeal or fever, for the district's early
   * warning (`FR-GOV-03`). Null — the common case — means none of the three.
   */
  readonly symptomSignal: SymptomSignal | null;
}

/** One chip on `BTN-B05-TEST`, from the hospital's catalogue. */
export interface CatalogueTest {
  readonly code: string;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly pricePoisha: number;
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
  readonly doctorNameEn: string;
  readonly departmentNameBn: string;
  readonly departmentNameEn: string;
  readonly hospitalNameBn: string;
  readonly hospitalNameEn: string;
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

/**
 * A refused or failed request, with the API's own error code when it sent one.
 *
 * The code is what lets a screen say *why*: `CONSENT_CODE_INVALID` asks the
 * doctor for a new code, while a 500 or a dropped connection is worth a retry.
 */
export class RequestFailed extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`${String(status)} ${code ?? 'no code'}`);
    this.name = 'RequestFailed';
  }
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

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null;
    throw new RequestFailed(response.status, body?.error?.code ?? null);
  }

  const body = (await response.json()) as Envelope<T>;
  return body.data;
}

/**
 * `GET /patients/:id/records?booking=` — the whole patient panel in one call.
 *
 * One request rather than three, because `NFR-04` assumes a connection where
 * each round trip is felt and the doctor is waiting with a patient in the room.
 *
 * Without a booking there is no intake to read, which is the consented case:
 * a patient who handed over a code is not necessarily on this chamber's roster.
 */
export async function fetchRecords(input: {
  readonly apiBaseUrl: string;
  readonly token: string | null;
  readonly patientId: string;
  readonly bookingId?: string;
}): Promise<PatientRecords> {
  const query =
    input.bookingId === undefined ? '' : `?booking=${encodeURIComponent(input.bookingId)}`;

  return await call<PatientRecords>(
    `${input.apiBaseUrl}/patients/${input.patientId}/records${query}`,
    input.token,
  );
}

export interface RedeemedConsent {
  readonly consentId: string;
  readonly patientId: string;
  readonly patientName: string;
  readonly expiresAt: string;
}

/**
 * `POST /consents/qr` — `BTN-B05-SCAN` (`FR-PAT-63`).
 *
 * Writes the grant and its audit row; the records are a separate read, which
 * is itself audited, so the patient's log shows both the handover and the look.
 */
export async function redeemConsent(input: {
  readonly apiBaseUrl: string;
  readonly token: string | null;
  readonly code: string;
}): Promise<RedeemedConsent> {
  const key = crypto.randomUUID();

  return await call<RedeemedConsent>(`${input.apiBaseUrl}/consents/qr`, input.token, {
    method: 'POST',
    headers: { 'idempotency-key': key },
    body: JSON.stringify({ code: input.code.trim(), idempotencyKey: key }),
  });
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
      ...(input.draft.symptomSignal === null ? {} : { symptomSignal: input.draft.symptomSignal }),
      sign: input.sign,
      idempotencyKey: key,
    }),
  });
}

/**
 * `GET /lab/catalogue` — the chips `BTN-B05-TEST` renders.
 *
 * Read from the server rather than held here, so the names and prices a
 * doctor ticks are the ones the lab and the patient's wallet will show. An
 * empty list is a hospital with no catalogue, and the chips simply do not
 * appear — never a chip that orders a test nobody can price.
 */
export async function fetchTestCatalogue(input: {
  readonly apiBaseUrl: string;
  readonly token: string | null;
}): Promise<readonly CatalogueTest[]> {
  const result = await call<{ tests: readonly CatalogueTest[] }>(
    `${input.apiBaseUrl}/lab/catalogue`,
    input.token,
    { method: 'GET' },
  );
  return result.tests;
}

/**
 * `POST /test-orders` — the ticked chips, pushed to the lab queue on save
 * (`APP_FLOW.md` B2, `FR-DOC-06`, `FR-LAB-01`).
 *
 * Called after the visit is filed, because an order is attached to the
 * consultation it came out of and the server reads the patient and the
 * hospital from it — never from this request.
 *
 * The idempotency key is the caller's and is **stable per consultation**, not
 * minted here: a doctor whose first attempt failed after the visit saved taps
 * save again, and the same key has to reach the server or the patient is
 * booked for two of every test.
 */
export async function orderTests(input: {
  readonly apiBaseUrl: string;
  readonly token: string | null;
  readonly bookingId: string;
  readonly testCodes: readonly string[];
  readonly idempotencyKey: string;
}): Promise<void> {
  await call<unknown>(`${input.apiBaseUrl}/test-orders`, input.token, {
    method: 'POST',
    headers: { 'idempotency-key': input.idempotencyKey },
    body: JSON.stringify({
      bookingId: input.bookingId,
      tests: input.testCodes.map((testCode) => ({ testCode })),
      idempotencyKey: input.idempotencyKey,
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
