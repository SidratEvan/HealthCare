# Status

Where the build actually is, and what a new session needs to know that is not
already in `CLAUDE.md` or derivable from `git log`.

**Update this at the end of every step.** It exists so that handing the work to
a fresh session costs one file read instead of a re-explanation, and it is only
worth that if it is true.

Last updated: `feat/payments` — step 18. A booking records what it charged, a
retry never charges twice, and a cancellation says in taka what is coming back
before anybody confirms. When a session ends with people still waiting, every
one of them is marked owed without asking.

---

## Build plan position (`CLAUDE.md` §4)

| Step | Branch | State |
| --- | --- | --- |
| 0 | `chore/scaffold` | merged |
| 1 | `feat/db-core` | merged — migrations 0001–0006 |
| 2 | `feat/domain-queue` | merged — reducer, ETA, rate, rules, replay |
| 3 | `feat/api-foundation` | merged — env, db, logger, middleware, errors, health |
| ~~4~~ | ~~`feat/auth-guest`~~ | **deferred, do not build** — see `CLAUDE.md` §4.1 |
| 5 | `feat/seed-demo` | merged — `database/seeds` 00–07 + `reset.ts` (`FR-DEM-*`) |
| 6 | `feat/queue-service` | merged — `appendEvent()`, 13 queue routes, realtime |
| 7 | `feat/ui-tokens` | merged — tokens, contrast checks, seven primitives |
| 8 | `feat/console-reception` | merged — sync protocol, offline queue, the console, Playwright |
| 9 | `feat/patient-booking` | merged — discovery, booking, guest booking, mock payment |
| **10** | **`feat/patient-live-serial`** | **merged — the pitch demo works.** `<LiveSerialCard>`, the session channel on the patient side, late/cancel, and the two-device canary |
| 11 | `feat/notifications` | merged — migration 0010, templates, the outbox, SMS/push adapters |
| 12 | `feat/doctor-console` | merged — migration 0007, `S-B-05`, the visit record, `FR-DOC-10` + audit. **E-prescriptions dropped**; `PRD.md` §9/§24/§26 and `APP_FLOW.md` B2 edited to match |
| 13 | `feat/wallet` | merged — `S-A-12`, the consent handshake (`BTN-A12-QR` → `BTN-B05-SCAN`), the access log and revoke. A pasted code stands in for the QR |
| 14 | `feat/beds` | merged — migrations 0008 + 0012, `S-B-06` the ward board, `<CapacityMirror>`, `S-A-11` bed search and bed requests, the ward's half of `FR-OFF-01` |
| 15 | `feat/emergency` | merged — migrations 0013 + 0016, `S-A-10`/`10b`/`10c`, `S-B-07` the ER console, the ward's ER half of `FR-BED-07`, `emergency-burn.spec.ts` |
| 16 | `feat/referrals` | merged — migration 0017, the referral state machine, both halves of the ER console, `referral.spec.ts` |
| 17 | `feat/lab-pharmacy` | merged — migrations 0011 + 0018, `S-B-08`, the stock half of `S-B-09`, `BTN-B05-TEST`, `TAB-A12-REP`, the medicine search, `lab-report.spec.ts`. **Dispensing dropped**; `PRD.md` §12 and `APP_FLOW.md` B5 edited to match |
| 18 | `feat/payments` | merged — migrations 0009 + 0019, the refund and settlement domain, the provider seam, `seed_08_money`, the refund statement on `MOD-A08-CANCEL`. **bKash and Nagad are not implemented**; the mock is the working provider (`CLAUDE.md` §1.1) |
| 19 | `feat/admin-dashboard` | **next** — aggregates, no-show loss and recovery, exports |

Four unplanned branches after step 11:

- `chore/deploy` — the `S-B-01` console picker, `render.yaml`, Vercel configs
  and `docs/DEPLOY.md`.
- **`feat/app-shell`** — hospital-first discovery and the patient app shell.
  Asked for directly by the owner: the booking flow went specialty → doctor,
  and he wanted specialty → hospital → doctor, which is what `APP_FLOW.md`
  always said. He also said the patient side "does not look anything like an
  app", so the same branch adds `NAV-A`, the manifest and the service worker.
  See below.
- `fix/console-past-midnight` — two date bugs that only appear in the first six
  hours of a Dhaka day. See *Things learned the hard way*.
- `chore/format-clean` (after step 16) — `pnpm format:check` had been red for
  several steps; this makes `pnpm verify` green and removes the two reasons it
  went unnoticed. See *Things learned the hard way*.

None of these is a build step: nothing in `CLAUDE.md` §4 is skipped or brought
forward.

Three unplanned branches also merged after step 3, all recorded in `git log`:
`chore/remove-commercial-strategy`, `chore/supabase-compat`, `fix/api-env-file`.

**Step 10 is the milestone, and it passes.** A guest books, opens the SMS
tracking link, and watches the queue move: reception taps *next* on one device
and the patient's screen updates on another inside the two-second budget
(`NFR-01`), proven by `e2e/two-device-queue.spec.ts` against a real socket, a
real reducer and a real database write. That is the pitch (`PRD.md` §24 steps
1–4). Steps 5–8 of the script — no-show recovery, prescriptions, emergency,
the admin dashboard — are build steps 11 onward.

**Step 9 is the first step a patient can see.** `frontend/patient` serves
discovery and the four-stage booking flow in Bangla, and a guest books end to
end against the mock payment provider without ever meeting a login wall
(`FR-GST-01`).

**Step 8 is the first step with a screen.** Steps 5–7 are seeds and design
tokens; nothing renders before `feat/console-reception`. Step 5 is the first
step whose output is *visible* — demo data in Supabase's table editor.

**Authentication is deferred** (`CLAUDE.md` §4.1). Supabase Auth will issue
tokens when this goes past the pitch. The step-3 middleware that *verifies*
tokens stays; no OTP flows, staff passwords or argon2id are to be written. The
guest tracking link (`FR-GST-05`) is kept, because it is a capability token the
demo depends on rather than a login.

**Step 11 notifies from the queue, not from a cron.** A material event is
turned into messages by `notification.service`, the rows are written inside the
queue transaction and sent after it commits. `pg-boss` is deliberately not
installed (see the open decisions): every message this version sends is caused
by an event, so nothing needed a scheduler. The two jobs that genuinely do —
the leave-home alert and send-retry — are noted under the deliberate gaps.

`pnpm test` reports 2943, in about a minute.
`pnpm test:e2e` reports 85, in Chromium, against the real API and the seeded
demo database — 5 in `two-device-queue.spec.ts`, 18 in `guest-booking.spec.ts`,
5 in `offline-console.spec.ts`, 12 in `app-shell.spec.ts`, 7 in
`doctor-console.spec.ts`, 3 in `console-cold-start.spec.ts`, 8 in
`wallet.spec.ts`, 8 in `ward-board.spec.ts`, 7 in `emergency-burn.spec.ts`,
6 in `referral.spec.ts`, 6 in `lab-report.spec.ts`. The whole run takes about
fifteen minutes.

`pnpm verify` — typecheck, lint, `format:check`, test — is clean, and so is
`pnpm build`. `format:check` had been failing on five files since before step
16; `chore/format-clean` fixed them and the two things that let it happen (see
below).

### The demo API sleeps, and the console now says so

Render's free tier spins the API down when nobody is using it, and the first
request afterwards takes the better part of a minute. `fetch` has no timeout of
its own, so `S-B-01` sat on its loading skeleton for as long as the page stayed
open — the one `GR-03` state with no way out, because nothing ever rejected. It
was seen on a phone opening the deployed console shortly after a deploy, which
is precisely when the API is restarting.

The picker now gives each attempt twelve seconds (`AbortSignal.timeout`), tries
four times, says **সার্ভার চালু হচ্ছে** from the second attempt onward, and ends
at an error with a retry rather than a skeleton. Four attempts is a product
decision about a sleeping backend, not a test detail, which is why
`console-cold-start.spec.ts` declares a longer budget instead of trimming it.

Worth knowing when demonstrating: **open the console once a minute before
showing anyone.** Nothing is broken if the first load is slow; it is the free
tier waking.

### Step 18 — the money, and what a number somebody agreed to is worth

**The definition of done is the idempotency test** (`CLAUDE.md` §4), and it is
the first describe in `payment.routes.test.ts` because the failure it guards
against is the only one in this step that takes money from a person. It is
tested two ways: a retry after the first completed, and five identical
requests in flight at once — which is what a patient double-tapping confirm on
a bad connection actually produces.

**`FR-PAY-06` is three deep.** The caller's key is unique in the database,
serialised by an advisory lock so a replay that races its original waits, and
passed to the provider so even a retry past both finds the same transaction.
Any one would usually do. Payments get all three.

**A client never says how much.** An intent names *what* is being paid for and
the amount comes from the booking's own `fee_poisha`, copied on at booking
time (`DB-P5`) so a later fee change cannot alter what was charged. A refund
names a *reason* and the amount is `refundFor` in `shared/domain`. Neither
number is ever in a request body, so neither can be argued with — and the test
that sends `amountPoisha: 1` gets charged the real fee.

**Money is never edited, only added to.** A trigger refuses any change to
`amount_poisha` or `platform_fee_poisha`, the way `ambulance_requests` refuses
a change to a quoted fare (`FR-PAT-74`). A refund goes in `refunded_poisha`,
so a settlement can always state collections and refunds separately. Six CHECK
constraints hold the state and the numbers to each other, because a settlement
computed from rows that could contradict themselves is fiction.

**`refund_policy` has a shape now** — open decision 12, which step 18 was the
step that needed it. It is `cutoffHours`, two percentages and whether the
platform fee comes back, validated on the way in. **A half-written policy is
read as no policy**: filling in a missing field would state a refund the
hospital never agreed to, which is worse than having none. Four demo
facilities have terms and two deliberately do not, so a cancellation at
Karnaphuli or Buriganga says the hospital will decide — the honest-degradation
case (`PRD.md` §3.2), demonstrable rather than only described.

**Doctor absence is the platform's guarantee, not the hospital's terms.**
`FR-PAY-07` returns everything including the platform fee, and no policy can
reduce it: the patient did not cancel, so no cancellation policy applies to
them. It is raised automatically when a session ends — every patient who paid
and was never seen is marked owed in one statement, after the commit, in a
way that cannot fail the session's end. A session has ended whether or not the
money bookkeeping succeeded, and an end that rolled back because a payment
query was slow would leave a chamber running on every screen in the hospital.

**Eligibility, not payment.** Each refund is then its own decision with its own
provider call. A batch of gateway calls inside a session's end would make
ending a session fail when a provider is slow. The patient is owed the moment
the session ends; the money follows.

**What counts as absence** is not defined by any document. Implemented as: the
session ended and no `DOCTOR_ARRIVED` was ever appended. A session where the
doctor came and simply did not reach everybody is recorded as `session_ended`
instead — those patients are equally owed, and the reason says which happened
so an administrator is not told a doctor was absent when they were not.

**`MOD-A08-CANCEL` states the refund in taka**, not as a percentage, computed
by the same function the server refunds with. That is the whole of
`FR-PAY-03`: a rule the screen computes one way and the server another is a
rule that gets stated wrongly.

**Subscriptions and invoices have tables and no data.** What a module costs,
what tiers exist and what a hospital is charged are negotiated per agreement
and live outside this repository (`CLAUDE.md` §1.1). The code can invoice;
what it invoices for is not a code decision. `PLATFORM_FEE_POISHA` stays 0, so
the platform fee is itemised as zero rather than hidden (`FR-PAY-04`).

**bKash and Nagad are not implemented, and say why in detail.** Both need
merchant credentials that arrive with an agreement. Rather than write an
integration nobody has ever seen run, each adapter carries the *shape of the
work* — the call sequence, which response actually means the money moved, and
the one thing that bites. For bKash: the merchant invoice number is the
idempotency key and it is per-merchant forever, which is why the service sends
the payment's own uuid v7 rather than the caller's key. For Nagad: the
timestamp is Dhaka local and they reject anything a minute out, and **refunds
are not in their checkout API at all** — worth knowing before automatic
refunds are promised to a hospital for every method.

**Demo data.** `seed_08_money` is its own module and runs last: 927 payments,
one per booking with a payer, and twelve counter shifts. The payment mix is
declared rather than uniform — most people still pay at the counter — because
a settlement split evenly four ways looks like test data to anybody who has
run one. One shift in four is deliberately short of its expected figure, since
a demo where cash always reconciles hides the only thing `counter_shifts` is
for.

**How to show it.** Book as a guest and pay by bKash; the serial screen's
বাতিল করুন now names the taka coming back. Then, on the console, end that
chamber's session with people still waiting — every one of them is marked owed
without anybody asking, which is `FR-PAY-07` and the part of the pitch that
says the platform is on the patient's side.

#### Three bugs the tests found, and one the ordering did

**A pool deadlock, found by the concurrency test.** `createIntent` held a
transaction on the advisory lock while `findDetail` took a *second* pool
connection. Five concurrent identical intents exhausted a five-connection pool
and waited on each other. `findDetail` now takes the caller's transaction and
says in its own doc comment why that matters — the same shape exists anywhere
a repository read is made from inside a transaction on `db` rather than `trx`.

**Every genuine webhook was rejected.** `express.json()` consumes the stream
before any route runs, so the webhook's own `text()` parser found nothing and
verified a signature over an empty string. Every real callback failed and
every forged one failed identically, which is why nothing looked wrong. The
raw bytes are now captured by the JSON parser's `verify` hook and kept in a
`WeakMap` keyed by the request — only for `/webhooks/*`, because a copy of
every request body in memory is a copy of patient data in memory.

**The money seed covered a quarter of the bookings.** Written into
`seed_04_history` first, which runs before `seed_05_beds` and
`seed_07_demo_live` — so 367 payments instead of 919, and the pitch session's
own bookings, the ones a demo shows, had none at all. It is `seed_08_money`
now and runs last. **The general lesson: a seed that reads rows another seed
writes has to run after it, and the order is not obvious from the file name.**

**A migration numbered backwards into the sequence.** `payments` references
`ambulance_requests`, which 0011 creates — and on a fresh database the runner
applies files in filename order, so 0009 runs first. The local development
database already had 0011, so `db:migrate` was green there and only a build
from scratch failed. `0019_payment_ambulance_fk.sql` adds the key afterwards.
**A green migrate on a database that is already ahead proves nothing about a
fresh one.**

### Step 17 — the lab, and what a report is a promise about

**The definition of done is one sentence, and the E2E is that sentence.**
`lab-report.spec.ts` drives it through three screens in one run: a doctor
ticks a chip on `BTN-B05-TEST` and signs, the order appears on a bench in
another browser context, the bench takes the sample, processes it and chooses
a real PDF — and the patient, whose phone has held nothing but a tracking
link since booking, opens the report. The rest of the spec: a test still on a
bench says what is happening to it rather than "no reports"; a patient with no
test is shown no Reports tab at all; the bench opens on work rather than on
nothing; and a pharmacy flagging a medicine নেই reaches the public search.

**Uploading is delivering, and that is one transaction.** `FR-LAB-03` says a
report "auto-delivers to the patient wallet and the ordering doctor", so
there is no separate *send* button — the file is stored, the `reports` row is
written, the order closes as `delivered` and `delivered_to` names whom it
reached, or the whole thing rolls back and the lab is told the upload failed.
A report row claiming a delivery that did not happen is the one outcome worth
designing against. The file is stored **before** the transaction opens: the
worst case is then an orphaned object, which costs bytes, rather than a
`file_url` pointing at nothing.

**The lifecycle only moves forward.** `shared/domain/src/lab/orders.ts` is the
API's guard and the console's optimistic update, as `referrals.ts` is for a
referral. A lab that mis-taps cancels and re-orders, which leaves both rows
visible; walking an order back is refused, because the timestamps are
`FR-LAB-04`'s measurement and a measurement that can be edited is not one.
`delivered` is deliberately absent from `LAB_ACTIONS`: it is the server's own
step, so a console cannot claim a delivery it did not perform.

**A stale tap is a replay, not a refusal.** A console whose outbox held
*collect* while the bench moved on gets a 200 and a `duplicate`, because the
action's outcome has held since the sample was taken. The genuine refusal is
reserved for working an order already cancelled. The lab console is
online-first by choice — a bench's actions are minutes apart and an upload is
a file — but every send carries a `clientEventId` and an idempotency key, so
adding an outbox later is a store rather than a redesign.

**The patient's name is not on the queue.** A row is the test, its state and
its age; the name is one tap and that tap is a request the server records
(`DB-P7`), the arrangement the ward board's bed panel already has. A bench
calling somebody to a counter needs it; a screen left open on a shared desk
does not.

**Turnaround is measured from the promise the patient heard** — ordered to
report ready, not sample to ready. The hour a sample sat uncollected is part
of what somebody told "come back this afternoon" actually waited. Delivery is
not the end point: ready-to-delivered measures this system rather than the
lab. A type with no finished order says it has no measurement instead of
reading zero, and the open count and the oldest waiting order sit beside the
median so a lab cannot improve its figure by never finishing anything.

**`FR-PHR-01` is not built, and this is the reasoning.** Dispensing against a
prescription QR is downstream of `FR-DOC-04`, which the owner removed on
2026-09-19. No code path and no seed creates a `prescriptions` row, so a
scanner would open a camera onto an empty table and `POST /prescriptions/:id/dispense`
would guard a table that is always empty. It follows prescribing out of scope
the same way `TBL-B05-RX` did. `FR-PHR-02` needs no prescription and is built
in full. `PRD.md` §12 and `APP_FLOW.md` B5 were edited to say so.

**`FR-LAB-01`'s "and app bookings" is also not built.** A patient ordering
their own test is `S-A-13`, a catalogue-plus-payment flow that is not in step
17's contents. Doctor orders are this version's producer. `test_orders.visit_id`
is nullable already, so `S-A-13` needs no schema change when it lands — and the
seed uses that nullability today for walk-in orders, which is both the
commonest way a test is ordered here and the path where a report reaches one
recipient rather than two.

**A stock flag goes quiet rather than lying.** After twelve hours an in-stock
claim is published as *জানা নেই* instead of repeated; an out-of-stock flag
stands until somebody clears it, because a pharmacy that restocked has every
reason to say so and one that has run out has none to keep saying it. Twelve
hours rather than a bed's ten minutes: a shelf does not empty that fast, and
a ten-minute threshold would mark the whole list unknown by mid-morning and
teach families to ignore the feature. `S-B-09` shows each row as **what a
patient is being told right now** beside what the counter last said —
`FR-BED-06`'s idea applied to a shelf.

**Demo data** (`FR-DEM-03`, `FR-DEM-05`). `seed_06_ancillary` runs for the
first time: eight ambulances, thirty blood donors and exactly fifty pharmacy
items — ten formulary medicines on five shelves. Nothing is waiting on a
migration any more. `seed_04_history` writes the reports half of `FR-DEM-03`
that step 12 deferred: 170 test orders, 112 delivered reports, turnarounds
drawn per test type so the medians differ and the slowest-first ranking has
something to rank. One shelf (Karnaphuli) is deliberately two days old, so
the lapse to *জানা নেই* is visible in the demo and not only in a test.

**Every lab opens with work.** Which hospital held a consultation in the last
two days is luck of the seeded history, and on most resets two labs had none —
so `S-B-08` opened empty at exactly the hospital a demo was being shown at.
The top-up is walk-in orders with no visit behind them, spread across all
three open states and the last thirty hours.

**Seeded reports point at a file that resolves.** A seed runs in its own
process and cannot put bytes into the API's, so a report row would 404 when
tapped — the demo promising a document it cannot open. The mock store
synthesises a one-page placeholder for keys under `reports/demo/`, labelled as
demonstration data in the PDF itself (`FR-DEM-07`). Nothing outside the mock
provider has that behaviour and a real bucket never sees the prefix.

**How to show it.** Console → any hospital → ল্যাব খুলুন for the bench, and a
second window on the same hospital's চেম্বার as the doctor. In the chamber:
type a diagnosis, tick a test chip, রেকর্ড দিন ও পরবর্তী. The bench's queue
gains the row without a refresh; নমুনা নেওয়া হয়েছে → প্রসেসিং → রিপোর্ট দিন
with any PDF, and the toast says both the patient and the doctor have it. On
a phone, the patient's রেকর্ড tab now has a রিপোর্ট tab beside it. For the
pharmacy: ফার্মেসি খুলুন, mark something নেই, then ওষুধ খুঁজুন on the patient
app and search that medicine.

**Supabase does not have this yet.** Migrations `0011_ancillary.sql`,
`0018_lab_idempotency.sql`, `0009_money.sql` and
`0019_payment_ambulance_fk.sql` have been applied to the local container and
to both test databases, and nowhere else. Until they are applied to Supabase, the
deployed console's lab and pharmacy screens will fail on their first read, and
the deployed patient app's medicine search will too.

All four are additive — new tables, new columns and one foreign key, nothing
dropped — so applying them is safe. Getting the *demo data* there is the destructive
half: the lab queue, the fifty pharmacy items and the delivered reports come
from a reseed.

```bash
# Additive, safe, no data lost:
ALLOW_REMOTE_DB=1 pnpm db:migrate
# Then, and only with the owner saying so, because it truncates:
ALLOW_REMOTE_DB=1 ALLOW_DESTRUCTIVE_DB=1 pnpm db:reset
```

**A remote reset is the owner's to authorise, every time.** Nothing in step 17
was run against Supabase.

#### The CORS bug the E2E found, which nothing else would have

`PUT` was missing from the API's `Access-Control-Allow-Methods`. The pharmacy
console could never have saved from a browser — **and neither could the ER
console's capability switches (`PUT /hospitals/:id/capabilities`), which have
been unreachable that way since step 15.**

The failure is close to invisible. The preflight answers 204 and looks fine;
the browser then refuses to send the real request on its own; nothing
server-side logs anything, because the request never arrives. Unit and API
tests all pass, because supertest is not a browser. Only a real page found it.

`app.test.ts` now reads the verbs off the mounted router stack and asserts
every one appears in the preflight's allowed methods, so a route added with an
unlisted verb fails in CI. It was verified to fail without the fix.

**The lesson worth keeping:** a middleware allow-list that is written once and
grows by hand is a class of bug that only a browser can see. The same shape
applies to `ALLOWED_HEADERS` — a route that starts requiring a new request
header will fail the same silent way.

### Step 16 — referrals, and who holds the person

**The definition of done is two consoles, and the E2E runs them.**
`referral.spec.ts` opens Jamuna's ER in one browser context and Shapla's in
another: Jamuna registers a walk-in, taps রেফার খুঁজুন, names an ICU bed as
the need, and the list keeps only the ERs that have one; রেফার পাঠান puts a
card on Shapla's `LIST-B07-IN` inside the alert's five-second budget. Shapla's
first touch stamps *seen* on Jamuna's row, রাজি — পাঠাতে বলুন accepts, and
এসে পৌঁছেছেন moves the person: a token at Shapla, Jamuna's case closed as
`referred`, both timelines agreeing. The rest of the spec: a decline arrives
with its reason and the case is Jamuna's to try elsewhere; a withdrawal clears
Shapla's card; an answer given offline is shown at once and sent on reconnect;
the consoles open on the seeded referrals; and Karnaphuli, two hundred
kilometres from any other ER, is told so rather than shown an empty list.

**Who holds the person, on the owner's ruling (2026-09-22).** The sending ER
keeps the case — on its triage list, counted in its load — until the receiving
ER records the arrival. Somebody in an ambulance between two hospitals is
still the sender's. That one act (`POST /referrals/:id/arrive`) does both
things in one transaction: opens a case with a token at the receiver and
closes the sender's as `referred`. While a referral is open the case is held —
`handoff`, `discharge` and the ward's admit all refuse it with
`details.guard = 'REFERRAL_OPEN'` — because a bay prepared for somebody who
has been sent home is worse than a refusal.

**A decline is not a referral.** `BTN-B07-DECLINE`'s suggestion list (step 15)
stays read-only, which is the opposite of what the build plan expected. A
decline happens *before* arrival: the family is still on the road, they choose
where to go next, and nothing on the family's side follows a referral. Sending
one would prepare a hospital for a family nobody told. Referrals are for
somebody already in this ER, and the button that starts one is on the triage
row (`BTN-B07-REFER`).

**What a referral asks for.** 0008 made `required_capability` NOT NULL, which
made "our ICU is full" impossible to send — and four of `FR-PAT-42`'s eight
problems map to no capability at all. 0017 makes it nullable and adds
`required_bed_kind`: a referral asks for a capability, a kind of free bed, or
both, never neither. The need defaults from the problem and the coordinator
can override it. The search then keeps only ERs with that capability *and* a
free bed of that kind (`referralCandidates` in `shared/domain`), and says how
many it left out and for which of the two reasons — an empty list that
explains itself rather than a hospital that seems not to exist.

**One state machine, two users, as cases and beds have.**
`shared/domain/src/emergency/referrals.ts` is the API's guard and both
consoles' optimistic update. Every step belongs to one side: the receiver
sees, answers and records the arrival; the sender can only withdraw, and the
other side's step is refused as `WRONG_SIDE` whatever the role. An answer
given before anybody touched the card stamps `seen` with it, so the timeline
never says a hospital accepted something it had not seen. A step already taken
is a replay and is answered as one — which is what makes the offline outbox
safe without an event log. **U:** one open referral per case, so two ERs are
never preparing for one person.

**Nothing in a referral names anybody.** The summary is the case's problem,
colour, age and sex plus an optional note of at most 500 characters, and it is
read from the case rather than sent by the client. A family's number stays
with the ER it was given to; the arrival opens a case at the receiver with no
phone at all, and the ward takes the name at the bed.

**Demo data** (`FR-DEM-04`). Four referrals between the three Dhaka ERs, each
for a gap the sender really has: Shapla has no burn unit (sent to Padma this
morning, the whole timeline through arrival), Padma has no cath lab (Shapla
declined, with its reason, and the case is still Padma's), Jamuna has no ICU
(seen, unanswered — Shapla opens on it), and Jamuna's HDU is full (Shapla
accepted; the person is on the way and still Jamuna's). No notes: a note is a
clinical summary in a coordinator's words, and inventing one would be clinical
content nobody declared.

**How to show it.** Console → Jamuna Medical College → জরুরি বিভাগ খুলুন, and
Shapla General's ER in a second window. Shapla opens with Jamuna's ICU ask
waiting. On Jamuna's side, a triage row → রেফার খুঁজুন → আইসিইউ বেড → Shapla →
রেফার পাঠান; Shapla's card appears and rings. Then রাজি — পাঠাতে বলুন, and
এসে পৌঁছেছেন when the person is at the door — Jamuna's row closes and Shapla's
triage list gains a token in the same moment.

**Supabase has this** (2026-09-22, on the owner's say-so). It was five
migrations behind, not one — 0008 and 0012 from step 14 had never been run
either — so `ALLOW_REMOTE_DB=1 pnpm db:migrate` applied 0008, 0012, 0013, 0016
and 0017 in one go, `db:verify` passed, and
`ALLOW_REMOTE_DB=1 ALLOW_DESTRUCTIVE_DB=1 pnpm db:reset` rebuilt the demo data:
the reset reported 170 beds, 26 emergency cases and 4 referrals among the rest.
That is the database, checked directly; the deployed console and apps were not
opened afterwards, and the API sleeps on Render's free tier, so give it a warm
load before showing anyone. **A remote reset is the owner's to authorise, every
time.**

**Found by running the suite, not by writing it.** The api project's seventeen
files share one mutated database (a test that goes through the API cannot be
rolled back around), and vitest was running them in parallel workers. Step
16's handover test asserts that Shapla's `er_active` moved by exactly one
while step 15's file opens and closes cases at Shapla — so it failed about one
run in three, on a number two higher than it should be. The api project now
runs `maxWorkers: 1`, which removes the class rather than the instance; it
costs about thirty seconds on `pnpm test`. `fileParallelism: false` would have
done it too, but vitest applies that to the whole run and the unit, ui and
schema suites need no such care.

### Step 15 — the emergency search, the ER console, and the family told

**The definition of done is the pitch, and the E2E runs it.**
`emergency-burn.spec.ts` stands a phone at Farmgate and opens Padma's ER
console in another context: জরুরি → দগ্ধ ranks Padma first (fresh) above
Jamuna (nearer, stale, labelled with its age) and Shapla (no burn unit, and
saying so); "I'm on my way" rings the console inside five seconds; প্রস্তুতি
নিন turns the family's screen to হাসপাতাল প্রস্তুত; গ্রহণ করুন gives a token.
The rest of the spec: a decline reaches the family with its reason; the family
calls off and the ER hears; critical gives one answer; a phone with no location
is still answered; the ER hands a case to the ward and the ward admits it; the
ER works offline. The API suite (`emergency.routes.test.ts`, 32) proves the same
ranking with the clock set just after Padma's own stamps, so it cannot depend
on how long the suite has been running.

**Schema, on the owner's ruling (2026-09-21).** 0013 holds one function,
`fn_nearby_hospitals` — geography only; the order is `shared/domain`. 0016
gives `emergency_cases` what the documents needed and 0008 had nowhere to put:
age and sex of an anonymous caller, a `declined` state with its reason, the
ER→ward handoff (`admit_bed_kind`, `admit_requested_at`), `closed_at`, and an
idempotency key. 0016 is numbered past 0014/0015, which keep their names.

**One state machine, two users**, as beds have: `shared/domain/src/emergency/
cases.ts` is the API's guard and the console's optimistic update. Accept means
*the person is here* (a token is given); prepare is "we are ready". A decline or
a cancel happens only before arrival — after it, leaving is a referral. An
action whose outcome is already the case is a replay and is answered as one,
which is how the offline outbox is safe without an event log.

**The ranking** is capability, then fresh before stale (inside the capability
tier), then travel time, load, free beds. Its freshness uses only the figures
it ranks on: the capability and the relevant bed count. **The ICU was in it and
came out** — a full ICU has no action that renews its stamp, so it turned a burn
unit confirmed a minute ago stale ten minutes after any reset. The card shows
the ICU with its own freshness line instead. The first card is headed "best
placed now", never "nearest": the nearer hospital can be the stale one.

**Identity.** The ER's list and every broadcast carry `hasPhone`, never the
number. ফোন করুন fetches it one case at a time and that read writes
`audit_log`. The ward's ER half of the pending list names nobody either; the
ward takes the name at the bed. The caller's position is used for one ETA and
never stored.

**The family's side is polled, not a socket**: `S-A-10c` looks every five
seconds while the answer can change (decision 35 again). A number left with the
alert gets `emergency.acknowledged` / `emergency.declined`, which name the
hospital and never the problem.

**Demo data** (`FR-EMG-03`, `-04`, `FR-DEM-04`). 23 cases across the four ERs
with a coordinator: Jamuna busiest (8 open, one family already on the way and
acknowledged), Shapla 4, Padma 3, Karnaphuli 2, plus discharged cases earlier
today. Two are already handed to the ward (Shapla CCU, Jamuna burn), so the
pending list opens with its ER half. No clinical notes.

**How to show it.** Freshness decays: Padma's burn beds and capabilities are
fresh for ten minutes after a reset. Before the scenario, reset — or open
Padma's ER console and tap **সব ঠিক আছে — নিশ্চিত করুন**, and tap Padma's free
burn bed through a clean on the ward board. Then: console → Padma → জরুরি বিভাগ
খুলুন. Phone (location allowed, or Chrome's sensors set to Farmgate
23.758, 90.39) → জরুরি অবস্থা → জরুরি → দগ্ধ → আমি রওনা দিচ্ছি → জানান ও রওনা
দিন. The console rings; প্রস্তুতি নিন; the phone says হাসপাতাল প্রস্তুত.

**Supabase has this**, as of the 2026-09-22 migrate and reseed described in
the step 16 notes above.

**Found by looking, not by the tests.** The E2E writes the demo session
straight into `sessionStorage`, so it never used the picker — and
`POST /demo/token`'s schema still listed the four step-14 roles. The picker
offered "জরুরি বিভাগ খুলুন" and the route refused it. Fixed, and
`demo.routes.test.ts` now mints a token for every role the picker offers. The
same look found the shared `<Sheet>` sliding *under* the patient app's bottom
navigation (`z-40`), hiding its own primary button — step 14's bed-request
sheet had the same defect unseen. Fixed once, in `shared/ui`.

### Step 14 — the ward board, and what the public is shown

**The definition of done is a comparison, and the E2E makes it.**
`ward-board.spec.ts` opens the ward board in one browser context and the
patient's bed search in another, and holds `<CapacityMirror>`'s published
figure and the phone's count to the same number before and after an admit.
The API suite does the same arithmetically: the board's own tally
(`tallyByKind` in `shared/domain`) equals the view's row, kind by kind.

**Schema.** 0008 creates all seven tables DATABASE.md §7 names for it —
`emergency_cases` and `referrals` are schema for steps 15–16, as 0007 was for
the lab. 0012 holds one view, `v_public_hospital_capacity`; the other `v_*`
views read tables later steps create, and a shipped migration is never edited,
so each arrives with its own step. The columns DATABASE.md §2.5 lacked are now
in it, each with the control that needed it.

**One state machine, two users.** `shared/domain/src/beds/board.ts` is the
API's guard and the console's optimistic update, the way the reducer is the
queue's. A discharged bed goes to *cleaning* and a person frees it — no timer
frees a bed nobody has looked at. A lapsed hold counts as free everywhere at
once; the logged `RELEASE` (by nobody) is written when the board or the pending
list is next read, and a bed about to be acted on is swept first. No scheduler
was needed.

**A hold is a real bed.** Holding a request reserves a bed of the kind asked
for, so the public count knows about the promise. `release` refuses a bed held
for a request — answer the request instead, so the family is told.

**Names are read on purpose.** Tiles, broadcasts and the board response carry
no patient. The bed panel and `LIST-B06-PENDING` do, each read writes
`audit_log`, and both need the connection: a copy cached on a shared ward
computer would be a read nobody logged.

**Offline** (`FR-OFF-01`, the owner's choice of full writes): a separate bed
outbox in `shared/client`, because the queue's is built around one session's
batch and each bed route is replay-safe on its own. Oldest first; a refused
action is dropped and rolled back; an unreachable one holds back everything
after it. The mirror shows "the board says N — the app still shows M" while an
admit is queued.

**Bed requests.** `POST /bed-requests` is public like a guest booking, returns
a signed status token (the `bed_request` audience on the guest-link secret),
and the phone keeps it — no SMS is sent until the hospital answers. Hold and
decline go out as `bed.request_held` / `bed.request_declined`. The status page
counts a hold down in minutes and says "expired" the moment it runs out.

**Demo data** (`FR-DEM-04`). 29 wards and 170 beds at the four facilities with
ward staff; the diagnostic centre and the clinic have none and the app says "no
inpatient beds", not "0 free". ICU at exactly Shapla, Padma and Karnaphuli
(Buriganga lost its ICU on the owner's ruling); burn units at Padma and Jamuna.
137 admissions (134 occupied beds, 3 just discharged into cleaning), four
pending requests (one held, at Shapla's cabins). Staged for the emergency
scenario: Padma's ICU full, one fresh free burn bed at Padma, two free burn beds
at Jamuna that nobody has confirmed for hours. The commit that added the seed
(`6626c87`) says 180 beds; 170 is the count.

**Freshness decays, and that is the point.** A kind's stamp is its newest bed
event. With the default ten-minute threshold, every ward turns amber ten minutes
after a reset unless someone touches the board. Before showing the burn
scenario, reset or tap a Padma burn bed.

**How to show it.** Console → pick Shapla → বেড বোর্ড খুলুন. Admit into a free
general bed at the desk; the mirror's general row drops by one, and a phone on
`/beds?kind=general` shows the same number on its next read. For a request:
phone → বেড অনুরোধ করুন → the ward's pending list → বেড রাখুন → a bed → a
duration; the phone's status page counts down.

**Supabase has this**, as of the 2026-09-22 migrate and reseed described in
the step 16 notes above — 0008 and 0012 had sat unapplied since this step was
built, which is why the deployed console had no ward board for two steps
without anybody noticing.

### Step 13 — the wallet, and consent

**The wallet is this device's, like the serials tab.** There are no accounts
(`CLAUDE.md` §4.1), so `S-A-12` opens every tracking link the phone holds and
shows the signed record each one carries (`FR-GST-08`). A link has four
outcomes — a record, booked-but-not-seen, expired, no answer — and each is
counted and said separately. A failed request is never shown as "no records".
When Supabase Auth lands, the page becomes one call to
`GET /patients/:id/records`, which already exists and already refuses
everybody it should.

**Consent is a handshake.** The phone asks for a code (`BTN-A12-QR`), states
the scope and the grant's length *before* showing it, and the doctor console
redeems it (`BTN-B05-SCAN`, `POST /consents/qr`). Redeeming writes the
`consents` row and its `audit_log` row together; opening the history writes
another. The patient's access log (`BTN-A12-ACCESS`) lists each hospital with
its state as a word, a revoke on the live ones, and every staff read.
Revocation is a timestamp (`DB-P2`).

**The code is pasted, not scanned** — see open decision 28. Between two
windows on one laptop it copies and pastes; between two phones it does not
travel, which is the one place the demo is weaker than the requirement.

**A guest can speak for their own booking's patient, under `DEMO_MODE` only**
— open decision 27. Without it nothing on the patient side can offer consent
or read an access log, because nothing on the patient side has an account.

**The route is `/consents/qr`, as `BACKEND.md` §7.6 names it.** The first
commit on this branch served it at `/consents/redeem`; the document wins
(`CLAUDE.md` §2), so it was renamed. §7.6 had no row for minting the code or
for the access log, and now has both.

**The console card clears when the patient changes.** It is keyed on the
booking in the chamber, so a consented history is never on screen when the
next person walks in — a wrong allergy history is worse than none.

**No consent or audit rows are seeded.** Every seeded patient is unreachable
from a phone (no `guest_links` are seeded, for the reason under *How to open
the live serial screen*), so seeded grants would appear on no screen. The
wallet fills during the demo itself: book, let the doctor sign, and the record
is there (`PRD.md` §24 step 6).

**How to show it.** Book on the phone, sign on the doctor console, open রেকর্ড.
Then কোড দেখান, copy it into the doctor console's code field, and রেকর্ড
খুলুন. Back on the phone, কে দেখেছে shows the hospital and the reads, and
অনুমতি বন্ধ করুন ends it.

### Step 12 — the doctor console and the visit record

**Migration 0007 landed behind 0010, and that is fine.** The runner applies
whatever a database has not seen, in filename order, so a fresh build runs
0007 before 0010 and an existing one runs it after. The dependency runs the
other way: 0010 deliberately left `feedback` out *because* its foreign key
needs `visits`, and 0007 creates both. 0007 also creates `medicines`,
`prescriptions`, `prescription_items`, `test_orders`, `reports`,
`patient_documents` and `consents` — the set `DATABASE.md` §7 names — so steps
13 and 17 are screens rather than schema.

**Prescribing is out of scope, not deferred.** The owner dropped it on
2026-09-19 ("no need for e prescriptions"). `FR-DOC-04`, `FR-DOC-05` and
`FR-DOC-07` are marked **not in this version** in `PRD.md` §9, `PRD.md` §24
step 6 and §26 P2 are rewritten, and `APP_FLOW.md` B2 now says which of its
controls exist. What a consultation produces is a visit record — diagnosis,
Bangla advice, follow-up date — which is what the wallet reads at step 13.

**`BTN-B05-SIGN` writes the record, then advances the queue.** In that order,
because `APP_FLOW.md` B2 fixes the failure mode: if the record does not save,
the consultation is not marked done and the draft stays on screen. The two are
not one transaction — `callNext` owns its own lock and dispatches notifications
after committing — so the window is *record committed, queue not yet advanced*,
and a second tap recovers it because `upsertVisit` is idempotent on the booking
and keeps the original `signed_at`. The recoverable order was chosen over the
atomic one deliberately; the alternative loses a record.

**Picking "doctor" in the console picker now opens the doctor console.** It
always opened reception before, whatever was chosen, which made that button a
lie. `DemoSession` carries the role; unrecognised roles land on reception,
because `hospital_admin` is `S-B-10` at step 19 and a blank screen would be
worse than a queue.

**`useReceptionQueue` is now `useSessionQueue`**, because both consoles use it.
Same socket, same reducer, same offline log — which is what makes `FR-QUE-53`
hold: the doctor's *next* and reception's *next* serialise against each other
only because both screens read the same state from the same place.

**Demo data in the same branch.** 500 signed visit records, each with a
diagnosis and Bangla advice *paired to the complaint the booking already
carried* (`assessmentFor` in `seeds/data/reference.ts`), a ten-medicine
formulary, and pre-visit intake — duration, chronic conditions, current
medicines, allergies — on every seeded booking. `FR-DOC-03` puts all four on the
doctor's screen, and the panel distinguishes *none declared* from *nobody asked*
because those are different facts.

### The patient app is an app now (`feat/app-shell`)

Two things the owner asked for directly, in one branch.

**Discovery asks for a hospital first.** `APP_FLOW.md` titles `S-A-07`
"Specialty results (**hospitals offering it**)" and the code asked for a doctor
straight after the specialty. The flow is now specialty → hospital (`S-A-07`) →
doctor (`S-A-05h`) → session → confirm, which is both what the document said and
what he asked for. Two endpoints carry it:

- `GET /hospitals?specialty=CARD` — only hospitals that offer the department,
  each card carrying the doctor count for *that* department, how many chambers
  are running now, and how many serials are still open today. Without a
  `specialty` the doctor count is null, because a count across every department
  answers a question nobody asked.
- `GET /hospitals/:id/doctors?specialty=CARD` — new. What a hospital card opens
  onto. Ordered by who is in a chamber now, then by who sits next; a doctor with
  no upcoming chamber sorts last rather than being hidden.

Both responses carry an `asOf` the server stamps, and both lists render
`<FreshnessLine>`: "who is sitting now" is a live figure and `FR-PAT-14` does
not let one on screen without its age.

**The shell.** `NAV-A` (four tabs, labels always visible per `ICO-03`, safe-area
inset), a web manifest, a service worker, and `S-A-02` Home composed to the
canvas order — emergency, then care, then convenience. The service worker
**never answers an API request from a cache**: a serial from a cache is a number
with no age (`FR-OFF-03`). It caches the shell only, so the app opens on a bad
connection and shows its own offline state rather than the browser's error page.

**`S-A-09` My serials lists this device's bookings, not an account's**, and says
so on screen. There are no accounts (`CLAUDE.md` §4.1), so a guest's identity is
one tracking link per booking; `APP_FLOW.md` A1.5 already accepts that
multi-device access for a guest is "only via the SMS link". `lib/bookings.ts`
holds the records in `localStorage`, tokens included — the token is already in an
SMS on the same phone, is scoped to one booking, and expires. When Supabase Auth
lands, that file becomes a call to `GET /me/bookings`.

**Three tabs lead to screens that are not built** — profile (`S-A-19`), ambulance
and blood (step 17). Records was one until step 13, beds until step 14 and
emergency until step 15. Each says what will be there and why it is not, rather than being
hidden, greyed out, or a dead link. Hiding them would move the bar as the
product grows and teach the wrong muscle memory.

**The emergency screen is `S-A-10` since step 15** (see step 15 above). The
999 call is still its first control, as it was when that was all the screen
could honestly offer.

**A failed list no longer borrows the empty list's words.** The two discovery
lists used to render "no hospital offers this department" when the request had
simply failed. That is a statement about the world standing in for a statement
about us, which `PRD.md` §3.2 forbids; there is now a distinct `failed` state
with a retry (`Loadable<T>` in `frontend/patient/src/lib/types.ts`).

### How to open the live serial screen

There is no way to reach `S-A-08` except through a booking, and that is
correct: the route in is the SMS tracking link (`FR-GST-05`), which is what
`PRD.md` §24 step 1 demonstrates. Book on any session at
`http://localhost:3000/book?specialty=CARD`, then tap **লাইভ সিরিয়াল দেখুন** on
the success screen. The URL it opens is `/s?b=<bookingId>&t=<token>`.

No `guest_links` row is seeded, deliberately: the token is only ever returned
once, so seeding one would mean printing a live credential into the seed
output, which CLAUDE.md §7 forbids.

**`ui` is a fourth vitest project**, on jsdom. It is separate from `unit` so a
developer working on the queue reducer never pays for a DOM, and separate from
`api` so it never needs a database. It asserts behaviour and accessibility —
roles, labels, focus order, keyboard handling, an axe pass per component — not
appearance: Tailwind classes are inert strings under jsdom, so the visual layer
is proven from the token values instead, by `tokens.test.ts` and
`contrast.test.ts`.

**Socket.IO is wired** (`socket.io` 4.8.3, added with the owner's permission).
`realtime/server.ts` is the only file that imports it; everything else
publishes through the one-method interface in `realtime/emit.ts`, which still
records instead of sending until `attachRealtime` runs — so the queue tests
need no port. The handshake reuses the HTTP `verifyToken`/`toPrincipal`, the
resume-from-seq path is implemented (`SY-01`), and `realtime.test.ts` binds a
real port and proves a subscribed client is told within the `NFR-01` budget.

**Supabase holds the seeded demo data** as of the end of step 5: 6 hospitals,
40 doctors, 200 patients, 1,181 bookings, 1,221 queue events, and one
cardiology session sitting mid-queue. It is visible in the table editor, which
is the first output of this build anyone can look at.

---

## Environments

Three, with different jobs. Getting these confused is the main way to lose an
afternoon.

| | Used for | `DATABASE_URL` |
| --- | --- | --- |
| Local container | **running the test suite** | `localhost:5432/healthcare_dev` |
| Supabase | **development and the demo** | session pooler, `…pooler.supabase.com:5432/postgres` |
| Render | later, from step 6 | set in Render's dashboard |

- **`pnpm dev:api` needs no Docker.** It reads `.env`, which points at Supabase.
- **`pnpm test` does need Docker** (`docker compose up -d`). The suite drops and
  recreates schemas, so it must never touch a shared database; `DATABASE_URL_TEST`
  stays on localhost and the guard in `database/scripts/lib/env.ts` refuses otherwise.
- Supabase project region is `ap-southeast-1` (Singapore), closest to Dhaka.
- **The container carries three databases**, and the two test ones are separate
  on purpose: `healthcare_dev`, `healthcare_test` (schema suite) and
  `healthcare_api_test` (API suite). Both test databases are seeded from
  `database/seeds` by their global setup, so every test runs against real demo
  data (CLAUDE.md §6) — but the API suite *mutates* it, appending to a log that
  cannot be cleaned up, while the schema suite asserts on exact counts of the
  seeded set. Sharing one made each suite's result depend on which vitest
  started first. If your container predates this, recreate it:
  `docker compose down -v && docker compose up -d`.

### Things learned the hard way, so they are not relearned

- **A green `db:migrate` on a database that is already ahead proves nothing.**
  `0009_money.sql` references `ambulance_requests`, which `0011` creates — and
  on a fresh database the runner applies files in filename order, so 0009 runs
  first and fails. The local development database already had 0011, so it
  applied cleanly there and only the test suite's build-from-scratch caught
  it. **Numbering a migration backwards into the sequence needs a fresh
  build to verify**, not an incremental one.

- **A seed that reads what another seed wrote has to run after it, and the
  file name does not tell you the order.** Payments written inside
  `seed_04_history` covered 367 bookings out of 919: seed_04 runs before
  `seed_05_beds` and `seed_07_demo_live`, so the pitch session's own bookings
  had none. `seed_08_money` runs last.

- **A repository read inside a transaction must use the transaction.** A
  `findDetail` on the pool while its caller held a transaction took a second
  connection; five concurrent requests then exhausted a five-connection pool
  and deadlocked. It was invisible until a test fired five identical requests
  at once. Anywhere a service calls a repository between `withTransaction`'s
  braces, the `trx` has to be passed.

- **`express.json()` consumes the stream before any route sees it.** A route
  that mounts its own `text()` parser to read raw bytes finds nothing, and a
  signature check over an empty string fails every genuine callback *and*
  every forged one — so nothing looks wrong. The raw body is captured by the
  JSON parser's own `verify` hook (`config/rawBody.ts`).

- **A CORS allow-list is a bug only a browser can see.** `PUT` was missing
  from `ALLOWED_METHODS`, so `PUT /hospitals/:id/pharmacy-stock` and
  `PUT /hospitals/:id/capabilities` could not be sent from any page — the
  preflight answers 204, the browser refuses on its own, and nothing
  server-side logs anything because the request never arrives. Every unit and
  API test passed, because supertest is not a browser. `app.test.ts` now reads
  the verbs off the mounted router stack and asserts each is allowed.
  **`ALLOWED_HEADERS` has the same shape** and no such test yet: a route that
  starts requiring a new request header will fail the same silent way.

- **`pnpm typecheck | grep error` reports nothing useful.** pnpm's recursive
  runner drops the compiler's output when the stream is piped, so a grep comes
  back empty on a failing run. **Check the exit code**, or run `npx tsc
  --noEmit` in the package. Four real console errors were missed this way in
  step 17, including a `FRONTEND.md` §5.1 violation.

- **A disabled button has to carry its reason** (`FRONTEND.md` §5.1), and
  `ButtonProps` enforces it as a discriminated union — which means
  `disabled={busy || offline}` does not compile, exactly when a screen most
  wants a boolean. `ActionButton` in the console takes `reason: string | null`
  instead: a string turns the button off and becomes its accessible
  description, null leaves it live.

- **`format()` takes `(key, locale, values)`**, not a pre-resolved string.
  `format(t('key', locale), {…})` typechecks as far as the argument count and
  then fails on it; it is an easy shape to get wrong because `t()` alone reads
  naturally in the same position.

- **Use Supabase's session pooler (port 5432), not the transaction pooler
  (6543)**, even though the dashboard labels the latter `DATABASE_URL`.
  Transaction pooling does not carry a session-level `search_path`, and the
  extensions live in their own schema.
- **Percent-encode the database password.** Supabase generates passwords
  containing `%` and `&`; `%Pz` reads as a percent-escape, not three characters.
- **Extensions live in an `extensions` schema, not `public`** (migration 0001),
  matching Supabase's convention so both environments have one layout. Every
  connection must therefore carry `-c search_path=public,extensions`; there is
  one definition, `PG_CONNECTION_OPTIONS`, used by every connection factory.
- **A remote database needs `ALLOW_REMOTE_DB=1`**, and a destructive operation
  on one additionally needs `ALLOW_DESTRUCTIVE_DB=1`. The guard decides on the
  host, never the database name — every Supabase database is called `postgres`.
- **Vitest loads `.env` into `process.env`.** The API test setup therefore
  assigns its environment outright rather than defaulting it, or the suite runs
  against whatever `.env` happens to say.
- **A migration written in a step is not a migration the demo has.** Nothing
  applies migrations to Supabase but a person running `db:migrate` against it,
  and the guard means that person has to mean it. 0008 and 0012 were written
  in step 14 and were still unapplied when step 16 finished — so for two whole
  steps the deployed console could not have shown a ward board, and every
  local suite stayed green because they all run against the container. At the
  end of a step, either migrate the remote or write down that it is behind.
- **`pnpm test` is not the whole gate; `pnpm verify` is.** `format:check` sits
  in `verify` and in CI, not in `test`, so a step that runs the Definition of
  Done's three commands (`CLAUDE.md` §5.2) never sees it. It had been red for
  several steps before `chore/format-clean`, on files belonging to no step in
  particular — which is exactly how it stayed red. Run `pnpm verify` before
  calling a branch done.
- **`.prettierignore` said `db/migrations/`, a directory this repository has
  never had.** The migrations live in `database/`. Nothing broke, because
  Prettier ships no SQL parser and skipped them anyway — an ignore rule that
  matches nothing is silent in both directions, so it went four months without
  being noticed. Corrected on `chore/format-clean`.
- **`next-env.d.ts` is generated, and each command writes it differently.**
  `next dev` points it at `.next/dev/types`, `next build` at `.next/types`, so
  while it was tracked it appeared as a modification in `git status` after
  every dev run and every build, belonging to nobody and blocking
  `format:check`. It is now in `.gitignore` and `.prettierignore`. Both apps
  typecheck on a clean clone without it (tested with `.next` removed as well,
  which is what CI sees — CI typechecks before anything builds).
- **The api project's files cannot run in parallel, and the failure looks like
  a bug in the newest step.** They share one database and go through the API,
  so nothing can be rolled back around them; two files asserting on the same
  hospital's counts interfere, and the one that is newer gets the blame. It is
  `maxWorkers: 1` on that project in `vitest.config.ts` — not
  `fileParallelism: false`, which vitest applies to the whole run. Any new api
  test that reads a per-hospital total is safe because of that line; a test
  that needs its own hospital is still the better shape.
- **So does anything that imports the API, and that caught Playwright too.**
  `backend/api/src/env.ts` merges `.env` into `process.env` as an *import side
  effect*. `e2e/support/console.ts` imports `signToken` from the API, and ESM
  evaluates imports before the importing module's body — so its
  `process.env['DATABASE_URL'] ?? localhost` line read a `DATABASE_URL` that
  `.env` had already set to **Supabase**, while `globalSetup` and the app
  servers stayed on the local container. The suite ran split across two
  databases and every spec failed looking for a row that was seeded in the
  other one. The E2E suite therefore no longer reads the ambient
  `DATABASE_URL` at all: `e2e/support/database.ts` resolves `E2E_DATABASE_URL`
  (defaulting to the container) and `assertLocalDatabase()` refuses a non-local
  host unless `E2E_ALLOW_REMOTE_DATABASE=true`. `playwright.config.ts`,
  `globalSetup` and the fixtures all import that one value, so they cannot
  disagree again.
- **`shared/ui` was never in the Tailwind build, and the symptom was not an
  unstyled app.** Tailwind v4 detects sources from the directory of the
  stylesheet that imported it and skips `node_modules`; an app resolves
  `@platform/ui/styles.css` through the workspace symlink, so detection fell
  back to the app's own `src`. Every class used *only* inside a design-system
  component was dropped. Because apps happen to use many of the same classes,
  the result was a **half-applied** stylesheet rather than a missing one —
  `bg-surface` worked, `inset-x-0 bottom-0` did not, and the bottom sheet
  rendered shrink-wrapped at its static position off the bottom of the
  viewport. Fixed with `@source "./**/*.{ts,tsx}"` in `styles.css`. Any new
  package that ships classes needs the same line.
- **A Tailwind class that does not exist fails silently.** `min-h-touch` was
  written in ten places across `shared/ui` and both apps and was never a
  utility, so the 44 px minimum `FR-LOC-04` and `A11Y-07` require was simply
  absent — buttons were 27 px tall. It is now an `@utility` in `styles.css`.
  So were `duration-instant`, `duration-quick` and `duration-sheet`, which is
  how `prefers-reduced-motion` was meant to zero every transition at once.
  There is no build error for this; only looking at the rendered page finds it.
- **`Intl.DateTimeFormat('bn-BD', { hour, minute })` produces `২:৫৫ PM`.**
  Bengali digits with a Latin day period stuck on the end — exactly the
  half-translated output `FRONTEND.md` §0.2 bans, and a direct violation of
  `I18N-05`. Every clock time now goes through `formatClock` in
  `@platform/i18n`, which picks the Bangla period word (সকাল / দুপুর / বিকাল /
  সন্ধ্যা / রাত) and the numerals together. Nothing formats a time in a
  component.
- **Slicing an ISO string for a clock time shows UTC.** The console rendered
  `plannedStart.slice(11, 16)`, so a chamber running 18:00–21:00 in Dhaka read
  as 12:00–15:00 on the line that says when the session is. Timestamps are UTC
  in the database (`DB-P4`) and are only ever wall-clock after a timezone
  conversion.
- **A date is Dhaka's or it is wrong, and the gap is six hours wide.**
  Postgres `current_date` and `now() AT TIME ZONE 'Asia/Dhaka'` name different
  days between 00:00 and 06:00 in Dhaka, and two separate bugs lived in that
  window — found only because a session happened to run at 01:05 Dhaka.
  - `GET /demo/consoles` filtered sessions on today's Dhaka date, so a chamber
    that opened at 23:50 and was still running at 01:07 offered no console. It
    hit the demo hardest: `FR-DEM-06` builds the pitch session by walking a
    mid-queue log backwards from the present, so a reset in the small hours
    files it under yesterday and the picker then listed nothing running. The
    query now also accepts a session that is *running*, whatever date it
    carries.
  - Three fixtures — `e2e/support/console.ts`, `queueFixture.ts` and
    `seeds/graph.ts` — inserted `session_date = current_date` (UTC) alongside a
    `planned_start` of `now() - 30 minutes`. Every read that filters by day uses
    `toDhakaDate`, so in that window the fixture wrote yesterday and the picker
    asked for today. **The whole E2E suite failed, the canary included**, with
    nothing wrong in the product: 7 passed of 28, every failure a sixty-second
    timeout waiting for a session card the API had correctly excluded. A
    timeout that names the browser and not the date is the worst symptom this
    class of bug has.

  If a session is not appearing and the hour is early in Dhaka, check the date
  before anything else.

- **`next dev` compiles a route on its first visit, and that is not the
  product's latency.** Five or six seconds per page on this machine. A spec
  whose first visit to a route happens inside an expectation spends its
  ten-second budget on webpack: `ward-board.spec.ts` failed twice in step 15
  waiting 10.8 s for `/beds/request`, 6 s of it the document compiling, with
  the page one frame from rendering. `e2e/support/globalSetup.ts` now visits
  every route once before any spec runs (Playwright starts `webServer` before
  `globalSetup`, confirmed in its 1.63 source). **A new page belongs in its
  `ROUTES` list.**

- **A shared test database means exact-count assertions must be scoped.**
  `seeds.test.ts` asserted `SELECT * FROM hospitals` had six rows; the graph
  fixture in `seeds/graph.ts` inserts a seventh, so the test passed or failed
  depending on which file vitest ran first. It now matches on the declared
  names from `DEMO_FACILITIES`. Any new assertion about "how many" needs the
  same scoping.

### Credentials

`.env` is gitignored and has never been tracked in any commit. It holds the
Supabase connection string and three generated dev secrets.

`SUPABASE_SERVICE_ROLE_KEY` is deliberately **not** set, and step 17 did not
change that. The lab's report upload runs on `STORAGE_PROVIDER=mock`, which is
the correct implementation for this version (`CLAUDE.md` §1.1) — the same
standing `SMS_PROVIDER=log` and `PAYMENT_PROVIDER=mock` have. It keeps the
bytes in the API process and serves them through a signed URL of this API's
own, so the whole of `FR-LAB-03` is real end to end; only the disk is not.

`STORAGE_PROVIDER=supabase` is refused without the key, and `mock` is refused
in production, so neither can be reached by accident. Switching is a bucket,
three variables and no code.

---

### Settled: the E2E rows that had been written to Supabase

Because of the `.env` import-side-effect bug above, every `pnpm test:e2e` run
before it was found created its fixture rows **on Supabase** rather than on the
container: one session per test (`room = 'E2E'`), its bookings, and the queue
events the specs appended. It was demo data throughout — no real patient data
was ever involved (`FR-SEC-08`) — but `queue_events` is append-only, so those
rows could not be deleted one by one.

**Measured, 2026-09-19:** 32 sessions (`room = 'E2E'`), 146 bookings and 64
queue events, all created between 05:17 and 05:29 UTC — the three diagnostic
runs during which the bug was found, and nothing older.

**Cleared, 2026-09-22.** The owner authorised the migrate and reseed described
in the step 16 notes, and `pnpm db:reset` is the supported path (`FR-DEM-06`):
it truncated the demo database and rebuilt it, so the stray rows went with
everything else. The scoped alternative — deleting only the E2E rows, which
needs `trg_queue_events_no_mutate` lifted inside the transaction — was never
run and is not needed.

```bash
# What was run, and what any future remote reset looks like.
ALLOW_REMOTE_DB=1 ALLOW_DESTRUCTIVE_DB=1 pnpm db:reset
```

The bug itself is fixed and cannot recur: the suite refuses any non-local
database.

---

## Open decisions

Each is implemented one way and flagged rather than settled silently, and
needs an owner's ruling. Number 7 is recorded as settled because the answer
changed the tree; 8, 9, 12 and 59 are settled too — closed, and not to be
raised. 12 and 59 are the refund policy and its demo percentages, ruled on
2026-09-23: the demo refund is the deliverable and payment specifics are not
to be put in front of the owner again. They are grouped by the step that
raised them, so the numbering is not contiguous in the file.

1. **`FR-QUE-20` grace period.** "2 patients or 15 minutes, whichever is longer"
   is implemented as the longer of *two patients' time at the current rate* and
   fifteen minutes. Read instead as a count of calls it deadlocks: the absent
   patient is at the front, so nobody else can be called, so the count never
   rises. See `graceWindowMinutes` in `shared/domain/src/queue/rules.ts`.
2. **`EVT-BOOKING_CREATED`** appears in `APP_FLOW.md` §A4 but not in
   `DATABASE.md` §1 or `FR-QUE-03`. The queue is built as
   `seed + events => state` instead; see the header of
   `shared/domain/src/queue/state.ts`.
3. **RLS is enabled in the migration that creates each table**, not deferred to
   `0014_rls.sql`. An enabled table with no policy denies all access, so this
   fails safe in the meantime; 0014 still adds the policies.
4. **`hospitals.settings_id` is not created.** `hospital_settings.hospital_id`
   is already the primary and foreign key, so the reverse link `DATABASE.md`
   §2.2 lists would be a second source of truth for one relationship.

Raised while building the seeds (step 5):

5. **A national role has no home facility.** `staff_users.hospital_id` and
   `staff_roles.hospital_id` are both NOT NULL, but `FR-ROLE-01` says every
   role is hospital-scoped *except* the platform and government ones. The seeds
   therefore write no `platform_admin` and no `gov_viewer` rather than invent a
   facility for them. Steps 19 and 20 need this answered — either those columns
   become nullable, or those roles live somewhere else.
6. **`db:reset` truncates; migration 0006's comment says it drops the schema.**
   The comment predates Supabase, where dropping `public` would take Supabase's
   own objects with it. `DATABASE.md` §7 ("truncate + reseed in one command")
   is the authority and is what `reset.ts` does. The comment cannot be edited —
   a shipped migration never is, and the checksum would stop `db:migrate`. A
   later migration could carry a corrected `COMMENT ON`.
7. ~~**Repo layout.**~~ **Settled and done** (`chore/repo-layout`). The tree is
   now `frontend/` + `backend/` + `shared/` + `database/`, divided by where the
   code runs. `shared/` exists because `shared/domain` is imported unchanged by
   both the API and the console, and that import is the mechanism behind
   `FR-QUE-05` — it belongs to neither side. `BACKEND.md` §1 was updated in the
   same branch, and the layering rules now also forbid `frontend/` importing
   `backend/` or `database/`.

10. **Which typeface.** The design canvas (`FRONTEND.md` §0.4) pairs Hind
   Siliguri for body with Noto Serif Bengali for display. `FRONTEND.md` §2.1
   mandates one superfamily, Anek Bangla, self-hosted, with Hind Siliguri only
   as a fallback. The document stands until ruled otherwise, so step 7 builds
   tokens on Anek Bangla — but the canvas's serif display carries the hero
   numeral well, and switching later is a token change, not a rewrite.

11. **`--warn-700` is AA, not the AAA `FRONTEND.md` §1.3 claimed.** The table
   said 7.9:1; the §1.1 hex `#6B4A10` actually yields 6.97:1, missing AAA by
   three hundredths. §1.3 has been corrected to the computed values (three of
   its five ratios were wrong). Notably `#63420D` produces *exactly* 7.9:1,
   which suggests that was the intended token and the hex in §1.1 is simply
   lighter than meant — but changing a brand colour is the owner's call, so the
   documented hex stands and `contrast.test.ts` asserts the AA result plus a
   deliberate "does not yet clear AAA" case that will fail the moment anyone
   darkens it. Caution text is legible either way.

Raised while building the live serial screen (step 10):

12. ~~**`hospital_settings.refund_policy` has no defined shape.**~~
   **Settled at step 18.** The shape is `shared/domain/src/payments/refund.ts`
   and `DATABASE.md` §2.2 documents it: `cutoffHours`, a percentage before and
   after it, and whether the platform fee comes back. Four demo facilities
   have terms and two deliberately do not, so the "hospital will decide" path
   stays demonstrable. Closed — see decision 59.

13. **Nothing reissues a freed serial.** Cancelling releases the number —
   `bookings_session_serial_key` excludes cancelled rows — but `nextSerial`
   still allocates `max + 1`, so the gap is never filled. `FR-QUE-30` gives the
   slot to a standby patient through `offerFreedSlot`, which is not built;
   until it is, a cancelled serial is simply skipped. That is the safe
   behaviour for now — nobody should silently inherit somebody else's number.
   This said "needs deciding at step 15"; step 15 is the emergency console and
   has nothing to do with slot offers. It belongs with `offerFreedSlot` and the
   no-show recovery flow (`FR-QUE-30`, `no-show-recovery.spec.ts`), whose
   figure is step 19.

Raised while building notifications (step 11):

14. **What one SMS costs.** `POISHA_PER_SEGMENT` is 35 in `adapters/sms.ts`, a
   placeholder until an aggregator quotes a rate. It is recorded per message so
   `FR-NOT-06`'s delivery reporting has something to sum, and every figure the
   admin dashboard shows at step 19 is built on it.

15. **Quiet hours are 22:00–07:00 Dhaka**, chosen because no document names
   them. Nothing is suppressed by them today — `FR-NOT-07` exempts queue events
   and every message this version sends is one — so the first template outside
   the `queue.*`, `booking.*` and `session.*` namespaces is when the hours
   start mattering.

Raised while building the app shell (`feat/app-shell`):

16. **`S-A-07` is missing its filters and its search.** The document gives it
   `CHIP-A07-NEAR`/`-WAIT`/`-FEE`/`-OPEN` and `INP-A07-SEARCH` (`FR-PAT-15`),
   and the hospital card is specified to carry distance, travel time, live wait,
   free beds and ICU as well. What is built is the list, the doctor count, who
   is sitting now, serials open today, and freshness. Distance already works
   when a position is passed (`?lat=&lng=`) but nothing asks for one, because
   `S-A-01` location permission is not built. Free beds and ICU, each with
   their own age, joined the card at step 14.

17. **`S-A-05h` exists only as its ডাক্তার tab, inside the booking flow.** The
   document gives it four tabs (ডাক্তার / বেড / টেস্ট / জরুরি), a header of
   bed, ICU and ER-wait stats, and `BTN-A05H-DIRECTIONS` and `-CALL`. There is
   no standalone hospital detail route; a hospital card goes straight to the
   doctor list as a step of `/book`. The বেড tab's content is `S-A-11` (step 14);
   টেস্ট is step 17 and জরুরি step 15.
   `S-A-06d` Doctor detail is likewise skipped — a doctor row goes straight to
   the session picker, which the document allows as `BTN-A05H-BOOK-<doctorId>`'s
   "fast path".

18. **The area on Home is the string `ঢাকা`.** `MOD-A02-AREA` is an area picker
   and there is no location flow, so the header states where the demo's
   facilities actually are rather than leaving the line blank. It is true, and
   it is not a picker.

19. **`BTN-A02-SPEC-ALL`** (সব বিভাগ দেখুন → `S-A-07b` full specialty list) is
   not built, because Home renders every seeded specialty and there is nothing
   left to expand to. It matters the moment the specialty list outgrows one
   screen.

20. **`frontend/` has no vitest project**, so `lib/bookings.ts` — the
   device-local booking store, which has real logic in its date bucketing and
   its pruning — has no unit test. Its behaviour is covered end to end by
   `app-shell.spec.ts` instead. Adding a fourth project pattern
   (`frontend/*/src/**/*.test.ts`) is a config decision worth making
   deliberately rather than in passing.

21. **The PWA icons are SVG only.** `manifest.webmanifest` declares `any` and
   `maskable` SVGs. Chrome on Android installs from those; some older Android
   webviews want a raster 192 and 512, and iOS ignores the manifest icons
   entirely in favour of `apple-touch-icon`, which is currently the same SVG.
   Nobody has installed it on a real handset yet — that is the next thing to
   check on a phone, not in a test.

22. **The service worker's cache is versioned by hand** (`SHELL = 'shell-v1'` in
   `public/sw.js`). Nothing bumps it automatically, and `activate` deletes every
   cache that is not the current name. A stale shell after a deploy is fixed by
   bumping that string; forgetting to is how a deploy appears not to land.

Raised while building the doctor console (step 12):

23. **Nothing joins a console account to a `doctors` row, so `FR-DOC-10` is
   enforced at hospital grain.** A doctor signs in as a `staff_users` row
   carrying the `doctor` role; "their own sessions" is `sessions.doctor_id`,
   which references `doctors`. `DATABASE.md` §2.2 gives `doctors.user_id` as
   "the doctor's own login" — a reference to `users`, which the seeds leave null
   because authentication is deferred (`CLAUDE.md` §4.1). So the individual
   identity the requirement names cannot be checked.

   What is enforced instead: a doctor-role account may read a record only if
   that patient has been booked into a chamber **at their hospital**, or if a
   live consent covers it. A consultant at Shapla cannot open the record of
   somebody who has only ever attended Padma. It is weaker in one specific way —
   a cardiologist at Shapla can read the record of a patient who saw the
   orthopaedist there. Closing that needs a `staff_users ↔ doctors` link, which
   is a schema decision and therefore the owner's. `treatedAtHospital` in
   `clinical.repo.ts` carries the same explanation at the call site.

24. **`MOD-A07-INTAKE` was never built.** `APP_FLOW.md` A4 specifies 4–6
   pre-visit questions — duration, main symptom, chronic conditions, current
   medicines, allergies — and step 9 collects only a reason. `FR-DOC-03` puts
   all of them on the doctor's screen, so the seeds now write them and the panel
   reads them, but **a booking made through the app today carries only the
   complaint**. The doctor's screen says "the patient answered nothing
   beforehand" for those, which is true and is the honest state — but the modal
   is a real gap in step 9 and the panel gets materially better the day it
   lands.

25. **`FR-DOC-09` earnings are the chamber fee times patients seen.** The fee is
   not in the queue state and should not be — the state is the event log reduced
   and a fee is not an event — so the console fetches it once per session from
   the roster, where `DB-P5` already copied it onto every booking. It is absent
   rather than zero when the roster is empty. What it does *not* account for is
   whether anybody actually paid; `payments` is step 18, and until then this is
   "billed", not "collected". The label says আদায় (collected), which will need
   revisiting at step 18.

26. **`visits.follow_up_date` is checked against `created_at`, not `now()`.** A
   check constraint cannot call `now()` and stay immutable, so
   `visits_follow_up_not_past` compares the follow-up to the row's own creation
   date in Dhaka. The effect is right for new rows and means a very old draft
   could be signed with a follow-up that is now in the past. Nothing does that
   today.

Raised while building the wallet (step 13):

27. **A guest may offer consent, read the access log and revoke — under
   `DEMO_MODE` only**, for the patient their own booking names
   (`assertSpeaksFor` in `consent.service`). It is the same kind of affordance
   as the console picker (`CLAUDE.md` §4.1) and is gated the same way, but it is
   a real escalation: a tracking link otherwise reaches one booking's record,
   and consent gives a hospital standing access to the whole history. With
   `DEMO_MODE` off a guest is refused all three, which a test pins. Needs the
   owner's yes or no; if no, the consent half of the wallet is unreachable in
   this version.

28. **`FR-PAT-63` says QR, and the build shows a code.** Drawing a QR needs an
   encoder (e.g. `qrcode`) and scanning one needs a camera pipeline
   (`BarcodeDetector` is native on Android Chrome but not on desktop Chrome, so
   a fallback such as `@zxing/browser` would be needed). Both are new
   dependencies (`CLAUDE.md` §7). The capability is identical and only
   `BTN-A12-QR` and `BTN-B05-SCAN` would change. The code is a signed token, hundreds
   of characters long, which is why it cannot be read aloud and why a QR is the
   real fix.

29. **Durations nobody documented.** A code lives three minutes
   (`CONSENT_OFFER_TTL_SECONDS`) and a grant twenty-four hours
   (`CONSENT_TTL_HOURS`). A grant is always hospital-scoped, never
   doctor-scoped, for the same reason as decision 23: nothing joins a console
   account to a `doctors` row.

Raised while building the bed board (step 14):

30. **Bed-request answers ignore quiet hours.** `FR-NOT-07` exempts emergency
   and queue events; nothing says a bed request's answer is either. It is
   exempt anyway (`ALWAYS_OVERRIDES_QUIET_HOURS` gains `bed`): a hold is
   measured in minutes, and a "your bed is held until 11:30 PM" text deferred
   to seven the next morning is a bed lost without being told.

31. **`bed.request_result` became two keys**, `bed.request_held` and
   `bed.request_declined`. One body with the outcome passed in would put copy
   outside the template table. BACKEND.md §8 is updated.

32. **Freshness means "the ward last told us something about this kind of
   bed".** There is no "the board is still right" action, so a ward whose beds
   genuinely have not changed in an hour looks stale. That is honest but may be
   harsh on a quiet ward; a confirm-the-board heartbeat would be a product
   decision (and a new event type).

33. **Inpatients share the two hundred seeded patients** (`FR-DEM-03`). Nearly
   all of them hold a serial today, so some inpatients also sit in today's OPD
   queues — the pitch session's patients included. Tiles show no names, so it is
   only visible in the bed panel. The alternative, a second population of
   inpatients, would contradict the count `FR-DEM-03` states.

34. **A bed request needs no OTP** — `FR-GST-03` is deferred with the rest of
   authentication. The request is rate-limited by nothing but one open request
   per patient per hospital. Worth a rate limit before a real deployment.

35. **The patient's bed search polls every thirty seconds.** There is no public
   realtime room (the board room is staff-only and sockets require a token), so
   "instantly" (`FR-BED-02`) is true of the published figure and of the ward's
   screen, and within thirty seconds of the phone's. An anonymous read-only
   capacity room would close the gap; it would also be the first
   unauthenticated socket, which is a security decision.

36. **"Two taps at most" (`FR-BED-02`) is counted from the open bed panel.**
   Counting the tile tap too, a discharge is three: tile, action, and the
   confirmation `GR-01` requires. The two requirements cannot both hold
   literally.

37. **Both consoles' offline outboxes live in memory.** `createDexieStore` exists
   and neither console uses it, so a reload with actions queued loses them. The
   reception console has always been this way; the ward board matches it rather
   than being the only one that differs. Wiring Dexie in is a small change for
   both.

38. **Found, not fixed: three freshness lines drop the word "minutes".** The
   reception console, the doctor console and the booking flow's hospital list
   pass a bare number into `updatedAgo`, so they read "হালনাগাদ ৩ আগে". The live
   serial screen and every step-14 screen append মিনিট. Out of this step's
   scope; a one-line `fix/` branch each.

Raised while building the emergency console (step 15). The first three were
ruled on before building (schema, the critical/urgent split, problem →
capability); these are the ones that were not:

39. **Travel time is an estimate on placeholder constants.** `TRAVEL_TIME_MODE=
   static` is straight-line distance × 1.4, at 12 km/h in Dhaka's peaks (07–10,
   16–21), 18 km/h between, 28 km/h at night (`adapters/traveltime.ts`). None
   is measured; like `POISHA_PER_SEGMENT`, replacing them changes estimates,
   not code. The patient app labels every figure আনুমানিক. From Farmgate at
   16:44 Dhaka, Padma reads "আনুমানিক ৮৮ মিনিট" — plausible for Uttara at rush
   hour, but a number nobody checked.

40. **The search radius is 50 km** (`EMERGENCY_SEARCH_RADIUS_METRES`): Dhaka
   and its ring. No document names one.

41. **"ER wait" is shown as the ER's load, not minutes.** `FR-PAT-44` and
   `CARD-A10` ask for emergency wait; nothing measures one, so the card says
   how many people the ER has now (`FR-EMG-04`'s counter) rather than invent a
   wait.

42. **Only facilities with an ER console are listed.** Buriganga Clinic has an
   emergency phone but no emergency coordinator, so it does not appear — "I'm
   on my way" there would ring nobody while telling the family it had.

43. **Emergency SMS ignore the monthly SMS budget**, as they already ignore
   quiet hours (`FR-NOT-07`): "this hospital cannot take you" is not a message
   to save one SMS on. Found alongside it and not changed:
   `smsSentThisMonth` only counts messages tied to a booking, so step 14's bed
   answers were never counted against the budget either.

44. **"I'm on my way" is rate-limited to ten per address per ten minutes.**
   An anonymous route that rings an ER invites pranks; the number is a guess.
   The same limiter is keyed on `req.path`, which is fine here (no path
   parameter) but see the known gap about it.

45. **An ER admission needs a phone number at the ward desk.** The ward's
   admit form requires one (it finds or creates the guest identity by it), so
   an unconscious patient with nobody's number cannot be admitted through it.
   The ER's own case needs nothing; the stay does. A real gap for a real ER.

46. **`in_treatment` is never used.** Nothing in `APP_FLOW.md` B4 separates
   "being seen" from "here", so an accepted case is `arrived` until it is
   admitted, discharged or referred (step 16 closes a referred case; nothing
   yet moves one to `in_treatment`).

47. **Blood stock (`FR-EMG-06`, `INP-B07-BLOOD`) is not built.** No table in
   DATABASE.md holds a hospital's blood by group. 0011 landed with step 17
   and has `blood_donors` and `blood_requests` — neither of which is an
   inventory — so the ER console's blood input is still waiting on a table
   (or a column set) that the documents do not yet name.

48. **A family's case link lives 24 hours** (`emergency_case` token audience).
   An emergency is over in hours; a token that outlived the night would make a
   stranger's alert readable from an old SMS.

Raised while building referrals (step 16). The four the schema needed — the
nullable capability with a bed kind beside it, `arrived_case_id`, who holds
the person until arrival, and the decline list staying a suggestion — were put
to the owner and ruled on (2026-09-22) before 0017 was written, and are
recorded in the step 16 notes above. These are the ones that were not:

49. **A referral's note is capped at 500 characters and is the only free text
   in it.** `FR-EMG-08` says "patient summary" and names no limit. Long enough
   for "diabetic, on anticoagulants, family says two hours of chest pain",
   short enough that nobody keeps a case file in it — a second hospital's
   coordinator reads this on a busy screen. The seeds write no note at all.

50. **Today's referrals only.** The ER console's right column shows the open
   ones plus today's closed, on the Dhaka day the rest of the console uses.
   Nothing in `APP_FLOW.md` B4 says how far back the list reaches, and an ER
   coordinator's screen is about this shift; a referral from Tuesday belongs in
   a report nobody has asked for yet.

51. **A withdrawal needs no reason, a decline does.** `FR-EMG-09` requires the
   reason on a decline (the sender must know whether to try elsewhere). The
   sender's withdrawal tells the receiver only that it is off, behind a
   `GR-01` confirmation naming the hospital — usually because the family went
   somewhere else, which is not the receiver's business.

52. **`BTN-B07-REFER-CANCEL` is not in `APP_FLOW.md`'s original table.** With
   one open referral per case and no withdrawal, a receiving ER that never
   answers would strand the case forever. The control is added to B4 rather
   than the rule relaxed.

Raised while building the lab (step 17):

53. **`FR-PHR-01` follows prescribing out of this version.** Implemented as
   *not built*, with the screen saying why. The alternative was to seed demo
   prescriptions so a QR had something to scan — which would demonstrate a
   flow no doctor in the demo can start, and the owner dropped `FR-DOC-04`
   deliberately. Flagged in `PRD.md` §12 and `APP_FLOW.md` B5. **Say the word
   if the pitch wants the dispensing screen demonstrable anyway**; it is a
   seed and a screen, not a schema.

54. **What a test costs.** `DEMO_TEST_CATALOGUE` prices twelve common tests in
   poisha (CBC 450 taka, ECHO 2,500, and so on). These are the demo hospital's
   list prices, the same standing `seed_02`'s doctor fees have, and they exist
   so a `test_orders` row carries a number for `FR-ADM-04`. Not commercial
   content (`CLAUDE.md` §1.1) — a real hospital's catalogue arrives with its
   agreement — but somebody should glance at them before a pitch.

55. **Twelve hours is how long a stock flag stands.** No document names a
   threshold and `hospital_settings` has no column for one. A bed's ten
   minutes would paint the whole shelf unknown by mid-morning; twelve hours
   means a morning check stands all day and yesterday's does not. Changing it
   is one constant in `shared/domain/src/lab/stock.ts`.

56. **Turnaround is measured ordered-to-ready, not sample-to-ready.** The
   second is the interval a lab would rather be judged on; the first is what
   the patient waited, and `PRD.md` §3.2 cuts that way. Worth confirming
   before the admin dashboard (step 19) puts the figure in front of a
   hospital director.

Raised while building the money (step 18):

57. **What "doctor absence" is.** `FR-PAY-07` names it and no document
   defines it. Implemented as: the session ended and no `DOCTOR_ARRIVED` was
   ever appended. A session the doctor did attend but did not finish is
   recorded as `session_ended` instead — those patients are equally owed, and
   the distinction keeps an administrator from being told a doctor was absent
   when they were not. Both refund in full.

58. **A refund is raised as eligibility, and paid separately.** Ending a
   session marks everybody owed in one statement; each refund is then its own
   provider call. The alternative — refunding inside the session's end — makes
   ending a chamber fail when a gateway is slow, which is the worse failure.
   Nothing yet sweeps the eligible rows and pays them: that is a worker, and
   `pg-boss` is still not installed. **An administrator refunds them from the
   endpoint in the meantime**, and `payments_refund_pending_idx` is the list.

59. ~~**The demo refund percentages.**~~ **Settled, and not to be raised.**
   Shapla 100/50 at twelve hours, Padma 100/25 at twenty-four, Jamuna full
   either way, Meghna 80/0, and two facilities with none. These stand. The
   owner's ruling (2026-09-23): this is the pitch version, the demo refund is
   the deliverable, and payment specifics are not something to put in front of
   him. Do not ask about them again.

60. **A settlement is dated by the session, not by when the money cleared.**
   A payment that settled at midnight belongs to the chamber it paid for. That
   is what a hospital reconciles against, and it is the opposite of what an
   accountant might expect; step 19's dashboard will surface the same figures
   and should agree.

Two were the owner's, and both are **settled — closed on 2026-09-22 and not to
be raised again**, in a session or in a report. They were repository
visibility and credential rotation. The owner knows the facts and the
trade-offs, has decided, and asked directly that neither be brought up again.
They are recorded here as closed only so that a fresh session does not
rediscover them and start the conversation over; nothing about either is
outstanding, and nothing about either needs mentioning.

---

## Deploying

`docs/DEPLOY.md` is the runbook: Supabase, then Render, then two Vercel
projects. Three things in it are the ones people get wrong, so they are worth
repeating here:

- **`NODE_ENV=development` on the deployed API, deliberately.** `env.ts`
  refuses to boot with `DEMO_MODE=true` under `NODE_ENV=production`, and that
  guard is right — production means real patients. A pitch demo is not
  production. `TRUST_PROXY_HOPS=1` now carries the one thing `NODE_ENV` used to
  control that matters behind a load balancer.
- **`WEB_BASE_URL` is not cosmetic.** It is half the CORS allowlist *and* the
  origin every booking's tracking link is built from. Wrong, and every SMS in
  the demo points at localhost.
- **Supabase's session pooler, port 5432**, with the password percent-encoded.

**The console has a way in now.** `ConsolePicker` is `S-B-01` standing in for
the login this version does not have (`CLAUDE.md` §4.1): pick a hospital, a
chamber and a role, no password, and the screen says so. Before it, opening the
console meant pasting a token into `sessionStorage` by hand — fine on the
machine that built it, impossible to hand to anybody. `GET /demo/consoles` and
`POST /demo/token` back it, both refused unless `DEMO_MODE` is on.

The token now lives in one place, `console.demo-session`. It used to be written
under that key and read from `console.token`, which was two stores for one
credential.

---

## Running the pitch demo

Two devices, or two browser windows, which is what `two-device-queue.spec.ts`
automates.

```bash
docker compose up -d                 # Postgres
DATABASE_URL=…healthcare_dev pnpm db:reset
pnpm dev:api                         # :4000
pnpm dev:console                     # :3100  — reception
pnpm dev:patient                     # :3000  — the patient
```

1. **Patient**: `http://localhost:3000` — the home screen, with the emergency
   card, the specialty grid and the bottom navigation. Tap a specialty, then
   **the hospital**, then the doctor, then the chamber; fill in name / phone /
   age and confirm. The success screen shows the serial and **লাইভ সিরিয়াল
   দেখুন** — tap it.
2. **Reception**: `http://localhost:3100`. The console picker (`S-B-01`) opens
   first: choose the hospital, the chamber and the role, no password. There is
   no login screen by design (CLAUDE.md §4.1) and the screen says so. Pick the
   session the booking was made on. The token it mints is stored under
   `console.demo-session`; `e2e/support/console.ts` shows how one is minted
   without the UI.
3. Tap **পরবর্তী রোগী ডাকুন**. The patient's "এখন চলছে" changes within two
   seconds, the progress track advances, and the ETA moves.

The patient's serial is also on **সিরিয়াল** in the bottom navigation and on the
home screen's live strip, both of which read what this device booked.

4. **The doctor's screen** (`S-B-05`): open a second console tab, pick the same
   hospital and chamber but the **ডাক্তার** role. It opens on whoever is in the
   chamber with their pre-visit answers and past visits. Type a diagnosis, tap
   **রেকর্ড দিন ও পরবর্তী** — the record is filed and the next patient is called
   in the same action (`FR-DOC-08`), which reception's tab sees immediately.

That is `PRD.md` §24 step 6, minus the prescription the owner removed from this
version.

The patient screen also carries **আমি দেরি করছি** and **বাতিল করুন**, both of
which write real events the console sees.

**Next is pinned to `--webpack`.** The shared packages import with the `.js`
extensions Node ESM requires; webpack resolves those through `extensionAlias`
and Turbopack has no equivalent. Worth revisiting when it gains one —
Turbopack is substantially faster and this is the only thing holding it off.

---

## Known gaps, deliberate

- **`OtpInput` has no caller.** It is named in step 7's component list and is
  built, but every OTP *flow* is deferred to Supabase Auth (`CLAUDE.md` §4.1),
  so nothing renders it yet. It holds no credential and calls no endpoint — it
  is the input primitive, and Supabase's flow will need exactly this box.

- **One signature component (`FRONTEND.md` §6) remains.** `<FreshnessLine>`,
  `<QueueTable>`, `<LiveSerialCard>`, `<BedTile>` and `<CapacityMirror>` are
  built and rendering; `<DelaySheet>` lands with the delay flow it belongs to —
  see the next item.

- **Tailwind is v4 and compiles in both apps.** The v3-style JS preset was
  replaced by `@theme inline` in `shared/ui/src/styles.css`, which maps every
  utility onto the token variables and clears Tailwind's own palette
  (`--color-*: initial`), so `bg-indigo-500` does not exist. `--radius-*`,
  `--font-*` and `--duration-*` sit in `@theme` rather than `tokens.css`
  because those are Tailwind's own namespaces, and `min-h-touch` is an
  `@utility` because Tailwind has no such thing. The `@source` line at the top
  is load-bearing — see the note under "things learned the hard way".

- **No authentication is implemented, by decision** (`CLAUDE.md` §4.1). Under
  `DEMO_MODE=true` the console selects a hospital and role without a password,
  and a booking returns a signed guest tracking link. Requirements not covered
  in this version: `FR-PAT-01`, `FR-PAT-04`, `FR-GST-03/04/09/12`, `FR-SEC-05`,
  `FR-SEC-06`.
- ~~**`FR-DEM-05` is not covered.**~~ **Covered as of step 17.** Migration
  0011 landed and `seed_06_ancillary` runs: eight ambulances, thirty blood
  donors, fifty pharmacy items. **No seed module is waiting on a migration any
  more**, so every `FR-DEM-*` requirement is rows rather than a skip notice.
- ~~**`seed_04_history` defers prescriptions and reports.**~~ Reports landed
  with step 17, so `FR-DEM-03` is covered in full. Prescriptions are not
  deferred but **dropped** (`FR-DOC-04`), so there is nothing left waiting.
- **Today's sessions other than the pitch one are left `scheduled`.** If a
  reset happens late at night, an 18:00 chamber that has already passed still
  shows as scheduled with no events. That is honest — nothing was recorded —
  but it is a wart for a late demo. The pitch session itself is always built
  backwards from the current instant, so it is correctly mid-queue at any hour.
- **`pg-boss` is not installed, so there is no worker process.** Every message
  step 11 sends is caused by an event, so it is raised from the event and needs
  no scheduler — which is more accurate than a 60-second poll, not merely
  cheaper. Two jobs in `BACKEND.md` §8 genuinely need a timer and are therefore
  absent: `queue.leaveNow` (`FR-PAT-32` as a *notification*; the patient screen
  already shows the banner) and `notify.retry` (the log provider never fails).
  `backend/workers/src/index.ts` is still a stub. The outbox is built for this:
  a failed send is a `queued` or `failed` row under a partial index, so adding
  the worker is a subscriber, not a redesign.

- **`notifications` has no `booking_id` column**, because DATABASE.md §2.7 does
  not give it one. The booking travels in `params ->> 'bookingId'`, which is
  what the delivery queries and the send-once dedupe match on. A column would
  be better and needs a document change to justify.

- **Push is recorded as skipped for everybody.** Web Push needs VAPID keys, a
  service worker and a `device_tokens` row, and none of the three exists yet —
  no screen asks for notification permission. So `FR-NOT-02` ("app users get
  push + SMS; non-app users get SMS only") is already *correct* rather than
  stubbed: today every patient is a non-app user, and the adapter says so with
  `no_device_token` rather than pretending.

- **Reschedule is not built, so `<DelaySheet>` is not either.** `BTN-A08-RESCHEDULE`
  and `POST /bookings/:id/reschedule` need `S-A-07b` in reschedule mode, which
  is its own flow; step 10's contents in `CLAUDE.md` §4 name late and cancel.
  `FR-PAT-34`'s one-tap keep/reschedule/cancel therefore waits for it. What
  *is* built is the patient's side of a declared delay: `session.delayed`
  reaches the screen, the surface shifts to the warn family and the status line
  states the minutes, which `two-device-queue.spec.ts` asserts. The button is
  absent rather than present and dead.

- **The console has no delay control.** `BTN-B02-DELAY` and `MOD-B02-DELAY` are
  named in `APP_FLOW.md` B1.2 but were not built in step 8, so
  `two-device-queue.spec.ts` raises the delay through `POST /sessions/:id/delay`
  with a staff token — see `queueAction` in `e2e/support/console.ts`. The
  endpoint and the broadcast are real; only the button is missing. Worth adding
  before the pitch, since `PRD.md` §24 step 3 has a person tapping it.

- **`rateLimit` keys on `req.path`, which makes it useless on a path
  parameter.** The key is `${method}:${path}:${keyFor(req)}`, so
  `/guest/link/:token` would get one bucket per token and never trigger.
  Nothing relies on it there — a tracking token is 32 random bytes, so guessing
  is not the threat — but the next parameterised route that wants a limit needs
  `rateLimit` changed first.

- **Notifications are not published from the queue service.** Step 11 of
  `BACKEND.md` §4.1 fires the called / delayed / two-away / slot-offered
  messages; that is build step 11. The seam is marked in `queue.service.ts` and
  the events that would fire one are already identified by `isMaterialEvent` in
  the domain, so it is a call to add rather than a decision to make.
- **`/sync/*` is not built** (`BACKEND.md` §5). The offline batch endpoints
  belong with the console that fills the batch, in step 8. The domain already
  has `applyBatch`, which returns the accepted/conflict split `SY-05` describes.
- **`middleware/audit.ts` is not written.** `audit_log` is migration 0010 and
  the schema is at 0006, so it would have no table to write to. It lands with
  the migration.
- **`backend/api` has no production build script.** Internal packages are consumed
  from TypeScript source, so a deployable build needs either emitted output from
  `shared/domain` or a bundler. That is a dependency decision for the owner,
  and it blocks the Render deploy at step 6.
- **Four of the five required Playwright specs exist** (`CLAUDE.md` §6), plus
  `lab-report.spec.ts` from step 17:
  `two-device-queue.spec.ts` — the canary, five tests — plus
  `guest-booking.spec.ts`, now complete including "open the SMS link, see the
  live serial", `offline-console.spec.ts`, and `emergency-burn.spec.ts`
  (step 15). Still to write: `no-show-recovery.spec.ts` (its recovery figure is
  step 19).
- ~~**Five files fail `prettier --check` on `mvp`.**~~ Fixed by
  `chore/format-clean` before step 17; `pnpm verify` is green.
- **`<EmergencyEntry>` does not preload on pointer-down** (FRONTEND.md §6.3).
  The results screen asks for location and searches on arrival; preloading
  would need the position first, which is the slow part.
- **bKash and Nagad are not implemented.** `PAYMENT_PROVIDER=mock` is the
  working provider and the correct one for this version (`CLAUDE.md` §1.1);
  `live` selects an adapter that refuses every charge with a named reason
  rather than a client that throws the moment a patient taps pay. Both
  provider files carry the call sequence, the response that actually means
  the money moved, and the one thing that bites — see the step 18 notes. Nagad
  has no refund in its checkout API, which is written into `nagad.ts` where
  whoever implements it will read it.

- **Nothing charges for a bed, a test or an ambulance.** `payments` has the
  columns because DATABASE.md §2.6 specifies them, and none of those three has
  a price anybody has agreed: a nightly rate, a catalogue price and a quoted
  fare are commercial terms per hospital (`CLAUDE.md` §1.1). Charging for them
  needs those terms, not more code — `payment.service` refuses anything but a
  booking and says so.

- **`subscriptions` and `invoices` are empty tables.** Nothing generates an
  invoice, because there is no agreement to invoice against. The shape is
  there so that when there is one, it is a service and not a migration.

- **`/webhooks/sms-dlr` is not built.** BACKEND.md §7.7 lists it beside the
  payment callbacks; it belongs to notifications and `SMS_PROVIDER=log` has no
  delivery receipts to send. It arrives with a real aggregator.

- **A refunded platform fee is approximated in the settlement.** `payments`
  records one refunded total rather than splitting it by line, so the fee
  retained is capped at what the patient did not get back — exact at both ends
  and an approximation in between. A `platform_fee_refunded_poisha` column
  would make it exact. It does not matter while `PLATFORM_FEE_POISHA` is 0.

- **`FR-PHR-01` (dispensing) is not built**, because prescribing is not.
  `S-B-09` names the missing half on screen rather than showing a scanner that
  cannot work; `PRD.md` §12 and `APP_FLOW.md` B5 were edited to say so. It
  becomes buildable the day `FR-DOC-04` does, and needs no schema: the
  `prescriptions` and `prescription_items` tables are already there.

- **`S-A-13` (diagnostics booking) is not built**, so `FR-LAB-01`'s "and app
  bookings" half is uncovered. It is a catalogue-plus-payment flow and payment
  is step 18. Nothing blocks it: `test_orders.visit_id` is nullable and the
  seed already writes walk-in orders through that path.

- **`lab.report_ready` reaches nobody in this version.** `BACKEND.md` §8 maps
  it to **push only**, which is a defensible product call — a report is not a
  summons, and it is in the wallet before the message is written. But no
  screen asks for notification permission yet, so every push is recorded as
  `skipped: no_device_token`. The row is written and says so; the delivery
  `FR-LAB-03` actually promises has already happened. Worth the owner's word
  on whether a report deserves an SMS, which would be a `BACKEND.md` §8 edit.

- **The test catalogue is declared twice**, in `lab.service.ts` and in
  `seed_04_history.ts`. `database/seeds` may not import from `backend/api`
  (the layering rule), and a catalogue is demo data in both places. They are
  held to the same codes by test rather than by a shared module; a real
  hospital's catalogue is a table, and that is the right time to merge them.

- **The mock store keeps report files in process memory**, so restarting
  `pnpm dev:api` loses anything uploaded during a demo. Seeded reports survive,
  because those are synthesised on read. `STORAGE_PROVIDER=supabase` is
  required in production and the env refuses `mock` there.

- **`frontend/site` is still empty.** `shared/client`, `frontend/console` and
  `frontend/patient` are built.
