# Platform plan

What gets built after the handover audit, in what order, and what has to be
decided first. Written 2 October 2026 from the owner's implementation brief of
the same day, `docs/HANDOVER.md`, and the code on `mvp` at `87d3dd2`.

- **Authority:** none over the five documents (`CLAUDE.md` §2). This file is
  the order of work. Where a phase adds scope, its first branch adds the
  requirements to `PRD.md` and the other documents, and the code follows them.
- **Kept current:** the progress table in §9 is updated as each branch merges.
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
| C | `FR-SEC-07` puts each real hospital on its own server in Bangladesh. Self-service signup, emergency search, referrals and the wallet across hospitals need hospitals on one deployment | Not solved here, and not pretended. Phase 3 is built to run on whatever deployment it is on: many organisations on a shared one, one on a hospital's own. Phase 6 writes the proposal. Opening signup to real hospitals waits for it (D6) |
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
| D4 | CSV only, or XLSX from the first release | CSV only. XLSX adds a parsing dependency and is Phase 5 | 4.2 scope |
| D5 | Model provider, where it runs, what is sent | What §4 lists and nothing else; off by default; one provider behind the adapter, called over HTTPS | 4.2 |
| D6 | The network architecture for many hospitals | Phase 6 writes the options. No decision needed before then | opening signup to real hospitals |
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
| 1.9 | `fix/log-sms-redaction` | merged — the `log` provider writes one line per message with no number and no text, and keeps nothing; every outbox row goes through `writeOutbox`, which stores the words with `{link}` where the link went; migration 0035 removes stored links, refuses new ones and indexes the purge; the hourly job clears a message's words after 90 days |
| 1.10 | `feat/tenant-rls` | next |
| 2.1 | `feat/notification-worker` | |
| 2.2 | `feat/sms-live` | waits: D1 |
| 3.0–3.4 | onboarding | 3.2 waits: D2, D3 |
| 4.0–4.3 | mapped import | 4.2 waits: D4, D5 |
