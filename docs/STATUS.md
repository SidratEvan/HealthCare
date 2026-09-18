# Status

Where the build actually is, and what a new session needs to know that is not
already in `CLAUDE.md` or derivable from `git log`.

**Update this at the end of every step.** It exists so that handing the work to
a fresh session costs one file read instead of a re-explanation, and it is only
worth that if it is true.

Last updated: end of step 3, plus the Supabase connection work.

---

## Build plan position (`CLAUDE.md` §4)

| Step | Branch | State |
| --- | --- | --- |
| 0 | `chore/scaffold` | merged |
| 1 | `feat/db-core` | merged — migrations 0001–0006 |
| 2 | `feat/domain-queue` | merged — reducer, ETA, rate, rules, replay |
| 3 | `feat/api-foundation` | merged — env, db, logger, middleware, errors, health |
| ~~4~~ | ~~`feat/auth-guest`~~ | **deferred, do not build** — see `CLAUDE.md` §4.1 |
| **5** | **`feat/seed-demo`** | **next** — `db/seeds` 00–07 + `reset.ts` (`FR-DEM-*`) |

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

`pnpm test` reports 640 at the time of writing: 464 unit, 122 api, 54 schema.

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

Four are documentation questions raised while building, each implemented one way
and flagged rather than settled silently. All four need an owner's ruling.

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

Two are the owner's and are not code:

5. **Repository visibility.** It is public. Commit `69c2d2e` still contains the
   commercial strategy that `9697d43` removed from the working tree — deleting a
   file does not remove it from history. Either make the repository private, or
   rewrite history and force-push.
6. **Rotate the Supabase credentials.** The database password and the
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
