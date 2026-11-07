# Reception Console — Phase 8B Batch 3A

Branch `feat/console-redesign-reception`, based on the founder-approved Batch 2 integration `4e1da6814a8da23e29d1067a17b75ed1903494df`. Local review only. Stop before Registration Batch 3B or Doctor redesign; no push, merge or deployment.

## What the receptionist can do

After the existing password/MFA steps, a receptionist opens their authorised desk as one workspace. One desk opens directly; several assigned desks require a choice. No-desk staff retain V1's permitted common hospital workspace. Current server identity, role, hospital, modules and desk assignments remain authoritative. Doctors still explicitly choose chambers in their unchanged consultation flow.

Each permitted chamber has its own expandable card, doctor/department/room identity, actual status, current patient/serial, waiting/arrived counts and timestamp. Completed/cancelled chambers are identified and do not permit new work. Unknown snapshots are loading/unavailable, not fabricated zero counts. Names use the existing protected roster read. Collapsing changes visibility only: queue controllers, pending actions, undo ownership and open forms stay bound to the same session.

The primary action follows the queue: record doctor arrival, resume a pause, call next/finish-and-next, or finish the last patient. Check-in with the quoted wait, mark done, late, late/no-show reinsertion, no-show, pause/resume, actual undo, standby and guarded chamber-end confirmation remain available. Secondary actions use visible **More** menus. A changed quote suggestion no longer overwrites the counter's chosen quote while the form is open.

Add Patient inside a card opens V1's working walk-in flow with that exact chamber and doctor label. Phone/household selection and patient creation are retained; no serial is predicted. The new atomic server operation supplies the actual booking receipt and the form reuses its attempt key after an uncertain answer. Full Registration remains its existing screen.

One workspace dispatcher owns keyboard shortcuts. Only a selected expanded queue can receive N/Space, A, P, W or queue Ctrl+Z. Editors, composing input, repeated keys, dialogs/Help and native button Space activation are protected. No active queue gives visible guidance. Queue state/revision checks, optimistic rollback, server acknowledgement, reconnect reconciliation and IndexedDB actor isolation continue through V1's domain/client implementation.

Each chamber sends/retries its own session's work in this mounted multi-queue workspace. It does not flush/retry another card's actions. Existing single-chamber links preserve V1's recovery of other pending sessions. Metadata cached for a previously opened offline desk contains doctor/chamber identity only, not patient names or notes; online permissions are revalidated. Offline counts retain their actual source timestamp and pending indicators. One socket/controller per listed chamber is bounded by the tested 15-doctor scope; this does not claim an untested large-hospital performance limit.

Bilingual contextual Help covers adding/checking in, next, corrections, pause/resume and unsent work. It preserves the active form. Existing role switching, optional MFA and sign-out remain reachable from Change console.

## Prototype comparison and V1 limits

- Approved card composition, prominent current patient, clear primary/secondary actions, semantic statuses, hospital theme and desktop/tablet layouts are integrated into React. The existing hospital branding determines colours and identity; prototype names/counts/data/review controls are not copied.
- The standalone prototype's simulated undo is replaced by the existing ten-second, server-checked undo. Some actions or intervening changes cannot be undone.
- Waiting/arrival/status values come from actual queue entries; all counters distinguish unreceived snapshots from zero. Aggregate counts are only shown once all listed snapshots are known and remain qualified by each card's freshness/unsent information.
- Add Patient preserves the existing counter form rather than reproducing the prototype's full Registration redesign. Its dialog now opts into the shared console theme and bounded tablet scrolling. Household ambiguity/identity safeguards and broader form/receipt/return-flow redesign belong to Batch 3B.
- Finished chambers are available through the opt-in existing roster read. The normal Doctor/work picker still omits them. Permitted legacy chamber URLs remain compatible; unavailable historical identity is displayed neutrally rather than borrowing another chamber's cached doctor name.
- No new doctor-account mapping, patient age/sex/history read, delay workflow, priority-reorder UI, printed token, or doctor-not-sitting workflow is invented. Existing API capabilities beyond the released Reception controls are not presented as completed UI.

## Review screenshots

All PNGs here are screenshots of the actual React application with synthetic accounts and canonical seeded doctors/patients. The tests create local fixture sessions and actual desk memberships; they do not load the standalone prototype's state machine.

| Doctors | Desktop | Tablet landscape | Tablet portrait | Expanded queue |
|---|---|---|---|---|
| 2 | [Bangla](2-doctors-desktop-bn.png), [English](2-doctors-desktop-en.png) | [Bangla](2-doctors-landscape-bn.png), [English](2-doctors-landscape-en.png) | [Bangla](2-doctors-portrait-bn.png), [English](2-doctors-portrait-en.png) | [View](2-doctors-expanded.png) |
| 6 | [Bangla](6-doctors-desktop-bn.png), [English](6-doctors-desktop-en.png) | [Bangla](6-doctors-landscape-bn.png), [English](6-doctors-landscape-en.png) | [Bangla](6-doctors-portrait-bn.png), [English](6-doctors-portrait-en.png) | [View](6-doctors-expanded.png) |
| 15 | [Bangla](15-doctors-desktop-bn.png), [English](15-doctors-desktop-en.png) | [Bangla](15-doctors-landscape-bn.png), [English](15-doctors-landscape-en.png) | [Bangla](15-doctors-portrait-bn.png), [English](15-doctors-portrait-en.png) | [View](15-doctors-expanded.png) |

Additional states: [offline work across two chambers](two-chambers-offline.png), [Help retaining walk-in context](walk-in-help-keeps-context.png), [finished chamber](finished-chamber.png). Desktop is 1440×900; tablets are 1024×768 and 768×1024.

## Changed files

Essential backend corrections, isolated in local commit `9390e24`, and their explicit rationale:

- `backend/api/src/realtime/auth.ts`
- `backend/api/src/realtime/handlers.ts`
- `backend/api/src/realtime/rooms.ts`
- `backend/api/src/controllers/queue.controller.ts`
- `backend/api/src/controllers/staffAuth.controller.ts`
- `backend/api/src/services/queue.service.ts`
- `backend/api/src/services/staffAuth.service.ts`
- `backend/api/src/services/hospitalSettings.service.ts`
- `backend/api/src/services/modules.service.ts`
- `backend/api/src/repositories/chamber.repo.ts`
- `backend/api/src/__tests__/realtime.test.ts`
- `backend/api/src/__tests__/receptionSafety.routes.test.ts`
- [SAFETY.md](SAFETY.md)

Reception integration and shared opt-in presentation:

- `frontend/console/src/components/ReceptionConsole.tsx`
- `frontend/console/src/components/ReceptionWorkspace.tsx` (new)
- `frontend/console/src/components/QueueTable.tsx`
- `frontend/console/src/components/CheckInSheet.tsx`
- `frontend/console/src/components/WalkInSheet.tsx`
- `frontend/console/src/components/OfflineBlock.tsx`
- `frontend/console/src/hooks/useSessionQueue.ts`
- `frontend/console/src/lib/registration.ts`
- `frontend/console/src/lib/demo.ts`
- `frontend/console/src/lib/staffAuth.ts`
- `frontend/console/src/components/StaffEntry.tsx`
- `frontend/console/src/components/ConsolePicker.tsx` (choice type only)
- `frontend/console/src/app/page.tsx`
- `shared/client/src/workspaces.ts`
- `shared/client/src/offline/queue.ts`
- `shared/client/src/__tests__/queue.test.ts`
- `shared/i18n/src/messages.ts`
- `shared/ui/src/console/reception.css` (new, scoped)
- `shared/ui/src/console/ConsoleFoundation.tsx` (portal brand accessor)
- `shared/ui/src/components/Sheet.tsx` (explicit console opt-in; default unchanged)
- `shared/ui/package.json` (CSS export only)

Browser coverage:

- `e2e/reception-workspace.spec.ts` (new)
- `e2e/support/reception.ts` (new)
- `e2e/support/console.ts` (optional synthetic fixture hospital/doctor selection)
- `e2e/chamber-end.spec.ts`
- `e2e/console-undo.spec.ts`
- `e2e/no-show-recovery.spec.ts` (open the row More menu before the existing no-show recovery assertions)
- `e2e/console-access.spec.ts`
- `e2e/staff-login.spec.ts`
- `e2e/staff-2fa.spec.ts`
- `e2e/production/reception-workspace.prod.spec.ts` (new: the same nine real-staff cases under production configuration)
- `e2e/production/two-device-queue.prod.spec.ts` (intentional direct desk landing expectation)

Existing assertions are retained; changes locate the approved More menus or assert the intentional direct desk workspace rather than the former chamber picker. Credentials, expiry, mandatory MFA, role/desk/hospital scope, undo and queue/database assertions are not removed or weakened. Previous Batch 2 screenshot artifacts are restored after regression capture, keeping its review package intact.

Documentation: this README, SAFETY.md, `docs/APP_FLOW.md`, `docs/BACKEND.md` and `docs/STATUS.md`. The twenty-four PNGs linked above are the new screenshot files.

## Verification and release boundary

Exact final commands, counts, initial failures and their resolution are recorded in `docs/STATUS.md`. Tests use localhost-only disposable schema/API or synthetic development databases and log/mock/static providers. This is a scoped implementation gate; unrun full-release suites are identified separately.

[Safety rationale and remaining critical dependencies](SAFETY.md) must be reviewed with these visuals. Doctor note loss/signing races, identity/clinician-policy decisions and other Phase 8A module findings remain unresolved. The Doctor, full Registration, Administration, Ward, Emergency, Laboratory, Pharmacy, Import, Platform and National workspace implementations are not redesigned here. This batch does not certify a real hospital pilot or provider/infrastructure readiness.

Rollback can revert the visual integration while retaining the isolated safety correction. It requires no database or outbox rollback. Do not revert to known walk-in/socket bypasses for real use. Stop after Batch 3A for founder review.
