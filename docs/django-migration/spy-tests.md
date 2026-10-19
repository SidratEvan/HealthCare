# Node tests that spy on in-process modules

The Node API suite runs unchanged against the Django server
(`vitest.django.config.ts`). A test that replaces a Node module with a spy
(`vi.spyOn(repo, 'fn').mockRejectedValueOnce(...)`) changes only the Node
process; the Django server never sees the spy. Such a test either fails
against Django (it expected the injected failure) or passes without having
tested anything (it asserted the spy was *not* called).

Neither result is evidence about Django. Each case below gets a pytest
equivalent in `backend/django/tests/` that injects the same failure into the
Python module, and the compatibility matrix counts that pytest, not the Node
case, for the Django side. No Node test is edited or skipped.

Where a test calls a service directly and asserts on what the server did,
the harness runs that call in the Django process instead
(`tests/node_suite/call.ts`: the queue service's writes, the notification
sender's `settled` and `dispatch`). That is not a spy and is not listed here.

| Node file | Case | What it injects | Django equivalent |
|---|---|---|---|
| `labPharmacySafety.routes.test.ts` | fails closed when durable audit writing fails | `clinicalRepo.recordRecordView` rejects | pending |
| `labPharmacySafety.routes.test.ts` | refuses a foreign hospital without writing a read audit | spy must not be called | pending |
| `adminChambers.routes.test.ts` | to be listed when the module is ported | | |
| `broadcastAfterCommit.test.ts` | to be listed | | |
| `consent.routes.test.ts` | none: its one spy is on `env`, which the harness carries to Django | | |
| `demo.routes.test.ts` | to be listed | | |
| `demoPhones.routes.test.ts` | to be listed | | |
| `doctorSafety.routes.test.ts` | refuses a stale unsigned sign when reception wins before the clinical transaction lock | `sessionRepo.lockForUpdate` runs reception's Next before taking the lock | pending |
| `doctorSafety.routes.test.ts` | does not finish B when reception advances after A is signed but before its queue step | `queue.callNext` runs reception's Next first, then the doctor's | pending |
| `doctorSafety.routes.test.ts` | reports a committed signature separately from a failed queue step and recovers safely | `queue.callNext` rejects once | pending |
| `readiness.routes.test.ts` | to be listed | | |
| `receptionSafety.routes.test.ts` | refuses exposing a reused canonical identity when its required audit fails | the registration lookup audit rejects | pending |
| `receptionSafety.routes.test.ts` | an event write failure rolls back the booking too | `queueEvent.append` rejects during a walk-in | pending |
| `smsRedaction.test.ts` | to be listed | | |
| `staffAuth.routes.test.ts` | keep the sign-in live while they rotate | `createRefreshSession` paused mid-transaction to send another request | pending |
| `staffAuth.routes.test.ts` | racing with the same token | a refresh held inside its transaction until the second waits on its lock | pending |
