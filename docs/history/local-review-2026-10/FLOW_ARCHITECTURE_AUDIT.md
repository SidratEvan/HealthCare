# Flow and architecture audit — 15 October 2026

## Verdict

The flow is not perfect. The core queue has a strong design and passed its five
central browser checks in the preceding setup review. This codebase contains real
workflow software, but a successful pitch walk does not establish safe refunds,
concurrent authentication, failure recovery or production operations.

The immediate need is correctness and activation hardening, not a framework rewrite
or a split into microservices. Keep the shared reducer, event log, tenant scopes,
limited database role and modular API. Repair the specific gaps below before
making a broad real-patient launch claim.

Scope: working tree based on `origin/mvp` `cd2a676`, plus the preceding local setup
changes. Inspected current application code, schema, jobs, offline clients, CI and
deployment configuration. New probes used `healthcare_audit_test` on localhost,
the repository's synthetic seed and fake SMS/payment providers. No public endpoint
was attacked, no real message/payment was sent, and `healthcare_dev` was not reset
by this audit. No application fixes were applied during this review.

Evidence levels: **reproduced** means an isolated local probe exercised the current
code; **code-confirmed** means the implementation demonstrates the stated behavior;
**risk** means the failure/scaling scenario needs a dedicated fault-injection or
acceptance test. Historical status reports are labelled separately.

## 1. Fix before live money: refunds are not safely idempotent

**High; reproduced.** `backend/api/src/services/payment.service.ts:769`, especially
the first transaction at 778, provider call at 848 and recording at 862;
`repositories/payment.repo.ts:254`; `adapters/payments/bkash.ts:136`.

Two simultaneous refund calls against one seeded payment, using the **same**
idempotency key, both reached the fake provider. One recorded successfully; the
other failed `payments_refund_within_amount` after its provider call had succeeded.
The database constraint protected its ledger, but it cannot undo an external refund.

The first payment lock is released before the network call. No persisted refund
operation reserves the amount or deduplicates this key, and the second recording
transaction adds the previously computed amount without re-deciding under a lock.
The bKash adapter does not put `request.idempotencyKey` in its refund request.
Provider-side behavior might reject an extra refund; this application does not
prove that guarantee, and a provider success followed by a local write failure
also creates a reconciliation problem.

Fix: create a durable refund operation keyed by hospital/payment/request key,
reserve the refundable amount atomically, perform the provider call outside the
transaction, then reconcile its outcome and reference. Track pending/unknown
outcomes. Same-key retries return that operation; distinct operations cannot reserve
more than the remaining amount. Test simultaneous calls, a lost provider answer,
and a crash after provider success. Existing refund tests primarily prove sequential
replay, which did not catch this race.

## 2. Fix authentication concurrency: several OTPs stay open

**High; reproduced.** `services/patientAuth.service.ts:111` and
`repositories/patientAuth.repo.ts:19`, `:36`; migration `0032_patient_otp.sql`.

Eight simultaneous requests to one synthetic number were all accepted even though
`OTP_MAX_PER_HOUR` is five. Depending on interleaving, four to eight challenge rows
remained open. The latest probe also successfully verified the latest open code
and then an older open code after the first was consumed.

Counting requests, consuming old challenges and inserting the new challenge are
separate statements without a per-phone transaction/lock or a uniqueness invariant.
Requests pass the count together. Their UPDATEs can run before the other INSERTs,
leaving several open rows. `openChallenge` selects the newest unconsumed row, so
consuming it exposes an older one again. The gateway can also deliver several
codes, confusing patients and inflating SMS cost.

Fix: serialize challenge creation per normalized phone; enforce rate count,
replacement and insert together; add an appropriate database invariant for one
active challenge. Send outside the transaction with explicit delivery state.
Add parallel request and retired-code regression tests. Keep the existing
wrong-attempt lock and one-time consume safeguards.

## 3. Patient logout does not end existing access

**High for record-access expectations; reproduced.**
`services/patientAuth.service.ts:186`, `:243`; `middleware/auth.ts:83`;
`realtime/auth.ts:117`, `:162`.

A patient token received HTTP 200 from `/api/v1/me/profiles` both before and after
logout of its refresh session. Patient access tokens contain no session/family ID;
logout only revokes the refresh row. HTTP live-session validation and socket
revocation sweeping apply to staff, not patients. The old patient access token
remains usable until JWT expiry, normally fifteen minutes. Patient/guest sockets
also lack the staff-style revocation sweep; a connected socket is not automatically
closed just because its original JWT later expires.

This does not grant access to another patient's rows, and clearing the browser's
local session still signs out that browser's UI. The gap is server-side access
termination for a copied token or an existing connection.

Fix: extend session-bound access and revocation to patient tokens and their sockets.
Decide guest-link revocation/expiry behavior explicitly too. Test logout, refresh
reuse, account deactivation and token expiry across HTTP and connected sockets.

## 4. Failed SMS looks successful to the patient

**High for patient entry; reproduced.** `services/patientAuth.service.ts:132`.

The fake SMS provider rejected delivery. `requestCode` only logged a warning and
returned the normal success result with a 300-second TTL. The guest/account screen
can therefore wait for a code that was never accepted for sending. A challenge was
already created, so failed sends also consume the current request budget.

Production Compose defaults to `SMS_PROVIDER=log` while real guest phone checking
is enabled by default when demo mode is off. A staff-only pilot can use that
configuration, but it cannot deliver the public patient booking/sign-in experience.
API process readiness does not establish SMS readiness.

Fix: distinguish accepted, failed and uncertain delivery; give an actionable retry
response; define how failed sends affect limits; and expose patient-entry capability
so forms are not offered when the deployment cannot complete verification. Do not
solve this by disabling phone proof for real patients.

## 5. Live integrations cannot be activated using the supplied Compose file alone

**High; code-confirmed.** `deploy/docker-compose.yml:45` and
`backend/api/src/env.ts:461`; `docs/DEPLOY.md` SMS/payment settings.

Compose passes `SMS_PROVIDER`, key and sender ID, but omits `SMS_API_URL` and
`SMS_DLR_SECRET`. Setting those in `deploy/.env` does not automatically inject them
into the API container. With `SMS_PROVIDER=http`, production env validation rejects
the missing settings. All `BKASH_*`/`NAGAD_*` settings are also absent from the API
environment, so changing to `PAYMENT_PROVIDER=live` alone leaves those methods
unavailable even if the credentials were written in the env file.

Fix: explicitly pass each required setting, update the deployment template, and
test the fully composed environment against the API validator. Exercise configured
HTTP SMS/payment adapters against stand-ins in the deployment stack before provider
sandbox activation. Real provider accounts and wire-format validation remain
separate external work.

## 6. The public demo lacks the agreed synthetic-identity boundary

**High; code-confirmed, also recorded in latest status.**
`services/patientAuth.service.ts:80`, `:137`; booking/registration phone handling;
`docs/STATUS.md`, 12 October entry.

Demo input accepts ordinary normalized Bangladeshi numbers. Demo OTP is returned
in the response, so it proves no real phone ownership. Without an explicit synthetic
identity allowlist, visitors can enter real contact information in the publicly
accessible demo. The owner's documented decision is to reject all identities
outside an explicit test list before any writes, across patient and staff routes.
That protection is not implemented here. A warning on the company website does
not establish the boundary.

Fix: apply the agreed guard at every relevant server entry point, add a route
coverage matrix, and check demo activation separately from production auth.

## 7. Booking confirmation can fall between transactions

**Medium/high; code-confirmed failure window, not crash-injected here.**
`services/booking.service.ts:349`, `:360`, `:399`, `:488`.

The booking commits before its confirmation notification is inserted. A crash or
notification-insert error in between leaves a booking without the message. The
helper logs enqueue failure without failing the booking. A same-key booking retry
returns through `created.replayed` before the normal confirmation enqueue, so that
retry does not necessarily repair the missing notification. The existing notification
sender retries rows that exist; it cannot discover a row that was never created.

Fix: enqueue a durable confirmation intent in the booking transaction, or reconcile
committed bookings missing the relevant intent. Compose/reissue credentials only
when sending, using the existing message-link machinery. Test a crash after booking
commit, a failed enqueue and a lost response followed by the same-key retry.

## 8. Realtime consistency is stronger on reconnect than during a silent loss

**Medium; architectural risk with code evidence.**
`services/queue.service.ts:864`, `shared/client/src/realtime/session.ts:234`,
`frontend/patient/src/hooks/useSessionChannel.ts:127`.

Queue writes correctly commit before broadcasting. Broadcast work is held in an
in-memory callback list, however; it is not a durable delivery outbox. Clients
receive authoritative state on subscribe/reconnect and newer queue updates, but
there is no periodic sequence heartbeat or authoritative resync while an apparently
connected socket remains quiet. A missed final broadcast can leave a device behind
until another mutation/reconnect. A whole single-instance crash normally triggers
reconnect, so this is not a claim that every restart loses queue state.

The patient hook also calls data stale based on connectivity/absence of a timestamp,
not its age, despite the shared channel exposing an age-based stale calculation.
The separate freshness line does show age, but live indicators can disagree with it.

Fix: establish a sequence/freshness heartbeat and resync on detected lag or resumed
visibility; use consistent freshness semantics. Evaluate a durable broadcast outbox
if reliable delivery across processes is required. Fault-test a lost last update,
an interrupted subscribe and a suspended phone.

## 9. Payment choices assume capabilities before configuration is known

**Medium; code-confirmed.** `frontend/patient/src/app/book/page.tsx:901` and
`hooks/useDeployment.ts:78`.

While deployment config is null, the booking screen assumes online payment is
available and offers bKash, Nagad and card, starting with bKash. That can show methods
this deployment cannot take. The API refuses unavailable methods, so this is a
misleading/dead-end flow rather than permission to charge through a missing provider.
Config caching also needs explicit invalidation when scope/capabilities change.

Fix: load verified capabilities before enabling online choices; show loading or
pay-at-counter where that is confirmed; provide config retry and scope-keyed caching.
Check the flow on slow networks and a counter-only hospital.

## 10. Client refresh has a concurrent-request race

**Medium; code-confirmed structure, not browser-reproduced here.**
`frontend/patient/src/lib/account.ts:172`, `:129`;
`services/patientAuth.service.ts:222`.

`freshAccess` can start several refresh calls with the same rotating refresh token.
There is no shared in-flight refresh promise. One can succeed while another returns
`raced` or `reused`; a signed-out failure clears local session storage. A legitimate
parallel page load can therefore compete with itself around token expiry.

Fix: single-flight refresh within a tab and coordinate across tabs as needed;
prevent an older failed request from clearing a successfully renewed session.
Test parallel requests at expiry and two tabs renewing together.

## 11. Operations and release evidence are incomplete

- CI is implemented, but the latest repository status records failing patient
  search/portal-install checks. Previous local full run: 7,301 passed, 10 failed;
  a focused clock investigation still had nine failures. These are not a green
  release gate. This audit did not inspect the current private GitHub dashboard.
- Render's configured health check is `/healthz`, which proves process liveness.
  `/readyz` reports DB schema version but does not compare it with the migrations
  the checked-out code expects. Worker/backup attention is exposed separately;
  a healthy process is not proof that the full patient journey works.
- The repository CI file has no deployment/migration step. Provider deployment
  from `main` and manual site publishing are separate paths. Branch protection,
  deploy-on-green configuration and promotion/rollback controls need verification
  with the cloud account owner.
- Scheduled jobs, sockets, revocation tracking and rate-limit windows are coupled
  to one API process. That is a reasonable V1 choice, but replicas need shared
  socket delivery, coordinated work and shared limits. A restart resets in-memory
  address limits; durable OTP safeguards have the race described above.
- Notification sending claims 20 rows for 120 seconds and sends them sequentially;
  each HTTP SMS call can take 10 seconds. A slow batch can outlive its lease.
  A second sender could reclaim work still being processed. This is a scaling
  risk, not proof of duplicate sends with today's single sender. Add lease renewal,
  suitable concurrency/batch sizing and delivery deduplication before scaling it.
- Backup/restore scripts and readiness signals exist. External alert delivery,
  on-call ownership, independently observed restore drills and production incident
  processes were not established by this review. The previously observed public
  demo readiness had backup watching disabled.
- Critical services and screens are large: queue/payment logic and the hospital
  settings/booking screens carry many responsibilities. Extract focused operations
  and state transitions behind existing boundaries as fixes land. File length alone
  is not a correctness defect or a reason to introduce distributed services.

## 12. Product decisions still need real-world validation

These are not all bugs. Separate deliberately omitted V1 scope from acceptance gaps:

| Area | What still needs proof/decision |
|---|---|
| Reception adoption | Who operates Next/arrival/delay every shift; accuracy if staff omit updates; transfer between desks and downtime procedure |
| Patient entry | A complete non-demo OTP → book → live tracking → cancellation/refund journey with the actual provider |
| Identity | Shared/reassigned phone numbers, mistaken profile claims, duplicate people and correction/merge rules; phone control is not durable proof of one person's identity |
| ETA and arrival | Measured accuracy during delays, walk-ins, offline stretches and long visits; a preferred arrival hour is not a guaranteed consultation time |
| Records | Staff acceptance of prescribing/report workflows, corrections, consent explanation and audit access; technical routes alone are insufficient |
| Emergency/capacity | Who confirms figures and how often; stale/unpublished information and refusal/transfer workflow; discovery does not guarantee admission |
| Deliberate omissions | Rescheduling, linked family accounts, independent pharmacies, native/store releases, live push and some multi-workplace doctor behavior are deferred or need external decisions |
| Hospital integrations | Real export formats, import deduplication/correction and an actual HMS handover; a mapping demo is not a verified integration |

## Recommended order

1. **Correctness/security:** refund operations, atomic OTP creation, patient
   revocation, demo synthetic-identity enforcement and regression coverage.
2. **Patient activation:** Compose settings, honest SMS failure/capability state,
   durable booking confirmations, payment availability and refresh races.
3. **Reliability:** green known tests, silent-loss resync/freshness, alerting,
   restore drill, release/migration/rollback checks and sender lease handling.
4. **One-hospital acceptance:** reception and patient journeys using approved
   provider sandbox/test identities, including retries, offline work and mistakes.
5. **Expansion:** measure workload and introduce shared coordination or separate
   workers when required; expand product scope after the actual workflows are proven.

## Reproduction evidence

Ignored local script: `.local/audit-probes.mts`; output: `.local/audit-probes.log`.

Latest run:

```text
concurrent OTP requests: requested=8, accepted=8, providerCalls=8, open=4
older OTP after consuming latest: successfulVerifications=2
failed SMS delivery: answeredSuccess=true, ttl=300
patient access after logout: before=200, after=200
concurrent refunds, SAME key: providerCalls=2
refund outcomes: one recorded; one payments_refund_within_amount error
```

The probe calls auth/refund service functions directly; logout behavior was also
checked through the real Express middleware with Supertest. Thus the refund/OTP
probes establish service-level defects, not a measured exploit through every
public rate limit. HTTP refund middleware validates the key but does not implement
deduplication. The fake providers prove application behavior, not that a real
gateway would necessarily pay a duplicate. The script keeps its mutations within
the disposable local audit database and logs no code, token or real provider secret.
