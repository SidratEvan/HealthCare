# Node tests that watch the Node process from inside

The Node API suite runs unchanged against the Django server
(`vitest.django.config.ts`). A test that replaces a Node module with a spy
(`vi.spyOn(repo, 'fn').mockRejectedValueOnce(...)`) changes only the Node
process; the Django server never sees it. Such a test either fails against
Django (it expected the injected failure) or passes without having tested
anything (it asserted the spy was *not* called).

Neither result is evidence about Django. Each such case has an equivalent in
`backend/django/tests/api/`, which sends the same request through the whole
Django pipeline (Django's test client, the same test database) and injects
the same failure into the Python module. The compatibility matrix counts the
pytest, not the Node case, for the Django side. No Node test is edited or
skipped.

Not listed, because the harness carries them to Django and the Node case is
evidence as it stands:

- a spy on `env` (`consent`, `demo`, `demoPhones`, `readiness`): the values a
  test changed travel with each request (`x-medlive-test-env`);
- a service a test calls directly (the queue service's writes, the
  notification sender's `settled` and `dispatch`, `portals.hospitalLinkOrigin`):
  the call runs in the Django process (`tests/node_suite/call.ts`);
- an adapter a test installs (SMS, payment provider, mapping provider), the
  rate limiter's `counter.reset()`, and the clock's heartbeats: each is
  bridged (`tests/node_suite/bridge.ts`).

## The cases and their equivalents

| Node file | Case | What it injects or watches | Django equivalent (`backend/django/tests/api/`) |
|---|---|---|---|
| `doctorSafety.routes.test.ts` | refuses a stale unsigned sign when reception wins before the clinical transaction lock | `sessionRepo.lockForUpdate` runs reception's Next first | `test_doctor_and_reception_safety.py::test_a_stale_unsigned_sign_is_refused_when_reception_wins_before_the_lock` |
| `doctorSafety.routes.test.ts` | does not finish B when reception advances after A is signed but before its queue step | `queue.callNext` runs reception's Next first | `…::test_b_is_not_finished_when_reception_advances_between_the_signature_and_its_queue_step` |
| `doctorSafety.routes.test.ts` | reports a committed signature separately from a failed queue step and recovers safely | `queue.callNext` rejects once | `…::test_a_committed_signature_is_reported_apart_from_a_failed_queue_step_and_recovers` |
| `receptionSafety.routes.test.ts` | an event write failure rolls back the booking too | `queueEvent.append` rejects during a walk-in | `…::test_an_event_write_failure_rolls_back_the_walk_in_booking_too` |
| `registration.routes.test.ts` | refuses exposing a reused canonical identity when its required audit fails | `registrationRepo.recordLookup` rejects | `test_registration_safety.py::test_a_reused_identity_is_not_shown_when_its_required_audit_fails` |
| `labPharmacySafety.routes.test.ts` | fails closed when durable audit writing fails | `clinicalRepo.recordRecordView` rejects | `test_lab_safety.py::test_the_label_read_fails_closed_when_its_audit_cannot_be_written` |
| `labPharmacySafety.routes.test.ts` | refuses a foreign hospital without writing a read audit | the audit must not be called (passed vacuously) | `test_lab_safety.py::test_a_foreign_hospital_is_refused_without_an_audit_being_attempted` |
| `labPharmacySafety.routes.test.ts` | rejects invalid characters / missing padding / empty decoded payload / wrong signature / noncanonical padding before storage | `storage().put` must not be called (passed vacuously) | `test_lab_safety.py::test_a_report_refused_for_its_bytes_never_reaches_storage` (five cases) |
| `labPharmacySafety.routes.test.ts` | rejects declared MIME mismatch before storage | as above | `test_lab_safety.py::test_a_declared_type_that_is_not_the_file_never_reaches_storage` |
| `labPharmacySafety.routes.test.ts` | accepts exactly 10 MiB and rejects the next byte before storage | as above, for the second upload | `test_lab_safety.py::test_one_byte_over_ten_mebibytes_never_reaches_storage` |
| `broadcastAfterCommit.test.ts` | happens after the write is committed, for every way a counter writes | a witness emitter installed in the Node process, which Django never calls | `test_broadcast_and_queries.py::test_the_room_is_told_after_the_write_is_committed_for_every_way_a_counter_writes` |
| `broadcastAfterCommit.test.ts` | does not happen at all for a write that fails after it was computed | `notificationRepo.queueAll` rejects; the witness as above | `test_broadcast_and_queries.py::test_nobody_is_told_of_a_write_that_fails_after_it_was_computed` |
| `adminChambers.routes.test.ts` | keeps one SQL execution for hundreds of chambers | counts the Node driver's executions of a Node repository | `test_broadcast_and_queries.py::test_the_chamber_board_is_one_sql_execution_for_hundreds_of_chambers` |
| `staffAuth.routes.test.ts` | keep the sign-in live while they rotate | `createRefreshSession` paused mid-transaction to send another request | `test_staff_auth_races.py::test_the_sign_in_stays_live_while_it_rotates` |
| `staffAuth.routes.test.ts` | racing with the same token | a refresh held inside its transaction until the second waits on its lock | `test_staff_auth_races.py::test_racing_with_the_same_token_one_renews_the_other_is_refused_and_nobody_is_signed_out` |
| `smsRedaction.test.ts` | the log adapter keeps no number and no words | spies on the Node process's console and logger, and calls the Node adapter itself | `test_sms_redaction.py` (ten cases) against `adapters/sms.py` |
| `mappingProvider.test.ts` | the Claude provider's requests and answers | calls the Node adapter itself with a stand-in `fetch` | `tests/unit/test_mapping_provider.py` against `adapters/mapping.py` |
