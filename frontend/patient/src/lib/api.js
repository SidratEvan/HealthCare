/**
 * The patient app's API client.
 *
 * Discovery is public, so most calls carry no token at all (`FR-GST-01`: the
 * app never shows a login wall). The one call that can carry one is the
 * booking, and it does so only when the person actually has an account.
 */

import { ApiClient } from '@platform/client';

import { scopedPath } from '@/lib/scope';

const BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';

/** Where the socket connects. Same origin as the API, without the path. */
export const SOCKET_URL = process.env['NEXT_PUBLIC_SOCKET_URL'] ?? 'http://localhost:4000';

/**
 * Where a hospital's logo is (`FR-BRD-06`). The version is part of the
 * address, so a changed logo is a new address and an unchanged one is kept by
 * the phone.
 */
export function logoUrl(hospitalId, version) {
  return `${BASE}/hospitals/${hospitalId}/logo?v=${encodeURIComponent(version)}`;
}

/** No token: every discovery surface is public, and booking is guest-first. */
export const api = new ApiClient({ baseUrl: BASE, getToken: () => null });

export async function specialtyDoctors(specialty) {
  const data = await api.get(scopedPath('/doctors', new URLSearchParams({ specialty })));
  return data.doctors;
}

export async function hospitals() {
  const data = await api.get(scopedPath('/hospitals'));
  return data.hospitals;
}

/**
 * `S-A-07` — the hospitals offering a specialty.
 *
 * The first screen of the booking flow, and the order matters: a patient picks
 * a place they can reach, then a person inside it.
 */
export async function hospitalsForSpecialty(specialty) {
  const data = await api.get(scopedPath('/hospitals', new URLSearchParams({ specialty })));
  return { items: data.hospitals, asOf: data.asOf };
}

/**
 * `S-A-05h` — the doctors at one hospital, in the specialty asked for.
 *
 * With no specialty, every doctor there: what a search result for a hospital
 * by name opens onto (`S-A-07s`), where nobody has named a specialty.
 */
export async function doctorsAtHospital(hospitalId, specialty) {
  const suffix = specialty === null ? '' : `?specialty=${encodeURIComponent(specialty)}`;
  const data = await api.get(`/hospitals/${hospitalId}/doctors${suffix}`);
  return { items: data.doctors, asOf: data.asOf };
}

/** Every participating hospital, stamped (`S-A-07` opened for a hospital by name). */
export async function allHospitals() {
  const data = await api.get(scopedPath('/hospitals'));
  return { items: data.hospitals, asOf: data.asOf };
}

/**
 * One search across every participating hospital.
 *
 * `need` is a need's key from `needKey`; `q` is what was typed. Either, both
 * or neither — neither answers with every hospital in the network.
 */
export async function searchNetwork(query) {
  const params = new URLSearchParams();
  if (query.q !== '') params.set('q', query.q);
  if (query.need !== null) params.set('need', query.need);
  return await api.get(scopedPath('/search', params));
}

export async function doctorSessions(doctorId) {
  const data = await api.get(`/doctors/${doctorId}`);
  return data.sessions;
}

export async function availability(sessionId) {
  return await api.get(`/sessions/${sessionId}/availability`);
}

/**
 * Books a serial.
 *
 * The idempotency key is generated once per confirm *attempt* and reused
 * across retries of that attempt — which is what makes a double tap on a bad
 * connection safe rather than expensive (`APP_FLOW.md` A4).
 */
export async function book(input) {
  return await callerFor(input.guestToken).post(
    '/bookings',
    {
      sessionId: input.sessionId,
      method: input.method,
      guest: input.guest,
      ...(input.reason === undefined || input.reason === '' ? {} : { reason: input.reason }),
      ...(input.arrivalWindowStart === undefined || input.arrivalWindowStart === null
        ? {}
        : { arrivalWindowStart: input.arrivalWindowStart }),
    },
    input.idempotencyKey,
  );
}

/** The shared client, or one carrying a proved phone's guest token. */
function callerFor(guestToken) {
  const token = guestToken ?? null;
  return token === null ? api : new ApiClient({ baseUrl: BASE, getToken: () => token });
}

/**
 * `MOD-A07-GUEST`'s next step (`FR-GST-03`, `FR-GST-12`): whether this number
 * must prove itself with a code before the booking. A number that already has
 * comes back with its guest token; a demonstration asks nothing.
 */
export async function startGuest(input) {
  return await api.post('/guest/start', input);
}

/**
 * `MOD-GST-OTP`: the code for the guest token, and the proof this device keeps
 * so it is not asked again. No account is made (`FR-GST-04`).
 */
export async function verifyGuest(input) {
  return await api.post('/guest/verify', input);
}

// ---------------------------------------------------------------------------
// The live serial screen (`S-A-08`)
// ---------------------------------------------------------------------------

/**
 * Opens an SMS tracking link (`FR-GST-05`).
 *
 * Takes no token and returns one. The opaque token in the URL is the durable
 * credential — it lasts until the chamber closes plus a day and the hospital
 * can revoke it — and what comes back is a short-lived access token for the
 * socket and for the two things a patient may do.
 */
export async function openTrackingLink(token) {
  return await api.get(`/guest/link/${encodeURIComponent(token)}`);
}

/**
 * `GET /medicines?q=` — who near here has this medicine (`FR-PHR-02`).
 *
 * Public: a stock flag names no patient and no staff member, so this needs no
 * token, like hospital discovery beside it. No position is sent — `S-A-01`
 * location permission is not built, and the API ranks by freshness instead,
 * which is the honest fallback rather than a guessed coordinate.
 */
export async function searchMedicines(q) {
  // Scoped: inside a hospital's own portal the answer is about that
  // hospital's pharmacy and no other (`FR-BRD-09`).
  const result = await api.get(scopedPath('/medicines', new URLSearchParams({ q })));
  return result.medicines;
}

/**
 * A fresh signed URL for one of that booking's reports (`TAB-A12-REP`).
 *
 * Fetched on the tap rather than carried in the link's payload: a signed URL
 * expires, and one minted when the screen loaded would be dead by the time
 * somebody scrolled to it.
 */
export async function openReportFile(token, reportId) {
  const result = await api.get(
    `/guest/link/${encodeURIComponent(token)}/reports/${encodeURIComponent(reportId)}`,
  );
  return fileHref(result.url);
}

/**
 * A stored file's signed address, as something a tab can open.
 *
 * The demonstration's store and a server's own disk answer with a path on the
 * API (`/files/<key>?expires=&sig=`), which is under the versioned API, not
 * under this app. Opened as it came, it was this app's address and a page
 * that does not exist; a bucket's full address is left as it is.
 */
export function fileHref(url) {
  return url.startsWith('/') ? `${BASE}${url}` : url;
}

/**
 * A client bound to one booking's access token.
 *
 * Built per call rather than held, because the token is exchanged again every
 * quarter of an hour and a client holding a stale closure would keep
 * presenting the expired one.
 */
function authed(token) {
  return new ApiClient({ baseUrl: BASE, getToken: () => token });
}

/** `POST /bookings/:id/late` — `MOD-A08-LATE` (`FR-PAT-33`). */
export async function declareLate(input) {
  await authed(input.token).post(
    `/bookings/${input.bookingId}/late`,
    { expectedMinutes: input.expectedMinutes, clientEventId: input.clientEventId },
    input.idempotencyKey,
  );
}

/**
 * `POST /bookings/:id/payments/:paymentId/confirm` — `S-A-07p` (plan H3).
 * The provider's word from the return address goes along only to choose how
 * the server asks; the answer is the server's (`FR-PAY-09`).
 */
export async function confirmPayment(input) {
  return await authed(input.token).post(
    `/bookings/${input.bookingId}/payments/${input.paymentId}/confirm`,
    { hint: input.hint },
  );
}

/**
 * `POST /payments/intent` — another attempt at paying for a held serial
 * (`BTN-A07P-RETRY`, `BTN-A07D-PAY`), or paying at the counter instead
 * (`BTN-A07P-COUNTER`). A new key each time: each is a new attempt.
 */
export async function payAgain(input) {
  const key = crypto.randomUUID();
  const answer = await authed(input.token).post(
    '/payments/intent',
    { bookingId: input.bookingId, method: input.method, idempotencyKey: key },
    key,
  );
  return {
    payment: { ...answer.payment, redirectUrl: answer.redirectUrl },
    redirectUrl: answer.redirectUrl,
  };
}

/** `POST /bookings/:id/cancel` — `MOD-A08-CANCEL` (`FR-PAT-23`). */
export async function cancelBooking(input) {
  await authed(input.token).post(
    `/bookings/${input.bookingId}/cancel`,
    { clientEventId: input.clientEventId },
    input.idempotencyKey,
  );
}

// ---------------------------------------------------------------------------
// The health wallet (`S-A-12`, `FR-PAT-63`, `FR-PAT-64`)
//
// Each call takes the access token a tracking link was exchanged for. There
// are no accounts in this version (`CLAUDE.md` §4.1), so the only thing that
// can speak for a patient on this device is a link to one of their bookings —
// and the API accepts that only while `DEMO_MODE` is on.
// ---------------------------------------------------------------------------

/** `POST /patients/:id/consent-offer` — `BTN-A12-QR`. */
export async function offerConsent(input) {
  // A fresh key per tap: every offer is a new code, and a retried request
  // returning the previous one would be correct anyway.
  return await authed(input.token).post(
    `/patients/${input.patientId}/consent-offer`,
    {},
    crypto.randomUUID(),
  );
}

/** `GET /patients/:id/access` — `BTN-A12-ACCESS`. */
export async function accessLog(input) {
  return await authed(input.token).get(`/patients/${input.patientId}/access`);
}

/** `POST /consents/:id/revoke` — `FR-PAT-64`, the half that makes it consent. */
export async function revokeConsent(input) {
  await authed(input.token).post(`/consents/${input.consentId}/revoke`, {}, input.idempotencyKey);
}

// ---------------------------------------------------------------------------
// Beds (`S-A-11`, FR-PAT-50..52)
// ---------------------------------------------------------------------------

/** Hospitals that have beds of `kind`, each with its published figures. */
export async function hospitalsWithBeds(kind) {
  const data = await api.get(scopedPath('/hospitals', new URLSearchParams({ bedKind: kind })));
  return { items: data.hospitals, asOf: data.asOf };
}

/**
 * `POST /bed-requests` — `MOD-A11-REQUEST`.
 *
 * The idempotency key is made once per send attempt and reused across its
 * retries, as the booking's is, so a double tap on a bad connection files one
 * request, not two.
 */
export async function requestBed(input) {
  return await callerFor(input.guestToken).post(
    '/bed-requests',
    {
      hospitalId: input.hospitalId,
      bedKind: input.bedKind,
      patient: input.patient,
      expectedArrivalAt: input.expectedArrivalAt,
      note: input.note,
    },
    input.idempotencyKey,
  );
}

/** `GET /bed-requests/track/:token` — the token is the credential. */
export async function trackBedRequest(token) {
  return await api.get(`/bed-requests/track/${encodeURIComponent(token)}`);
}

// ---------------------------------------------------------------------------
// Emergency (`S-A-10b`, `S-A-10c`) — public; nothing is asked of anybody
// ---------------------------------------------------------------------------

/** `GET /emergency/search` — ranked (`FR-PAT-43`). Every field may be missing. */
export async function emergencySearch(query) {
  const params = new URLSearchParams();
  if (query.problem !== null) params.set('problem', query.problem);
  if (query.position !== null) {
    params.set('lat', String(query.position.lat));
    params.set('lng', String(query.position.lng));
  }
  const encoded = params.toString();
  const suffix = encoded === '' ? '' : `?${encoded}`;
  return await api.get(`/emergency/search${suffix}`);
}

/**
 * `POST /emergency/inbound` — "I'm on my way" (`FR-PAT-46`).
 *
 * The key is made once, when the sheet opens, and reused for every retry of
 * the same alert: a phone on one bar of signal that sends it three times has
 * told the ER once.
 */
export async function sendInbound(body, idempotencyKey) {
  return await api.post('/emergency/inbound', body, idempotencyKey);
}

/** `GET /emergency/track/:token` — the token is the credential. */
export async function trackEmergency(token) {
  return await api.get(`/emergency/track/${encodeURIComponent(token)}`);
}

/** `POST /emergency/track/:token/cancel` — `BTN-A10C-CANCEL`. */
export async function cancelEmergency(token) {
  return await api.post(`/emergency/track/${encodeURIComponent(token)}/cancel`, {});
}

// ---------------------------------------------------------------------------
// The standby list (`FR-PAT-25`…`27`) — public; the status token is the place
// ---------------------------------------------------------------------------

/**
 * `POST /sessions/:id/standby` (`BTN-A06D-STANDBY`).
 *
 * One key per join attempt, reused across its retries: a double tap on a bad
 * connection is one place on the list and one payment, not two.
 */
export async function joinStandby(input) {
  return await callerFor(input.guestToken).post(
    `/sessions/${input.sessionId}/standby`,
    { guest: input.guest, prepay: input.prepay, clientEventId: input.idempotencyKey },
    input.idempotencyKey,
  );
}

/** `GET /standby/:token` — `S-A-08s`, polled while the patient waits. */
export async function standbyStatus(token) {
  return await api.get(`/standby/${encodeURIComponent(token)}`);
}

/** `POST /standby/:token/accept` — yes to the chair (`FR-PAT-27`). */
export async function acceptStandby(input) {
  return await api.post(
    `/standby/${encodeURIComponent(input.token)}/accept`,
    { method: input.method, clientEventId: input.idempotencyKey },
    input.idempotencyKey,
  );
}

/** `POST /standby/:token/decline` — no; the chair goes to the next person. */
export async function declineStandby(token) {
  await api.post(`/standby/${encodeURIComponent(token)}/decline`, {}, crypto.randomUUID());
}

/** `POST /standby/:token/leave` — off the list. A prepayment is owed back. */
export async function leaveStandby(token) {
  return await api.post(`/standby/${encodeURIComponent(token)}/leave`, {}, crypto.randomUUID());
}
