/**
 * The modules a hospital runs (`PRD.md` `FR-BRD-11`, `FR-SUP-03`; plan C4).
 *
 * One platform, and not every hospital uses all of it: a diagnostic centre
 * has no ward, a clinic no emergency desk. A hospital runs the modules
 * switched on for it. A module that is off is not offered on that hospital's
 * consoles, is refused by the API, and is absent from what the hospital
 * publishes. Nothing it already holds is deleted, so switching one back on
 * finds everything where it was.
 *
 * ## Stored as what is off
 *
 * `hospital_settings.modules_off` (migration 0047). Every hospital that
 * existed before this, and every one made after, has everything on with
 * nothing written; and a module added to the product later is on for
 * everybody without a migration to say so.
 *
 * ## What is never a module
 *
 * Signing in, the hospital's own settings, and the platform's screens. A
 * hospital with every module off can still be set up and switched back on.
 *
 * Which modules a hospital has on is product state. What a module costs, and
 * what an agreement includes, are not in this repository (`CLAUDE.md` §1.2).
 */

import { z } from 'zod';

export const HOSPITAL_MODULES = [
  /** Serials and reception: chambers, the queue, bookings, the counter. */
  'queue',
  /** The doctor's console: visits and the record. */
  'doctor',
  /** Wards, the bed board, bed requests. */
  'beds',
  /** The ER console, inbound alerts, referrals, what the hospital can treat. */
  'emergency',
  /** Test orders and reports. */
  'lab',
  /** The pharmacy's stock flags. */
  'pharmacy',
  /** The administrator's figures, exports, settlement and refunds. */
  'dashboard',
  /** Bringing the hospital's own data in. */
  'import',
] as const;

export type HospitalModule = (typeof HOSPITAL_MODULES)[number];

export function isHospitalModule(value: string): value is HospitalModule {
  return (HOSPITAL_MODULES as readonly string[]).includes(value);
}

/**
 * The module a staff role's console belongs to. An administrator's role is
 * not one module's: the dashboard and the import are, and settings are
 * nobody's.
 */
export const MODULE_OF_ROLE: Readonly<Record<string, HospitalModule | null>> = {
  receptionist: 'queue',
  doctor: 'doctor',
  ward: 'beds',
  emergency: 'emergency',
  lab: 'lab',
  pharmacy: 'pharmacy',
  hospital_admin: null,
};

/** Why a set of switched-off modules cannot be saved. */
export type ModulesProblem = 'doctor_needs_queue';

/**
 * What stops a choice of modules, if anything.
 *
 * One rule: the doctor's console works a chamber's queue, so it cannot be on
 * where serials are off. Everything else is independent.
 */
export function modulesProblems(off: readonly HospitalModule[]): readonly ModulesProblem[] {
  return off.includes('queue') && !off.includes('doctor') ? ['doctor_needs_queue'] : [];
}

/** Whether a module is on, given what is off. */
export function moduleOn(off: readonly string[], module: HospitalModule): boolean {
  return !off.includes(module);
}

/** `PUT /platform/hospitals/:id/modules`: the modules that are off. */
export const modulesBody = z.strictObject({
  off: z
    .array(z.enum(HOSPITAL_MODULES))
    .max(HOSPITAL_MODULES.length)
    .refine((list) => new Set(list).size === list.length, 'each module once'),
});
export type ModulesBody = z.infer<typeof modulesBody>;

// ---------------------------------------------------------------------------
// Which module a staff request belongs to
// ---------------------------------------------------------------------------

/**
 * Every route a member of staff calls that belongs to a module, by method and
 * path as the API mounts it. A route not here is nobody's module: signing in,
 * settings, a patient's or the public's.
 *
 * In one table, and not on each route, for the reason the tenant matrix is
 * one file: `moduleRoutes.test.ts` holds this against the routes the server
 * really mounts, so a staff route added later has to be placed.
 *
 * A route may need two: a doctor orders a test, which needs a doctor's
 * console and a lab.
 */
export const MODULE_ROUTES: Readonly<Record<string, readonly HospitalModule[]>> = {
  // --- serials and reception ---------------------------------------------------
  'GET /sessions/:id/queue': ['queue'],
  'POST /sessions/:id/arrived': ['queue'],
  'POST /sessions/:id/delay': ['queue'],
  'POST /sessions/:id/pause': ['queue'],
  'POST /sessions/:id/resume': ['queue'],
  'POST /sessions/:id/end': ['queue'],
  'POST /sessions/:id/next': ['queue'],
  'POST /sessions/:id/walkin': ['queue'],
  'POST /sessions/:id/reorder': ['queue'],
  'GET /sessions/:id/standby': ['queue'],
  'POST /bookings/:id/done': ['queue'],
  'POST /bookings/:id/no-show': ['queue'],
  'POST /bookings/:id/reinstate': ['queue'],
  'POST /bookings/:id/check-in': ['queue'],
  'POST /bookings/:id/offer-slot': ['queue'],
  'POST /offers/:id/accept': ['queue'],
  'POST /sync/events': ['queue'],
  'GET /sync/session/:id': ['queue'],
  // Shared with the patient whose booking it is. Only a member of staff is
  // asked about modules, so for a patient these are nobody's.
  'GET /bookings/:id': ['queue'],
  'GET /bookings/:id/payments': ['queue'],
  'POST /bookings/:id/late': ['queue'],
  'POST /bookings/:id/cancel': ['queue'],
  'POST /events/:id/undo': ['queue'],
  'GET /registration/patients': ['queue'],
  'POST /registration/patients': ['queue'],

  // --- the doctor's console ------------------------------------------------------
  'POST /visits': ['doctor'],
  // A patient reads their own record here; for staff it is the doctor's panel.
  'GET /patients/:id/records': ['doctor'],
  'POST /consents/qr': ['doctor'],
  'GET /lab/catalogue': ['doctor', 'lab'],
  'POST /test-orders': ['doctor', 'lab'],

  // --- beds -------------------------------------------------------------------------
  'GET /hospitals/:id/beds': ['beds'],
  'GET /hospitals/:id/bed-requests': ['beds'],
  'GET /beds/:id': ['beds'],
  'POST /beds/:id/admit': ['beds'],
  'POST /beds/:id/discharge': ['beds'],
  'POST /beds/:id/transfer': ['beds'],
  'POST /beds/:id/reserve': ['beds'],
  'POST /beds/:id/release': ['beds'],
  'POST /beds/:id/clean-start': ['beds'],
  'POST /beds/:id/clean-done': ['beds'],
  'POST /beds/:id/oos': ['beds'],
  'POST /beds/:id/restore': ['beds'],
  'POST /beds/:id/expected-discharge': ['beds'],
  'POST /bed-requests/:id/respond': ['beds'],
  'POST /hospital/wards': ['beds'],
  'POST /hospital/beds': ['beds'],
  'PATCH /hospital/beds/:id': ['beds'],

  // --- emergency ----------------------------------------------------------------------
  'GET /hospitals/:id/emergency': ['emergency'],
  'PUT /hospitals/:id/capabilities': ['emergency'],
  'POST /emergency/cases': ['emergency'],
  'GET /emergency/cases/:id/contact': ['emergency'],
  'POST /emergency/cases/:id/acknowledge': ['emergency'],
  'PATCH /emergency/cases/:id': ['emergency'],
  'POST /referrals': ['emergency'],
  'POST /referrals/:id/seen': ['emergency'],
  'POST /referrals/:id/accept': ['emergency'],
  'POST /referrals/:id/decline': ['emergency'],
  'POST /referrals/:id/cancel': ['emergency'],
  'POST /referrals/:id/arrive': ['emergency'],
  'PUT /hospital/capabilities': ['emergency'],

  // --- the lab and the pharmacy ----------------------------------------------------------
  'GET /hospitals/:hospitalId/test-orders': ['lab'],
  'PATCH /test-orders/:id/state': ['lab'],
  'POST /test-orders/:id/report': ['lab'],
  'GET /test-orders/:id/patient': ['lab'],
  'GET /hospitals/:hospitalId/pharmacy-stock': ['pharmacy'],
  'PUT /hospitals/:hospitalId/pharmacy-stock': ['pharmacy'],

  // --- the administrator's figures ---------------------------------------------------------
  'GET /admin/dashboard': ['dashboard'],
  'GET /admin/export': ['dashboard'],
  'GET /hospitals/:hospitalId/settlement': ['dashboard'],
  'POST /payments/:id/refund': ['dashboard'],

  // --- import ---------------------------------------------------------------------------------
  'GET /hospital/imports/templates/:set': ['import'],
  'GET /hospital/imports': ['import'],
  'GET /hospital/imports/:id': ['import'],
  'POST /hospital/imports': ['import'],
  'POST /hospital/imports/analyse': ['import'],
  'POST /hospital/imports/mapped': ['import'],
  'POST /hospital/imports/:id/commit': ['import'],
  'POST /hospital/imports/:id/undo': ['import'],
  'POST /hospital/imports/:id/discard': ['import'],
};

interface Compiled {
  readonly method: string;
  readonly pattern: RegExp;
  readonly modules: readonly HospitalModule[];
}

const COMPILED: readonly Compiled[] = Object.entries(MODULE_ROUTES).map(([key, modules]) => {
  const space = key.indexOf(' ');
  const path = key
    .slice(space + 1)
    .split('/')
    .map((part) => (part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return { method: key.slice(0, space), pattern: new RegExp(`^${path}/?$`), modules };
});

/**
 * The modules a request needs, by its method and its path under the API's
 * base; empty when it is nobody's module.
 *
 * A literal segment wins over a parameter (`/hospital/imports/analyse` is not
 * an import called "analyse"): the table has both, and the one with fewer
 * parameters is asked first.
 */
export function modulesOfRequest(method: string, path: string): readonly HospitalModule[] {
  const wanted = method.toUpperCase();
  let best: Compiled | null = null;
  for (const entry of COMPILED) {
    if (entry.method !== wanted || !entry.pattern.test(path)) continue;
    if (
      best === null ||
      entry.pattern.source.split('[^/]+').length < best.pattern.source.split('[^/]+').length
    ) {
      best = entry;
    }
  }
  return best?.modules ?? [];
}
