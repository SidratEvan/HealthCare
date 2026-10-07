/**
 * A patient's account on this device (pilot step 25, `S-A-03`, `S-A-04`,
 * `S-A-20`, `FR-PAT-01`, `FR-GST-09`).
 *
 * Signing in is optional — the app never puts a login wall in front of
 * booking (`FR-GST-01`). It is how a person gathers everything their number
 * holds in one place: bookings and records made as a guest, and any a
 * hospital imported.
 *
 * ## Where the session lives
 *
 * In `localStorage`, because a patient app that forgets its person every time
 * the tab closes is not one people keep. Every read and write is guarded — a
 * private window can refuse storage, and then the person simply signs in again.
 * The access token lasts fifteen minutes and is renewed from the refresh token
 * a minute before it ends; the server binds that refresh token to this browser
 * (`FR-SEC-05`), so a copied token is refused elsewhere.
 */

import { ApiClient, ApiError, NetworkError } from '@platform/client';
import { toLatinDigits } from '@platform/i18n';

import { forgetLinks, rememberLink } from '@/lib/bookings';

import type { BookingResponse } from '@/lib/api';
import type { VisitRecord } from '@/lib/types';

const BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';
const STORAGE_KEY = 'patient.account';

export interface AccountSession {
  readonly access: string;
  readonly refresh: string;
  readonly accessExpiresAt: string;
  readonly phone: string;
}

interface IssuedSession {
  readonly access: string;
  readonly refresh: string;
  readonly accessExpiresAt: string;
  readonly user: { readonly id: string; readonly phone: string };
  readonly isNew: boolean;
  readonly claimable: number;
}

export interface Profile {
  readonly patientId: string;
  readonly fullName: string;
  readonly ageYears: number | null;
  readonly sex: string;
  readonly relationship: string;
  readonly isPrimary: boolean;
  readonly bookings: number;
  readonly visits: number;
}

export interface ClaimableProfile extends Profile {
  readonly hospitalNameBn: string | null;
  readonly hospitalNameEn: string | null;
}

export type AccountFailure =
  | { readonly kind: 'offline' }
  | { readonly kind: 'phone' }
  | { readonly kind: 'rate' }
  | { readonly kind: 'locked'; readonly until: string | null }
  | { readonly kind: 'wrong'; readonly attemptsLeft: number | null }
  | { readonly kind: 'expired' }
  | { readonly kind: 'signedOut' }
  | { readonly kind: 'failed' };

export type AccountResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: AccountFailure };

export function readAccount(): AccountSession | null {
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    return raw === null ? null : (JSON.parse(raw) as AccountSession);
  } catch {
    return null;
  }
}

function writeAccount(session: AccountSession | null): void {
  try {
    if (session === null) globalThis.localStorage.removeItem(STORAGE_KEY);
    else globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage refused (a private window): the session lasts as long as the page.
  }
}

function failureOf(error: unknown): AccountFailure {
  if (error instanceof NetworkError) return { kind: 'offline' };
  if (error instanceof ApiError) {
    const details = error.details ?? {};
    if (error.code === 'VALIDATION_FAILED') return { kind: 'phone' };
    if (error.code === 'AUTH_OTP_RATE_LIMIT' || error.code === 'RATE_LIMITED')
      return { kind: 'rate' };
    if (error.code === 'AUTH_LOCKED') {
      return {
        kind: 'locked',
        until: typeof details['until'] === 'string' ? details['until'] : null,
      };
    }
    if (error.code === 'AUTH_OTP_INVALID') {
      if (details['reason'] === 'wrong') {
        const left = details['attemptsLeft'];
        return { kind: 'wrong', attemptsLeft: typeof left === 'number' ? left : null };
      }
      return { kind: 'expired' };
    }
    if (error.code === 'AUTH_TOKEN_INVALID' || error.code === 'AUTH_REQUIRED')
      return { kind: 'signedOut' };
  }
  return { kind: 'failed' };
}

async function attempt<T>(call: () => Promise<T>): Promise<AccountResult<T>> {
  try {
    return { ok: true, value: await call() };
  } catch (error: unknown) {
    const failure = failureOf(error);
    if (failure.kind === 'signedOut') writeAccount(null);
    return { ok: false, failure };
  }
}

const publicApi = new ApiClient({ baseUrl: BASE, getToken: () => null });

/** `S-A-03` → `POST /auth/otp`. The demo's code comes back only on a demonstration. */
export async function requestCode(
  typedPhone: string,
): Promise<AccountResult<{ resendAfterSeconds: number; demoCode: string | null }>> {
  return await attempt(async () => {
    const data = await publicApi.post<{ resendAfterSeconds: number; demoCode?: string }>(
      '/auth/otp',
      {
        phone: toLatinDigits(typedPhone),
      },
    );
    return { resendAfterSeconds: data.resendAfterSeconds, demoCode: data.demoCode ?? null };
  });
}

/** `S-A-04` → `POST /auth/verify`. Answers how many patients the number holds to claim. */
export async function verifyCode(
  typedPhone: string,
  typedCode: string,
): Promise<AccountResult<{ isNew: boolean; claimable: number }>> {
  return await attempt(async () => {
    const data = await publicApi.post<IssuedSession>('/auth/verify', {
      phone: toLatinDigits(typedPhone),
      code: toLatinDigits(typedCode).replace(/\s/g, ''),
    });
    writeAccount({
      access: data.access,
      refresh: data.refresh,
      accessExpiresAt: data.accessExpiresAt,
      phone: data.user.phone,
    });
    return { isNew: data.isNew, claimable: data.claimable };
  });
}

/** An access token good for at least a minute more, renewing it if need be. */
async function freshAccess(): Promise<string> {
  const session = readAccount();
  if (session === null) throw new ApiError('AUTH_REQUIRED', 'Not signed in.', 401);
  if (Date.parse(session.accessExpiresAt) - Date.now() > 60_000) return session.access;
  const data = await publicApi.post<IssuedSession>('/auth/refresh', { refresh: session.refresh });
  const renewed = {
    access: data.access,
    refresh: data.refresh,
    accessExpiresAt: data.accessExpiresAt,
    phone: data.user.phone,
  };
  writeAccount(renewed);
  return renewed.access;
}

async function signedIn(): Promise<ApiClient> {
  const token = await freshAccess();
  return new ApiClient({ baseUrl: BASE, getToken: () => token });
}

export async function profiles(): Promise<AccountResult<readonly Profile[]>> {
  return await attempt(
    async () => (await (await signedIn()).get<{ profiles: Profile[] }>('/me/profiles')).profiles,
  );
}

/** `S-A-20`'s list: what the number holds that no account owns yet. */
export async function claimable(): Promise<AccountResult<readonly ClaimableProfile[]>> {
  return await attempt(
    async () =>
      (
        await (
          await signedIn()
        ).post<{ claimable: ClaimableProfile[] }>(
          '/guest/claim',
          { confirm: false },
          crypto.randomUUID(),
        )
      ).claimable,
  );
}

/** `BTN-A20-CLAIM`: all of it, in one step (`FR-GST-09`). */
export async function claimAll(): Promise<AccountResult<number>> {
  return await attempt(
    async () =>
      (
        await (
          await signedIn()
        ).post<{ claimed: number }>('/guest/claim', { confirm: true }, crypto.randomUUID())
      ).claimed,
  );
}

export async function recordsOf(patientId: string): Promise<AccountResult<readonly VisitRecord[]>> {
  return await attempt(
    async () =>
      (await (await signedIn()).get<{ visits: VisitRecord[] }>(`/patients/${patientId}/records`))
        .visits,
  );
}

// ---------------------------------------------------------------------------
// The account's own serials (plan F1, `S-A-09`, `FR-PAT-03`, `FR-GST-10`)
// ---------------------------------------------------------------------------

/** One of the account's bookings, as `GET /me/bookings` lists it. */
export interface AccountBooking {
  readonly bookingId: string;
  readonly sessionId: string;
  readonly serial: number;
  /** Current or past, by the chamber's state and the booking's, never by the date (`FR-PAT-39`). */
  readonly standing: 'current' | 'past';
  readonly patientId: string;
  readonly patientName: string;
  readonly hospitalId: string;
  readonly hospitalNameBn: string;
  readonly hospitalNameEn: string;
  readonly doctorNameBn: string;
  readonly doctorNameEn: string;
  readonly plannedStart: string;
  /** The serial in the chamber now, when somebody is. */
  readonly nowServing: number | null;
}

/** My serials, from the server: the same on every phone the account is signed in on. */
export async function myBookings(): Promise<
  AccountResult<{ readonly bookings: readonly AccountBooking[]; readonly serverTs: string }>
> {
  return await attempt(
    async () =>
      await (
        await signedIn()
      ).get<{ bookings: AccountBooking[]; serverTs: string }>('/me/bookings'),
  );
}

/**
 * A link to the live screen of one of the account's own bookings, for a phone
 * that holds none. Kept once given (`rememberLink`), so it is asked for once.
 */
export async function linkForBooking(bookingId: string): Promise<AccountResult<string>> {
  return await attempt(async () => {
    const { url } = await (
      await signedIn()
    ).post<{ url: string }>(`/me/bookings/${bookingId}/link`, {}, crypto.randomUUID());
    const token = new URL(url, globalThis.location.origin).searchParams.get('t') ?? '';
    if (token !== '') rememberLink(bookingId, token);
    return token;
  });
}

/**
 * Books for one of the account's own profiles (`FR-GST-10`): nothing is
 * retyped, and no phone is proved again, because the account is a phone that
 * was. Throws what the API threw, so the screen names the cause as it does
 * for a guest.
 */
export async function bookAsProfile(input: {
  readonly sessionId: string;
  readonly method: string;
  readonly patientId: string;
  readonly reason?: string;
  readonly idempotencyKey: string;
}): Promise<BookingResponse> {
  return await (
    await signedIn()
  ).post<BookingResponse>(
    '/bookings',
    {
      sessionId: input.sessionId,
      method: input.method,
      patientId: input.patientId,
      ...(input.reason === undefined || input.reason === '' ? {} : { reason: input.reason }),
    },
    input.idempotencyKey,
  );
}

export async function signOut(): Promise<void> {
  const session = readAccount();
  writeAccount(null);
  // The links kept for this account's serials were this account's.
  forgetLinks();
  if (session === null) return;
  try {
    await publicApi.post('/auth/logout', { refresh: session.refresh });
  } catch {
    // Signed out on this device either way; the server's session lapses on its own.
  }
}
