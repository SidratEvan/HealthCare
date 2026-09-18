# Status

Where the build actually is, and what a new session needs to know that is not
already in `CLAUDE.md` or derivable from `git log`.

**Update this at the end of every step.** It exists so that handing the work to
a fresh session costs one file read instead of a re-explanation, and it is only
worth that if it is true.

Last updated: end of step 5 (`feat/seed-demo`).

---

## Build plan position (`CLAUDE.md` §4)

| Step | Branch | State |
| --- | --- | --- |
| 0 | `chore/scaffold` | merged |
| 1 | `feat/db-core` | merged — migrations 0001–0006 |
| 2 | `feat/domain-queue` | merged — reducer, ETA, rate, rules, replay |
| 3 | `feat/api-foundation` | merged — env, db, logger, middleware, errors, health |
| ~~4~~ | ~~`feat/auth-guest`~~ | **deferred, do not build** — see `CLAUDE.md` §4.1 |
| 5 | `feat/seed-demo` | merged — `db/seeds` 00–07 + `reset.ts` (`FR-DEM-*`) |
| **6** | **`feat/queue-service`** | **next** — `appendEvent()`, queue routes, realtime rooms |

Three unplanned branches also merged after step 3, all recorded in `git log`:
`chore/remove-commercial-strategy`, `chore/supabase-compat`, `fix/api-env-file`.

**Step 8 is the first step with a screen.** Steps 5–7 are seeds and design
tokens; nothing renders before `feat/console-reception`. Step 5 is the first
step whose output is *visible* — demo data in Supabase's table editor.

**Authentication is deferred** (`CLAUDE.md` §4.1). Supabase Auth will issue
tokens when this goes past the pitch. The step-3 middleware that *verifies*
tokens stays; no OTP flows, staff passwords or argon2id are to be written. The
guest tracking link (`FR-GST-05`) is kept, because it is a capability token the
demo depends on rather than a login.

`pnpm test` reports 665 at the time of writing: 464 unit, 122 api, 79 schema.

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
  stays on localhost and the guard in `db/scripts/lib/env.ts` refuses otherwise.
- Supabase project region is `ap-southeast-1` (Singapore), closest to Dhaka.

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

### Credentials

`.env` is gitignored and has never been tracked in any commit. It holds the
Supabase connection string and three generated dev secrets.

`SUPABASE_SERVICE_ROLE_KEY` is deliberately **not** set: nothing needs it until
the storage work in steps 12–13.

---

## Open decisions

Seven are questions raised while building, each implemented one way and flagged
rather than settled silently. All of them need an owner's ruling.

1. **`FR-QUE-20` grace period.** "2 patients or 15 minutes, whichever is longer"
   is implemented as the longer of *two patients' time at the current rate* and
   fifteen minutes. Read instead as a count of calls it deadlocks: the absent
   patient is at the front, so nobody else can be called, so the count never
   rises. See `graceWindowMinutes` in `packages/domain/src/queue/rules.ts`.
2. **`EVT-BOOKING_CREATED`** appears in `APP_FLOW.md` §A4 but not in
   `DATABASE.md` §1 or `FR-QUE-03`. The queue is built as
   `seed + events => state` instead; see the header of
   `packages/domain/src/queue/state.ts`.
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
7. **Repo layout.** The owner has asked for `frontend/`, `backend/`,
   `database/` top-level folders instead of the `apps/` + `packages/` + `db/`
   layout that `BACKEND.md` §1 fixes. Agreed, with `shared/` for the packages
   both sides import — `packages/domain` is imported unchanged by the API and
   the console, and that shared import is the mechanism behind `FR-QUE-05`, so
   it belongs to neither side. To be done on `chore/repo-layout`; `BACKEND.md`
   §1 needs updating with it.

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

## Known gaps, deliberate

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
- **`middleware/audit.ts` is not written.** `audit_log` is migration 0010 and
  the schema is at 0006, so it would have no table to write to. It lands with
  the migration.
- **`apps/api` has no production build script.** Internal packages are consumed
  from TypeScript source, so a deployable build needs either emitted output from
  `packages/domain` or a bundler. That is a dependency decision for the owner,
  and it blocks the Render deploy at step 6.
- **`e2e/` and Playwright do not exist yet.** They arrive with the first
  user-visible flow. The two-device queue test is the product's canary and is
  never skipped (`CLAUDE.md` §6).
- **`packages/ui`, `packages/client`, `packages/i18n` are empty**, as are the
  three Next.js apps. Steps 7–10.
