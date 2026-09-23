/**
 * How the demo console gets a principal (CLAUDE.md §4.1).
 *
 * Authentication is deferred to Supabase Auth, and `S-B-00` Staff login is
 * therefore not built. What replaces it for the pitch version is stated in the
 * operating instructions rather than invented here:
 *
 *   "Under `DEMO_MODE=true`, the console picks a hospital and a role without a
 *   password. That is the correct implementation for a pitch version, not a
 *   shortcut to apologise for."
 *
 * So this mints the same signed staff token `auth.service` will mint later,
 * with the same claims, verified by the same middleware. The only thing absent
 * is the password check — and when Supabase Auth arrives, this file is deleted
 * rather than rewritten.
 *
 * ## The two things that keep it from being a back door
 *
 * It refuses to run unless `DEMO_MODE` is on, and `env.ts` already refuses to
 * boot at all with `DEMO_MODE=true` and `NODE_ENV=production`. A deployment
 * serving real patients therefore cannot reach this code even by mistake, and
 * the check is in two places because one of them would eventually be moved.
 *
 * The subject is always a **real** seeded staff account. That is not a detail:
 * `queue_events.actor_staff_id` is a foreign key, so a token for an invented
 * id produces a console whose every action the database refuses. `FR-QUE-04`
 * makes an unattributable queue action impossible to record, and that rule
 * holds in the demo too.
 */

import type { StaffRole } from '@platform/domain';

import { signToken } from '../config/jwt.js';
import { env } from '../env.js';
import { AppError, notFound } from '../errors/AppError.js';
import * as demoRepo from '../repositories/demo.repo.js';

/**
 * Roles the demo console offers, in the order they are shown.
 *
 * Reception first, and not alphabetically: it is the console the pitch is
 * about and the primary action on every chamber card. The ward follows the
 * two chamber roles because it is the one console that opens on a hospital
 * rather than a chamber (`S-B-06`, build step 14). The ER console opens on a
 * hospital too (`S-B-07`, build step 15), and follows the ward; the lab and the
 * pharmacy (`S-B-08`, `S-B-09`, step 17) and the dashboard (`S-B-10`, step 19)
 * follow it.
 *
 * `lab` and `pharmacy` were missing from this list from step 17 until step 19,
 * so the picker never offered either console and `POST /demo/token` refused
 * both. `lab-report.spec.ts` writes its session straight into storage and so
 * never used the picker — the same blind spot that hid the ER role at step 15.
 */
const OFFERED: readonly StaffRole[] = [
  'receptionist',
  'doctor',
  'ward',
  'emergency',
  'lab',
  'pharmacy',
  'hospital_admin',
];

/** Refuses unless this deployment is a demo. */
function assertDemoMode(): void {
  if (!env.DEMO_MODE) {
    // Not `NOT_FOUND`: a caller finding this route on a real deployment should
    // learn that it exists and is switched off, not go looking for a variant
    // of the path that might not be.
    throw new AppError('AUTH_FORBIDDEN_SCOPE', {
      message: 'Demo sign-in is only available on a demonstration deployment.',
      details: { reason: 'demo_mode_off' },
    });
  }
}

export interface DemoConsole {
  readonly hospitalId: string;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly district: string;
  /** Only the roles this version has a console for. */
  readonly roles: readonly string[];
  readonly sessions: readonly demoRepo.DemoSessionRow[];
}

/** `GET /demo/consoles` — what `S-B-01` lists. */
export async function listConsoles(): Promise<readonly DemoConsole[]> {
  assertDemoMode();

  const rows = await demoRepo.listConsoles();

  return rows.map((row) => ({
    hospitalId: row.hospitalId,
    nameBn: row.nameBn,
    nameEn: row.nameEn,
    district: row.district,
    // Filtered to what exists, and ordered by `OFFERED` rather than by name:
    // a clinic with no ward staff offers no ward board (`data/people.ts`).
    roles: OFFERED.filter((role) => row.roles.includes(role)),
    sessions: row.sessions,
  }));
}

export interface DemoPrincipal {
  readonly token: string;
  readonly staffName: string;
  readonly hospitalId: string;
  readonly role: string;
}

/** `POST /demo/token` — the console's stand-in for `S-B-00`. */
export async function mintPrincipal(input: {
  readonly hospitalId: string;
  readonly role: string;
}): Promise<DemoPrincipal> {
  assertDemoMode();

  if (!(OFFERED as readonly string[]).includes(input.role)) {
    throw new AppError('AUTH_FORBIDDEN_SCOPE', {
      message: 'That console is not built in this version.',
      details: { reason: 'role_not_offered', role: input.role },
    });
  }

  const staff = await demoRepo.staffFor(input.hospitalId, input.role);
  if (staff === null) throw notFound('staff account');

  return {
    token: await signToken({
      kind: 'access',
      claims: {
        sub: staff.id,
        kind: 'staff',
        hospitalId: input.hospitalId,
        roles: [input.role],
      },
    }),
    staffName: staff.fullName,
    hospitalId: input.hospitalId,
    role: input.role,
  };
}
