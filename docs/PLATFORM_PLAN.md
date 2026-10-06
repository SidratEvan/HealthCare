# Platform plan

What gets built after the handover audit, in what order, and what has to be
decided first. Written 2 October 2026 from the owner's implementation brief of
the same day, `docs/HANDOVER.md`, and the code on `mvp` at `87d3dd2`.

- **Authority:** none over the five documents (`CLAUDE.md` §2). This file is
  the order of work. Where a phase adds scope, its first branch adds the
  requirements to `PRD.md` and the other documents, and the code follows them.
- **Kept current:** the progress table in §9 is updated as each branch merges.
- **What is active:** §2, *Now: the V1 pitch build* (owner, 5 October, evening).
  It replaced the client-readiness freeze of that morning, which is kept below
  it, marked superseded, for what it records.
  `docs/STATUS.md` still carries what changed and what is undecided.

---

## 1. The direction, in ten lines

1. One platform, two sides: hospitals run their patient-facing services on it,
   patients reach every participating hospital through one identity.
2. A hospital should be able to arrive, create its organisation, set itself up
   or import what it already holds, be verified, and go live, without the
   founders building each onboarding by hand.
3. Three setup paths, always available together: manual setup, the template
   CSV import, and an import where the hospital's own export is mapped onto the
   template for it.
4. The only AI in scope is that mapping. It reads column names and shapes and
   proposes; a person confirms; the existing importer checks and writes.
   Nothing clinical, no chatbot, no scoring of staff or doctors.
5. Real patient data stays in Bangladesh. No patient row goes to a model
   outside it.
6. The platform sits beside a hospital's HMS. It does not become one.
7. Marks is the first hospital, set up by hand where needed, on generic code.
   Nothing is written for Marks alone.
8. The queue engine, the importer's safeguards and staff sign-in are kept as
   they are. No rewrite.
9. The verified pilot blockers are fixed before anything new is built.
10. Nothing is called production-ready because it exists or passes on demo
    data.

---

## 2. Order of work

### Now: the V1 pitch build (owner, 5 October, evening)

After reading an audit of the code against a clarified product direction, the
owner lifted the freeze below and set the direction that `CLAUDE.md` §1.2 and
§4.4 and `PRD.md` §4.2b now carry. In short:

- **One platform**: a multi-hospital patient app, a private portal per
  hospital, and later an optional hospital-branded patient app on the same
  API.
- **One shared deployment hosted in Bangladesh is the default.** A hospital on
  its own server is an exception, not the design (conflict C in §6 is
  decided).
- **Build until the pitch-ready V1 experience is complete, then stop adding
  scope.** The pitch is the whole platform, not a reception pilot.
- **Providers do not block it**: SMS, bKash, Nagad, the stores and a paid
  penetration test follow company registration and agreements.
- **Tenant isolation in the database (1.10) blocks the second real hospital,
  not the pitch.**

One branch at a time, each gated at the level `CLAUDE.md` §6 gives it, no
approval waited for between them.

| # | Branch | What it does | Gate | Done when |
|---|---|---|---|---|
| V0 | `chore/v1-direction` | The direction in `CLAUDE.md`, `PRD.md` (§4.2b, `FR-PAT-16`–`19`, `FR-IMP-13`–`22`, §14c `FR-ONB`, `FR-NET`, `FR-BRD`, `FR-SEC-07` amended, `FR-SEC-11`), this plan, `STATUS.md`, `BACKEND.md` §12, `DEPLOY.md` | Documents | A new session reads the new direction and not the freeze |
| V1.1 | `fix/patient-v1-surface` | Nothing unfinished on show: ambulance and blood leave the patient app's first screen and its routes say nothing is promised (`PRD.md` §7.8) | Focused | No control on the patient app leads to "not built yet" |
| V2.1 | `feat/patient-search` | `GET /search` and `S-A-07s`: free text over doctors, hospitals and specialties, and the needs hospitals publish (specialty, bed kind, capability); results are hospitals with the live figures for that need, and doctors. The first screen is rebuilt around it (`FR-PAT-16`–`18`) | Focused, plus the API tests for the new route | A patient types or taps a need and sees which hospitals can provide it, with ages, and reaches booking from there |
| V2.2 | `feat/hospital-scope` | The branded-app foundation, and no more: a scope the patient app passes on every discovery call, patient links built in one place, the API's allowed origins as a list (`FR-PAT-19`, `FR-BRD-02`–`04`) | Strict for the origin and link change; focused for the app | The same build opened with a hospital's code shows that hospital only |
| V3.1 | `feat/org-lifecycle` | A workspace's state (migration), its rules in `shared/domain`, every public read gated on active, the checklist and "request review" on `S-B-11` (`FR-ONB-02`–`04`, `FR-NET-03`) | Strict | A hospital that is not approved appears nowhere public, proven per public route |
| V3.2 | `feat/platform-console` | `S-B-12`: workspaces and their state, create one with its first administrator, approve or send back, suspend and reinstate, verify doctors; a platform administrator made without touching a hospital (`FR-ONB-01`, `05`–`08`) | Strict | A hospital goes from nothing to live on synthetic data with no command line after the deployment's first platform administrator |
| V4.1 | `feat/import-mapping` | Upload a hospital's own CSV; profile, header guard, rules and aliases in both languages, the mapping screen, saved mappings, hand-off to the existing check (`FR-IMP-13`–`15`, `18`–`20`) | Strict | A deliberately mismatched synthetic export is mapped and imported with no model |
| V4.2 | `feat/import-mapping-ai` | The model adapter on top (`MAPPING_PROVIDER`, off by default): proposals with confidence and reason, typed, validated, never trusted (`FR-IMP-16`, `17`) | Strict for what is sent; focused for the screen | The same file is mapped with the model's help; with it off or failing V4.1's path is unchanged |
| V4.3 | `feat/import-warnings` | Near-duplicate patients and mixed formats named before the preview (`FR-IMP-21`) | Focused | Only if V5 has room; otherwise after the pitch |
| V5.x | `fix/pitch-*` | The product walked as each role; what is confusing is fixed, one small branch per finding. Reschedule only if it is cheap; otherwise it leaves `PRD.md` §24 | Focused | Each role's path reads as one product |
| V6 | `chore/pitch-release` | `pnpm verify`, `pnpm build`, every browser suite, once; the migrations Supabase lacks applied; `mvp` → `main`; demo data reset; `demo` moved | Full | The public demo is the current product |

**Then stop adding scope.** What follows the pitch is in the order a real
deployment needs it:

| Before | Branch |
|---|---|
| A second real hospital on the shared deployment | 1.10 `feat/tenant-rls`, and the doctor's read of another hospital's visits (`FR-SEC-11`) |
| Patients on a real deployment | 2.1 `feat/notification-worker`, 2.2 `feat/sms-live` (waits for an account), 1.9f `fix/serial-past-midnight` |
| The ward board or the ER console in a real hospital | 1.9d, 1.9e; 1.9c with a slow SMS gateway |
| A store listing | a native shell, push, account deletion, privacy and terms pages |

**Decisions this build makes without asking, and where they are recorded:**
the smallest lifecycle that fits a hospital created by a platform
administrator (three working states, §3); the model is called over HTTPS with
no SDK and is off unless configured (§4); hospital-aware links and origins are
prepared, not switched on.

### Superseded: client-readiness mode (owner, 5 October, morning)

**Lifted by the owner the same evening** (above). Kept because the
reception-pilot candidate and its conditions are still true of a
single-hospital deployment: `fb1d1d8` is still the commit that was tested for
one, and P5 still waits for a hospital's IT. What no longer holds: the
freeze, "reception only" as the goal, and one server per hospital as the
default.

The priority is signing a hospital pilot, not finishing this plan. **Feature
work is frozen**: no new product features, no self-service onboarding, no AI
import, no network architecture, no refactor that a pilot does not need.
Phases 2–4 and rows 1.9c–1.10 below wait.

**The pilot candidate is `fb1d1d8`** (owner, 5 October): P1 to P4, the whole
gate and all three CI jobs. The dry run and any first deployment use that
exact commit (`DEPLOY.md` S8); `main` is not moved for it. **No feature
coding until a hospital agrees to pilot.** What is left is operational:
the hospital's IT says how its server is reached, the dry run is done on
their hardware, and a blocker it finds is fixed alone on a small branch.
When a hospital agrees, the owner gets one short deployment sheet
(`docs/STATUS.md`, *Pilot readiness*).

**The pilot this is for.** One hospital, one department, one to three
chambers, on that hospital's own server and database. Supervised closely.
Pay at the hospital. The hospital's own system keeps running beside it, and
paper is the fallback.

**Scope for week one: reception only** (owner, 5 October).

| In the first week's work | Outside it |
|---|---|
| Staff sign-in; registration at the counter and walk-ins; doctor arrived; call next; done; late; absent; bring back; pause and resume; undo; end chamber; the few figures needed to check the queue against the paper list | The doctor's screen; the ward board; the ER console; the lab; the pharmacy; the patient app and live tracking; SMS; online payment |

**Outside the pilot is not the same as not ready.** Nothing in the right-hand
column is removed, rewritten or re-rated by this. Each module keeps the
rating `HANDOVER.md` §13 gave it (several are "pilot-ready with
supervision"); they are simply not part of the first week at one reception
desk.

**What may be said to a hospital, where it was getting said wrongly:**

- **Import.** The product imports a hospital's data from CSV files in the
  templates already built (sets A–C), checked, previewed, approved and
  undoable, under supervision. What must not be promised yet is a direct
  connection to their HMS or its database, arbitrary Excel files, or an
  import that works out an unknown format by itself.
- **Other modules.** Say they are outside this pilot, not that they do not
  work.

**A — must be done before a staff-side pilot.** Only what could put the
queue in a wrong state, lose data, expose something serious, or make the
pilot unusable.

| # | Branch | Why it is here | Tests |
|---|---|---|---|
| P1 | `fix/console-ack-rollback` | The queue on the counter's screen stepped back to the patient before, and stayed there while the socket was silent. **Merged 5 October** (`becb262`) | In the branch: unit, and a browser test with the socket held silent |
| P2 | `fix/console-demo-banner` | Every console screen says "This is a demonstration. All data here is for display only", whatever the server's mode: the line is drawn unconditionally in ten console components, and in four screens of the patient app, which is deployed in the same stack. Over real patients it is false, and it tells staff their entries do not count. The branch makes the label follow the server on both (owner, 5 October): shown on a demonstration, absent on a real server, and **hidden while the server has not answered**, because the false warning is the dangerous one | Console and patient app, both ways: the demonstration shows it where it did (`FR-DEM-07`); the production configuration shows it nowhere; with the answer withheld it is not shown |
| P3 | `fix/chamber-end-of-day` | Nothing ends a chamber: `POST /sessions/:id/end` exists and no screen calls it, and no job does. The next morning yesterday's chamber is still "running", is listed first on the picker, and the card shows no date or time, so today's walk-ins go into yesterday's queue. **Approved by the owner, 5 October**: `BTN-B02-END` with its confirmation, and the service date and planned start on the picker's cards (`APP_FLOW.md` B1.2, `S-B-01`). Ending a previous day's chamber must leave today's untouched, and the schedule job's next-day chamber must sit beside a chamber that ran late. **It must not strand anybody silently** (`MOD-B02-END`): off while a patient is in the chamber; the count of patients not seen stated in the confirmation, which then needs a deliberate tick; nobody's status changed to tidy up; refund eligibility as it was. **The server refuses an end while a patient is in the chamber** (added by the owner the same day): one guard, the queue's ordinary refusal, nothing written; it is what a second counter with a stale screen is told. Waiting, late and booked patients do not block an end | Domain and API: a patient in the chamber → the end is refused and no `SESSION_ENDED` is written; that patient finished → it succeeds; patients left waiting are still waiting after an end. The end route's auth matrix already exists. Schedule job: tomorrow's chamber is written beside a chamber still running from today, and neither changes. Browser: end a chamber with nobody left; the control is off with its reason while somebody is in the chamber; end one with patients waiting, only after the tick, and they are still waiting in the record; end yesterday's chamber, it leaves the current list, and today's is then chosen and worked; a chamber not dated today says which day it is from |
| P4 | `chore/e2e-pilot-path` | The pilot's own path has never been run in the configuration it will run in. `pnpm test:e2e:prod` drives the canary and the counter on chambers and bookings a fixture made; nothing there signs in, registers a walk-in at the counter and sees them through, and that is the whole of a pilot with no patient app. Whatever it finds is A | Production configuration, built apps, limited database role, one path from end to end: sign in → register a walk-in → doctor arrived → call → done → end chamber → it has left the current list and today's or the next valid chamber is the one chosen. No demonstration line anywhere on the way (P2). A schedule set from settings produces tomorrow's chamber |
| P5 | `chore/deploy-lan-https` — **deferred, not to be built on a guess** (owner, 5 October) | The console needs HTTPS that every counter PC trusts: the service worker and the keys it gives its actions both need a secure context. `DEPLOY.md` covers publicly resolvable names with automatic certificates, and that stays the documented path. The first hospital's IT is asked to choose (`DEPLOY.md`, *Before a pilot*): (1) publicly resolvable HTTPS names, or (2) a server reachable only inside the hospital. If they choose the second, the smallest trusted-certificate design goes to the owner before anything is built | Decided with the design, if there is one |

**Order, and where it stops** (owner, 5 October): P1 merged if its gate is
wholly green; then P2; then P3; then P4; then **stop and report what P4
found**. P5 only once the hospital has said how its server is reached. After
P4 the owner is given one answer, go or no-go for a supervised reception
pilot, listing only what actually blocks it. AI import, self-service
onboarding, ward and ER reconciliation and the rest of this plan do not
resume until that path is green.

**B — after the first pilot.** Everything else, including things that are
imperfect. Four of them move into A the moment the pilot's shape changes:

| Waits | Moves into A if |
|---|---|
| 1.9c `fix/queue-exactly-once` (an action drawn twice while its answer is slower than its broadcast) | a real SMS provider is put behind the adapter while sending is still in the request, or the doctor's delay button is part of the pilot on a slow network. With SMS recorded only, the answer trails the broadcast by milliseconds |
| 1.9d, 1.9e ward and ER reconciliation | the ward board or the ER console is part of the pilot |
| 1.9f `fix/serial-past-midnight`, 2.1, 2.2 (patient side, SMS) | patients are given the app or a tracking link |
| 1.10 `feat/tenant-rls`, and the doctor's read of other hospitals' visits (`HANDOVER.md` §16) | a second hospital is put on the same database |

Also B: alerts when a backup or the API fails (somebody looks each morning
instead); a warning at sign-out when actions are still unsent (an operating
rule instead: nobody changes shift with a pending count showing); names on an
offline reload; undo toasts on the row buttons; ending a signed-out person's
socket; everything in phases 2–4.

### The plan as it stood

One branch per row, off `mvp`, merged back only when `CLAUDE.md` §5 is met.
Every fix carries a test that fails on the old code. Rows marked **waits** need
a decision from §7 first; everything else proceeds.

### Phase 1 — pilot blockers

| # | Branch | What changes | Tests that must fail first | Done when |
|---|---|---|---|---|
| 1.1 | `fix/delay-on-arrival` | A delay declared before the doctor arrives is used up by the arrival; a delay declared after it holds the chamber until that time. The no-show grace cannot end before a hold does (`eta.ts`, `reducer.ts`, `rules.ts`) | Domain: declare 30 minutes, arrive, the first patient's time is now. API: the same through HTTP | Handover §4.9 replayed gives 17:32, not 18:02, and no absent-marking before the time a patient was told |
| 1.2 | `fix/console-resume` | `BTN-B02-PAUSE` becomes resume while paused, key `P`, a paused banner, call-next says why it is refused. The grace clock restarts at resume | E2E: pause, call-next refused, resume, call-next works, the patient's phone shows both | A chamber paused from the console is resumed from the console |
| 1.3 | `fix/console-undo` | Undo removes actions not yet sent, and calls `POST /events/:id/undo` with the real event id for ones already accepted. `/sync/events` returns each accepted event's id. `Ctrl+Z` | E2E: next, undo, the patient is back and the chamber is as it was. API: the sync answer carries event ids | Undo undoes; no junk `ACTION_UNDONE` is written |
| 1.4 | `fix/sync-event-allowlist` | `/sync/events` takes only the actions a counter can queue offline; `ACTION_UNDONE`, `SLOT_*`, `BOOKING_CANCELLED`, `SESSION_ENDED`, `SESSION_OPENED`, `WALKIN_ADDED` are refused there and keep their own routes | API: each refused type returns a conflict and writes nothing | The sync path cannot bypass a dedicated route's rules |
| 1.5 | `fix/offline-outbox-persist` | The three console outboxes (queue, beds, emergency) are kept in IndexedDB. An entry the server can never take stops blocking the ones behind it and is shown as stuck with a way to discard it | Unit: a poison entry does not block. E2E: queue five actions offline, reload, reconnect, all five arrive once | A reload, a crashed tab or a power cut loses nothing queued |
| 1.6 | `feat/console-offline-load` | A service worker for the console caches the shell, so the console opens with no network and shows the last queue it held with its age | E2E: load, go offline, reload, the console opens and queues an action | The console loads offline |
| 1.7 | `chore/ops-hardening` | Self-host: the API connects as a non-superuser role, container logs rotate, the nightly backup is verified and copied to a second location, a health check that reports failure, containers not root where cheap | Script test for the backup check; the compose stack boots with the limited role and `pnpm test` passes against it | `DEPLOY.md` Part S describes what is true |
| 1.8 | `chore/e2e-ci` | CI runs `pnpm build` and the browser suite, the canary first. A second job runs the canary and the reception specs against the production configuration (`DEMO_MODE=false`, production builds) | — | The canary cannot be skipped by forgetting to run it |
| 1.9 | `fix/log-sms-redaction` | The `log` SMS provider stops printing numbers and bodies and stops keeping every message in memory; tracking links are no longer stored in `notifications.params` | API: a sent booking message leaves no link in the table or the log | Handover §12 items 11 and 13 closed |
| 1.10 | `feat/tenant-rls` | Database-level hospital isolation: policies on every hospital-scoped table, keyed on a per-transaction hospital setting, enforced for the API's limited role. Design note first, in the branch | Schema tests: a query without the setting sees nothing; with hospital A's, nothing of B's | A forgotten scope check in a route can no longer leak across hospitals |

1.10 is last in the phase because it rests on 1.7's role, and it comes before
Phase 3 because self-service signup puts many hospitals on one database.

#### Added 5 October — one action, shown once (before 1.10)

Found while verifying 1.9a, and asked for by the owner's review of that day.
The server answers a console's write by two roads, the response and a
broadcast, and the three consoles were each right only when the broadcast
came first and promptly. The contract is `BACKEND.md` `SY-08` and `SY-09` and
`FRONTEND.md` §11.1 (*One action, shown once*), written before any code
(`chore/requirements-5-october`, which also carries the founder's decision
on sessions that cross midnight: `PRD.md` `FR-QUE-06`, `FR-PAT-39`).

The review asked for these before 1.5. **1.5 and 1.6 were already merged on
3 October**, so they were placed before 1.10 instead: the outboxes they fix
are the ones 1.5 put on disk. Later the same day the owner switched to
client-readiness mode (above), and all four now wait until after the first
pilot unless its shape brings one forward. The contract and the founder's
decision stand as written; only the building waits.

| # | Branch | What changes | Tests that must fail first | Done when |
|---|---|---|---|---|
| 1.9c | `fix/queue-exactly-once` | `queue.updated` names the actions it took in (`applied`, bounded to the one write behind it); a subscribing console sends its unanswered keys and the catch-up names those in the log. The console takes an action off its own drawing at the first statement that names it, answer or broadcast, in the redraw that shows the queue containing it. A tap's events are queued and sent as one | Unit: each order of arrival as a sequence, ending in one queue; a tap of two events is never half drawn. API: a broadcast names its actions and nothing older; a catch-up names only the asked keys. E2E: the doctor declares 30 minutes with the answer held and the screen says 30, never 60 (broadcast first); with the socket held (answer first, socket silent); and reconnecting with an action still unanswered | One action is drawn once in every order: tap first, answer first, broadcast first, socket silent, answer slow, reconnect with unanswered actions |
| 1.9d | `fix/ward-reconcile` | A bed carries `version`, raised by a trigger in the statement that changes the row (one migration). Answers, broadcasts and board reads carry it. The ward board keeps the highest version per bed from any road, shows the answer's beds in the redraw that drops its own drawing of the action, and `bed.updated` names the action | Schema: every write path raises the version, and a rolled-back change raises nothing. Unit: version N+1 then N leaves N+1. E2E: socket held silent, admit a patient, the tile settles from the answer and never shows the bed before; and N+1 delivered before N does not step the tile back | The board is right with the socket silent, and no older statement can replace a newer one, in any order |
| 1.9e | `fix/er-reconcile` | The same for the ER console: `version` on an emergency case, the answer used at once, the broadcast names the action. What else that console draws optimistically (capabilities, a walk-in's provisional case) is read and settled in the branch | As 1.9d, on a triage step and a walk-in | As 1.9d, for the ER console |
| 1.9f | `fix/serial-past-midnight` | `FR-QUE-06`, `FR-PAT-39` (founder's decision, 5 October): a booking is current until it is settled or its session ends, whatever the date. Home's strip and My serials ask the server instead of comparing dates; a status that cannot be checked is shown as unknown, never as past. Nothing is copied to the next day | Domain: waiting at 23:59 is current at 00:01; a chamber paused across midnight is current; a session ended after midnight is past; unknown is not past. API or schema: the next day's scheduled chamber is written beside a previous-day chamber still running, and neither is changed. E2E: a chamber dated yesterday and still running keeps its strip; ending it moves the booking to Past | A patient still waiting after midnight still sees their serial |

Hospital and per-person isolation are not touched by any of these: the
outboxes stay one database per signed-in person, a statement is only ever
matched against the console's own keys, and the socket's room rules stand.

### Phase 2 — real patient entry

| # | Branch | What changes | Done when |
|---|---|---|---|
| 2.1 | `feat/notification-worker` | Sending moves out of the request: a worker loop claims unsent rows (`FOR UPDATE SKIP LOCKED`), retries with backoff, and gives up visibly. No new dependency | A failed send is retried and a slow gateway no longer slows a queue tap |
| 2.2 | `feat/sms-live` (pilot step 27) — **waits: D1** | One aggregator behind the existing adapter, delivery reports on `/webhooks/sms-dlr` | A code and a tracking link arrive on a real phone from a non-demo server |

### Phase 3 — self-service onboarding v1

| # | Branch | What changes | Done when |
|---|---|---|---|
| 3.0 | `chore/onboarding-scope` | `PRD.md` §14c (`FR-ONB-*`), `APP_FLOW.md` screens, `DATABASE.md`, `BACKEND.md`. Documents only | The owner has read the requirement list |
| 3.1 | `feat/org-lifecycle` | The onboarding migration (§3), the lifecycle rules in `shared/domain`, discovery and every public read gated on `active`, the entitlement record | An unverified facility appears nowhere public, proven per public route |
| 3.2 | `feat/org-signup` — **waits: D2, D3** | A public registration screen creates a workspace in `draft` and its first administrator, who sets a password there and two-step at first sign-in. Rate-limited | A hospital exists without `pnpm staff:create` |
| 3.3 | `feat/platform-review` | A platform administrator's screen: pending organisations, verify or reject with a note, mark the agreement active, suspend, approve go-live. All audited | Verification and activation happen on a screen |
| 3.4 | `feat/setup-checklist` | `S-B-11`'s status card becomes the checklist: the three setup paths, what is missing, unverified doctors, unconfirmed beds, services not ready, then "request go-live" | Brief §13: a new hospital goes from registration to live on synthetic data with no CLI |

### Phase 4 — mapped import

| # | Branch | What changes | Done when |
|---|---|---|---|
| 4.0 | `chore/mapping-scope` | `PRD.md` §14b additions (`FR-IMP-13` onward), `APP_FLOW.md` `S-B-14`, `BACKEND.md` adapter. Documents only | — |
| 4.1 | `feat/import-mapping` | Upload any CSV; a mapping step between the file and the existing check. Proposals from a local rule set (names, synonyms in both languages, value shapes); the administrator corrects; the result is a template-shaped CSV handed to today's `check`. Approved mappings are saved per hospital and reused. Its migration is in §3 | A deliberately mismatched synthetic CSV is mapped by hand and imported, with no model involved |
| 4.2 | `feat/import-mapping-ai` — **waits: D4, D5** | The model adapter (`MAPPING_PROVIDER`, off by default) proposes the same mapping with a confidence and a plain-language reason per column. Typed, validated, audited, never trusted (§4) | The same file is mapped by the model; with the provider off or failing, 4.1's path still works |
| 4.3 | `feat/import-warnings` | Local checks before the preview: near-duplicate patients flagged (never merged), mixed date and phone formats named with the normalisation proposed | — |

### Later

- **Phase 5 — import usability:** XLSX, better previews, from real exports.
- **Phase 6 — network design:** a written proposal for a hospital data plane
  and a network plane (§6, conflict C). No migration before the owner approves.
- **Phase 7 — commercial automation:** only after the decisions it depends on.

---

## 3. The onboarding state model (proposed, smallest set)

**The onboarding migration — one file, numbered when it is written.** (0034 went to plan 1.7 and 0035 to plan 1.9; 1.10 takes what its policies need.)

```
hospitals
  + lifecycle        org_lifecycle NOT NULL DEFAULT 'draft'
  + registration_no  text            -- licence or registration number, as given
  + verified_at      timestamptz
  + verified_by      uuid → staff_users
  + review_note      text            -- why rejected, suspended or sent back
  CHECK (NOT is_live OR lifecycle = 'active')

org_lifecycle = draft | verification_pending | setup_incomplete
              | ready_for_review | active | suspended | closed

subscriptions.state  + 'trial'       -- the table exists and is empty
```

- The brief lists `verified` as a state between `verification_pending` and
  `setup_incomplete`. It is held as `verified_at` instead: a verified
  workspace is always in one of the later states, and a column cannot disagree
  with the state the way two states can.
- `is_live` stays the one switch every public query already reads. The new
  CHECK means nothing unverified or suspended can be live, whatever a route
  forgets. Existing demo hospitals are backfilled to `active`.
- **Setup progress is not stored.** It is counted from what exists
  (departments, verified doctors, schedules, confirmed beds, staff), which is
  what `S-B-11`'s status card already does. A stored percentage would go stale
  the moment somebody edits a doctor.
- **Entitlement** is the existing `subscriptions` row: which modules are on and
  whether the agreement is `trial`, `active`, `paused` or `cancelled`, set by a
  platform administrator. No plan names and no amounts are written into the
  repository (`CLAUDE.md` §1.1); `monthly_poisha` is whatever the operator
  enters and defaults to 0.

Transitions, all in `shared/domain` with tests, all audited:

```
draft ──submit──▶ verification_pending ──verify──▶ setup_incomplete
                        │ reject (note)                 │ checklist complete
                        ▼                               ▼
                      draft                     ready_for_review
                                                        │ platform approves + entitlement on
                                                        ▼
                               suspended ◀──────────  active  ──▶ closed
                                   └──── reinstate ────▶
```

**The mapping-profiles migration (Phase 4), numbered when it is written.**

```
import_mapping_profiles
  hospital_id, set, header_fingerprint (sha-256 of the normalised header row),
  mapping jsonb, source ('manual' | 'rules' | 'model'),
  approved_by, approved_at
  UNIQUE (hospital_id, set, header_fingerprint)
```

---

## 4. The mapped import: interface and data flow

```
 hospital's CSV (stays on the server; never leaves it)
        │
        ▼
 ┌─────────────────────────────── local, deterministic ─────────────────────┐
 │ 1. parse (existing csv.ts)                                               │
 │ 2. header guard: a first row that looks like data (phones, dates,        │
 │    numbers) is not a header ─▶ stop, ask for the header row              │
 │ 3. profile each column: type class (text / integer / date-like /         │
 │    phone-like / time-like / money-like), fill rate, distinct-count       │
 │    bucket, length range. No cell value is kept in the profile            │
 │ 4. saved profile for this fingerprint? ─▶ use it, skip 5                 │
 │ 5. propose: rules first; the model only for columns the rules could      │
 │    not place, and only when MAPPING_PROVIDER is on                       │
 └───────────────┬──────────────────────────────────────────────────────────┘
                 │ sent to the model, and nothing else:
                 │   · the set being imported and the template's field list
                 │   · the file's column NAMES
                 │   · each column's profile from step 3
                 │   · sample values GENERATED locally from the profile
                 │     ("01XXXXXXXXX", "31/12/2026"), never copied from a row
                 ▼
        model adapter ──▶ { column → field | none, confidence, reason }
                 │ parsed with a zod schema; unknown fields, duplicates and
                 │ anything off-template are dropped, not repaired
                 ▼
 ┌─────────────────────────────── local, deterministic ─────────────────────┐
 │ 6. administrator sees the proposal, corrects it, approves it             │
 │ 7. the approved mapping rewrites the file into the template's shape      │
 │ 8. the existing check ─▶ preview ─▶ approve ─▶ all-or-nothing write,     │
 │    undo. Unchanged.                                                      │
 │ 9. the mapping is saved for that fingerprint; the decision is audited    │
 │    (who, which columns, which source), with no cell values               │
 └──────────────────────────────────────────────────────────────────────────┘
```

```ts
interface MappingProvider {
  /** Never throws into the request: a failure is `{ kind: 'unavailable' }`. */
  propose(input: {
    set: ImportSet;
    fields: readonly { name: string; required: boolean; describes: string }[];
    columns: readonly { name: string; profile: ColumnProfile; samples: readonly string[] }[];
  }): Promise<
    | { kind: 'proposal'; columns: readonly ColumnProposal[] }
    | { kind: 'unavailable'; reason: string }
  >;
}
```

Why the header guard matters: a file with no header row has a patient in its
first line, and "send the column names" would send that patient. Step 2 is
what makes the rule in §1 line 5 true rather than usually true.

Cost: one short call per new export format, none for a format already
approved. The rules alone carry the feature when the provider is off.

---

## 5. What is reused

| For | Existing code |
|---|---|
| Creating a facility and its first administrator | `staffAuth.service.ts` `createFirstAdministrator` (today behind `scripts/createStaff.ts`); the forced password change and two-step from steps 21 and 28 |
| Manual setup | `hospitalSettings.service.ts`, `HospitalSettings.tsx` (`S-B-11`), its status card and `goLive` |
| Verification of doctors | `scripts/verifyDoctor.ts`, `doctors.bmdc_verified_at` (moves onto the platform screen in 3.3) |
| The public gate | `hospitals.is_live`, `hospitals_live_requires_onboarding`, `v_public_hospital_capacity`, `discovery.service.ts` |
| Entitlement | `subscriptions` (0009), empty today |
| Platform administrator | `platform_admin` role, the `national` principal (0024), mandatory two-step |
| Import | `shared/domain/src/imports/{csv,sets}.ts` (`IMPORT_COLUMNS`, `columnIndex`, `readRow`), `import.service.ts` (`check`, `commit`, `undo`, `discard`, `purgeExpired`), `HospitalImport.tsx` (`S-B-14`), `import_batches`, `import_rows`, `external_refs` |
| Value reading for the profile | `readDate`, `readTime`, `latinDigits`, `takaToPoisha`, `normaliseBdMobile` |
| Audit | `audit_log` with `SETTINGS_CHANGE`, as settings and imports write today |
| Offline (Phase 1) | `shared/client/src/offline/store.dexie.ts` (written, never called), `OfflineQueue`, `Outbox`, the patient app's service worker as the pattern |
| The worker (Phase 2) | `jobs.service.ts` (the hourly loop in the API), `notifications` as the outbox |

---

## 6. Where the brief, the code and the documents disagree

| | Conflict | How this plan handles it |
|---|---|---|
| A | `CLAUDE.md` §2 says nothing is built that is not in `PRD.md`. The brief adds onboarding and mapped import, which are not | Each phase opens with a documents-only branch (3.0, 4.0). The owner reads the requirement list before code is written |
| B | `CLAUDE.md` §1.1 keeps plans and prices out of the repository. The brief asks for "plan/package and entitlement state" | Entitlement is modules on or off and an agreement state. No names, no amounts (§3) |
| C | `FR-SEC-07` puts each real hospital on its own server in Bangladesh. Self-service signup, emergency search, referrals and the wallet across hospitals need hospitals on one deployment | **Decided by the owner, 5 October:** one shared platform hosted in Bangladesh is the default, and a hospital's own server is a later exception (`FR-SEC-07` as amended). What that makes necessary before a second real hospital is 1.10 (`FR-SEC-11`) |
| D | The brief says to prefer the handover over an older document where the handover found a mismatch | The documents in handover §14.3 are corrected in the branch that fixes the thing each one is wrong about, so the rule in `CLAUDE.md` §2 keeps holding |
| E | `CLAUDE.md` §7: no new dependency without asking. XLSX needs a parser; a model SDK is a dependency | Phase 4 uses `fetch`, no SDK. XLSX is D4. Phase 1 needs none: Dexie is already installed |
| F | The brief lists tenant policies as a blocker but leaves them out of its Phase 1 list | Added as 1.10 |
| G | Documents are silent on two queue behaviours the fixes touch: what a delay declared after arrival means, and whether the no-show grace runs during a pause | Implemented the way that cannot take a patient's turn: a later delay holds the chamber until then, and the grace restarts at resume. Recorded in `STATUS.md` for a ruling |
| H | Self-service signup needs to reach the registrant, and nothing sends email | The registrant sets the password on the form. Verification is by a person, who contacts the hospital outside the product |

---

## 7. Decisions needed

| | Decision | Recommendation | Blocks |
|---|---|---|---|
| D1 | Which SMS aggregator, and its account, API key and sender ID | Whichever the first hospital can hold an account with itself; the adapter is about a day once there is an API to call | 2.2 only |
| D2 | Signup open to anyone, or by invitation | An open form that creates nothing public, with a rate limit; every workspace waits for a person to verify it | 3.2 |
| D3 | Fields required at registration | Facility name in both languages, kind, division, district, phone, registration number; administrator's name, email, mobile, password. Everything else at setup | 3.2 |
| D4 | ~~CSV only, or XLSX from the first release~~ | **Decided 5 October:** CSV first; a spreadsheet file follows (`FR-IMP-22`) | — |
| D5 | ~~Model provider, where it runs, what is sent~~ | **Built as recommended (V4.2):** what §4 lists and nothing else; `MAPPING_PROVIDER=off` by default; Claude behind the adapter over HTTPS, no SDK. Switching it on needs an API key, which is the owner's to arrange | — |
| D6 | ~~The network architecture for many hospitals~~ | **Decided 5 October:** one shared deployment in Bangladesh | — |
| D7 | Module names for entitlement | The modules the console rail already has | 3.1 |
| D8 | Any change to "real patient data stays in Bangladesh" | None proposed | — |

Phase 1 and branches 2.1, 3.0, 3.1, 4.0 and 4.1 need none of these.

---

## 8. Working rules for these phases

In addition to `CLAUDE.md`:

1. Read `HANDOVER.md` and the code before each phase; where they disagree
   with an older document, say so and fix the document in the same branch.
2. A fix lands with a test that fails without it.
3. Reuse the services, repositories, importer and screens in §5. No parallel
   replacement.
4. Model output is untrusted input: typed, validated, and never written
   without a person's approval and the importer's own check.
5. Mapping decisions and approvals are logged. Patient values and working
   tracking links never are.
6. Synthetic data only, in development, tests and demos.
7. Stop and ask before anything that changes where data lives, who can see a
   patient, how hospitals are isolated, how the system is deployed, or
   clinical scope.
8. At the end of each phase: a short summary for the owner of what changed,
   what is now possible, what is still blocked, and how to show it.

---

## 9. Progress

| # | Branch | State |
|---|---|---|
| — | `chore/platform-plan` | merged — this file |
| 1.1 | `fix/delay-on-arrival` | merged — `QueueState.hold`, `outstandingDelayMinutes`; the patient card and the doctor's header show what is still ahead |
| 1.2 | `fix/console-resume` | merged — one button both ways, key `P`, the paused banner, `QueueState.resumedAt`, `e2e/pause-resume.spec.ts` |
| 1.3 | `fix/console-undo` | merged — event ids in the sync answer, `undo`/`undoLast` in the hook, `Ctrl+Z`, `e2e/console-undo.spec.ts` |
| 1.4 | `fix/sync-event-allowlist` | merged — `OFFLINE_ACTION_ROLES`, `canReplayOffline`, `SY-07`; the console hook can only queue what the server replays |
| 1.4a | `fix/queue-pool-starvation` | merged — not in the handover; found by the gate while verifying 1.5. A queue write needed a second database connection while holding the session lock; with the pool busy it stalled five seconds and failed. Notification reads now use the transaction; `poolStarvation.test.ts` |
| 1.4b | `fix/broadcast-after-commit` | merged — `HANDOVER.md` §12 item 12, brought forward because it was failing a browser test one run in six. `queue.updated` is sent after the commit; a screen that subscribed mid-tap no longer stays on the previous patient, and a failed write tells nobody. `broadcastAfterCommit.test.ts` |
| 1.5 | `fix/offline-outbox-persist` | merged — `openConsoleStores` (IndexedDB, one database per person), stuck entries with send-again and discard, retry with backoff, 401/429 kept rather than dropped |
| 1.6 | `feat/console-offline-load` | merged — the console's service worker, the kept queue (`snapshots`), `pnpm test:e2e:built` against `next build`. Same tab only; no names; reception queue only |
| 1.7 | `chore/ops-hardening` | merged — the API's own database role (`pnpm db:role`, migration 0034), the API suite run as that role, non-root images, log rotation, a backup that is restored, copied and health-checked. The role keeps `BYPASSRLS` until 1.10; nothing alerts yet |
| 1.8 | `chore/e2e-ci` | merged — CI builds, runs the canary first, then the whole browser suite and the built suite; a second job runs the canary and the counter against the production configuration (`pnpm test:e2e:prod`). There the patient's link comes from a fixture: nobody can book without an SMS provider |
| 1.8a | `fix/e2e-fast-runner` | merged — not in the handover; found by the first CI run of the browser suite, which a faster runner failed 6 of 150. `ADDRESS_RATE_LIMIT_FACTOR` (default 1) scales the limits keyed on an address, and the suite sets it; the ward fixture takes another name when one is taken. `docs/STATUS.md` decision 90 |
| 1.9 | `fix/log-sms-redaction` | merged — the `log` provider writes one line per message with no number and no text, and keeps nothing; every outbox row goes through `writeOutbox`, which stores the words with `{link}` where the link went; migration 0035 removes stored links, refuses new ones and indexes the purge; the hourly job clears a message's words after 90 days |
| 1.9a | `fix/console-key-race` | merged — not in the handover; found by the third CI run, where N pressed the instant a break ended was answered "a break is in progress". The console swapped its key listener a frame after each redraw. `useWindowKeydown` in `@platform/ui` listens once and changes what it calls inside the redraw; the reception console and the bed panel use it. Found on the way and not fixed: the queue steps back when a tap's answer beats its broadcast (`docs/STATUS.md`, *Plan 1.9a*) |
| 1.9b | `fix/console-ack-rollback` | merged — not in the handover; found while verifying 1.9a. The reception console dropped a tap from its screen when the push was answered and waited for the broadcast, so the queue stepped back to the patient before whenever the broadcast was the slower of the two, and stayed there while the socket said nothing. The answer already carried the queue (`SY-05`); the console now shows it in the same redraw (`FRONTEND.md` §11.1 step 4). Not done: the ward board and the ER console have the same shape, and an action is folded twice for as long as the answer is slower than the broadcast (`docs/STATUS.md`, *Plan 1.9b*) |
| — | `fix/materialise-test-midnight`, `fix/tests-past-midnight` | merged — tests only. Two tests failed every night just after Dhaka midnight: one asserted the schedule job's first run writes nothing, the other stood on an e2e fixture whose chamber was dated today and started yesterday. The job's purpose now has a test of its own |
| — | `chore/requirements-5-october` | documents only: `SY-08`, `SY-09` and `FRONTEND.md` §11.1 *One action, shown once*; `FR-QUE-06` and `FR-PAT-39` (sessions that cross midnight) in `PRD.md` and `APP_FLOW.md`; rows 1.9c–1.9f |
| P2 | `fix/console-demo-banner` | merged — one banner component in each app, drawn only when the server says it is a demonstration, hidden until it has answered; `demo-label.spec.ts`, and the production suite checks a real server shows none |
| P3 | `fix/chamber-end-of-day` | merged — `BTN-B02-END` and `MOD-B02-END` on the reception console; the server refuses an end while a patient is in the chamber (`canEndSession`); patients left unseen are counted, need a tick and are not changed; the picker says which day a chamber is from and no longer lists an ended one; `chamber-end.spec.ts` |
| P4 | `chore/e2e-pilot-path` | merged — `e2e/production/reception-pilot.prod.spec.ts`: one receptionist's day end to end, and late, absent and bring back with the counters, under the production configuration. It found nothing. **Stopped here for the owner's review** (`docs/STATUS.md`, *Pilot readiness*) |
| P5 | `chore/deploy-lan-https` | deferred until the first hospital's IT has chosen how its server is reached |
| V0 | `chore/v1-direction` | merged — the owner's direction of 5 October (evening): the freeze lifted, one shared platform, the V1 pitch build (§2) |
| V1.1 | `fix/patient-v1-surface` | merged — the ambulance and blood tiles, their two routes and the two ambulance links on the emergency screens are gone; `NotBuiltYet` is deleted; `app-shell.spec.ts` asserts nothing on the first screen leads to an unbuilt one |
| V2.1 | `feat/patient-search` | merged — `GET /search` (`need`, `q`), `shared/domain` `search/needs` and `search/order`, `S-A-07s` at `/search`, Home rebuilt around it (`BTN-A02-SEARCH`, five quick needs), deep links into booking (`/book?specialty=&hospital=&doctor=`), `patient-search.spec.ts`. Not built: misspelling tolerance, distance from the patient, a hospital's own page |
| V2.2 | `feat/hospital-scope` | merged — migration 0036 (`hospital_settings.brand`), `shared/domain` `brand/theme`, `scope=` on `/search`, `/hospitals`, `/doctors` and `/config`, `config/links.ts` (`patientLink`, `allowedOrigins`, `EXTRA_ALLOWED_ORIGINS`), the patient app's `lib/scope` and `<ScopeTheme>`, Padma's theme in the seeds, `hospital-scope.spec.ts`. Supabase does not have 0036 yet |
| V3.1 | `feat/org-lifecycle` | merged — migration 0037 (`org_lifecycle`, `hospitals.lifecycle`, `hospitals_live_requires_workspace_active`), `shared/domain` `org/lifecycle`, `POST /hospital/request-review` in place of `/hospital/go-live`, the `/platform/*` routes (list, create with first administrator, approve, send back, suspend, reinstate, close, verify a doctor), the checklist on `S-B-11`, `HOSPITAL_NOT_LIVE` on a public booking, a seeded platform administrator, `platform.routes.test.ts`. The platform's screen is V3.2. Supabase does not have 0037 yet |
| V3.2 | `feat/platform-console` | merged — `S-B-12` (`PlatformConsole.tsx`, `lib/platform.ts`), the picker's platform section and `/?view=platform`, `platform_admin` on the demo door, `pnpm staff:create --platform` (`createPlatformAdministrator`), `platform-onboarding.spec.ts`. Not built: feature flags, subscriptions, moderation, system health (`FR-SUP-03`–`06`) |
| V4.1 | `feat/import-mapping` | merged — `shared/domain` `imports/mapping` (profile, header guard, rules and other names in both languages, `applyMapping`), migration 0038 (`import_mapping_profiles`), `POST /hospital/imports/analyse` and `/mapped`, the mapping step on `S-B-14` (`ImportMapping.tsx`), four synthetic sample exports in `database/seeds/samples`, `import-mapping.spec.ts`. No model yet (V4.2). Supabase does not have 0038 |
| V4.2 | `feat/import-mapping-ai` | merged — `adapters/mapping.ts` (`MAPPING_PROVIDER`, off by default; Claude over HTTPS, no SDK), `modelMappingRequest` and `withModelSuggestions` in `shared/domain`, `model` on the analyse answer, the model's part on the mapping step, `pnpm mapping:try`, a fifth sample export, `mappingProvider.test.ts`. **Not run against the live service: no key exists on the build machine** |
| V4.3 | `feat/import-warnings` | if V5 has room |
| V5.1 | `fix/pitch-walkthrough` | **merged 6 October.** Walked as patient, in Padma's own app, and as reception, doctor, ward, emergency, hospital administrator and platform administrator. One fault: a hospital's own app showed a serial booked at another hospital; fixed with a test. `PRD.md` §24 rewritten for the platform and without a reschedule; the demo path in `STATUS.md` covers search, a hospital's own app, onboarding and the mapped import |
| V5.x | `fix/pitch-*` | further findings, if the owner's own walk turns any up |
| V6 | `chore/pitch-release` | |
| 1.9c | `fix/queue-exactly-once` | after the first pilot (see §2 for what would bring it forward) |
| 1.9d | `fix/ward-reconcile` | after the first pilot |
| 1.9e | `fix/er-reconcile` | after the first pilot |
| 1.9f | `fix/serial-past-midnight` | after the first pilot |
| 1.10 | `feat/tenant-rls` | after the pitch; before a second real hospital shares the deployment (`FR-SEC-11`) |
| 2.1 | `feat/notification-worker` | |
| 2.2 | `feat/sms-live` | waits: D1 |
| 3.0–3.4 | onboarding | 3.2 waits: D2, D3 |
| 4.0–4.3 | mapped import | 4.2 waits: D4, D5 |
