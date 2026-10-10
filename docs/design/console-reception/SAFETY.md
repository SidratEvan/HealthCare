# Reception safety corrections — Batch 3A

The founder approved Batch 2's integrated visuals before this batch began. Branch: `feat/console-redesign-reception`, based on `4e1da6814a8da23e29d1067a17b75ed1903494df`. Local synthetic validation only; no production change, push, merge or deployment.

## Why these corrections accompany Reception

The multi-chamber workspace exposes the existing walk-in and realtime paths continuously. Phase 8A C3/C4 were verified against current source and then exercised through real API/database/socket regressions. Before correction, an event-write failure left one booking behind, concurrent copies of a walk-in did not both receive its result, restricted password/MFA tokens could connect, and same-hospital roles could subscribe beyond their HTTP queue-read permissions. Initial red regressions were recorded; they were not treated as passing evidence.

Walk-in creation now locks the session and checks the event key inside that lock before issuing a serial. The booking, event, projection and queued notifications commit together. Invalid/ended requests and event-write failures retain no new booking. Existing event guards, reducer, actor/hospital/desk checks and post-commit publication remain authoritative. Replays check session, actor, patient and original position/reason, then return the original booking's serial even when another patient has since joined. The HTTP receipt is additive (`walkin.bookingId`, `walkin.serial`); existing result fields stay intact. The Reception form retains one key for the same attempt across an uncertain answer. Patient-profile creation remains its existing separate registration operation.

Socket handshakes now reject `mcp` and `tfa=setup` tokens before rooms are joined. Session rooms use the existing HTTP queue-read roles, queue module and desk scope. Ambient room roles match the existing HTTP board reads: beds admit ward/emergency/reception/doctor/admin, ER emergency/admin, lab lab/admin, and admin admin; disabled modules supply no matching room. Patients/guests retain the identifier-free queue copy and existing booking scope.

After authorised desk/module changes in this process, staff sockets for that hospital disconnect and resubscribe using current permissions. The existing revocation sweep also checks joined-room permissions and access-token expiry, covering external changes within its existing minute interval. Module reads retain their existing thirty-second cache. A permission lookup failure closes the connection; it does not renew access. Staff account/family revocation remains in place. This is permission parity, not a new role or permission policy. No migration is required.

An opt-in `GET /staff/chambers?includeEnded=1` supplies today's finished chambers for the overview. The default work-picker read still omits them; hospital/desk filtering is identical. Finished/cancelled cards remain read-only, and existing guarded deep links remain available. No queue write endpoint or alternate reducer was added.

## Verification

Unchanged baseline: 25 unit/component files / 800 tests and five queue/replay/concurrency/socket API files / 93 tests passed. The first API attempt could not reach PostgreSQL because Docker was stopped; the installed local Docker engine and existing `healthcare-db` were started, then the unchanged baseline passed.

The corrected affected API run passed **nine files / 145 tests**: `receptionSafety.routes`, `realtime`, `queue.routes`, `queueRules.routes`, `queueConflict`, `sync.routes`, `hospitalDesks.routes`, `sessionRevocation`, and `moduleRoutes`. It covers real socket admission/payload refusal, ambient room membership, a desk change during a connection, module removal, existing scope/revocation and the walk-in transaction/receipt regressions. Test fixture corrections use the actual 200 desk-write/422 queue-guard contracts and `error.occurred` envelope; synthetic assignments/modules are restored even on failures.

Current frontend/unit/component and final build/browser evidence belongs in `README.md` and `docs/STATUS.md`. The complete release, schema and production-configuration suites are separate gates; this document does not certify them or a hospital launch.

## Critical dependencies still open

Doctor C1/C2 remain: an incoming serving-patient change still clears unsaved consultation writing, and signing can race with reception's advancement. Doctor implementation is excluded from Batch 3A. The new Reception commands retain the same booking-specific V1 event path; they do not add a generic patient-switch operation or imply that another doctor's note has been safely saved. Protect and test booking-bound notes/signing before a clinical release.

Patient identity ambiguity and clinician-account mapping (C9), plus the other module-specific Phase 8A findings, remain separate decisions/corrections. Registration Batch 3B must handle its approved identity confirmation, duplicate/ambiguous-person safeguards, unsaved forms and actual serial receipt/return context; this batch preserves its existing entry rather than redesigning it.
