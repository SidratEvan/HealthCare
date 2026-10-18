# Doctor consultation safety — Phase 8B Batch 4A

10 October 2026. Local implementation on `fix/console-doctor-consultation-safety`, based on Batch 3B `ec9cbf217b46144fbd833d11e1a4da2bffa1086f` (including Registration safety `67f49d0f903e2b6f52d4e386ce3b243a9cc5efd2` and earlier batches). This is clinical correctness on the existing Doctor screen. Approved standalone Doctor prototypes are unchanged. Stop for founder review; no Batch 4B, push, protected-branch merge, deployment, remote migration or provider activation.

## Exact causes and corrections

**C1:** `DoctorConsole.tsx` compared `noteFor` to the queue's current `servingBookingId` during render and unconditionally called `setDraft(emptyDraft())` when reception changed patient. Its note identity, PatientPanel, consent component and submission body all followed that live serving booking. Same-patient socket rerenders were protected, but an external Next erased an unfinished consultation. A save response could also arrive after that reset.

The editor now owns an explicit session/booking/patient entry independently of the live queue. The canonical server booking supplies hospital/patient/doctor identity. External Next retains the original patient panel and every note/medicine/test selection, raises a changed-queue notice and blocks a fresh sign for that old encounter. The doctor can explicitly save the old unsigned draft, then open the current patient, or deliberately confirm discard. Signed refusal, revision conflict and save failure retain local writing. There is no automatic patient switch on external Next, even for an empty note; the original consultation remains explicit.

`GET /visits/booking/:id` reads drafts and signed state through the existing Doctor module/authentication, doctor role, own-hospital RLS/scope and RECORD_VIEW audit. Existing wallet/history still exclude drafts. Initial hydration completes before editing is enabled. Reconnection checks the existing revision without overwriting writing; cancelled reads and reads predating a newer write are ignored. Notes remain in React memory. No clinical draft is placed in browser storage or the queue outbox. Native leave/reload warns about unsaved or uncertain work.

**C2:** `clinical.service.saveVisit` checked booking status before its visit transaction and later called unqualified `queueService.callNext` after the visit committed. That operation acquired a different session lock and finished whoever was then serving. A deterministic test made reception call B in that gap; signing A marked B done. `lib/visits.saveVisit` also generated a new key for every call; the booking-status guard rejected a completed sign retry before it could return the known signature, and the generic queue replay was not rechecked after waiting for its lock. Concurrent baseline signing returned 201/409; a later retry returned 422.

The visit transaction now takes the existing session lock, re-reads booking status and compares the editor's expected draft revision. The opaque revision combines persisted visit identity/full timestamp and a digest of all clinical fields/medicines, so different content is detected even at an identical timestamp. Null/omitted revision cannot overwrite an unseen existing draft. A lost draft reply reconciles without another write only for an exact match of persisted content. Patient/session assertions must match the canonical booking. Signed visits and medicines remain immutable.

Signing's queue transaction takes `expectedBookingId`, compares it under the existing lock and uses one deterministic queue action identity from the persisted visit ID. It checks replay before state guards and again under the lock. Overlapping retries, a lost reply, a different key or another device cannot finalize the next patient. Reception's ordinary Next still behaves as before. A signature can return as confirmed even when the separate queue step changed or failed: `queueOutcome` explicitly distinguishes `advanced` (including replay), `changed`, and `retry_needed`. This is intentionally record-first recovery, not an atomic record-and-queue transaction.

The client holds one in-flight operation with a synchronous guard and freezes its original identity, body, follow-up date and key for uncertain signing. It never reports a signature until a backend write/read confirms it. Checking an uncertain sign can continue after the queue changes. `contentMatches: false` identifies an already-signed record with different content; the local note stays visible and unsaved for explicit review/discard. A complete confirmed sign reconciles through the existing sequence-aware queue hook and releases only its original editor. Delayed receipts cannot replace a newer queue snapshot. Test-order failure has its own booking/codes/key descriptor and retry action, retained even after opening another patient. Existing draft-time lab ordering and server-record prescription printing are retained.

## Files modified

- Backend: `backend/api/src/controllers/clinical.controller.ts`, `backend/api/src/routes/clinical.routes.ts`, `backend/api/src/services/clinical.service.ts`, `backend/api/src/repositories/clinical.repo.ts`, `backend/api/src/services/queue.service.ts`.
- Shared contracts: `shared/domain/src/schemas/clinical.schema.ts`, `shared/domain/src/modules/modules.ts`, `shared/i18n/src/messages.ts`.
- Console: `frontend/console/src/components/DoctorConsole.tsx`, `frontend/console/src/hooks/useSessionQueue.ts` (authoritative refresh only), `frontend/console/src/lib/visits.ts`.
- API tests under `backend/api/src/__tests__/`: new `doctorSafety.routes.test.ts`; existing `clinical.routes.test.ts` and `prescriptions.routes.test.ts` helpers now supply the read revision; `tenantMatrix.test.ts` includes the additive route. Existing assertions remain.
- Browser tests: new `e2e/doctor-safety.spec.ts` and production wrapper `e2e/production/doctor-safety.prod.spec.ts`.
- Documentation: this report, `docs/APP_FLOW.md`, `docs/BACKEND.md`, `docs/STATUS.md`.

No new dependencies, migrations, clinician-account linkage, patient identity model, consent policy, queue reducer, outbox format or visual redesign.

**Separate test-only correction:** the wider suite exposed an unchanged no-show fixture collision in `backend/api/src/__tests__/noshowPrepay.routes.test.ts`. Its `900 + index + random(90)` serials could duplicate another inserted row, violating `bookings_session_serial_key` before the booking API ran. It now allocates distinct high serials above that session's existing maximum. Product behavior and assertions are unchanged. This verification correction is committed separately from C1/C2.

## Regression coverage

Thirteen deterministic API cases and twelve browser cases use synthetic localhost fixtures. API/browser assertions read persisted visits, signatures, medicines, bookings, queue state or test orders, not just success banners.

| Requested case | Evidence |
|---|---|
| Typing during reception Next | Browser retains A; sign disabled; explicit old-booking save persists only A; switch opens an empty B editor. API independently saves old unsigned A without advancing B. |
| Typing during socket updates | Real session socket remains attached; a same-patient delay retains writing. |
| Stale/out-of-order events | Browser re-injects an actual older Socket.IO queue frame after Next; identity/note remain A. Existing shared session tests verify sequence/reconnect reconciliation. |
| Failed draft save | Controlled 503 preserves fields and writes no visit; retry persists the original booking. |
| Delayed draft reply | Actual backend save precedes a controlled response barrier; reception advances meanwhile; the reply cannot erase/reassign A. |
| Reconnection | Offline typed diagnosis/advice survive catch-up after reception Next. A controlled late reconnect read cannot replace a newer acknowledged save. Saved drafts hydrate after reload. |
| Signing while reception changes queue | Deterministic API interleavings test reception winning before clinical lock and between record commit/queue lock. Only the correct record signs; B is not finalized. Browser holds a real signing response while reception advances again; the editor opens the newest queue patient afterward. |
| Repeated Sign & Next | Simultaneous API calls return confirmed receipts and leave exactly B serving; browser double-click produces one request. |
| Lost successful signing response | Browser aborts only the answer after the backend commits; check-result reuses the original key. API retries after another advancement/new key replay one persisted visit action. |
| Two conflicting devices | Version-matched draft writers serialize with one winner; stale sign refuses without altering draft/queue. Different signatures retain one immutable record and return content mismatch for the other writer. Browser retains conflicting local writing and honors a cancelled discard/review. |
| Incorrect patient/encounter | Patient and session mismatches refuse before visit insertion/queue change; existing history booking/patient tests retained. |
| Unauthorized doctors/non-doctors | New draft read requires authentication/doctor role; existing clinical write matrix/service guard and revocation suites retained. |
| Cross-hospital isolation | Draft read refuses foreign booking; expanded exhaustive tenant matrix checks own/foreign/national/anonymous access. Existing clinical writes/consent/history and schema RLS tests retained. |
| Normal consultation/next | Existing Doctor tests retain save, sign, next-patient, prescription/formulary and server-record printing assertions. |
| Reception/Registration | Existing API safety, queue, browser workspace/counter/offline/access and canary regressions retained. |

Additional cases verify audited draft reads, exclusion from wallet, exact no-write draft reconciliation, identical-timestamp conflict protection, a committed signature with a failed/recoverable queue step, and a lost test-order reply retried against the signed A after B opens.

## Verification

Final commands, counts, failures, corrections and unrun gates are recorded in [STATUS.md](../../STATUS.md). Workspace TypeScript/lint/format and production build passed. The final full Vitest run passed 159 files / 7,635 tests; three independent focused API runs passed 19 each (57 executions). The selected development browser regressions passed 115. Compiled production configuration passed 29 distinct cases repeated three times (87 executions), including all twelve safety cases and the under-two-second canary in every repetition. A final clarified test-order identity caption passed three further rebuilt production executions (90 production executions total). Reception and Registration's exercised regressions remain functional, and their test-regenerated screenshots were restored.

Initial signing-race/replay and browser failures, the corrected exhaustive route registries and an independently fixed random no-show fixture collision are explicitly recorded in STATUS. Restricted development-server cleanup stalled two early runs; their assertions/results and eventual verified process cleanup are distinguished from the clean final gates. There are no new skipped cases or automatic retries. Two additional tooling TypeScript checks still fail in unchanged files: root `vitest.config.ts` rejects four `passWithNoTests` options, and `e2e/import-mapping.spec.ts:308` narrows `suggestedByModel` to `never`. These are separate unresolved tooling issues, not green checks. All test database targets are local/disposable and real patients/providers/infrastructure are not used.

## Remaining limits and Batch 4B preservation

- Unsaved writing survives the mounted workspace, queue/socket changes and recoverable requests. A forced reload, crash, power loss or mandatory authorization removal can destroy memory. Persist explicitly to the server; no unsupported durable/offline clinical store is implied. Test-code selection is not part of a persisted clinical draft.
- V1 signatures remain immutable. If another device already signed different writing, the UI retains this local copy and requires a deliberate decision; V1 has no amendment/replacement feature. Do not offer silent overwrite or invent one during visual integration.
- Saving an old encounter preserves an unsigned record, not a completed prescription in the wallet. A fresh sign after reception has moved on remains refused. This batch adds no retrospective finalization or draft-browser workflow; resolving such an unfinished visit still needs a permitted clinical workflow and explicit review.
- Record and queue are separate committed transactions. The truthful partial receipt/reconciliation is essential. A signed A whose queue changed must never finalize B as recovery. Reception may have legitimately marked A done even when a concurrent stale sign is refused; signing does not undo reception.
- Doctor authorization remains hospital-wide because no staff-account-to-clinician mapping exists (Phase 8A C9). This batch does not settle that founder/data-owner policy decision. Narrower clinician authorization and other Phase 8A clinical/lab/pricing/identity/infrastructure blockers remain separate launch gates.
- Batch 4B must preserve pinned patient identity, old-booking rescue/discard guards, revision checking, hydration generation/cancellation, frozen uncertain-operation bodies/keys, backend-confirmed signatures, content mismatch handling, deterministic expected-booking queue replay, independent test-order retries, consent/audit/RLS/module rules and server-record printing. Styling must not restore a live-serving-patient reset or clear records on rejected operations. Do not change draft-time lab semantics by copying the standalone prototype's behavior.

**C1 and C2 are resolved within the verified V1 workflow.** No unresolved C1/C2 race is concealed; the remaining workflow/access/tooling/launch limits above remain explicit. This local branch is not clinical launch approval. Stop after Batch 4A for founder review; Batch 4B has not started.
