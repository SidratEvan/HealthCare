# Registration safety receipt — Phase 8B Batch 3B

The founder approved Batch 3A before implementation. This branch starts at `5f6e4407f2998fe63f7431a3d34e2000699bbdac` and retains `9390e24` unchanged. Synthetic local verification only; no push, merge, deployment or production change.

## Necessary, narrow backend extension

V1 registration returned a patient ID while silently reusing an exact guest phone/name match. Its submitted age/sex could differ from the stored person. A lookup can become stale before submission, and a lost creation answer can be retried after the record exists. A frontend cannot infer whether that ID represents a newly created person or a reused record, and the existing twenty-person lookup cap is not a reliable receipt lookup.

The existing POST now adds `created`, `ambiguous` and canonical `patient` identity fields beside its unchanged `patientId`/normalised `phone`. It retains the existing guest-identity upsert and row lock, exact-name storage rule, patient creation helper, schema and role guards. Concurrent copies serialize under that existing household lock. No patient demographic is overwritten. No new identity, endpoint, migration, consent policy, account linkage or generic idempotency table is introduced. Existing callers can ignore the additive fields.

Returning a reused identity records the existing `RECORD_VIEW` audit with actual actor, hospital and purpose inside the same transaction. If that audit fails, no identity receipt is returned. The regression verifies the failure and successful audited recovery. Other regressions verify canonical original demographics, concurrent one-profile creation, explicit same-name ambiguity and existing registration/walk-in/tenant/desk/socket behavior. The frontend displays the stored receipt for explicit confirmation rather than automatically accepting the typed fields as that identity.

## Existing protections retained

Batch 3A already refuses walk-ins to ended chambers before insertion and commits booking/event/projection/notifications atomically. Its replay returns the original issued booking/serial even after other people join. Registration retains one logical key/time and exact target through uncertain answers. Duplicate clicks cannot start a second pending request. A missing issuance receipt is uncertain; the adapter no longer guesses a serial from the largest queue entry.

The profile operation's Idempotency-Key is validated, not stored in a durable request table. Its existing phone/name identity lock supplies repeat/concurrency safety. The new form locks an unresolved request's fields, retries the same body/key, and reconciles against the canonical creation/reuse receipt. Queue issuance has its separate durable event key and Batch 3A replay contract. These are separate transactions: a patient record can exist even if the chosen chamber later ends or rejects registration. The UI says that explicitly and never claims rollback of that profile.

Every lookup/register/walk-in continues to require existing server authentication and roles. Chamber HTTP/queue writes retain hospital/desk/module checks; the UI does not grant scope. Registration applies the actual selected desk filter and the same revalidation as Reception. A stale or revoked assignment is tested at submission. Lost replies and two different actual receptionists are exercised through the real API/database.

The added production offline-shell gate also exposed a pre-existing access metadata gap: a permitted deep link absent from the picker roster was opened online but its session ID was not recorded as already authorised, so offline reload was refused. StaffEntry now records that ID only inside the successful existing server-authorisation branch, clears a different target's old doctor label, and revalidates on the browser's online event. A never-authorised target still cannot mount offline; the production test checks the existing access gate and automatic validation on reconnect, while the demo retains its uncached-queue explanation. No token, role, module, hospital/desk policy or patient-data cache is changed.

## Remaining limits

- Phone/name matches are not identity proof. Listed existing people need explicit confirmation; indistinguishable returned records stop. The UI warns against creating another exact/normalised-name match. Distinct people with different names can legitimately share a phone. V1 has no supported path to create/disambiguate two distinct exact same-name guest profiles; that requires a separately agreed identity contract.
- Lookup returns at most twenty people. It cannot establish completeness of a large household, identity ownership, NID verification or absence of another account/imported profile. No automatic merge, record overwrite, added patient search or new consent grant is introduced.
- Form contents and unresolved attempt state remain in the mounted browser workspace. Guards protect reset/navigation and a browser leave warning covers reload/close; this is not durable draft recovery after a forced reload or browser restart. Review authoritative existing patient/queue state before issuing a fresh operation in a new workspace. No patient names/phones/notes are added to ordinary browser storage.
- No printable token exists in the inspected Registration/walk-in flow. Billing/payment receipts and prescription printing are separate V1 capabilities and unchanged. This batch adds no printer, bill, payment, SMS receipt or template system.
- Doctor C1/C2 remain critical: an external serving-patient change can discard unsaved writing, and signing can race with queue advancement. Doctor code is unchanged. Other Phase 8A module findings and provider/infrastructure readiness are separate gates.

Rollback may revert the Registration presentation while retaining this compatible receipt/audit extension and both Batch 3A safety fixes. It requires no database/down migration/outbox rollback. Stop after Batch 3B for founder review.
