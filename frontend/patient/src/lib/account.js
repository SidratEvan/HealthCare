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

import { fileHref } from '@/lib/api';
import { forgetLinks, rememberLink } from '@/lib/bookings';

const BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';
const STORAGE_KEY = 'patient.account';

export function readAccount() {
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeAccount(session) {
  try {
    if (session === null) globalThis.localStorage.removeItem(STORAGE_KEY);
    else globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage refused (a private window): the session lasts as long as the page.
  }
}

function failureOf(error) {
  if (error instanceof NetworkError) return { kind: 'offline' };
  if (error instanceof ApiError) {
    const details = error.details ?? {};
    if (error.code === 'DEMO_PHONE_NOT_ALLOWED') return { kind: 'demoPhone' };
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
    if (error.code === 'DOCUMENT_NOT_SUPPORTED') return { kind: 'unsupported' };
    if (error.code === 'AUTH_TOKEN_INVALID' || error.code === 'AUTH_REQUIRED')
      return { kind: 'signedOut' };
  }
  return { kind: 'failed' };
}

async function attempt(call) {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    const failure = failureOf(error);
    if (failure.kind === 'signedOut') writeAccount(null);
    return { ok: false, failure };
  }
}

const publicApi = new ApiClient({ baseUrl: BASE, getToken: () => null });

/** `S-A-03` → `POST /auth/otp`. The demo's code comes back only on a demonstration. */
export async function requestCode(typedPhone) {
  return await attempt(async () => {
    const data = await publicApi.post('/auth/otp', {
      phone: toLatinDigits(typedPhone),
    });
    return { resendAfterSeconds: data.resendAfterSeconds, demoCode: data.demoCode ?? null };
  });
}

/** `S-A-04` → `POST /auth/verify`. Answers how many patients the number holds to claim. */
export async function verifyCode(typedPhone, typedCode) {
  return await attempt(async () => {
    const data = await publicApi.post('/auth/verify', {
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
async function freshAccess() {
  const session = readAccount();
  if (session === null) throw new ApiError('AUTH_REQUIRED', 'Not signed in.', 401);
  if (Date.parse(session.accessExpiresAt) - Date.now() > 60_000) return session.access;
  const data = await publicApi.post('/auth/refresh', { refresh: session.refresh });
  const renewed = {
    access: data.access,
    refresh: data.refresh,
    accessExpiresAt: data.accessExpiresAt,
    phone: data.user.phone,
  };
  writeAccount(renewed);
  return renewed.access;
}

async function signedIn() {
  const token = await freshAccess();
  return new ApiClient({ baseUrl: BASE, getToken: () => token });
}

export async function profiles() {
  return await attempt(async () => (await (await signedIn()).get('/me/profiles')).profiles);
}

/** `S-A-20`'s list: what the number holds that no account owns yet. */
export async function claimable() {
  return await attempt(
    async () =>
      (await (await signedIn()).post('/guest/claim', { confirm: false }, crypto.randomUUID()))
        .claimable,
  );
}

/** `BTN-A20-CLAIM`: all of it, in one step (`FR-GST-09`). */
export async function claimAll() {
  return await attempt(
    async () =>
      (await (await signedIn()).post('/guest/claim', { confirm: true }, crypto.randomUUID()))
        .claimed,
  );
}

export async function recordsOf(patientId) {
  return await attempt(
    async () => (await (await signedIn()).get(`/patients/${patientId}/records`)).visits,
  );
}

/** My serials, from the server: the same on every phone the account is signed in on. */
export async function myBookings() {
  return await attempt(async () => await (await signedIn()).get('/me/bookings'));
}

/**
 * A link to the live screen of one of the account's own bookings, for a phone
 * that holds none. Kept once given (`rememberLink`), so it is asked for once.
 */
export async function linkForBooking(bookingId) {
  return await attempt(async () => {
    const { url } = await (
      await signedIn()
    ).post(`/me/bookings/${bookingId}/link`, {}, crypto.randomUUID());
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
export async function bookAsProfile(input) {
  return await (
    await signedIn()
  ).post(
    '/bookings',
    {
      sessionId: input.sessionId,
      method: input.method,
      patientId: input.patientId,
      ...(input.reason === undefined || input.reason === '' ? {} : { reason: input.reason }),
      ...(input.arrivalWindowStart === undefined || input.arrivalWindowStart === null
        ? {}
        : { arrivalWindowStart: input.arrivalWindowStart }),
    },
    input.idempotencyKey,
  );
}

export async function signOut() {
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

export async function papersOf(patientId) {
  return await attempt(
    async () =>
      (await (await signedIn()).get(`/me/documents?patient=${encodeURIComponent(patientId)}`))
        .documents,
  );
}

/** The file read in the browser and sent as base64; the server reads its bytes again. */
export async function addPaper(input) {
  const buffer = new Uint8Array(await input.file.arrayBuffer());
  let binary = '';
  for (let index = 0; index < buffer.length; index += 0x8000) {
    binary += String.fromCharCode(...buffer.subarray(index, index + 0x8000));
  }
  const key = crypto.randomUUID();
  return await attempt(
    async () =>
      (
        await (
          await signedIn()
        ).post(
          '/me/documents',
          {
            patientId: input.patientId,
            contentType: input.file.type,
            dataBase64: btoa(binary),
            docType: input.docType,
            ...(input.docDate === null ? {} : { docDate: input.docDate }),
            ...(input.doctorName.trim() === '' ? {} : { doctorName: input.doctorName.trim() }),
            idempotencyKey: key,
          },
          key,
        )
      ).document,
  );
}

export async function removePaper(documentId) {
  return await attempt(
    async () =>
      (await (await signedIn()).delete(`/me/documents/${encodeURIComponent(documentId)}`)).removed,
  );
}

/** A fresh signed link, minted at the moment of opening. */
export async function paperLink(patientId, documentId) {
  return await attempt(async () =>
    fileHref(
      (
        await (
          await signedIn()
        ).get(
          `/patients/${encodeURIComponent(patientId)}/documents/${encodeURIComponent(documentId)}/url`,
        )
      ).url,
    ),
  );
}
