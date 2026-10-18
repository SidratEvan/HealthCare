# Registration Desk — Phase 8B Batch 3B

Branch `feat/console-redesign-registration`, based on founder-approved Reception integration `5f6e4407f2998fe63f7431a3d34e2000699bbdac`. Batch 3A safety commit `9390e24` remains intact. Local founder review only; stop before Doctor implementation. No push, merge or deployment.

Isolated canonical receipt/audit commit: `67f49d0f903e2b6f52d4e386ce3b243a9cc5efd2`. The following UI integration commit contains this review and the final verification record; its hash is available in `git log` and the delivery message.

## What changed for the receptionist

The real React Registration Desk now follows **Mobile number → Patient → Doctor/Chamber → Serial confirmation**, with the approved hospital frame, four-step indicator, readable cards and persistent intended-registration summary. Valid V1 Bangladesh mobile formats, including Bangla digits and +880, search automatically. Find remains available for explicit search/retry. A changed number cancels the old result's ownership; a late response cannot select the previous phone's patient.

A household phone can belong to several people. Existing names, stored ages and sex are shown separately, with app-account labels retained. Selecting a person opens inline identity confirmation. An indistinguishable returned identity stops rather than guessing. Not listed opens the existing name/age/sex form for a legitimate different household member. Name, whole-year age 0–130 and sex validation is retained, with field-level feedback and a duplicate-name warning. No NID, patient age/sex requirement beyond V1, new identity proof, merge or demographic overwrite is introduced.

Patient creation is a separate operation from issuing a queue serial. The creation receipt now distinguishes a new profile from V1's reuse of an existing guest phone/name record, returning its actual stored identity. A record created concurrently or recovered after a lost answer is explicitly confirmed using that identity. The additive backend extension and audit gate are isolated and explained in [SAFETY.md](SAFETY.md).

Registration shows the selected desk's authorised chambers, with department, room, planned time, actual status/waiting count and qualified list-read freshness. No-desk staff retain V1's common hospital workspace. Ended/cancelled chambers are explained and disabled. A queue's Registration link opens `/?view=registration&from=<session-id>` with that exact authorised chamber preselected and a return route. Missing or revoked origin context never supplies a substitute doctor. The server still enforces every queue write's hospital/desk/module rules, including chamber closure during the form.

The summary names the confirmed patient and intended chamber/end-of-queue insertion. It promises no predicted serial. Only a valid actual walk-in issuance receipt opens the large serial, patient/doctor/chamber summary and instruction to tell the patient that number. Next patient clears a standalone doctor's selection; a queue-origin flow retains its chamber. Return opens the actual issued chamber's queue. A missing receipt remains uncertain instead of guessing from the latest queue maximum.

Repeated pending submissions are blocked. Uncertain profile/serial attempts keep their original body/key/target and expose a result-check action. Retrying reconciles with canonical profile or original queue issuance, even after another counter changed the queue. The form stays intact through a temporary outage or recoverable refusal; profile/serial writes remain online-only. Help changes with the current step, and Help/language changes preserve work. Reset/navigation asks before losing incomplete information, browser reload/close uses its native warning, and uncertain work is protected from a fresh operation. Reception's positioned/reasoned walk-in remains available, now sharing identity confirmation, retry locking and an unsaved-close guard.

## Comparison with the approved prototype

- The approved two-column phone/patient and doctor panels, four steps, hospital theme, summary bar, bilingual actions, tablet layouts and clear final number are integrated into the actual application. Prototype accounts, simulated queues/review controls and fake results are not copied.
- Exact pre-issued numbers and invented ahead counts are omitted. The server's actual issuance receipt determines the final number; chamber waiting counts come from the protected existing read and keep their read-time qualification.
- An existing person is explicitly confirmed inline, without an extra modal for routine phone/chamber steps. Same-name identity ambiguity is treated as a stop, rather than prototype-only duplicate reassurance.
- Standalone Registration inserts at the end. Existing positioned/reasoned insertion remains in the queue's walk-in sheet, as the prototype specifies. Neither flow adds billing, printing, payment or medical features.
- Authentication, password/MFA, role landing and Reception queue controllers are retained. Registration adopts the existing foundation and desk revalidation; it does not rebuild those workspaces.

## Actual application screenshots

Synthetic local accounts, patients, household records and actual desk memberships only. Tests use the existing canonical seeded doctor/session fixture; screenshots are not the standalone prototype.

| State | Desktop 1440×900 | Landscape 1024×768 | Portrait 768×1024 |
|---|---|---|---|
| Empty | [Bangla](empty-desktop-bn.png), [English](empty-desktop-en.png) | [Bangla](empty-landscape-bn.png), [English](empty-landscape-en.png) | [Bangla](empty-portrait-bn.png), [English](empty-portrait-en.png) |
| Patient/chamber summary | [Bangla](summary-desktop-bn.png), [English](summary-desktop-en.png) | [Bangla](summary-landscape-bn.png), [English](summary-landscape-en.png) | [Bangla](summary-portrait-bn.png), [English](summary-portrait-en.png) |
| Actual serial confirmation | [Bangla](confirmed-desktop-bn.png), [English](confirmed-desktop-en.png) | [Bangla](confirmed-landscape-bn.png), [English](confirmed-landscape-en.png) | [Bangla](confirmed-portrait-bn.png), [English](confirmed-portrait-en.png) |

Further states: household [Bangla](household-bn.png)/[English](household-en.png), [duplicate warning](duplicate-warning.png), [indistinguishable identity stop](ambiguous-identity-stop.png), [Help retaining the form](help-preserves-form.png), [leave guard](leave-guard.png), [offline form](offline-preserves-form.png), [original serial recovered after a lost reply](reconciled-original-serial.png), [chamber ended during registration](ended-during-registration.png).

## Exact changed-file inventory

Canonical receipt/audit extension (isolated from the UI commit):

- `backend/api/src/controllers/registration.controller.ts`
- `backend/api/src/services/registration.service.ts`
- `backend/api/src/repositories/registration.repo.ts`
- `backend/api/src/__tests__/registration.routes.test.ts`
- This directory's `SAFETY.md`.

Production Registration and opt-in presentation:

- `frontend/console/src/components/RegistrationConsole.tsx`
- `frontend/console/src/components/PatientFinder.tsx`
- `frontend/console/src/components/WalkInSheet.tsx`
- `frontend/console/src/components/ReceptionConsole.tsx` (Registration link only)
- `frontend/console/src/components/StaffEntry.tsx` (Registration desk/ended-read/revalidation parity; cache the already-authorised deep-link target without borrowing another doctor's label)
- `frontend/console/src/lib/registration.ts`
- `frontend/console/src/lib/staffAuth.ts` (optional archive read)
- `shared/ui/src/console/registration.css` (new, console-scoped)
- `shared/ui/package.json` (CSS export only)
- `shared/i18n/src/messages.ts`

Browser coverage:

- `e2e/registration-workspace.spec.ts` (new, real staff/identity/race/loss/layout scenarios)
- `e2e/production/registration-workspace.prod.spec.ts` (new, same scenarios in production configuration)
- `e2e/support/registration.ts` (new, synthetic local database evidence with closed connections)
- `e2e/counter-registration.spec.ts` (intentional inline identity confirmation, unsaved-close guard and explicit serial/next-patient screen interactions; existing workflow assertions retained)
- `e2e/console-access.spec.ts` (healthy refresh owns an isolated canonical queue, waits for actual revalidation, retains token-change/draft-preservation assertions and records a mount diagnostic; Doctor implementation unchanged)
- `e2e/built/console-offline-shell.spec.ts` (retain offline reload/replay assertions; production's never-authorised target expects the existing access gate, while demo retains its uncached-queue state)

Documentation: this README, SAFETY.md, `docs/APP_FLOW.md`, `docs/BACKEND.md`, `docs/STATUS.md`. The twenty-seven PNGs linked above are the new visual artifacts. Earlier access/Reception review artifacts are restored after regression captures. Approved standalone prototypes and pre-existing `.claude/`/`docs/reports/` material are not edited or staged.

## Verification and remaining constraints

Exact final commands/counts, initial failures/fixes and unrun suites are in [STATUS.md](../../STATUS.md). API/schema and browser harnesses use their separate localhost test/synthetic databases, with remote targets disallowed. Production configuration means built apps, compiled demo-disabled API, a limited database role and log/off/local/static providers; it is not provider or infrastructure certification.

V1 still lacks genuine same-name identity disambiguation and lookup pagination beyond twenty people. Guards retain a mounted form, not a durable patient draft after a forced reload/new browser session. A profile can legitimately remain without a serial after queue refusal. Registration has no printable token; separate billing/payment receipt and prescription workflows are unchanged. All these limits, and unchanged critical Doctor C1/C2, are in [SAFETY.md](SAFETY.md). Do not enable clinical signing on the strength of this Registration review.

No Doctor, patient-app, billing/payment, Administration, Ward, Emergency, Lab, Pharmacy, Import, Platform or National implementation is redesigned here. Existing dependent browser regressions verify their exercised flows; untested modules are not represented as certified. Roll back the visual integration independently, retaining the compatible receipt extension and Batch 3A safety fixes. Stop after Batch 3B for founder review.
