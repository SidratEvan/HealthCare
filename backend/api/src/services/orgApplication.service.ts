/**
 * A hospital applies by itself (`PRD.md` `FR-ONB-09`, `FR-ONB-10`; plan D1).
 *
 * `POST /hospital-applications` is public: no account exists yet, which is
 * the point of it. What it makes is a workspace that is **setting up** and
 * its first administrator, and nothing else. The hospital is not live and
 * cannot be made live by anything sent here; it appears in no list, its code
 * opens nothing, and it goes live only when its administrator asks for
 * review and a person at the platform approves (`FR-ONB-04`).
 *
 * ## Whose work this is
 *
 * The request is nobody's: it carries no principal, and a connection that is
 * nobody's reaches no hospital and no staff account (`DATABASE.md` §5.2). So
 * the two rows are written as the server's own work, stated here and nowhere
 * else, the way the schedule job states it. Nothing the caller sent chooses
 * a scope.
 *
 * ## What keeps it from being a way to fill the database
 *
 * The route is limited by address. Beyond that, the number of applications
 * nobody has acted on yet is capped for the whole deployment
 * (`ORG_APPLICATIONS_OPEN_MAX`): at the cap the form is refused until the
 * platform has looked at what is waiting. What relieves it is the hospital
 * asking for review, or the platform closing a workspace that should not go
 * on, which it may do from `setup` (`FR-ONB-10`, `shared/domain`
 * `org/lifecycle`). An application sent twice with one key is answered with
 * the workspace the first made.
 *
 * The password is never logged, returned or stored except as its hash.
 */

import { codeFor, codeStem, type ApplicationBody } from '@platform/domain';

import { runInDbScope } from '../config/dbScope.js';
import { hashPassword, passwordProblem } from '../config/password.js';
import { env } from '../env.js';
import { AppError } from '../errors/AppError.js';
import * as settingsRepo from '../repositories/hospitalSettings.repo.js';
import * as repo from '../repositories/orgApplication.repo.js';
import * as staffAuthRepo from '../repositories/staffAuth.repo.js';
import { withTransaction } from '../repositories/transaction.js';

export interface ApplicationAnswer {
  /** The code the workspace was given; its administrator signs in under it. */
  readonly code: string;
  readonly adminEmail: string;
}

/** How many times a code is chosen again when two applications took the same one at once. */
const CODE_ATTEMPTS = 4;

function constraintOf(thrown: unknown): string | null {
  if (typeof thrown !== 'object' || thrown === null) return null;
  const error = thrown as { code?: unknown; constraint?: unknown };
  return error.code === '23505' && typeof error.constraint === 'string' ? error.constraint : null;
}

export async function apply(input: {
  readonly body: ApplicationBody;
  readonly key: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
}): Promise<ApplicationAnswer> {
  const { body, key } = input;

  // The server's own rule, which counts characters as a person does.
  const problem = passwordProblem(body.password);
  if (problem !== null) throw new AppError('AUTH_PASSWORD_WEAK', { details: { reason: problem } });

  return await runInDbScope({ kind: 'system' }, async () => {
    // The same form again: the workspace the first one made, and no second.
    const before = await repo.findByKey(key);
    if (before !== null) return { code: before.code, adminEmail: before.adminEmail };

    if ((await repo.openApplications()) >= env.ORG_APPLICATIONS_OPEN_MAX) {
      throw new AppError('RATE_LIMITED', { details: { reason: 'applications_paused' } });
    }

    const passwordHash = await hashPassword(body.password);

    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      const code = codeFor(body.nameEn, await repo.codesFrom(codeStem(body.nameEn)));
      if (code === null) {
        throw new AppError('SETTINGS_DUPLICATE', { details: { field: 'nameEn' } });
      }

      try {
        await withTransaction(async (trx) => {
          const hospitalId = await repo.createWorkspace(trx, {
            code,
            key,
            nameBn: body.nameBn,
            nameEn: body.nameEn,
            kind: body.kind,
            division: body.division,
            district: body.district,
            phone: body.phone,
            registrationNo: body.registrationNo,
          });
          const staffId = await repo.createApplicant(trx, {
            hospitalId,
            email: body.adminEmail,
            fullName: body.adminName,
            phone: body.adminMobile,
            passwordHash,
          });
          await staffAuthRepo.grantRole(trx, { staffId, hospitalId, role: 'hospital_admin' });
          // Who applied, when and from where (`FR-ONB-07`). The actor is the
          // account the application made: there is nobody else to name.
          await settingsRepo.recordChange(trx, {
            actorStaffId: staffId,
            hospitalId,
            subjectTable: 'hospitals',
            subjectId: hospitalId,
            change: 'workspace_applied',
            ip: input.ip,
            userAgent: input.userAgent,
          });
        });
        return { code, adminEmail: body.adminEmail };
      } catch (thrown: unknown) {
        const constraint = constraintOf(thrown);
        // The same form, sent twice at once: the other one made it.
        if (constraint === 'hospitals_application_key_key') {
          const made = await repo.findByKey(key);
          if (made !== null) return { code: made.code, adminEmail: made.adminEmail };
        }
        // Another application took this code between the look and the write.
        if (constraint === 'hospitals_code_key') continue;
        throw thrown;
      }
    }

    throw new AppError('WRITE_CONFLICT');
  });
}
