/**
 * Counter registration and walk-ins — the console's calls (pilot step 23,
 * `S-B-03`, `MOD-B02-WALKIN`, `FR-REC-14`, `FR-REC-20`).
 *
 * ## Online only, and saying so
 *
 * Every other reception action queues offline (`FR-OFF-01`), because it
 * describes something that already happened at the counter. A walk-in is
 * different: it needs a serial, and a serial issued offline by two counters
 * would be the same number handed to two people. So a walk-in waits for the
 * connection, and the controls say that is why they are switched off.
 */

import { ApiClient, ApiError, NetworkError } from '@platform/client';
import { normaliseBdMobile } from '@platform/domain';
import { toLatinDigits } from '@platform/i18n';

import { readDemoSession } from '@/lib/demo';

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';

export interface CounterPatient {
  readonly patientId: string;
  readonly fullName: string;
  readonly ageYears: number | null;
  readonly sex: 'male' | 'female' | 'other';
  readonly relationship: string;
  readonly isPrimary: boolean;
  readonly owner: 'account' | 'guest' | 'hospital';
}

/** Why a counter call failed, in the words the screen has copy for. */
export type CounterFailure = 'offline' | 'phone' | 'refused' | 'failed' | 'uncertain' | 'access';

export type CounterResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: CounterFailure };

function client(): ApiClient {
  return new ApiClient({ baseUrl: API_BASE, getToken: () => readDemoSession()?.token ?? null });
}

function failureOf(error: unknown): CounterFailure {
  if (error instanceof NetworkError) return 'offline';
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return 'access';
    if (error.code === 'VALIDATION_FAILED') return 'phone';
    if (error.code === 'QUEUE_GUARD_FAILED' || error.code === 'QUEUE_CONFLICT') return 'refused';
  }
  return 'failed';
}

async function attempt<T>(call: () => Promise<T>, write = false): Promise<CounterResult<T>> {
  try {
    return { ok: true, value: await call() };
  } catch (error: unknown) {
    // A missing/invalid write response can follow a committed transaction.
    // Reuse its attempt; a transport exception does not establish failure.
    return {
      ok: false,
      failure:
        write && !(error instanceof ApiError && error.status < 500)
          ? 'uncertain'
          : failureOf(error),
    };
  }
}

/**
 * The phone as the patient says it — `০১৭…`, `017 …`, `+88017…` — in the
 * stored shape (`DB-P6`), or null when it cannot be a Bangladeshi mobile.
 */
export function counterPhone(typed: string): string | null {
  return normaliseBdMobile(toLatinDigits(typed));
}

/** Everybody this number reaches (`FR-REC-20`). */
export async function findByPhone(
  phone: string,
): Promise<CounterResult<readonly CounterPatient[]>> {
  return await attempt(async () => {
    const data = await client().get<{ patients: CounterPatient[] }>(
      `/registration/patients?phone=${encodeURIComponent(phone)}`,
    );
    return data.patients;
  });
}

export interface PatientRegistrationReceipt {
  readonly patientId: string;
  readonly phone: string;
  readonly created: boolean;
  readonly ambiguous: boolean;
  readonly patient: CounterPatient;
}

export async function registerPatient(
  body: {
    readonly phone: string;
    readonly fullName: string;
    readonly ageYears: number;
    readonly sex: 'male' | 'female' | 'other';
  },
  requestKey: string = crypto.randomUUID(),
): Promise<CounterResult<PatientRegistrationReceipt>> {
  return await attempt(async () => {
    const data = await client().post<PatientRegistrationReceipt>(
      '/registration/patients',
      body,
      requestKey,
    );
    if (data.patient?.patientId !== data.patientId || typeof data.created !== 'boolean')
      throw new Error('Registration receipt missing; identity must be reconciled.');
    return data;
  }, true);
}

export type WalkInPosition =
  | { readonly kind: 'end' }
  | { readonly kind: 'index'; readonly index: number; readonly reason: string };

/**
 * `POST /sessions/:id/walkin` (`FR-REC-14`). Answers with the serial issued:
 * the receipt names the booking issued by this attempt. The original serial
 * survives a lost-answer retry after other patients have joined.
 */
export async function addWalkIn(
  sessionId: string,
  patientId: string,
  position: WalkInPosition,
  requestAttempt: { readonly key: string; readonly at: string } = {
    key: crypto.randomUUID(),
    at: new Date().toISOString(),
  },
): Promise<CounterResult<number>> {
  return await attempt(async () => {
    const data = await client().post<{ walkin?: { serial: number } }>(
      `/sessions/${sessionId}/walkin`,
      {
        clientEventId: requestAttempt.key,
        clientTs: requestAttempt.at,
        patientId,
        position: position.kind,
        index: position.kind === 'index' ? position.index : null,
        reason: position.kind === 'index' ? position.reason : null,
      },
      requestAttempt.key,
    );
    const receipt = data.walkin;
    if (receipt === undefined || !Number.isSafeInteger(receipt.serial) || receipt.serial < 1)
      throw new Error('Walk-in receipt missing; retry the original attempt.');
    return receipt.serial;
  }, true);
}
