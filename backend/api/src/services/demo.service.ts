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

import type { NationalRole, StaffRole } from '@platform/domain';

import { signToken } from '../config/jwt.js';
import { env } from '../env.js';
import { AppError, notFound } from '../errors/AppError.js';
import * as demoRepo from '../repositories/demo.repo.js';

import * as modules from './modules.service.js';

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

/** `GET /demo/status`: whether the password-less picker is on here. */
export function status(): { readonly demoMode: boolean } {
  return { demoMode: env.DEMO_MODE };
}

export interface DemoConsole {
  readonly hospitalId: string;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly district: string;
  /** Only the roles this version has a console for. */
  readonly roles: readonly string[];
  /** The modules this hospital does not run (`FR-BRD-11`): the picker offers none of them. */
  readonly modulesOff: readonly string[];
  readonly sessions: readonly demoRepo.DemoSessionRow[];
}

/** `GET /demo/consoles` — what `S-B-01` lists. */
export async function listConsoles(): Promise<readonly DemoConsole[]> {
  assertDemoMode();

  const rows = await demoRepo.listConsoles();

  return await Promise.all(
    rows.map(async (row) => ({
      hospitalId: row.hospitalId,
      nameBn: row.nameBn,
      nameEn: row.nameEn,
      district: row.district,
      // Filtered to what exists, and ordered by `OFFERED` rather than by name:
      // a clinic with no ward staff offers no ward board (`data/people.ts`).
      roles: OFFERED.filter((role) => row.roles.includes(role)),
      modulesOff: await modules.modulesOff(row.hospitalId),
      sessions: row.sessions,
    })),
  );
}

export interface DemoPrincipal {
  readonly token: string;
  readonly staffName: string;
  /** Null for a national account, which works for no facility (0024). */
  readonly hospitalId: string | null;
  readonly role: string;
}

/**
 * National roles the demo console offers: the government viewer (`S-B-13`,
 * step 20) and the platform administrator (`S-B-12`, V3.2).
 *
 * The platform administrator was left out while it had no screen — a door to
 * nothing is the dead button the picker exists to avoid. It has one now:
 * hospital onboarding (`FR-ONB-*`).
 */
const OFFERED_NATIONAL: readonly NationalRole[] = ['gov_viewer', 'platform_admin'];

/**
 * `GET /demo/consoles`' national half: the national roles there is a seeded
 * account for. Empty on a database seeded before step 20, which the picker
 * reads as "nothing to offer" rather than as an error.
 */
export async function listNationalConsoles(): Promise<readonly NationalRole[]> {
  assertDemoMode();

  const present = await demoRepo.nationalRoles();
  return OFFERED_NATIONAL.filter((role) => present.includes(role));
}

/**
 * `POST /demo/token` for a national role — a token with no hospital.
 *
 * The same signed access token as a hospital console's, less the one claim a
 * national account cannot have. `toPrincipal` reads a hospital-less token as a
 * national principal only when every role on it is national, so this cannot be
 * used to mint a receptionist who belongs nowhere.
 */
export async function mintNationalPrincipal(input: {
  readonly role: NationalRole;
}): Promise<DemoPrincipal> {
  assertDemoMode();

  if (!OFFERED_NATIONAL.includes(input.role)) {
    throw new AppError('AUTH_FORBIDDEN_SCOPE', {
      message: 'That console is not built in this version.',
      details: { reason: 'role_not_offered', role: input.role },
    });
  }

  const staff = await demoRepo.nationalStaffFor(input.role);
  if (staff === null) throw notFound('staff account');

  return {
    token: await signToken({
      kind: 'access',
      claims: { sub: staff.id, kind: 'staff', roles: [input.role] },
      expiresIn: DEMO_TOKEN_TTL,
    }),
    staffName: staff.fullName,
    hospitalId: null,
    role: input.role,
  };
}

/**
 * How long a demo principal lasts.
 *
 * Longer than an access token's fifteen minutes on purpose. A real login
 * (`S-B-00`, deferred to Supabase Auth, CLAUDE.md §4.1) would refresh its
 * token; the picker has no refresh, so a console opened before a meeting
 * stopped answering fifteen minutes later — mid-demo, on whichever tab was used
 * last. Twelve hours covers a day of meetings. `assertDemoMode` keeps this to
 * `DEMO_MODE`, which production refuses to boot with.
 */
export const DEMO_TOKEN_TTL = '12h';

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
      expiresIn: DEMO_TOKEN_TTL,
    }),
    staffName: staff.fullName,
    hospitalId: input.hospitalId,
    role: input.role,
  };
}
