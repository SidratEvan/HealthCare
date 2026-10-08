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

import { createHash } from 'node:crypto';

import {
  BED_UNCONFIRMED_REASON,
  type FacilityRole,
  type BedPatchBody,
  LOGO_MAX_BYTES,
  brandProblems,
  logoBytesMatch,
  type BedsBody,
  type BrandBody,
  type DeclaredCapabilitiesBody,
  type DepartmentBody,
  type DepartmentPatchBody,
  type DoctorBody,
  type DoctorPatchBody,
  type LogoBody,
  type ProfileBody,
  type PublishingBody,
  type RulesBody,
  type StaffBody,
  type StaffPatchBody,
  type TemplateBody,
  type WardBody,
  type WardPatchBody,
  identityEditable,
  missingForReview,
  nextLifecycle,
  type SetupCounts,
} from '@platform/domain';

import { hashPassword, temporaryPassword } from '../config/password.js';
import { AppError, notFound, validationFailed } from '../errors/AppError.js';
import * as repo from '../repositories/hospitalSettings.repo.js';
import * as platformRepo from '../repositories/platform.repo.js';
import * as staffAuthRepo from '../repositories/staffAuth.repo.js';
import { withTransaction, type Tx } from '../repositories/transaction.js';

import { revokeStaffSessions } from './accessGuard.service.js';
import { onlinePaymentsAvailable } from './deployment.service.js';
import * as portals from './portal.service.js';
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

const notAllowed = (reason: string, extra: Record<string, unknown> = {}): AppError =>
  new AppError('SETTINGS_NOT_ALLOWED', { details: { reason, ...extra } });

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

/** The setup screen's whole view, with what the checklist counts (`FR-ONB-03`). */
export type SetupView = repo.SetupSnapshot & {
  readonly counts: SetupCounts;
  /**
   * Where patients reach this hospital's own portal (`FR-BRD-07`): under the
   * platform's domain, when the deployment has one, and at the hospital's own
   * domain, when the platform has recorded one. Both null: by `?scope=` only.
   */
  readonly portal: { readonly platform: string | null; readonly own: string | null };
  /** Whether this deployment takes payment online, so the payment hold means anything (plan H3). */
  readonly onlinePayments: boolean;
};

export async function setup(hospitalId: string): Promise<SetupView> {
  const [snapshot, counts] = await Promise.all([
    repo.snapshot(hospitalId),
    platformRepo.setupCounts(hospitalId),
  ]);
  if (snapshot === null || counts === null) throw notFound('hospital');
  return {
    ...snapshot,
    counts,
    portal: portals.portalAddresses(snapshot.hospital.code, snapshot.hospital.portalDomain),
    onlinePayments: onlinePaymentsAvailable(),
  };
}

// --- profile and rules ---------------------------------------------------------

/**
 * The facility's own details.
 *
 * Its division, district and registration number are what it was registered
 * as, and what the platform checks before approving it. They are the
 * hospital's to correct while the workspace is setting up, which is where a
 * typo in an application is found, and refused once review has been asked
 * for (`identityEditable`, plan D2). A workspace sent back is setting up
 * again.
 */
export async function updateProfile(actor: Actor, body: ProfileBody): Promise<void> {
  const { coordinates, ...fields } = body;
  if (
    fields.division !== undefined ||
    fields.district !== undefined ||
    fields.registrationNo !== undefined
  ) {
    const workspace = await platformRepo.findWorkspace(actor.hospitalId);
    if (workspace === null) throw notFound('hospital');
    if (!identityEditable(workspace.lifecycle)) {
      throw notAllowed('identity_after_review', { lifecycle: workspace.lifecycle });
    }
  }
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

// --- the figures it shares (FR-NET-04) ---------------------------------------------

/**
 * Which live figures the hospital shares with the network: the whole list of
 * what it withholds. Its own decision, and so its administrator's to make.
 * A figure withheld is said to be not shared wherever it would have been
 * shown, from the next read.
 */
export async function updatePublishing(actor: Actor, body: PublishingBody): Promise<void> {
  await change(actor, { table: 'hospital_settings', change: 'publishing' }, async (trx) => {
    await repo.setUnpublished(trx, actor.hospitalId, body.unpublished);
    return { result: undefined, subjectId: actor.hospitalId };
  });
}

// --- its public face: colours and a logo (FR-BRD-06) -----------------------------

/**
 * The hospital's colours, or the platform's own again.
 *
 * Checked here whatever the screen checked: a set that cannot carry text is
 * refused with which rule it broke, and nothing is stored, so the app is never
 * half in somebody's colours (`brand/theme.ts`).
 */
export async function updateBrand(actor: Actor, body: BrandBody): Promise<void> {
  if (body.theme !== null) {
    const problems = brandProblems(body.theme);
    if (problems.length > 0) throw notAllowed('brand_unreadable', { problems });
  }
  await change(
    actor,
    { table: 'hospital_settings', change: body.theme === null ? 'brand_cleared' : 'brand' },
    async (trx) => {
      await repo.setBrand(trx, actor.hospitalId, body.theme);
      return { result: undefined, subjectId: actor.hospitalId };
    },
  );
}

/**
 * A logo: the image it says it is, and no larger than the ceiling. The
 * answer is its version, which the public address carries.
 */
export async function setLogo(actor: Actor, body: LogoBody): Promise<{ version: string }> {
  const bytes = Buffer.from(body.content, 'base64');
  if (bytes.length === 0 || bytes.length > LOGO_MAX_BYTES) {
    throw validationFailed({ field: 'content', reason: 'logo_too_large' });
  }
  if (!logoBytesMatch(body.fileType, bytes)) {
    throw validationFailed({ field: 'content', reason: 'logo_not_that_image' });
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await change(actor, { table: 'hospital_logos', change: 'logo' }, async (trx) => {
    await repo.setLogo(trx, {
      hospitalId: actor.hospitalId,
      contentType: body.fileType,
      bytes,
      sha256,
      staffId: actor.staffId,
    });
    return { result: undefined, subjectId: actor.hospitalId };
  });
  return { version: sha256.slice(0, 16) };
}

export async function removeLogo(actor: Actor): Promise<void> {
  await change(actor, { table: 'hospital_logos', change: 'logo_removed' }, async (trx) => {
    await repo.removeLogo(trx, actor.hospitalId);
    return { result: undefined, subjectId: actor.hospitalId };
  });
}

/** The hospital's own logo, for its own settings screen; null when it has none. */
export async function ownLogo(
  hospitalId: string,
): Promise<{ contentType: string; bytes: Buffer } | null> {
  return await repo.ownLogo(hospitalId);
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

/**
 * Takes away a department nobody sits in (plan D2): one added by mistake, or
 * under the wrong code, which cannot be changed. One a doctor is listed
 * under is refused, and the refusal says so; the doctor is moved or
 * deactivated first.
 */
export async function removeDepartment(actor: Actor, departmentId: string): Promise<void> {
  await change(actor, { table: 'departments', change: 'department_removed' }, async (trx) => {
    const outcome = await repo.removeDepartment(trx, actor.hospitalId, departmentId);
    if (!outcome.removed) {
      throw outcome.inUse ? notAllowed('department_has_doctors') : notFound('department');
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

/** A ward's names and floor (plan D2). What kind of ward it is does not change. */
export async function updateWard(actor: Actor, wardId: string, body: WardPatchBody): Promise<void> {
  if (
    body.nameEn !== undefined &&
    (await repo.wardNameTaken(actor.hospitalId, body.nameEn, wardId))
  ) {
    throw duplicate('nameEn');
  }
  await change(actor, { table: 'wards', change: 'ward_changed' }, async (trx) => {
    if (!(await repo.updateWard(trx, actor.hospitalId, wardId, body))) throw notFound('ward');
    return { result: undefined, subjectId: wardId };
  });
}

/** Takes away a ward that holds no bed (plan D2). */
export async function removeWard(actor: Actor, wardId: string): Promise<void> {
  await change(actor, { table: 'wards', change: 'ward_removed' }, async (trx) => {
    const outcome = await repo.removeWard(trx, actor.hospitalId, wardId);
    if (!outcome.removed) throw outcome.inUse ? notAllowed('ward_has_beds') : notFound('ward');
    return { result: undefined, subjectId: wardId };
  });
}

/**
 * Takes away a bed the ward never brought into service (plan D2): a line
 * typed by mistake. A bed that has been in service has a history and is not
 * removed here; the ward takes it out of service from its board, with the
 * reason (`BTN-B06-OOS`).
 */
export async function removeBed(actor: Actor, bedId: string): Promise<void> {
  await change(actor, { table: 'beds', change: 'bed_removed' }, async (trx) => {
    const outcome = await repo.removeUnconfirmedBed(trx, actor.hospitalId, bedId);
    if (!outcome.removed) throw outcome.inUse ? notAllowed('bed_in_use') : notFound('bed');
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
    await revokeStaffSessions(staffId);
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
  await revokeStaffSessions(staffId);
  return { temporaryPassword: password };
}

/**
 * Turns a staff member's second factor off (pilot step 28, FR-SEC-10): a lost
 * or replaced phone. Their next sign-in asks for none — or, for an
 * administrator, sets one up again before anything opens. Every session they
 * hold ends. Not one's own: that is somebody else's check on the person
 * holding the phone, or `pnpm staff:reset-2fa` when nobody else can.
 */
export async function resetStaffTwoFactor(actor: Actor, staffId: string): Promise<void> {
  if (staffId === actor.staffId) throw notAllowed('own_two_factor');
  if ((await repo.staffOf(actor.hospitalId, staffId)) === null) throw notFound('staff');

  await change(actor, { table: 'staff_users', change: 'two_factor_reset' }, async (trx) => {
    await staffAuthRepo.clearTwoFactor(staffId, trx);
    return { result: undefined, subjectId: staffId };
  });
  await revokeStaffSessions(staffId);
}

// --- capabilities (FR-EMG-05) ----------------------------------------------------

export async function declareCapabilities(
  actor: Actor,
  body: DeclaredCapabilitiesBody,
): Promise<void> {
  await change(actor, { table: 'capabilities', change: 'capabilities_declared' }, async (trx) => {
    await repo.declareCapabilities(trx, {
      hospitalId: actor.hospitalId,
      kinds: body.kinds,
      by: actor.staffId,
    });
    return { result: undefined, subjectId: actor.hospitalId };
  });
}

// --- going live ----------------------------------------------------------------

/**
 * Asks the platform to review the workspace (`FR-ONB-04`).
 *
 * The hospital's half of going live, and the only half it has: this moves
 * the workspace to `ready_for_review` and publishes nothing. A platform
 * administrator approves it, or sends it back with a note this hospital's
 * administrator reads on the same screen.
 *
 * Refused while a required item of the checklist is missing — a department,
 * a doctor, a schedule — and the refusal names them, so the screen can say
 * what to do rather than that something is wrong.
 */
export async function requestReview(actor: Actor): Promise<void> {
  const workspace = await platformRepo.findWorkspace(actor.hospitalId);
  if (workspace === null) throw notFound('hospital');

  const to = nextLifecycle(workspace.lifecycle, 'request_review');
  if (to === null) throw notAllowed('wrong_state', { lifecycle: workspace.lifecycle });

  const missing = missingForReview(workspace.counts);
  if (missing.length > 0) throw notAllowed('not_ready', { missing });

  await change(actor, { table: 'hospitals', change: 'review_requested' }, async (trx) => {
    const moved = await platformRepo.moveLifecycle(trx, {
      hospitalId: actor.hospitalId,
      from: workspace.lifecycle,
      to,
      reviewedBy: null,
    });
    if (!moved) throw notAllowed('changed_meanwhile');
    return { result: undefined, subjectId: actor.hospitalId };
  });
}

/** `pnpm doctor:verify` (`FR-SUP-02`): platform staff, after checking the register. */
export async function verifyDoctor(bmdcNumber: string): Promise<string | null> {
  return await repo.markDoctorVerified(bmdcNumber);
}
