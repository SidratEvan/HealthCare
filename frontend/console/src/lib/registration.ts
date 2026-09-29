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
import type { QueueState } from '@platform/domain';
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
  readonly owner: 'account' | 'guest';
}

/** Why a counter call failed, in the words the screen has copy for. */
export type CounterFailure = 'offline' | 'phone' | 'refused' | 'failed';

export type CounterResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: CounterFailure };

function client(): ApiClient {
  return new ApiClient({ baseUrl: API_BASE, getToken: () => readDemoSession()?.token ?? null });
}

function failureOf(error: unknown): CounterFailure {
  if (error instanceof NetworkError) return 'offline';
  if (error instanceof ApiError) {
    if (error.code === 'VALIDATION_FAILED') return 'phone';
    if (error.code === 'QUEUE_GUARD_FAILED' || error.code === 'QUEUE_CONFLICT') return 'refused';
  }
  return 'failed';
}

async function attempt<T>(call: () => Promise<T>): Promise<CounterResult<T>> {
  try {
    return { ok: true, value: await call() };
  } catch (error: unknown) {
    return { ok: false, failure: failureOf(error) };
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

export async function registerPatient(body: {
  readonly phone: string;
  readonly fullName: string;
  readonly ageYears: number;
  readonly sex: 'male' | 'female' | 'other';
}): Promise<CounterResult<string>> {
  return await attempt(async () => {
    const data = await client().post<{ patientId: string }>(
      '/registration/patients',
      body,
      crypto.randomUUID(),
    );
    return data.patientId;
  });
}

export type WalkInPosition =
  | { readonly kind: 'end' }
  | { readonly kind: 'index'; readonly index: number; readonly reason: string };

/**
 * `POST /sessions/:id/walkin` (`FR-REC-14`). Answers with the serial issued:
 * the highest in the chamber, because a walk-in is always the newest booking
 * even when it is seated earlier in the line.
 */
export async function addWalkIn(
  sessionId: string,
  patientId: string,
  position: WalkInPosition,
): Promise<CounterResult<number>> {
  return await attempt(async () => {
    const data = await client().post<{ state: QueueState }>(
      `/sessions/${sessionId}/walkin`,
      {
        clientEventId: crypto.randomUUID(),
        clientTs: new Date().toISOString(),
        patientId,
        position: position.kind,
        index: position.kind === 'index' ? position.index : null,
        reason: position.kind === 'index' ? position.reason : null,
      },
      crypto.randomUUID(),
    );
    return data.state.entries.reduce((max, entry) => Math.max(max, entry.serial), 0);
  });
}
