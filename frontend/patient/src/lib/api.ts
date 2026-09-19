/**
 * The patient app's API client.
 *
 * Discovery is public, so most calls carry no token at all (`FR-GST-01`: the
 * app never shows a login wall). The one call that can carry one is the
 * booking, and it does so only when the person actually has an account.
 */

import { ApiClient } from '@platform/client';

import type {
  Availability,
  DoctorCard,
  HospitalCard,
  SessionCard,
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
