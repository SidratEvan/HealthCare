/**
 * A facility sets itself up (`S-B-11`, pilot step 22, `FR-SUP-01`,
 * `FR-ADM-11`, BACKEND.md §7.7 `/hospital/*`).
 *
 * Until now a facility existed only as seed rows. This is what lets a
 * hospital with no seed data describe itself from the console: its profile
 * and queue rules, departments, doctors and their fees, weekly schedules,
 * wards and beds, and the staff who sign in. Every change is one transaction
 * with its `SETTINGS_CHANGE` audit row (`DB-P7`), so the record of who changed
 * a fee cannot be missing when the fee changed.
 *
 * ## Rules that are not obvious from the forms
 *
 * - A doctor's identity (names, degrees) is editable only while the BMDC
 *   number is unverified and the doctor sits at no other facility. After
 *   verification it is the register's, and a shared doctor's record is not one
 *   facility's to rename (`FR-SUP-02`).
 * - Adding a doctor whose BMDC number is already known links that doctor
 *   rather than creating a second: one person, one record.
 * - A fee or room change reaches the doctor's chambers from today that are
 *   still scheduled; a booking keeps the fee it was made at (DB-P5).
 * - Removing a schedule removes its future chambers nobody has booked. One
 *   somebody booked stays for the counter to run or cancel, and the answer
 *   says how many.
 * - A bed added here starts out of service, "not yet confirmed", so a public
 *   count never includes a bed nobody at the ward has looked at (§3.2).
 * - An administrator cannot deactivate themself, take away their own
 *   administrator role, or reset their own password here (they change it).
 *   A deactivated account's sessions end at once.
 */

import {
  BED_UNCONFIRMED_REASON,
  type FacilityRole,
  type BedPatchBody,
  type BedsBody,
  type DepartmentBody,
  type DepartmentPatchBody,
  type DoctorBody,
  type DoctorPatchBody,
  type ProfileBody,
  type RulesBody,
  type StaffBody,
  type StaffPatchBody,
  type TemplateBody,
  type WardBody,
} from '@platform/domain';

import { hashPassword, temporaryPassword } from '../config/password.js';
import { AppError, notFound } from '../errors/AppError.js';
import * as repo from '../repositories/hospitalSettings.repo.js';
import * as staffAuthRepo from '../repositories/staffAuth.repo.js';
import { withTransaction, type Tx } from '../repositories/transaction.js';

import { materialise } from './sessionMaterialise.service.js';

/** Who is changing what, for the audit row. */
export interface Actor {
  readonly staffId: string;
  readonly hospitalId: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

const duplicate = (field: string, extra: Record<string, unknown> = {}): AppError =>
  new AppError('SETTINGS_DUPLICATE', { details: { field, ...extra } });

const notAllowed = (reason: string): AppError =>
  new AppError('SETTINGS_NOT_ALLOWED', { details: { reason } });

/** One change and its audit row, together or not at all. */
async function change<T>(
  actor: Actor,
  subject: { table: string; change: string },
  body: (trx: Tx) => Promise<{ result: T; subjectId: string | null }>,
): Promise<T> {
  return await withTransaction(async (trx) => {
    const { result, subjectId } = await body(trx);
    await repo.recordChange(trx, {
      actorStaffId: actor.staffId,
      hospitalId: actor.hospitalId,
      subjectTable: subject.table,
      subjectId,
      change: subject.change,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return result;
  });
}

// --- reading -------------------------------------------------------------------

export async function setup(hospitalId: string): Promise<repo.SetupSnapshot> {
  const snapshot = await repo.snapshot(hospitalId);
  if (snapshot === null) throw notFound('hospital');
  return snapshot;
}

// --- profile and rules ---------------------------------------------------------

export async function updateProfile(actor: Actor, body: ProfileBody): Promise<void> {
  const { coordinates, ...fields } = body;
  await change(actor, { table: 'hospitals', change: 'profile' }, async (trx) => {
    await repo.updateProfile(trx, actor.hospitalId, {
      ...fields,
      ...(coordinates === undefined
        ? {}
        : { lat: coordinates?.lat ?? null, lng: coordinates?.lng ?? null }),
    });
    return { result: undefined, subjectId: actor.hospitalId };
  });
}

export async function updateRules(actor: Actor, body: RulesBody): Promise<void> {
  await change(actor, { table: 'hospital_settings', change: 'queue_rules' }, async (trx) => {
    await repo.updateRules(trx, actor.hospitalId, body);
    return { result: undefined, subjectId: actor.hospitalId };
  });
}

// --- departments ---------------------------------------------------------------

export async function createDepartment(
  actor: Actor,
  body: DepartmentBody,
): Promise<{ departmentId: string }> {
  if (await repo.departmentCodeTaken(actor.hospitalId, body.code)) throw duplicate('code');
  return await change(actor, { table: 'departments', change: 'department_added' }, async (trx) => {
    const departmentId = await repo.createDepartment(trx, {
      hospitalId: actor.hospitalId,
      nameBn: body.nameBn,
      nameEn: body.nameEn,
      code: body.code,
      sortOrder: body.sortOrder ?? 0,
      createdBy: actor.staffId,
    });
    return { result: { departmentId }, subjectId: departmentId };
  });
}

export async function updateDepartment(
  actor: Actor,
  departmentId: string,
  body: DepartmentPatchBody,
): Promise<void> {
  await change(actor, { table: 'departments', change: 'department_changed' }, async (trx) => {
    if (!(await repo.updateDepartment(trx, actor.hospitalId, departmentId, body))) {
      throw notFound('department');
    }
    return { result: undefined, subjectId: departmentId };
  });
}

// --- doctors -------------------------------------------------------------------

export async function addDoctor(
  actor: Actor,
  body: DoctorBody,
): Promise<{ doctorHospitalId: string; doctorId: string; linkedExisting: boolean }> {
  if (!(await repo.departmentBelongs(actor.hospitalId, body.departmentId)))
    throw notFound('department');

  const known = await repo.doctorByBmdc(body.bmdcNumber);
  if (
    known !== null &&
    (await repo.doctorAlreadyHere(actor.hospitalId, known.id, body.departmentId))
  ) {
    throw duplicate('bmdcNumber');
  }

  return await change(actor, { table: 'doctor_hospitals', change: 'doctor_added' }, async (trx) => {
    const doctorId =
      known?.id ??
      (await repo.createDoctor(trx, {
        nameBn: body.nameBn,
        nameEn: body.nameEn,
        bmdcNumber: body.bmdcNumber,
        degrees: body.degrees ?? null,
        specialties: body.specialties ?? [],
        defaultConsultMinutes: body.defaultConsultMinutes ?? 15,
        createdBy: actor.staffId,
      }));
    const doctorHospitalId = await repo.linkDoctor(trx, {
      doctorId,
      hospitalId: actor.hospitalId,
      departmentId: body.departmentId,
      feePoisha: body.feePoisha,
      room: body.room ?? null,
      createdBy: actor.staffId,
    });
    return {
      result: { doctorHospitalId, doctorId, linkedExisting: known !== null },
      subjectId: doctorHospitalId,
    };
  });
}

export async function updateDoctor(
  actor: Actor,
  doctorHospitalId: string,
  body: DoctorPatchBody,
): Promise<void> {
  const chamber = await repo.chamberOfDoctor(actor.hospitalId, doctorHospitalId);
  if (chamber === null) throw notFound('doctor');

  const { feePoisha, room, isActive, ...identity } = body;
  const touchesIdentity = Object.values(identity).some((value) => value !== undefined);
  if (touchesIdentity) {
    if (chamber.verified) throw notAllowed('doctor_verified');
    if (await repo.doctorSitsElsewhere(chamber.doctorId, actor.hospitalId)) {
      throw notAllowed('doctor_shared');
    }
  }

  await change(actor, { table: 'doctor_hospitals', change: 'doctor_changed' }, async (trx) => {
    if (touchesIdentity) await repo.updateDoctorIdentity(trx, chamber.doctorId, identity);
    if (feePoisha !== undefined || room !== undefined || isActive !== undefined) {
      await repo.updateDoctorHospital(trx, doctorHospitalId, { feePoisha, room, isActive });
    }
    if (feePoisha !== undefined || room !== undefined) {
      await repo.carryToScheduledSessions(trx, {
        hospitalId: actor.hospitalId,
        doctorId: chamber.doctorId,
        departmentId: chamber.departmentId,
        feePoisha,
        room,
      });
    }
    return { result: undefined, subjectId: doctorHospitalId };
  });

  // A doctor made active again gets their chambers back straight away.
  if (isActive === true) await materialise();
}

// --- weekly schedules ----------------------------------------------------------

export async function addSchedule(
  actor: Actor,
  body: TemplateBody,
): Promise<{ templateId: string; sessionsCreated: number }> {
  const chamber = await repo.chamberOfDoctor(actor.hospitalId, body.doctorHospitalId);
  if (chamber === null) throw notFound('doctor');
  if (
    await repo.templateOverlaps({
      doctorId: chamber.doctorId,
      weekday: body.weekday,
      startTime: body.startTime,
      endTime: body.endTime,
    })
  ) {
    throw duplicate('schedule');
  }

  const templateId = await change(
    actor,
    { table: 'session_templates', change: 'schedule_added' },
    async (trx) => {
      const id = await repo.createTemplate(trx, {
        doctorHospitalId: body.doctorHospitalId,
        weekday: body.weekday,
        startTime: body.startTime,
        endTime: body.endTime,
        capacity: body.capacity ?? null,
        createdBy: actor.staffId,
      });
      return { result: id, subjectId: id };
    },
  );

  // Its chambers now, not at the next hourly run: an administrator who adds
  // Tuesday evenings expects to see this Tuesday's chamber.
  const sessionsCreated = await materialise({ onlyTemplate: templateId });
  return { templateId, sessionsCreated };
}

export async function removeSchedule(
  actor: Actor,
  templateId: string,
): Promise<{ bookedChambersKept: number }> {
  if ((await repo.templateOf(actor.hospitalId, templateId)) === null) throw notFound('schedule');
  return await change(
    actor,
    { table: 'session_templates', change: 'schedule_removed' },
    async (trx) => {
      const kept = await repo.endTemplate(trx, templateId);
      return { result: { bookedChambersKept: kept }, subjectId: templateId };
    },
  );
}

// --- wards and beds ------------------------------------------------------------

export async function addWard(actor: Actor, body: WardBody): Promise<{ wardId: string }> {
  return await change(actor, { table: 'wards', change: 'ward_added' }, async (trx) => {
    const wardId = await repo.createWard(trx, {
      hospitalId: actor.hospitalId,
      ...body,
      createdBy: actor.staffId,
    });
    return { result: { wardId }, subjectId: wardId };
  });
}

export async function addBeds(actor: Actor, body: BedsBody): Promise<{ bedIds: string[] }> {
  if ((await repo.wardOf(actor.hospitalId, body.wardId)) === null) throw notFound('ward');
  const taken: string[] = [];
  for (const label of body.labels) {
    if (await repo.bedLabelTaken(actor.hospitalId, label, null)) taken.push(label);
  }
  if (taken.length > 0) throw duplicate('label', { labels: taken });

  return await change(actor, { table: 'beds', change: 'beds_added' }, async (trx) => {
    const bedIds: string[] = [];
    for (const label of body.labels) {
      bedIds.push(
        await repo.createBed(trx, {
          hospitalId: actor.hospitalId,
          wardId: body.wardId,
          label,
          kind: body.kind,
          nightlyPoisha: body.nightlyPoisha,
          unconfirmedReason: BED_UNCONFIRMED_REASON,
          createdBy: actor.staffId,
        }),
      );
    }
    return { result: { bedIds }, subjectId: body.wardId };
  });
}

export async function updateBed(actor: Actor, bedId: string, body: BedPatchBody): Promise<void> {
  if (body.label !== undefined && (await repo.bedLabelTaken(actor.hospitalId, body.label, bedId))) {
    throw duplicate('label', { labels: [body.label] });
  }
  await change(actor, { table: 'beds', change: 'bed_changed' }, async (trx) => {
    if (!(await repo.updateBed(trx, actor.hospitalId, bedId, body))) throw notFound('bed');
    return { result: undefined, subjectId: bedId };
  });
}

// --- staff (FR-ADM-11, FR-SUP-01) ----------------------------------------------

export async function addStaff(
  actor: Actor,
  body: StaffBody,
): Promise<{ staffId: string; temporaryPassword: string }> {
  if (await staffAuthRepo.emailTakenAt(actor.hospitalId, body.email)) throw duplicate('email');
  const staffCode = body.staffCode ?? null;
  if (staffCode !== null && (await repo.staffCodeTaken(actor.hospitalId, staffCode, null))) {
    throw duplicate('staffCode');
  }

  // Shown once, to the administrator, to hand over in person. Never logged;
  // the first sign-in replaces it (`must_change_password`).
  const password = temporaryPassword();
  const passwordHash = await hashPassword(password);

  return await change(actor, { table: 'staff_users', change: 'staff_added' }, async (trx) => {
    const staffId = await staffAuthRepo.createStaffAccount(trx, {
      hospitalId: actor.hospitalId,
      email: body.email,
      fullName: body.fullName,
      staffCode,
      passwordHash,
      createdBy: actor.staffId,
    });
    await repo.setRoles(trx, {
      staffId,
      hospitalId: actor.hospitalId,
      roles: body.roles,
      by: actor.staffId,
    });
    return { result: { staffId, temporaryPassword: password }, subjectId: staffId };
  });
}

export async function updateStaff(
  actor: Actor,
  staffId: string,
  body: StaffPatchBody,
): Promise<void> {
  const account = await repo.staffOf(actor.hospitalId, staffId);
  if (account === null) throw notFound('staff');

  const self = staffId === actor.staffId;
  if (self && body.isActive === false) throw notAllowed('own_access');
  if (
    self &&
    body.roles !== undefined &&
    !body.roles.includes('hospital_admin' satisfies FacilityRole)
  ) {
    throw notAllowed('own_access');
  }
  const staffCode = body.staffCode;
  if (
    staffCode !== undefined &&
    staffCode !== null &&
    (await repo.staffCodeTaken(actor.hospitalId, staffCode, staffId))
  ) {
    throw duplicate('staffCode');
  }

  await change(actor, { table: 'staff_users', change: 'staff_changed' }, async (trx) => {
    await repo.updateStaff(trx, staffId, {
      fullName: body.fullName,
      isActive: body.isActive,
      staffCode,
    });
    if (body.roles !== undefined) {
      await repo.setRoles(trx, {
        staffId,
        hospitalId: actor.hospitalId,
        roles: body.roles,
        by: actor.staffId,
      });
    }
    return { result: undefined, subjectId: staffId };
  });

  // A deactivated account, or one whose roles changed, signs in again: its
  // refresh tokens were issued for access it no longer has.
  if (body.isActive === false || body.roles !== undefined) {
    await staffAuthRepo.revokeOtherSessions(staffId, null);
  }
}

export async function resetStaffPassword(
  actor: Actor,
  staffId: string,
): Promise<{ temporaryPassword: string }> {
  if (staffId === actor.staffId) throw notAllowed('own_password');
  if ((await repo.staffOf(actor.hospitalId, staffId)) === null) throw notFound('staff');

  const password = temporaryPassword();
  const passwordHash = await hashPassword(password);
  await change(actor, { table: 'staff_users', change: 'password_reset' }, async (trx) => {
    await staffAuthRepo.setPassword(staffId, passwordHash, true, trx);
    return { result: undefined, subjectId: staffId };
  });
  await staffAuthRepo.revokeOtherSessions(staffId, null);
  return { temporaryPassword: password };
}

// --- going live ----------------------------------------------------------------

/**
 * Publishes the facility (`hospitals.is_live`). Refused while there is
 * nothing a patient could book: no department or no active doctor. Its
 * doctors still appear only once their BMDC numbers are verified.
 */
export async function goLive(actor: Actor): Promise<void> {
  const counts = await repo.setupCounts(actor.hospitalId);
  if (counts.departments === 0 || counts.doctors === 0) throw notAllowed('nothing_to_publish');
  await change(actor, { table: 'hospitals', change: 'went_live' }, async (trx) => {
    await repo.goLive(trx, actor.hospitalId);
    return { result: undefined, subjectId: actor.hospitalId };
  });
}

/** `pnpm doctor:verify` (`FR-SUP-02`): platform staff, after checking the register. */
export async function verifyDoctor(bmdcNumber: string): Promise<string | null> {
  return await repo.markDoctorVerified(bmdcNumber);
}
