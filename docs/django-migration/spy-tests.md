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

| Node file | Case | What it injects | Django equivalent |
|---|---|---|---|
| `labPharmacySafety.routes.test.ts` | fails closed when durable audit writing fails | `clinicalRepo.recordRecordView` rejects | pending |
| `labPharmacySafety.routes.test.ts` | refuses a foreign hospital without writing a read audit | spy must not be called | pending |
| `adminChambers.routes.test.ts` | to be listed when the module is ported | | |
| `broadcastAfterCommit.test.ts` | to be listed | | |
| `consent.routes.test.ts` | to be listed | | |
| `demo.routes.test.ts` | to be listed | | |
| `demoPhones.routes.test.ts` | to be listed | | |
| `doctorSafety.routes.test.ts` | to be listed | | |
| `readiness.routes.test.ts` | to be listed | | |
| `receptionSafety.routes.test.ts` | to be listed | | |
| `smsRedaction.test.ts` | to be listed | | |
| `staffAuth.routes.test.ts` | to be listed | | |
