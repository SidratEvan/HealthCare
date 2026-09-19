# Status

Where the build actually is, and what a new session needs to know that is not
already in `CLAUDE.md` or derivable from `git log`.

**Update this at the end of every step.** It exists so that handing the work to
a fresh session costs one file read instead of a re-explanation, and it is only
worth that if it is true.

Last updated: end of step 10 (`feat/patient-live-serial`) — **the pitch demo milestone**.

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
| 11 | `feat/notifications` | **next** — templates, workers, SMS/push adapters |

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

`pnpm test` reports 1332.
`pnpm test:e2e` reports 28, in Chromium, against the real API and the seeded
demo database — 5 in `two-device-queue.spec.ts`, 18 in `guest-booking.spec.ts`,
5 in `offline-console.spec.ts`.

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
- **A shared test database means exact-count assertions must be scoped.**
  `seeds.test.ts` asserted `SELECT * FROM hospitals` had six rows; the graph
  fixture in `seeds/graph.ts` inserts a seventh, so the test passed or failed
  depending on which file vitest ran first. It now matches on the declared
  names from `DEMO_FACILITIES`. Any new assertion about "how many" needs the
  same scoping.

### Credentials

`.env` is gitignored and has never been tracked in any commit. It holds the
Supabase connection string and three generated dev secrets.

`SUPABASE_SERVICE_ROLE_KEY` is deliberately **not** set: nothing needs it until
the storage work in steps 12–13.

---

### Awaiting a ruling: E2E rows written to Supabase

Because of the `.env` import-side-effect bug above, every `pnpm test:e2e` run
before it was found created its fixture rows **on Supabase** rather than on the
container: one session per test (`room = 'E2E'`), its bookings, and the queue
events the specs appended. It is demo data throughout — no real patient data
was involved (`FR-SEC-08`) — but `queue_events` is append-only, so those rows
cannot be deleted; clearing them means a `pnpm db:reset` against Supabase,
which is a destructive operation on the demo environment and needs the owner's
say-so (`ALLOW_REMOTE_DB=1` plus `ALLOW_DESTRUCTIVE_DB=1`).

**Measured, 2026-09-19:** 32 sessions (`room = 'E2E'`), 146 bookings and 64
queue events, all created between 05:17 and 05:29 UTC — the three diagnostic
runs during which the bug was found, and nothing older. Supabase then held 161
sessions, 1,327 bookings and 1,285 queue events in total, so the stray rows are
roughly a fifth of the sessions and a twentieth of the bookings.

Connecting needs no TLS options: the URL carries no `sslmode`, and the repo's
own connection factories pass nothing but the connection string, so a plain
`new Client({ connectionString })` is how everything here already talks to
Supabase.

**Still not cleared.** Both routes are refused by this environment's sandbox:
`pnpm db:reset` reads as a mass delete, and the scoped alternative — deleting
only the E2E rows — has to lift `trg_queue_events_no_mutate` to remove the 64
events, which reads as tampering with an append-only log. Both readings are
fair; the operations are what they look like. The owner runs one of these:

```bash
# The supported path: truncate and reseed the demo (FR-DEM-06).
ALLOW_REMOTE_DB=1 ALLOW_DESTRUCTIVE_DB=1 DEMO_MODE=true pnpm db:reset
```

A scoped delete is possible instead, but it must remove `queue_events` first
(both `bookings → sessions` and `queue_events → sessions` are `RESTRICT`), and
that means disabling the row guard inside the transaction and restoring it
before commit — exactly what `seeds/reset.ts` does for the TRUNCATE guard.
Given that the whole database is regenerable demo data, the reset is the
simpler and better-tested of the two.

The bug itself is fixed and cannot recur: the suite refuses any non-local
database.

---

## Open decisions

Eight are open questions, each implemented one way and flagged rather than
settled silently; all eight need an owner's ruling. One more is recorded as
settled because the answer changed the tree.

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

12. **`hospital_settings.refund_policy` has no defined shape.** `FR-PAY-03`
   requires the refund rule to be stated before a cancellation is confirmed,
   and `MOD-A08-CANCEL` states it — but the column is an untyped `jsonb`
   defaulting to `{}`, no document says what goes in it, and the seeds write
   nothing. So the sheet degrades honestly: when the object is empty it says
   "ফেরতের বিষয়টি হাসপাতাল জানাবে" rather than inventing a percentage
   (`PRD.md` §3.2). Deciding the shape is a product call, and step 18 needs it
   answered because that is where a refund is actually paid.

13. **Nothing reissues a freed serial.** Cancelling releases the number —
   `bookings_session_serial_key` excludes cancelled rows — but `nextSerial`
   still allocates `max + 1`, so the gap is never filled. `FR-QUE-30` gives the
   slot to a standby patient through `offerFreedSlot`, which is not built;
   until it is, a cancelled serial is simply skipped. That is the safe
   behaviour for now — nobody should silently inherit somebody else's number —
   and it needs deciding at step 15.

Two are the owner's and are not code:

8. **Repository visibility.** It is public. Commit `69c2d2e` still contains the
   commercial strategy that `9697d43` removed from the working tree — deleting a
   file does not remove it from history. Either make the repository private, or
   rewrite history and force-push.
9. **Rotate the Supabase credentials.** The database password and the
   `sb_secret_…` key were pasted into a chat transcript. Nothing references the
   secret key yet, so rotating it is free; rotating the password means
   re-encoding `DATABASE_URL`.

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

1. **Patient**: `http://localhost:3000`, pick a specialty, pick the doctor and
   the chamber, fill in name / phone / age, confirm. The success screen shows
   the serial and **লাইভ সিরিয়াল দেখুন** — tap it.
2. **Reception**: `http://localhost:3100/?session=<id>` with a staff token in
   `sessionStorage` under `console.token`. There is no login screen by design
   (CLAUDE.md §4.1); `e2e/support/console.ts` shows how a principal is minted.
   Use the session the booking was made on.
3. Tap **পরবর্তী রোগী ডাকুন**. The patient's "এখন চলছে" changes within two
   seconds, the progress track advances, and the ETA moves.

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

- **Two signature components (`FRONTEND.md` §6) remain.** `<FreshnessLine>`,
  `<QueueTable>` and `<LiveSerialCard>` are built and rendering. `<BedTile>`
  and `<CapacityMirror>` are step 14; `<DelaySheet>` lands with the delay flow
  it belongs to — see the next item.

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
- **`FR-DEM-04` and `FR-DEM-05` are not covered.** `seed_05_beds` needs
  migration 0008 (`wards`, `beds`, `bed_events`) and `seed_06_ancillary` needs
  0011 (`ambulances`, `blood_donors`, `pharmacy_stock`). Both files exist and
  declare what they are waiting for; the seed runner checks each module's
  tables before calling it and prints the skip with the migration name. They
  fill in at steps 14 and 17, in the branches that render them.
- **`seed_04_history` defers prescriptions and reports** to migration 0007. It
  writes the half the schema holds — past sessions, `done` bookings with
  measured consultation lengths, and the event log behind them — which is what
  the rolling rate (`FR-QUE-12`) and the admin figures read. The clinical
  records land in step 12.
- **Today's sessions other than the pitch one are left `scheduled`.** If a
  reset happens late at night, an 18:00 chamber that has already passed still
  shows as scheduled with no events. That is honest — nothing was recorded —
  but it is a wart for a late demo. The pitch session itself is always built
  backwards from the current instant, so it is correctly mid-queue at any hour.
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
- **Three of the five required Playwright specs exist** (`CLAUDE.md` §6):
  `two-device-queue.spec.ts` — the canary, five tests — plus
  `guest-booking.spec.ts`, now complete including "open the SMS link, see the
  live serial", and `offline-console.spec.ts`. Still to write:
  `no-show-recovery.spec.ts` (its recovery figure is step 19) and
  `emergency-burn.spec.ts` (step 15).
- **`frontend/site` is still empty.** `shared/client`, `frontend/console` and
  `frontend/patient` are built.
