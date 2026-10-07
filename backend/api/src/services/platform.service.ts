/**
 * The platform's side of bringing a hospital on (`PRD.md` §14c, `FR-ONB-*`,
 * `S-B-12`).
 *
 * A platform administrator creates a hospital's workspace with its first
 * administrator, verifies its doctors against the register, and answers its
 * request to go live: approve, or send back with a reason the hospital reads.
 * Afterwards it can suspend a workspace, reinstate it, or close it. That is
 * everything this file does, and none of it touches a patient (`FR-ONB-08`).
 *
 * ## Why approval checks the checklist again
 *
 * The hospital could only ask for review with its required items in place.
 * Between asking and being answered it can delete its only schedule. So
 * approval counts again, and adds the one thing only the platform supplies: a
 * verified doctor. A hospital approved with none would be live with nobody to
 * book, which is the listing-that-leads-nowhere this flow exists to prevent
 * (`missingForApproval`).
 *
 * ## Every act is audited, with the workspace as its subject (`FR-ONB-07`)
 *
 * The same `SETTINGS_CHANGE` row a hospital's own changes write, with the
 * platform administrator as the actor: one place to read what happened to a
 * hospital and who did it, whoever they work for.
 */

import {
  actionNeedsNote,
  missingForApproval,
  modulesProblems,
  nextLifecycle,
  platformActions,
  setupChecklist,
  type AgreementState,
  type ChecklistItem,
  type HospitalModule,
  type OrgAction,
  type WorkspaceBody,
} from '@platform/domain';

import { AppError, notFound, validationFailed } from '../errors/AppError.js';
import * as settingsRepo from '../repositories/hospitalSettings.repo.js';
import * as repo from '../repositories/platform.repo.js';
import * as staffAuthRepo from '../repositories/staffAuth.repo.js';
import { withTransaction } from '../repositories/transaction.js';

import * as modules from './modules.service.js';
import * as portals from './portal.service.js';
import { createFirstAdministrator } from './staffAuth.service.js';

/** The platform administrator acting, for the audit row. */
export interface PlatformActor {
  readonly staffId: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

/** The acts that are the platform's to take. */
export type PlatformAction = Exclude<OrgAction, 'request_review'>;

const notAllowed = (reason: string, extra: Record<string, unknown> = {}): AppError =>
  new AppError('SETTINGS_NOT_ALLOWED', { details: { reason, ...extra } });

/** A workspace with what may be done to it next. */
export interface WorkspaceSummary extends repo.WorkspaceRow {
  readonly checklist: readonly ChecklistItem[];
  /** What the platform may do from this state. Empty while it is the hospital's move. */
  readonly actions: readonly OrgAction[];
}

function summarise(row: repo.WorkspaceRow): WorkspaceSummary {
  return {
    ...row,
    checklist: setupChecklist(row.counts),
    actions: platformActions(row.lifecycle),
  };
}

export async function listWorkspaces(): Promise<readonly WorkspaceSummary[]> {
  return (await repo.listWorkspaces()).map(summarise);
}

export interface WorkspaceDetail extends WorkspaceSummary {
  /**
   * Where the hospital's portal is (`FR-BRD-07`): under the platform's
   * domain, when the deployment has one, and at its own, when one is recorded.
   */
  readonly portal: { readonly platform: string | null; readonly own: string | null };
  /**
   * The facility's own phone. Here and not in the list, which stays
   * organisations and counts (`FR-ONB-08`): it is for the person who rings a
   * hospital before approving it (`FR-ONB-10`).
   */
  readonly phone: string | null;
  readonly doctors: readonly repo.WorkspaceDoctor[];
  /** Who the platform would write to or ring; `phone` where one was given (`FR-ONB-09`). */
  readonly administrators: readonly {
    readonly fullName: string;
    readonly email: string;
    readonly phone: string | null;
  }[];
  /** What stops an approval right now; empty when nothing does. */
  readonly missingForApproval: readonly string[];
  /**
   * What the hospital has used (`FR-SUP-04`): three counts and when they were
   * counted. Counts of activity, never a row of it (`FR-ONB-08`).
   */
  readonly usage: repo.WorkspaceUsage & { readonly asOf: string };
}

export async function workspace(hospitalId: string): Promise<WorkspaceDetail> {
  const row = await repo.findWorkspace(hospitalId);
  if (row === null) throw notFound('hospital');

  const [doctors, administrators, phone, usage] = await Promise.all([
    repo.doctorsOf(hospitalId),
    repo.administratorsOf(hospitalId),
    repo.facilityPhoneOf(hospitalId),
    repo.usageOf(hospitalId),
  ]);

  return {
    ...summarise(row),
    portal: portals.portalAddresses(row.code, row.portalDomain),
    phone,
    doctors,
    administrators,
    missingForApproval: missingForApproval(row.counts),
    usage: { ...usage, asOf: new Date().toISOString() },
  };
}

/**
 * Records where a hospital's agreement stands (`FR-SUP-04`, the state half):
 * trial, active, overdue or ended, with a note for whoever reads it next.
 *
 * **A record, and it switches nothing.** What the agreement says, and what
 * follows from its state, are settled outside this product; taking a hospital
 * out of the network is suspending its workspace (`FR-ONB-06`), which stays a
 * separate act with a reason the hospital reads. An overdue invoice that
 * silently unlisted a hospital's doctors would be the product deciding
 * something nobody here decided.
 *
 * The note belongs to the state it was written with: setting a state without
 * one clears the last.
 */
export async function setAgreement(
  actor: PlatformActor,
  hospitalId: string,
  state: AgreementState,
  note: string | null,
): Promise<WorkspaceDetail> {
  const changed = await withTransaction(async (trx) => {
    const found = await repo.setAgreement(trx, {
      hospitalId,
      state,
      note,
      changedBy: actor.staffId,
    });
    if (!found) return false;
    await settingsRepo.recordChange(trx, {
      actorStaffId: actor.staffId,
      hospitalId,
      subjectTable: 'hospitals',
      subjectId: hospitalId,
      // Which state, so the trail can be read without the row it changed.
      change: `agreement_${state}`,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return true;
  });
  if (!changed) throw notFound('hospital');

  return await workspace(hospitalId);
}

/**
 * Switches a hospital's modules (`FR-BRD-11`, `FR-SUP-03`): the whole list of
 * what is off, as the screen shows it.
 *
 * The platform's act. What a hospital runs follows what was agreed with it,
 * which is settled outside this product; here it is only switched. Nothing
 * the hospital holds is touched: a module switched back on finds its beds,
 * its cases and its orders where they were.
 */
export async function setModules(
  actor: PlatformActor,
  hospitalId: string,
  off: readonly HospitalModule[],
): Promise<WorkspaceDetail> {
  if ((await repo.findWorkspace(hospitalId)) === null) throw notFound('hospital');

  const problems = modulesProblems(off);
  if (problems.length > 0) throw notAllowed(problems[0] ?? 'modules', { problems });

  await withTransaction(async (trx) => {
    await settingsRepo.setModulesOff(trx, hospitalId, off);
    await settingsRepo.recordChange(trx, {
      actorStaffId: actor.staffId,
      hospitalId,
      subjectTable: 'hospital_settings',
      subjectId: hospitalId,
      change: 'modules',
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  });
  // Refused, and unpublished, from the next request.
  modules.forgetModules(hospitalId);

  return await workspace(hospitalId);
}

/**
 * Records a domain the hospital owns as its portal's address, or removes it
 * (`FR-BRD-07`).
 *
 * The platform's act, not the hospital's: an address is answered for by the
 * whole deployment (CORS, the socket handshake, every link sent), and a
 * hospital naming somebody else's domain, or the platform's own, is not
 * something to find out afterwards. That the domain's DNS points here, and
 * its certificate, are outside the product; this is the record that it does.
 *
 * Refused: a name under the platform's own domain (those are hospitals'
 * codes, not anybody's to record), and one another hospital already has.
 */
export async function setPortalDomain(
  actor: PlatformActor,
  hospitalId: string,
  domain: string | null,
): Promise<WorkspaceDetail> {
  if ((await repo.findWorkspace(hospitalId)) === null) throw notFound('hospital');

  if (domain !== null) {
    const own = portals.platformDomain();
    if (own !== null && (domain === own || domain.endsWith(`.${own}`))) {
      throw notAllowed('domain_is_the_platforms');
    }
    const holder = await repo.hospitalWithDomain(domain);
    if (holder !== null && holder !== hospitalId) throw notAllowed('domain_taken');
  }

  await withTransaction(async (trx) => {
    await repo.setPortalDomain(trx, hospitalId, domain);
    await settingsRepo.recordChange(trx, {
      actorStaffId: actor.staffId,
      hospitalId,
      subjectTable: 'hospitals',
      subjectId: hospitalId,
      change: domain === null ? 'portal_domain_removed' : 'portal_domain',
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  });
  // Answered for from the next request, not in half a minute.
  portals.forgetRecordedDomains();

  return await workspace(hospitalId);
}

/**
 * Creates a hospital's workspace and its first administrator (`FR-ONB-01`).
 *
 * The workspace starts in `setup`, not live and not listed anywhere. The
 * temporary password is returned once, to be handed over in person, and has
 * to be changed at first sign-in; an administrator also sets up two-step
 * verification before any console opens (`FR-SEC-10`).
 */
export async function createWorkspace(
  actor: PlatformActor,
  body: WorkspaceBody,
): Promise<{
  readonly hospitalId: string;
  readonly code: string;
  readonly adminEmail: string;
  readonly temporaryPassword: string;
}> {
  if ((await staffAuthRepo.hospitalIdByCode(body.code)) !== null) {
    throw new AppError('SETTINGS_DUPLICATE', { details: { field: 'code', code: body.code } });
  }

  const created = await createFirstAdministrator({
    hospitalCode: body.code,
    hospital: {
      nameBn: body.nameBn,
      nameEn: body.nameEn,
      kind: body.kind,
      division: body.division,
      district: body.district,
    },
    email: body.adminEmail,
    fullName: body.adminName,
  });

  await withTransaction(async (trx) => {
    if (body.registrationNo !== undefined) {
      await repo.setRegistrationNo(trx, created.hospitalId, body.registrationNo);
    }
    await settingsRepo.recordChange(trx, {
      actorStaffId: actor.staffId,
      hospitalId: created.hospitalId,
      subjectTable: 'hospitals',
      subjectId: created.hospitalId,
      change: 'workspace_created',
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  });

  return {
    hospitalId: created.hospitalId,
    code: body.code,
    adminEmail: body.adminEmail,
    temporaryPassword: created.temporaryPassword,
  };
}

/**
 * Approve, send back, suspend, reinstate or close (`FR-ONB-04`, `FR-ONB-06`).
 *
 * Refused when the workspace is not in a state the act starts from, when a
 * reason is owed and missing, and — for an approval — when the hospital is no
 * longer ready. The state is moved only from the state it was read in, so two
 * administrators answering at once cannot both be recorded.
 */
export async function act(
  actor: PlatformActor,
  hospitalId: string,
  action: PlatformAction,
  note: string | undefined,
): Promise<WorkspaceDetail> {
  const row = await repo.findWorkspace(hospitalId);
  if (row === null) throw notFound('hospital');

  const to = nextLifecycle(row.lifecycle, action);
  if (to === null) throw notAllowed('wrong_state', { lifecycle: row.lifecycle, action });

  if (actionNeedsNote(action) && (note === undefined || note.trim() === '')) {
    throw validationFailed({ note: 'required' });
  }

  if (action === 'approve') {
    const missing = missingForApproval(row.counts);
    if (missing.length > 0) throw notAllowed('not_ready', { missing });
  }

  await withTransaction(async (trx) => {
    const moved = await repo.moveLifecycle(trx, {
      hospitalId,
      from: row.lifecycle,
      to,
      reviewedBy: actor.staffId,
      // An approval or a reinstatement clears the reason the last refusal
      // gave: it no longer describes the workspace.
      note: actionNeedsNote(action) ? (note?.trim() ?? null) : null,
    });
    if (!moved) throw notAllowed('changed_meanwhile');

    await settingsRepo.recordChange(trx, {
      actorStaffId: actor.staffId,
      hospitalId,
      subjectTable: 'hospitals',
      subjectId: hospitalId,
      change: `workspace_${action}`,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  });

  return await workspace(hospitalId);
}

/** Records a doctor's BMDC verification, from the review screen (`FR-ONB-05`). */
export async function verifyDoctor(
  actor: PlatformActor,
  hospitalId: string,
  doctorId: string,
): Promise<WorkspaceDetail> {
  if ((await repo.findWorkspace(hospitalId)) === null) throw notFound('hospital');

  await withTransaction(async (trx) => {
    const verified = await repo.verifyDoctorAt(trx, { hospitalId, doctorId });
    if (!verified) throw notFound('doctor');

    await settingsRepo.recordChange(trx, {
      actorStaffId: actor.staffId,
      hospitalId,
      subjectTable: 'doctors',
      subjectId: doctorId,
      change: 'doctor_verified',
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  });

  return await workspace(hospitalId);
}
