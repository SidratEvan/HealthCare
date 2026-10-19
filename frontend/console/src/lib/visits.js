/**
 * A refused or failed request, with the API's own error code when it sent one.
 *
 * The code is what lets a screen say *why*: `CONSENT_CODE_INVALID` asks the
 * doctor for a new code, while a 500 or a dropped connection is worth a retry.
 */
export class RequestFailed extends Error {
  status;
  code;
  constructor(status, code) {
    super(`${String(status)} ${code ?? 'no code'}`);
    this.status = status;
    this.code = code;
    this.name = 'RequestFailed';
  }
}

async function call(url, token, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new RequestFailed(response.status, body?.error?.code ?? null);
  }

  const body = await response.json();
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
export async function fetchRecords(input) {
  const query =
    input.bookingId === undefined ? '' : `?booking=${encodeURIComponent(input.bookingId)}`;

  return await call(`${input.apiBaseUrl}/patients/${input.patientId}/records${query}`, input.token);
}

/**
 * `POST /consents/qr` — `BTN-B05-SCAN` (`FR-PAT-63`).
 *
 * Writes the grant and its audit row; the records are a separate read, which
 * is itself audited, so the patient's log shows both the handover and the look.
 */
export async function redeemConsent(input) {
  const key = crypto.randomUUID();

  return await call(`${input.apiBaseUrl}/consents/qr`, input.token, {
    method: 'POST',
    headers: { 'idempotency-key': key },
    body: JSON.stringify({ code: input.code.trim(), idempotencyKey: key }),
  });
}

/** FR-DOC-08/FR-DOC-10: authorised drafts, never browser storage. */
export async function fetchConsultation(input) {
  return await call(`${input.apiBaseUrl}/visits/booking/${input.bookingId}`, input.token, {
    method: 'GET',
  });
}

export function consultationDraft(visit) {
  return {
    diagnosisText: visit.diagnosisText ?? '',
    adviceTextBn: visit.adviceTextBn ?? '',
    followUpDays: null,
    followUpDate: visit.followUpDate,
    symptomSignal: visit.symptomSignal,
    testCodes: [],
    medicines: visit.medicines.map((m) => ({
      key: crypto.randomUUID(),
      medicineId: m.medicineId,
      name: m.name,
      strength: m.strength ?? '',
      schedule: m.schedule ?? '',
      days: m.durationDays === null ? '' : String(m.durationDays),
      instructionBn: m.instructionBn ?? '',
    })),
  };
}

/**
 * `POST /visits` — `BTN-B05-DRAFT` when `sign` is false, `BTN-B05-SIGN` when true.
 *
 * FR-DOC-08: the caller freezes the body/key of an uncertain attempt.
 */
export async function saveVisit(input) {
  const key = input.idempotencyKey;

  return await call(`${input.apiBaseUrl}/visits`, input.token, {
    method: 'POST',
    headers: { 'idempotency-key': key },
    body: JSON.stringify({
      bookingId: input.bookingId,
      patientId: input.patientId,
      sessionId: input.sessionId,
      expectedRevision: input.expectedRevision,
      // Omitted rather than sent empty: an empty string would be a diagnosis
      // that exists and says nothing.
      ...(input.draft.diagnosisText.trim() === ''
        ? {}
        : { diagnosisText: input.draft.diagnosisText.trim() }),
      ...(input.draft.adviceTextBn.trim() === ''
        ? {}
        : { adviceTextBn: input.draft.adviceTextBn.trim() }),
      ...(input.draft.followUpDate !== undefined && input.draft.followUpDate !== null
        ? { followUpDate: input.draft.followUpDate }
        : input.draft.followUpDays === null
          ? {}
          : { followUpDate: dhakaDateIn(input.draft.followUpDays) }),
      ...(input.draft.symptomSignal === null ? {} : { symptomSignal: input.draft.symptomSignal }),
      // Always sent, so a row the doctor removed is removed from the draft too.
      medicines: input.medicines,
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
export async function fetchTestCatalogue(input) {
  const result = await call(`${input.apiBaseUrl}/lab/catalogue`, input.token, { method: 'GET' });
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
export async function orderTests(input) {
  await call(`${input.apiBaseUrl}/test-orders`, input.token, {
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
export async function fetchSessionFee(input) {
  const data = await call(`${input.apiBaseUrl}/sessions/${input.sessionId}/queue`, input.token);

  return data.bookings[0]?.feePoisha ?? null;
}

/**
 * A Dhaka calendar date `days` from today, as `YYYY-MM-DD`.
 *
 * Dhaka's, not the browser's: a follow-up is a date a patient reads on a
 * calendar in Bangladesh, and a console running with its clock set to another
 * timezone must not write a different day (`DB-P4`).
 */
function dhakaDateIn(days) {
  const at = new Date(Date.now() + days * 86_400_000);

  // `en-CA` formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * `GET /formulary?q=` — suggestions for a medicine's name (`FR-DOC-05`).
 * Two letters or more; fewer is answered here with nothing, without asking.
 */
export async function fetchFormulary(input) {
  const query = input.query.trim();
  if (query.length < 2) return [];
  const result = await call(
    `${input.apiBaseUrl}/formulary?q=${encodeURIComponent(query)}`,
    input.token,
    { method: 'GET' },
  );
  return result.medicines;
}

/**
 * `GET /patients/:id/documents/:docId/url` — a paper the patient added, opened
 * under their consent; the server audits the opening (`FR-PAT-62`, `DB-P7`).
 * The store's path is under the API, so it is made the API's address here.
 */
export async function fetchPaperUrl(input) {
  const result = await call(
    `${input.apiBaseUrl}/patients/${encodeURIComponent(input.patientId)}/documents/${encodeURIComponent(input.documentId)}/url`,
    input.token,
    { method: 'GET' },
  );
  return result.url.startsWith('/') ? `${input.apiBaseUrl}${result.url}` : result.url;
}
