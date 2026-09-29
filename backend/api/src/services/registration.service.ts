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
  const patients = await registrationRepo.patientsForPhone(phone);
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
 * A patient for this phone and name. The same name under the same number is
 * the same person, so registering twice finds the first record rather than
 * making a second (`FR-REC-20`).
 */
export async function register(
  body: RegisterPatientBody,
): Promise<{ patientId: string; phone: string }> {
  const phone = phoneOf(body.phone);
  const patientId = await withTransaction(async (trx) => {
    const guestId = await guestRepo.findOrCreateIdentity(trx, {
      phone,
      displayName: body.fullName,
    });
    return await guestRepo.findOrCreatePatient(trx, {
      guestId,
      fullName: body.fullName,
      ageYears: body.ageYears,
      sex: body.sex,
      phone,
    });
  });
  return { patientId, phone };
}
