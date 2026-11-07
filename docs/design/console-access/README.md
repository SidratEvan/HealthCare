# Staff access and workspace landing — Phase 8B Batch 2

Branch `feat/console-redesign-access`, based on the approved foundation commit `8d81ce8f3dcaf62d5af8f09f5b3e6aeb057cf032`. Local review only; no push, merge or deployment.

## Completed workflows

Sign-in, password change, MFA code entry, MFA setup and recovery-code acknowledgement use the Batch 1 scoped theme, bilingual actions, labelled fields and contextual Help. MedLiveBD identity appears before hospital identification. Sign-in supports show/hide password, shared-computer guidance, offline/loading/failure states, generic credential errors, real lockout responses and the existing hospital-code prompt. Passwords remain transient form state; the existing per-tab session/refresh storage and backend authentication are preserved.

Staff entry reads the existing `/staff/me` endpoint before deciding role/hospital scope. A hospital's existing `/staff/chambers` response supplies both its scoped chambers and disabled modules; `/hospital/desks` supplies actual receptionist assignments. National accounts skip the hospital-only roster endpoint. Password-change and mandatory MFA gates remain ahead of all private workspaces, including when browser metadata is altered.

A new sign-in with one enabled unambiguous facility workspace goes there directly. Multiple roles require a role choice. A receptionist's single assigned desk is selected automatically; several desks require a choice. If the desk covers several chambers, the employee chooses the chamber because V1 Reception is still a single-chamber console. A single eligible chamber can open directly. Doctors always choose a chamber explicitly; no account-to-doctor mapping is inferred from a name, email or hospital.

Selections and direct URLs are checked against fresh server metadata. Reopening a work list does not blindly reopen remembered work. Manual selections are rechecked before routing. Existing role, module, hospital and desk rules remain authoritative on the API. Scoped explicit queue URLs absent from today's work list are checked through the existing protected read endpoint, preserving permitted ended/historical reads; patient values are not used as landing metadata. Healthy token refresh/focus revalidation keeps the same workspace subtree mounted so it does not erase an unsaved doctor note.

Optional MFA setup, its enabled/low-recovery state, sign-out, the existing public hospital-application link and workspace switching remain available. Intentional sign-out is distinct from expired/revoked access. Offline sign-in/new selections remain blocked; an already-open matching workspace retains V1 offline continuation and server replay checks.

## Differences from the standalone prototype

- One desk does not imply one chamber. No multi-doctor Reception redesign or new desk route is introduced here.
- A receptionist with no desk assignment retains V1's hospital-wide common workspace; this is not automatically a permission denial. A desk-bound receptionist with no eligible chambers gets a truthful empty state.
- Doctors are not automatically identified or restricted to a mapped clinician record. The current backend's hospital-grain clinical permissions remain an explicit Phase 8A limitation.
- Ended chambers are not offered as new work by the existing roster API. Permitted explicit queue reads remain available through the current server guard.
- The hospital code is asked only on the real authenticated backend response. No unauthenticated hospital-membership list is shown.
- QR codes, temporary-password rules, TOTP/recovery validation and lockout come from V1. No prototype password/code behavior, review controls, chatbot or new recovery method is copied.

## Files

New production code/assets:

- `frontend/console/src/components/StaffAccessFrame.tsx`
- `frontend/console/src/components/StaffEntry.tsx`
- `frontend/console/public/brand/medlivebd-logo-light.png` (existing approved asset reused)
- `shared/client/src/workspaces.ts`
- `shared/ui/src/console/access.css`

Modified production code:

- `frontend/console/src/app/page.tsx`
- `frontend/console/src/components/StaffLogin.tsx`
- `frontend/console/src/components/ChangePassword.tsx`
- `frontend/console/src/components/TwoFactorCode.tsx`
- `frontend/console/src/components/TwoFactorSetup.tsx`
- `frontend/console/src/components/ConsoleWorkspaceFrame.tsx` (adapter comment updated for its landing use)
- `frontend/console/src/lib/staffAuth.ts`
- `frontend/console/src/lib/demo.ts`
- `shared/client/src/index.ts`
- `shared/i18n/src/messages.ts`
- `shared/ui/package.json` (CSS export only; no dependency added)

Tests:

- `shared/client/src/__tests__/workspaces.test.ts`
- `e2e/console-access.spec.ts`
- `e2e/support/staff.ts`
- `e2e/support/accessScreenshots.ts`
- `e2e/staff-login.spec.ts` (masked integrated password-change screenshot)
- `e2e/staff-2fa.spec.ts` (intentional direct-landing expectations updated; MFA/refusal/recovery assertions retained)

Documentation: this file, `docs/STATUS.md`, and the access-flow note in `docs/APP_FLOW.md`.

## Review and verification

Screenshots in this directory are generated from the actual integrated React application and local synthetic test accounts, not from the prototype. Password fields, the public demo-password hint, QR/secret and code regions are masked where applicable. Desktop 1440×900, tablet landscape 1024×768 and portrait 768×1024 are reviewed in Bangla and English.

| Size | Sign-in screenshots | Role-selection screenshots |
|---|---|---|
| Desktop | [Bangla](signin-desktop-bn.png), [English](signin-desktop-en.png) | [Bangla](roles-desktop-bn.png), [English](roles-desktop-en.png) |
| Tablet landscape | [Bangla](signin-landscape-bn.png), [English](signin-landscape-en.png) | [Bangla](roles-landscape-bn.png), [English](roles-landscape-en.png) |
| Tablet portrait | [Bangla](signin-portrait-bn.png), [English](signin-portrait-en.png) | [Bangla](roles-portrait-bn.png), [English](roles-portrait-en.png) |

Additional integrated security screens: [temporary-password change](password-change-bn.png), [MFA setup](mfa-setup-bn.png), [MFA code entry](mfa-code-bn.png). These fifteen PNGs are the screenshot files added by this batch.

Exact final commands/results are recorded in `docs/STATUS.md`. The new browser cases cover direct/multiple-role landing, assigned/common/empty desks, assignment and role changes, forged URL/storage labels, mandatory MFA, hospital-code isolation, national boundaries, generic errors/lockout, offline/server failure, keyboard/accessibility and draft-preserving refresh. Existing authentication API tests, staff sign-in/MFA browser tests and the queue canary remain part of the gate.

The harness uses only local synthetic databases and mock/log providers. Full release/API/schema/browser/production suites and the hospital dry run are reported separately when not run. Phase 8A's socket-authentication parity and clinical/lab/pharmacy/import findings are not fixed in this frontend batch. Frontend landing is not a replacement for server authorisation, and this work does not certify a real hospital launch.

## Stop boundary and rollback

Batch 2 stops for founder review. Reception, patient Registration, Doctor consultation, Administration and other module redesigns have not started. No database schema, API, hospital permission policy or authentication method is changed.

Rollback restores the previous access presentation/entry logic while retaining Batch 1; it needs no database/data/outbox rollback. A later clinician-specific login mapping requires a separately approved data-model/policy change.
