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

function client() {
  return new ApiClient({ baseUrl: API_BASE, getToken: () => readDemoSession()?.token ?? null });
}

function failureOf(error) {
  if (error instanceof NetworkError) return 'offline';
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return 'access';
    if (error.code === 'DEMO_PHONE_NOT_ALLOWED') return 'demoPhone';
    if (error.code === 'VALIDATION_FAILED') return 'phone';
    if (error.code === 'QUEUE_GUARD_FAILED' || error.code === 'QUEUE_CONFLICT') return 'refused';
  }
  return 'failed';
}

async function attempt(call, write = false) {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
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
export function counterPhone(typed) {
  return normaliseBdMobile(toLatinDigits(typed));
}

/** Everybody this number reaches (`FR-REC-20`). */
export async function findByPhone(phone) {
  return await attempt(async () => {
    const data = await client().get(`/registration/patients?phone=${encodeURIComponent(phone)}`);
    return data.patients;
  });
}

export async function registerPatient(body, requestKey = crypto.randomUUID()) {
  return await attempt(async () => {
    const data = await client().post('/registration/patients', body, requestKey);
    if (data.patient?.patientId !== data.patientId || typeof data.created !== 'boolean')
      throw new Error('Registration receipt missing; identity must be reconciled.');
    return data;
  }, true);
}

/**
 * `POST /sessions/:id/walkin` (`FR-REC-14`). Answers with the serial issued:
 * the receipt names the booking issued by this attempt. The original serial
 * survives a lost-answer retry after other patients have joined.
 */
export async function addWalkIn(
  sessionId,
  patientId,
  position,
  requestAttempt = {
    key: crypto.randomUUID(),
    at: new Date().toISOString(),
  },
) {
  return await attempt(async () => {
    const data = await client().post(
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
