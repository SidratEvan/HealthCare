/**
 * The patient app's API client.
 *
 * Discovery is public, so most calls carry no token at all (`FR-GST-01`: the
 * app never shows a login wall). The one call that can carry one is the
 * booking, and it does so only when the person actually has an account.
 */

import { ApiClient } from '@platform/client';

import type {
  AccessLog,
  Availability,
  ConsentOffer,
  DoctorCard,
  HospitalCard,
  HospitalDoctorCard,
  SessionCard,
  StampedList,
  TrackingLinkView,
} from '@/lib/types';

const BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';

/** Where the socket connects. Same origin as the API, without the path. */
export const SOCKET_URL = process.env['NEXT_PUBLIC_SOCKET_URL'] ?? 'http://localhost:4000';

/** No token: every discovery surface is public, and booking is guest-first. */
export const api = new ApiClient({ baseUrl: BASE, getToken: () => null });

export async function specialtyDoctors(specialty: string): Promise<DoctorCard[]> {
  const data = await api.get<{ doctors: DoctorCard[] }>(
    `/doctors?specialty=${encodeURIComponent(specialty)}`,
  );
  return data.doctors;
}

export async function hospitals(): Promise<HospitalCard[]> {
  const data = await api.get<{ hospitals: HospitalCard[] }>('/hospitals');
  return data.hospitals;
}

/**
 * `S-A-07` — the hospitals offering a specialty.
 *
 * The first screen of the booking flow, and the order matters: a patient picks
 * a place they can reach, then a person inside it.
 */
export async function hospitalsForSpecialty(specialty: string): Promise<StampedList<HospitalCard>> {
  const data = await api.get<{ hospitals: HospitalCard[]; asOf: string }>(
    `/hospitals?specialty=${encodeURIComponent(specialty)}`,
  );
  return { items: data.hospitals, asOf: data.asOf };
}

/** `S-A-05h` — the doctors at one hospital, in the specialty asked for. */
export async function doctorsAtHospital(
  hospitalId: string,
  specialty: string,
): Promise<StampedList<HospitalDoctorCard>> {
  const data = await api.get<{ doctors: HospitalDoctorCard[]; asOf: string }>(
    `/hospitals/${hospitalId}/doctors?specialty=${encodeURIComponent(specialty)}`,
  );
  return { items: data.doctors, asOf: data.asOf };
}

export async function doctorSessions(doctorId: string): Promise<SessionCard[]> {
  const data = await api.get<{ doctor: DoctorCard; sessions: SessionCard[] }>(
    `/doctors/${doctorId}`,
  );
  return data.sessions;
}

export async function availability(sessionId: string): Promise<Availability> {
  return await api.get<Availability>(`/sessions/${sessionId}/availability`);
}

export interface BookingResponse {
  readonly bookingId: string;
  readonly serial: number;
  readonly sessionId: string;
  readonly fee: {
    readonly consultationPoisha: number;
    readonly platformFeePoisha: number;
    readonly totalPoisha: number;
    readonly dueAtHospitalPoisha: number;
  };
  readonly trackingUrl: string | null;
  readonly paid: boolean;
}

/**
 * Books a serial.
 *
 * The idempotency key is generated once per confirm *attempt* and reused
 * across retries of that attempt — which is what makes a double tap on a bad
 * connection safe rather than expensive (`APP_FLOW.md` A4).
 */
export async function book(input: {
  readonly sessionId: string;
  readonly method: string;
  readonly guest: {
    readonly name: string;
    readonly phone: string;
    readonly ageYears: number;
    readonly sex: string;
  };
  readonly reason?: string;
  readonly idempotencyKey: string;
}): Promise<BookingResponse> {
  return await api.post<BookingResponse>(
    '/bookings',
    {
      sessionId: input.sessionId,
      method: input.method,
      guest: input.guest,
      ...(input.reason === undefined || input.reason === '' ? {} : { reason: input.reason }),
    },
    input.idempotencyKey,
  );
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
export async function openTrackingLink(token: string): Promise<TrackingLinkView> {
  return await api.get<TrackingLinkView>(`/guest/link/${encodeURIComponent(token)}`);
}

/**
 * A client bound to one booking's access token.
 *
 * Built per call rather than held, because the token is exchanged again every
 * quarter of an hour and a client holding a stale closure would keep
 * presenting the expired one.
 */
function authed(token: string): ApiClient {
  return new ApiClient({ baseUrl: BASE, getToken: () => token });
}

/** `POST /bookings/:id/late` — `MOD-A08-LATE` (`FR-PAT-33`). */
export async function declareLate(input: {
  readonly bookingId: string;
  readonly token: string;
  readonly expectedMinutes: number;
  readonly idempotencyKey: string;
  readonly clientEventId: string;
}): Promise<void> {
  await authed(input.token).post(
    `/bookings/${input.bookingId}/late`,
    { expectedMinutes: input.expectedMinutes, clientEventId: input.clientEventId },
    input.idempotencyKey,
  );
}

/** `POST /bookings/:id/cancel` — `MOD-A08-CANCEL` (`FR-PAT-23`). */
export async function cancelBooking(input: {
  readonly bookingId: string;
  readonly token: string;
  readonly idempotencyKey: string;
  readonly clientEventId: string;
}): Promise<void> {
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
export async function offerConsent(input: {
  readonly patientId: string;
  readonly token: string;
}): Promise<ConsentOffer> {
  // A fresh key per tap: every offer is a new code, and a retried request
  // returning the previous one would be correct anyway.
  return await authed(input.token).post<ConsentOffer>(
    `/patients/${input.patientId}/consent-offer`,
    {},
    crypto.randomUUID(),
  );
}

/** `GET /patients/:id/access` — `BTN-A12-ACCESS`. */
export async function accessLog(input: {
  readonly patientId: string;
  readonly token: string;
}): Promise<AccessLog> {
  return await authed(input.token).get<AccessLog>(`/patients/${input.patientId}/access`);
}

/** `POST /consents/:id/revoke` — `FR-PAT-64`, the half that makes it consent. */
export async function revokeConsent(input: {
  readonly consentId: string;
  readonly token: string;
  readonly idempotencyKey: string;
}): Promise<void> {
  await authed(input.token).post(`/consents/${input.consentId}/revoke`, {}, input.idempotencyKey);
}
