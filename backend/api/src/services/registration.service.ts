/**
 * Counter registration (`S-B-03`, `MOD-B02-WALKIN`, pilot step 23,
 * `FR-REC-20`, `FR-GST-13`).
 *
 * "Register a new patient in under 30 seconds: phone, name, age, gender;
 * duplicates detected by phone number." The phone comes first because it is
 * the one thing a returning patient's records are found by, and a new record
 * for somebody already known splits their history in two.
 *
 * Registration makes the same rows a guest booking does — a guest identity
 * for the phone and a patient under it (`FR-GST-13`: "no account is
 * created") — so a patient registered at the counter can later verify the
 * phone in the app and find everything (`FR-GST-09`).
 */

import { normaliseBdMobile } from '@platform/domain';
import type { RegisterPatientBody } from '@platform/domain';

import { validationFailed } from '../errors/AppError.js';
import * as guestRepo from '../repositories/guest.repo.js';
import * as registrationRepo from '../repositories/registration.repo.js';
import { withTransaction } from '../repositories/transaction.js';

export interface CounterActor {
  readonly staffId: string;
  readonly hospitalId: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

function phoneOf(typed: string): string {
  const phone = normaliseBdMobile(typed);
  if (phone === null) throw validationFailed({ field: 'phone', reason: 'not_bd_mobile' });
  return phone;
}

/** Everybody the number reaches, with the lookup audited (`DB-P7`). */
export async function lookup(
  actor: CounterActor,
  typedPhone: string,
): Promise<{ phone: string; patients: registrationRepo.CounterPatient[] }> {
  const phone = phoneOf(typedPhone);
  const patients = await registrationRepo.patientsForPhone(phone, actor.hospitalId);
  if (patients.length > 0) {
    await withTransaction(async (trx) => {
      await registrationRepo.recordLookup(trx, {
        actorStaffId: actor.staffId,
        hospitalId: actor.hospitalId,
        patientIds: patients.map((patient) => patient.patientId),
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
    });
  }
  return { phone, patients };
}

/**
 * V1 reuses an exact guest phone/name match (`FR-REC-20`). That is a storage
 * rule, not proof of identity. Report reuse and the stored demographics so
 * the counter can require explicit confirmation; do not overwrite the person.
 */
export async function register(
  body: RegisterPatientBody,
  actor: CounterActor,
): Promise<{
  patientId: string;
  phone: string;
  created: boolean;
  ambiguous: boolean;
  patient: registrationRepo.CounterPatient;
}> {
  const phone = phoneOf(body.phone);
  return await withTransaction(async (trx) => {
    const guestId = await guestRepo.findOrCreateIdentity(trx, {
      phone,
      displayName: body.fullName,
    });
    // The identity upsert above retains its row lock until commit, so these
    // reads and the existing creation operation serialize concurrent counters.
    const existing = await registrationRepo.guestNameCount(trx, guestId, body.fullName);
    const patientId = await guestRepo.findOrCreatePatient(trx, {
      guestId,
      fullName: body.fullName,
      ageYears: body.ageYears,
      sex: body.sex,
      phone,
    });
    if (existing > 0)
      await registrationRepo.recordLookup(trx, {
        actorStaffId: actor.staffId,
        hospitalId: actor.hospitalId,
        patientIds: [patientId],
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
    return {
      patientId,
      phone,
      created: existing === 0,
      ambiguous: existing > 1,
      patient: await registrationRepo.registeredPatient(trx, patientId),
    };
  });
}
