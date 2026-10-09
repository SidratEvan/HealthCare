# Deploying the pitch demo

Three services: the database on **Supabase**, the API on **Render**, the two
web apps on **Vercel**. Roughly forty minutes the first time.

This deploys the **pitch version** (`CLAUDE.md` §1.1). Everything it serves is
seeded demonstration data, every row is labelled as such (`FR-DEM-07`), SMS is
written to a log rather than sent, and payments always succeed. That is the
correct configuration for showing a hospital director what the product does —
not a staging environment on its way to production.

`docs/STATUS.md` records what is and is not built, and its *Running the pitch
demo* is the full walk: every console, the platform administrator's screen, a
hospital's own app and the import.

---

## 0. Before you start

You need accounts on Supabase, Render and Vercel, and the repository pushed to
GitHub. Render and Vercel both deploy from **`main`**, the release branch
(`render.yaml`, CLAUDE.md §3.1). A change reaches the live demo only once
`mvp` is merged into `main` and `main` is pushed; pushing `mvp` alone deploys
nothing.

Have these to hand:

```bash
# Three secrets, each different from the other two.
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 1. Supabase — the database

The project already exists if you have been developing against it. If not,
create one in **ap-southeast-1 (Singapore)**, the closest region to Dhaka.

### 1.1 Get the connection string right

This is the step that costs people an afternoon. Use the **session pooler**, on
port **5432** — not the transaction pooler on 6543, even though the dashboard
labels that one `DATABASE_URL`. Transaction pooling does not carry a
session-level `search_path`, and this schema puts its extensions in their own
schema.

```
postgresql://postgres.<project-ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
```

**Percent-encode the password.** Supabase generates passwords containing `%`
and `&`, and neither survives a URL unescaped — `%Pz` reads as a
percent-escape, not three characters. Anything outside `[A-Za-z0-9._~-]` needs
encoding.

### 1.2 Apply the schema and build the demo

From your machine, with that URL:

```bash
export DATABASE_URL='postgresql://…pooler.supabase.com:5432/postgres'

# Forward-only. Safe to re-run; already-applied migrations are skipped.
ALLOW_REMOTE_DB=1 pnpm db:migrate

# Confirms the invariants in DATABASE.md §0 hold before you trust the data.
ALLOW_REMOTE_DB=1 pnpm db:verify
```

Then the demo data. **This one is destructive** — it truncates every table and
rebuilds six hospitals, forty doctors, two hundred patients and one cardiology
session sitting mid-queue, ready for the pitch (`FR-DEM-06`):

```bash
ALLOW_REMOTE_DB=1 ALLOW_DESTRUCTIVE_DB=1 DEMO_MODE=true pnpm db:reset
```

Run this again whenever the demo gets untidy, and **before any pitch** — the
mid-queue session is built backwards from the moment you run it, so a reset an
hour before the meeting puts the chamber in exactly the right state.

---

## 2. Render — the API

**New → Web Service**, from the repository, branch `main`.

`render.yaml` at the repository root carries the settings. If Render does not
pick it up, the four that matter are:

| Setting | Value |
|---|---|
| Region | Singapore |
| Build command | `npm install --prefix .render --no-audit --no-fund pnpm@12.4.2 && .render/node_modules/.bin/pnpm install --frozen-lockfile` |
| Start command | `.render/node_modules/.bin/pnpm --filter @platform/api start` |
| Health check path | `/healthz` |

**The Node version comes from `.nvmrc`** when `NODE_VERSION` is not set in the
dashboard, and it is `22` on purpose. Render ships its own Node 24 under a
read-only `/usr`, so on 24 any `npm install -g` in the build fails with
`EROFS`. On 22, Render downloads Node into a writable directory. The build
command above does not install anything globally, so it works on either. It is
also the safe choice when a service was created before this changed and still
runs `npm install -g pnpm@12.4.2 && pnpm install --frozen-lockfile`.

### 2.1 Environment variables

Set these in the dashboard. The ones marked **later** cannot be filled in until
Vercel has given you URLs, so do the first deploy without them and come back.

| Key | Value |
|---|---|
| `DATABASE_URL` | the session-pooler URL from step 1.1 |
| `NODE_ENV` | `development` — see the note below |
| `DEMO_MODE` | `true` |
| `TRUST_PROXY_HOPS` | `1` |
| `JWT_ACCESS_SECRET` | a generated secret |
| `JWT_REFRESH_SECRET` | a *different* generated secret |
| `GUEST_LINK_SECRET` | a third generated secret |
| `SMS_PROVIDER` | `log` |
| `PAYMENT_PROVIDER` | `mock` |
| `API_BASE_URL` | the Render URL, once it exists |
| `WEB_BASE_URL` | **later** — the patient app's Vercel URL |
| `CONSOLE_BASE_URL` | **later** — the console's Vercel URL |

> **Why `NODE_ENV=development` on a deployed service.**
> `env.ts` refuses to boot with `DEMO_MODE=true` under `NODE_ENV=production`,
> and that guard is correct: production means real patients, and mock payments
> and a resettable database have no business in front of them. A pitch demo is
> not production. When there is a signed pilot, the two flags flip together.
>
> The one thing `NODE_ENV` used to control that genuinely matters behind a load
> balancer — how many proxy hops to trust — is now `TRUST_PROXY_HOPS`.

### 2.2 Check it

```bash
curl https://<your-api>.onrender.com/healthz
```

Expect `{"ok":true,…}`. On the free plan the first request after fifteen
minutes idle takes thirty seconds or so while the service wakes up — worth
knowing before you open a laptop in front of somebody.

---

## 3. Vercel — the two web apps

Two projects from the same repository. The difference is one setting.

Vercel detects the pnpm workspace from `pnpm-workspace.yaml` at the repository
root and installs there, then builds the app in its Root Directory. It needs no
custom install or build command, and giving it one is a good way to break it —
`vercel.json` in each app declares the framework and nothing else.

### 3.1 The patient app

| Setting | Value |
|---|---|
| Root Directory | `frontend/patient` |
| Framework | Next.js (detected) |
| Include files outside root | **on** — it is a workspace |

Environment variables:

| Key | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<your-api>.onrender.com/api/v1` |
| `NEXT_PUBLIC_SOCKET_URL` | `https://<your-api>.onrender.com` |

Note the first has `/api/v1` and the second does not. The socket connects to
the origin.

### 3.2 The console

Identical, with Root Directory `frontend/console`.

### 3.3 Close the loop

Go back to Render and set `WEB_BASE_URL` and `CONSOLE_BASE_URL` to the two
Vercel URLs, then redeploy.

Both matter for more than tidiness:

- they are the **CORS allowlist** — a browser origin that is not one of them
  gets no response it can read;
- `WEB_BASE_URL` is what every booking's **tracking link** is built from. Leave
  it on `localhost` and every SMS in the demo points at a machine nobody has.

---

## 4. Walk the demo

Open the two URLs on two devices, or two windows side by side.

1. **Patient** → search for what you need, or pick a specialty → pick the
   hospital, the doctor and the chamber → fill in name, phone and age →
   confirm. You get a serial.
2. Tap **লাইভ সিরিয়াল দেখুন**. This is `S-A-08`, the screen the product is for.
3. **Console** → it opens on a picker: choose the hospital, then the chamber
   the patient booked, then **রিসেপশন**. There is no password, and the screen
   says so.
4. Tap **পরবর্তী রোগী ডাকুন**.

The patient's *এখন চলছে* changes within two seconds, the progress bar advances
and the estimate moves. That is the product (`NFR-01`), and
`e2e/two-device-queue.spec.ts` is the test that keeps it true.

Also worth showing: **আমি দেরি করছি** and **বাতিল করুন** on the patient screen
both write real events the console sees, and the Render logs record that each
SMS the demo would have sent was written, without its number or text.

The rest of the pitch — a hospital's own app at `/?scope=PADMA`, onboarding a
hospital from the picker's **প্ল্যাটফর্ম পরিচালনা**, and importing a hospital's
own export — is `docs/STATUS.md`, *Running the pitch demo*, steps 6–9. The
model's import suggestions are off on the deployed demo unless
`MAPPING_PROVIDER=claude` and `MAPPING_API_KEY` are set on Render.

---

## 5. When something is wrong

| What you see | Almost always |
|---|---|
| Patient screen loads but never updates | `NEXT_PUBLIC_SOCKET_URL` has `/api/v1` on the end, or `WEB_BASE_URL`/`CONSOLE_BASE_URL` on Render do not match the Vercel URLs exactly — including `https://` and no trailing slash |
| Every request fails in the browser, works in `curl` | CORS: the same two variables |
| API will not boot, logs name a variable | `env.ts` validates at boot and says which key and why. `DEMO_MODE=true` with `NODE_ENV=production` is the common one |
| `password authentication failed` | the password is not percent-encoded |
| `relation "hospitals" does not exist` | `pnpm db:migrate` has not run against this database |
| Console picker says no chambers are running | `pnpm db:reset` has not run, or was run on a different day — today's sessions are seeded for today |
| Tracking links in SMS point at localhost | `WEB_BASE_URL` on Render |
| First request takes thirty seconds | Render free plan, cold start |

---

## 6. What this deployment is not

- **Not production.** `NODE_ENV` says so, and the guard in `env.ts` enforces it.
- **Not a build.** This demo's API runs TypeScript through `tsx` rather than
  compiled output: its start command lives in Render's settings, and a cold
  start on the free plan is dominated by waking up, not by compiling. The
  self-hosted image (Part S) runs the compiled API (plan I1); the same two
  commands work here (`pnpm build:api` added to the build command, `start`
  replaced by `start:compiled`) if this demo is ever moved to them.
- **Not private.** Anyone with the console URL can open a console: under
  `DEMO_MODE=true` the picker lets a visitor in as any role with no password,
  the platform administrator included, and says so on the screen. Staff login
  and the second factor are built (`CLAUDE.md` §4.1) and are what a real
  deployment runs on; the demo keeps the picker so that it can be explored.
  Share the link accordingly.
- **Not holding real data, ever** (`FR-SEC-08`). If a real patient's details
  are ever typed into this deployment, reset it.

---

## 7. Releasing V1 to the public demo (plan J)

**State, 9 October (the owner authorised one public-demo release that day).**
Done: the gate on the release code (§7.1; `b7b1094`, plus `a4ca5b0`'s reset
guard with its own tests); Supabase identified as the demo (project
`vrfbwnbfzogfkwgajcjn`, six "(Demo)" hospitals, the seeded 200 patients and
no others, migrations through 0038, PostgreSQL 17.6); the daily refresh
**disabled**; the backup taken (§7.3) at
`%LOCALAPPDATA%\HealthCareDemo\backups\supabase-before-v1-20261009T0650Z.dump`
with `pg_dump` 17 from the `postgres:17-alpine` image, and **restored** into a
scratch database with every count matching. Render could not be suspended
from the machine (no credential), so step 2 was skipped. Then, on the owner's
second explicit word: 0039–0063 applied (25, about half a second each),
`db:verify` held, the reset filled the new screens, `main` merged and pushed
(`99e4c5e`, the tree of `mvp` `a373b3b`). Render served the new API about a
minute after the push (`GET /api/v1/formulary` went from 404 to 401) and
Vercel the new apps (the nonce policy appeared). `/readyz`: schema 0063, all
four workers on time. **Smoke walk on the deployed URLs:** a guest booked
serial 18 through the patient app with a tracking link on the patient app's
own address; two reception taps reached the patient's screen in 1,276 ms and
464 ms. The demo was reset again after it, `demo` fast-forwarded to `99e4c5e`
and pushed, and the daily refresh re-enabled. Keep the backup until the
release has been used in a meeting.

**One thing learned:** `db:verify` does not notice migrations that are missing,
so a refresh from an `mvp` newer than Supabase's schema truncates and then
fails to seed. Apply migrations before the refresh next runs.

Originally: **prepared on 8–9 October, nothing in this section run against
Supabase, Render or Vercel without the owner's word** (`CLAUDE.md` §4.6). It releases
`mvp` over the pitch release of 6 October (`fa31157`, migrations through
0038). Still a pitch deployment: `DEMO_MODE=true`, `SMS_PROVIDER=log`,
`PAYMENT_PROVIDER=mock`, `STORAGE_PROVIDER=mock`, demonstration data only.
A hospital's own pilot is a different deployment (Part S) and a different
checklist (§7.9).

The order, each step with its check: **7.1** the gate · **7.2** what the
migrations do · **7.3** the backup · **7.4** the window and the order ·
**7.5** the limited database role (optional, the owner's question 18) ·
**7.6** the smoke walk · **7.7** rolling back · **7.8** after.

### 7.1 Before anything: the gate, on the commit being released

On a clean checkout of the `mvp` commit to be released, with the local
database (never Supabase):

```bash
pnpm install --frozen-lockfile
pnpm verify                 # typecheck, lint, format, every unit/API/schema test
pnpm build
pnpm test:e2e               # the whole browser suite, the canary among it
pnpm test:e2e:built
pnpm test:e2e:prod
pnpm audit --prod           # expect: no known vulnerabilities
```

Nothing red goes out (§3.1). The browser suite runs the API with
`DEMO_MODE=true` **as a limited database role**, exactly as §7.5 would run
the public demo, so it is also the test of §7.5. Write the commit hash down:
it is what `main` will point at.

### 7.2 The migrations Supabase does not have: 0039 to 0063

Forward-only, applied in order by `pnpm db:migrate`, each in its own
transaction: one that fails is rolled back whole, the run stops, and the ones
before it stay applied. Re-running continues from where it stopped. Five
change rows that exist; the rest add.

| Migration | What it does | Rows it changes |
|---|---|---|
| 0039, 0040 | A version on a bed and on an emergency case | none |
| 0041 | A booking keeps its idempotency key; several tracking links per booking | none, but **drops `guest_links_booking_key`** (§7.4) |
| 0042 | A staff sign-in keeps one family across refreshes | sets `family_id` on staff refresh rows |
| 0043, 0044, 0056 | Tenant, patient and person policies; the role `app_tenant` | none; the role is created if missing, which Supabase's `postgres` may do |
| 0045 to 0049 | Logos, portal domain, modules, publishing, applications | none |
| 0050 to 0052 | Told ETA, agreement state, workspace health | none |
| 0053 | The notification sender's attempts and due time | sets `next_attempt_at` on queued messages |
| 0054, 0055 | Delivery receipts, backup runs | none |
| 0057 | Payment holds and `payment_events` | marks old failed payments `declined` |
| 0058 | No-show prepayment settings | none (off by default) |
| 0059 | A patient's own papers: content type, size, uploader | none (nothing wrote the table) |
| 0060 | Preferred arrival hour | none (off by default) |
| 0061, 0063 | Reception desks, their doctors, their receptionists | none |
| 0062 | `facility_kind` gains `chamber` (`ALTER TYPE … ADD VALUE`) | none; allowed inside a transaction on PostgreSQL 12 and later, and nothing uses the value in that migration |

**Rehearsed on 9 October, locally:** a database built by the released commit (`fa31157`: its 36 migrations and its demo reset, 975 payments and a live session among them), then `pnpm db:migrate` from `mvp`: all 25 applied in under a second, `pnpm db:verify` held every invariant, the new reset filled the new screens, and `pnpm db:role` made a role without bypass that, querying with no hospital scope, saw no hospital at all. Supabase itself has not been touched.

**Compatibility, both ways.** The new API needs every one of these (it reads
columns and tables they add), so it must not run against the old schema. The
old API (`fa31157`) runs against the new schema with one exception: it writes
a tracking link with `ON CONFLICT (booking_id)`, which needs the unique index
0041 drops, so **from the migration until the new API is live, every booking
on the demo fails**. Nothing else the old API does is broken by an additive
column, table or policy (the policies bind nobody while the API connects as
`postgres`). Hence the order in §7.4.

### 7.3 The backup, before the first statement

The demo holds synthetic data only (`FR-SEC-08`), so the reset in §7.4 is
itself a way back; the backup is for the schema and for the case where the
reset is what fails. On Supabase's free plan there is no point-in-time
recovery, so take one by hand, from the machine that will run the migration:

```bash
export DATABASE_URL='postgresql://…pooler.supabase.com:5432/postgres'   # the owner, §1.1
pg_dump --no-owner --no-privileges --format=custom \
  --file="supabase-before-v1-$(date -u +%Y%m%dT%H%MZ).dump" "$DATABASE_URL"
pg_restore --list supabase-before-v1-*.dump | head        # it opens, and lists tables
```

Keep the file off the repository (`.gitignore` ignores `*.dump`) and keep it
until the release is confirmed good. A
`pg_dump` whose major version is older than the server's refuses; use the
server's major (`SHOW server_version`).

### 7.4 The window, and the order

The gap in §7.2 cannot be removed, only kept short and away from a meeting.
About ten minutes end to end; the booking outage is steps 2 to 6.

1. Pick a time nobody is being shown the demo. Pause the demo's own daily
   refresh on the owner's machine for the evening (Task Scheduler, *HealthCare
   demo refresh*, Disable), so it cannot reset in the middle.
2. **Render: suspend the API service** (Settings → Suspend). The patient app
   and console then say they cannot reach the server, which is the honest
   state; nobody books into the gap.
3. **Backup** (§7.3), if not taken already.
4. **Migrate, verify, reset**, from that machine with the owner URL:
   ```bash
   ALLOW_REMOTE_DB=1 pnpm db:migrate        # 0039 to 0063
   ALLOW_REMOTE_DB=1 pnpm db:verify         # every invariant holds
   ALLOW_REMOTE_DB=1 ALLOW_DESTRUCTIVE_DB=1 DEMO_MODE=true pnpm db:reset
   ```
   The reset is what fills the new screens (logos, agreements, desks, demo
   prescriptions and papers, the arrival-hour hospital) and rebuilds today's
   chambers. It **truncates every table**.
5. **Merge `mvp` into `main` at the commit from §7.1, and push `main`.**
   Vercel builds both apps from it; Render builds the API when resumed.
6. **Render: resume the API.** Wait for `GET /healthz` to answer `ok`, and for
   both Vercel deployments to show *Ready*.
7. **Smoke walk** (§7.6). If it passes: move `demo` to the same commit and
   push it (§3.1), and re-enable the daily refresh.

Render's environment needs nothing new for this release: every setting added
since 6 October has a default right for the demo (`.env.example`).
`PLATFORM_DOMAIN` stays empty until there is a domain, so portals open with
`?scope=<code>` as before.

### 7.5 The public demo on a limited database role (question 18; optional, separate)

The owner wants the demo eventually to connect as a limited role, as a real
deployment does, so that the database itself keeps hospitals apart (0043).
**Not part of the release above unless the owner says so; nothing here has
been run on Supabase, and no credential is changed without the release
approval.** It is safe to do after §7.4 on another evening.

What makes it safe: the browser suite has always run the API in exactly this
way (`DEMO_MODE=true`, connected as `healthcare_e2e_api`, a role made by the
same `lib/role.ts`), and the demo's daily reset runs on the owner's machine
with the owner URL, never through the API, so it is unaffected.

1. Generate the role's password (32 random bytes, hex) and keep it with the
   other secrets.
2. From the machine, with the owner URL:
   ```bash
   API_DB_USER=medlivebd_api API_DB_PASSWORD='…' ALLOW_REMOTE_DB=1 pnpm db:role
   ```
   It creates the role (login, no superuser, no bypass of row-level
   security), grants rows only, and makes it a member of `app_tenant`; it
   touches no Supabase role. Safe to run again.
3. Check it, as that role, through the pooler (user `medlivebd_api.<project-ref>`):
   ```sql
   SELECT current_user, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user;
   -- medlivebd_api | f
   ```
4. **Render:** change `DATABASE_URL` to the same session-pooler address with
   that user and password (percent-encoded, §1.1). Redeploy. `GET /readyz`.
5. Smoke walk (§7.6), plus the platform administrator's screen and one
   hospital's import preview, which are the reads that cross the most tables.
6. **Rollback:** put the owner URL back in Render's `DATABASE_URL` and
   redeploy. The role can stay; it has no power of its own.

### 7.6 The smoke walk

On two devices, against the deployed URLs:

- `GET /healthz` answers `ok`; `GET /readyz` answers and names the backup as
  not watched (Supabase's own).
- Guest booking: book, open the live serial, tap next in the console, see it
  move within two seconds.
- The console picker: Padma's rail shows its logo and colours, and its desk
  choice; the admin dashboard opens on *the hospital now*.
- The doctor's console: write a medicine, sign, print the sheet.
- Booking with bKash settles at once (mock); the success screen shows a paid
  serial. At Padma the confirm step offers a preferred hour.
- The platform administrator's screen lists the workspaces with their health.
- An `.xlsx` patient file reaches the preview on a hospital's import.

Any failure: §7.7.

### 7.7 Rolling back

- **The new API misbehaves, the data is fine:** in Render, *Manual Deploy* →
  the previous deploy, or point `main` back at the previous release
  (`98c98ca`) and push. **This needs the schema the old API can run on**:
  with 0041 applied, bookings fail (§7.2), so a code rollback alone is a demo
  without bookings. Prefer fixing forward on `mvp`, gated, and releasing
  again.
- **The migration itself fails partway:** the failing migration is rolled
  back; the API is still suspended; read the error, fix on `mvp`, gate, and
  run `pnpm db:migrate` again (it continues). If the schema must go back,
  restore the dump: `pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" supabase-before-v1-….dump`,
  then resume the old API.
- **The data is wrong after the reset:** run the reset again (§1.2). It is
  synthetic.
- `demo` is moved only after the smoke walk passes, so it never points at a
  release that failed.

### 7.8 After

- `docs/STATUS.md`: the release, its commit, the migrations Supabase now has,
  `demo` moved.
- Re-enable the daily refresh (§7.4 step 1).

### 7.9 Before the first hospital pilot: what is outside the code

The demo release above needs only the owner's word. A hospital pilot needs
things the code cannot provide, in roughly this order:

1. **The company registered in Bangladesh** (X0). Every account below is
   opened in its name.
2. **A server in Bangladesh** for the hospital's deployment (`FR-SEC-07`,
   X7): a hosting account, or the hospital's own machine (Part S, §S1), and
   **a domain with DNS and a certificate** (X3), which `PLATFORM_DOMAIN` and
   the HTTPS terminator need.
3. **Off-machine backups:** where the nightly dump is copied, and one restore
   rehearsed on that server (§S5).
4. **An SMS aggregator account and a registered sender ID** (X1), set as
   `SMS_PROVIDER=http` with its URL, key, sender and receipt secret (§S3,
   *An SMS aggregator*). Until then patients get no SMS: a pilot can run on
   the counter and the live link shown on screen, but booking confirmations
   and *you are next* messages need it.
5. **Payments, only if the pilot takes money online:** bKash and Nagad
   merchant approval and credentials, each provider's sandbox run through the
   ten-item checklist (§S3, *bKash and Nagad*) and one real transaction
   verified (X2, X9). Question 17 (whose merchant account) is the owner's to
   settle first. Without them the pilot takes payment at the counter, which
   the product supports (`PAYMENT_PROVIDER=off`).
6. **The hospital's agreement** (X10), its administrator's details, and its
   data: either entered on the settings screen or imported from its own
   export (`.xlsx` or CSV, sets A to C); patient data only with the
   hospital's legal adviser's agreement (`FR-IMP-11`, `FR-IMP-12`).
7. **The dry run on that server** (§S8), with the production suite
   (`pnpm test:e2e:prod`) against it, before the first real patient.
8. **Not needed for the first pilot:** store accounts (the PWA is the launch
   format), an independent security test (X8, recommended before scale), the
   import model's API key (X6; rules and manual mapping work without it).

---

# Part S — On a hospital's own server in Bangladesh

> **Read this first (owner, 2026-10-05).** The default for real patients is
> now **one shared platform hosted in Bangladesh**, every hospital a workspace
> inside it (`FR-SEC-07` as amended, `CLAUDE.md` §1.2). This part was written
> for one hospital on a machine of its own, and it stays true for that case,
> which is now the exception: the reception-pilot candidate in S8 is such a
> deployment. The stack is the same on a shared machine. Hospitals are kept
> apart by the database since plan B1 (`FR-SEC-11`, migration 0043,
> `DATABASE.md` §5.2). What a shared machine needs that is not here yet: an
> wildcard DNS and a certificate for `*.<PLATFORM_DOMAIN>`, so that each
> hospital's portal address reaches it (`FR-BRD-07`; built in plan C2, set
> `PLATFORM_DOMAIN` for the API and `NEXT_PUBLIC_PLATFORM_DOMAIN` when the
> patient app is built; a hospital's own domain is pointed here by the hospital
> and then recorded on `S-B-12`). One patient is
> kept from another by the database for the clinical record (plan B3,
> migration 0044) and for bookings, payments and messages (plan I3,
> migration 0056).

The pilot build (`CLAUDE.md` §4.2, pilot step 26). Everything above deploys
the **demonstration**; this part deploys the **real** thing for one
hospital, on a machine the hospital controls, in Bangladesh (`FR-SEC-07`).
Real patient data lives here and nowhere else — not on Supabase, Render or
Vercel, and never in a development or demo database (`FR-SEC-08`,
`FR-IMP-11`).

One command starts the whole stack: the database, the migrations, the API,
the two web apps, a web server that holds the TLS certificates, and a nightly
backup that is checked and copied to a second place (`deploy/docker-compose.yml`,
built from the root `Dockerfile`).

## S1. The machine

- A Linux server (Ubuntu 24.04 LTS is what this was written against) with
  **Docker Engine and the compose plugin**. 4 CPU cores, 8 GB of memory and
  100 GB of disk is comfortable for one hospital; the database grows by
  roughly a gigabyte a year of queues and visits.
- **Three DNS names** pointing at it — for example `app.hospital.com.bd`
  (patients), `console.hospital.com.bd` (staff) and `api.hospital.com.bd` —
  and ports **80 and 443** open to the internet. Certificates are obtained and
  renewed automatically.
- The repository checked out on it: `git clone`, then the commit being deployed.
  **For the reception pilot that is the commit named in `S8`, not `main`.**

  **Before a pilot, the hospital's IT is asked one question, and the answer
  comes back before anything else is set up** (owner's decision,
  2026-10-05). The console only works over HTTPS that every counter PC
  trusts without a warning: the browser will not run its offline part, or
  let it sign its own actions, on anything else. How will this server be
  reached?

  1. **By publicly resolvable HTTPS names**, as above: three names in DNS,
     ports 80 and 443 reachable from the internet. This is the path this
     guide describes and the only one that is built.
  2. **Only from inside the hospital's network.** Nothing here covers that
     yet. Automatic certificates need the public names, so this needs another
     way for the counter PCs to trust the server. It is not built on a guess:
     if a hospital chooses this, the smallest design that works for *their*
     network is agreed first (`docs/PLATFORM_PLAN.md`, P5).
- **A second place for backups** that is not this server's disk: an external
  drive, or a folder on another machine mounted here. It has to exist before
  the pilot starts (`S5`); the stack runs without it and says, every day,
  that its backups are failing.

## S2. Configure

```bash
cp deploy/.env.example deploy/.env
```

Fill in `deploy/.env`:

| Value | What to put |
|---|---|
| `APP_ORIGIN`, `CONSOLE_ORIGIN`, `API_ORIGIN` | The three names, as `https://…` |
| `POSTGRES_PASSWORD` | A long random password (the command is in the file). This is the **owner**: it runs the migrations and the backups and serves no request |
| `API_DB_USER`, `API_DB_PASSWORD` | The role the **API** connects as, and a second, different password from the same command. It can read and write rows and nothing else (`S6`). Created on the first start |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `GUEST_LINK_SECRET`, `TOTP_ENCRYPTION_KEY` | Four **different** random values of 64 hex characters. The last encrypts every administrator's two-step verification (pilot step 28): a restored database needs the same value, so keep it with the other secrets |
| `PAYMENT_PROVIDER` | `off` — patients pay at the hospital. bKash and Nagad arrive with merchant accounts (`CLAUDE.md` §1.1) |
| `SMS_PROVIDER` | `log` until an SMS aggregator is arranged (pilot step 27). Patients then follow their serial from the link on the booking screen |
| `ADDRESS_RATE_LIMIT_FACTOR` | `1` unless patients will book from the hospital's own network. The API limits what one address may do in ten minutes (30 phone checks, 10 standby places, 10 emergency alerts), and a waiting room on the hospital's Wi-Fi is one address: the 31st patient would be told to wait. `10` allows ten times each limit; the most is `100`. The limits on a single phone number are not affected |
| `BACKUP_AT_UTC_HOUR`, `BACKUP_KEEP_DAYS` | When the nightly backup runs (20 UTC is 02:00 Dhaka) and how many days are kept |
| `BACKUP_SECOND_DIR` | The folder on **another disk or machine** every backup is copied to (`S5`). Empty means backups stay on this disk and the backup service reports itself failing |
| `BACKUP_VERIFY_RESTORE` | `true`: each night's dump is restored into a scratch database to prove it restores. Needs free disk the size of the database |

`deploy/.env` holds the hospital's secrets. It is ignored by git and by the
image build; keep a copy somewhere safe off the machine, because a backup is
useless without the password that opens it.

## S3. Start, and the first administrator

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

The first build takes ten to fifteen minutes. Then the facility and its first
administrator — nobody can be given an account from a screen until one exists
(`FR-SUP-01`):

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec api \
  pnpm staff:create --hospital-code MARKS --email admin@hospital.com.bd --name "Full Name" \
  --hospital-name-bn "…" --hospital-name-en "…" --kind hospital --division Dhaka --district Dhaka
```

It prints a temporary password once. Sign in at the console address; the
first sign-in asks for the person's own password, and then — because this is
an administrator — sets up **two-step verification** (`FR-SEC-10`): an
authenticator app on their phone (Google Authenticator, Microsoft
Authenticator or any like them) scans the QR code on the screen, and ten
recovery codes are shown once, to write down or print. No console opens until
that is done, and every sign-in after asks for the code from the app. From
there, **সেটিংস খুলুন**
on the dashboard sets up departments, doctors, schedules, wards and staff
(`S-B-11`), and **পুরোনো তথ্য আমদানি করুন** brings in what the hospital's
own system already holds (`S-B-14`). A doctor appears to patients once their
BMDC number is verified:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec api \
  pnpm doctor:verify --bmdc A-12345
```

Then **পর্যালোচনার অনুরোধ করুন** in settings asks for the hospital to go live, and a platform administrator approves it (below).

### A lost phone

An administrator resets anyone else's two-step verification from `S-B-11`
(**দুই ধাপের যাচাই রিসেট করুন** on the person's row); their next sign-in asks
for none, or sets it up again if they are an administrator. With the phone
lost, a recovery code signs in once. When the facility's only administrator
has lost both, platform staff reset it on the server, after confirming who is
asking:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec api \
  pnpm staff:reset-2fa --email admin@hospital.com.bd
```

Both are written to the audit log.

### The platform administrator, and going live (V3.1, V3.2)

A hospital does not publish itself. Its administrator sets it up on `S-B-11` and **asks for review**; a **platform administrator** approves it on `S-B-12`, and until then nothing of the hospital is public (`FR-ONB-04`). So a deployment needs one platform administrator, and its first comes from the command line, once:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec api \
  pnpm staff:create --platform --email ops@example.org --name "Full Name"
```

It prints a temporary password once; the first sign-in changes it and sets up two-step verification, as for any administrator. **From there no command is needed for a hospital**: on `S-B-12`, *নতুন হাসপাতাল যোগ করুন* creates a hospital's workspace and its first administrator (the temporary password is shown once, to hand over), each doctor's BMDC number is verified beside the doctor, and the hospital's request is approved or sent back with a reason. `pnpm staff:create --hospital-code …` and `pnpm doctor:verify` above still work and are no longer the way.

On a deployment that holds a single hospital it is still two accounts, by design: the hospital's administrator and the platform's. A hospital that was already live before 0037 stays live.

**A hospital can also apply by itself (plan D1, `FR-ONB-09`).** The console has a public form at `/?apply=1`, linked from the sign-in screen. It makes a workspace that is setting up and its first administrator, with a password of their own, and nothing public: the hospital still goes live only by the review above. On `S-B-12` such a workspace carries **নিজে আবেদন করেছে**, with the phone and registration number it gave, so that somebody can ring it; one that should not go on is closed there with a reason. The form is limited to five an hour per address, and `ORG_APPLICATIONS_OPEN_MAX` (200) is how many applications may wait unanswered on the whole deployment before the form says it is paused. **Nothing switches the form off.** The shared deployment is what V1 is built for (`FR-SEC-07`); a server that holds one hospital only still offers the form on its sign-in screen, and what it would make is a workspace nobody approves.

### An SMS aggregator (when there is an account; plan H2)

Until an aggregator is arranged, `SMS_PROVIDER=log` stays: messages are
recorded and marked sent, and nothing leaves the server. **None of what
follows can be done before a hospital agreement and an aggregator account
exist** (`CLAUDE.md` §1.1). It is written down so that the day there is one,
switching it on is these settings and a restart.

What the aggregator has to give you, and where each goes in `.env`:

| Setting | What it is |
| --- | --- |
| `SMS_PROVIDER=http` | Send through an aggregator reached over HTTPS |
| `SMS_API_URL` | The address the aggregator takes a message at |
| `SMS_API_KEY` | The key it issued. Sent as `Authorization: Bearer <key>` |
| `SMS_SENDER_ID` | The sender name or number it registered for you. Masking and the regulator's approval of it are arranged with the aggregator |
| `SMS_DLR_SECRET` | The secret it signs delivery receipts with. Long and random. Without it every receipt is refused |

The server refuses to start with `SMS_PROVIDER=http` and any of the other four
missing.

**What this server sends** for each message, as JSON:
`{ "to": "+8801…", "text": "…", "senderId": "…", "reference": "<our id>" }`,
and it expects back, with a 2xx, `{ "id": "<the aggregator's id>" }`.

**Where the aggregator sends delivery receipts:**
`POST https://<your API address>/api/v1/webhooks/sms-dlr`, as JSON
`{ "id": "<the aggregator's id>", "status": "…", "reason": "…" }`, with the
header `x-signature` holding the HMAC-SHA256 of the request's body, in hex,
under `SMS_DLR_SECRET`. A status of `delivered`, `delivrd` or `success` marks
the message delivered; `failed`, `undelivered`, `undeliv`, `rejected` or
`expired` marks it failed, with the reason; anything else is taken as not
final and changes nothing.

**An aggregator will not speak exactly this.** Each names its fields its own
way, and the one above is what the adapter was built and tested against, not
any company's API. When the aggregator is chosen, compare its documents with
the two shapes above. If they differ, the difference is one file beside
`backend/api/src/adapters/smsHttp.ts` with the same four members (`send`,
`reportsDelivery`, `verifyReceipt`, `readReceipt`); nothing that calls it
changes. Ask for that change before going live, not after.

**After switching it on:** book one serial with a number you hold, and check
that the SMS arrives, that its row in the hospital's settings (*এই মাসের
এসএমএস*) counts it as sent, and that within a minute or two it counts it as
having reached the phone. If the second never happens, the receipts are not
arriving or are failing their signature: the API's log says
`delivery receipt signature rejected` for the second.

A message that fails is tried again five times over about twenty minutes and
then marked failed; the platform's screen shows which hospital has failed
messages (`S-B-12`, *অবস্থা*).

### bKash and Nagad (when there are merchant accounts; plan H3)

**Nothing here moves real money until every box below is ticked on the
provider's own sandbox, and then once with a real taka.** The code was built
and tested against stand-in servers that speak what bKash and Nagad publish;
it has never talked to either provider (`docs/PLATFORM_PLAN.md` X2).

**As built, one merchant account per provider for the deployment**, with
collections settled to each hospital (`FR-PAY-05`). Whether instead each
hospital is paid into its own merchant account is the founders' decision
(`docs/STATUS.md`, question 17); it changes how an adapter is chosen, not
anything that decides whether to charge.

Settings (in `.env`, never in the repository):

| Setting | What |
|---|---|
| `PAYMENT_PROVIDER` | `live`. `off` offers paying at the hospital only; `mock` is refused in production |
| `BKASH_BASE_URL` | The sandbox address bKash gives you (`https://tokenized.sandbox.bka.sh/v1.2.0-beta` at the time of writing); the live address only after the checklist. **There is no default**: bKash is not offered until it is set |
| `BKASH_APP_KEY`, `BKASH_APP_SECRET`, `BKASH_USERNAME`, `BKASH_PASSWORD` | From bKash, per merchant |
| `NAGAD_BASE_URL` | The sandbox address Nagad gives you; no default |
| `NAGAD_MERCHANT_ID`, `NAGAD_MERCHANT_NUMBER` | From Nagad |
| `NAGAD_PUBLIC_KEY` | Nagad's payment-gateway public key (PEM body or whole PEM) |
| `NAGAD_PRIVATE_KEY` | The merchant's private key; the public half is registered with Nagad. Keep it as you keep `JWT_*` |

A method appears in the patient app only when its settings are complete
(`GET /config` `paymentMethods`). Card has no adapter and is not offered.

**The sandbox checklist**, for each provider, on a staging server with
`PAYMENT_PROVIDER=live` and the sandbox address:

1. A booking with that method shows the held screen, the countdown and the pay button.
2. Paying on the provider's page returns to `/pay/return` and shows **পরিশোধ হয়েছে**; the payment's history (`GET /payments/:id/history`) reads created, redirected, asked, paid; `provider_ref` holds the provider's transaction id.
3. Cancelling on the provider's page returns and shows **বাতিল করেছেন**; the retry starts a new attempt with the same deadline; paying it succeeds.
4. Closing the provider's page without paying: after the hold, the serial is pay-at-the-counter (or released, on a booking that had to be paid first), and the SMS says so.
5. Paying, then closing the tab before the return: the timer finds the payment paid within a minute of the deadline at the latest.
6. Opening `/pay/return?payment=…&booking=…&status=success` by hand for an unpaid attempt: it does **not** say paid.
7. bKash only: a refund from the administrator's screen reaches the sandbox wallet; the payment reads refunded. Nagad: the refund is made in Nagad's merchant panel and recorded by hand with its reference.
8. The API's log, after all of the above, holds no transaction id, no wallet number and no token (`grep` it).
9. Whatever the provider itself requires before going live (its own test cases, an IP allow-list, a certificate): done and recorded (`docs/PLATFORM_PLAN.md` X9).
10. **Things the code assumed that only the sandbox can confirm:** bKash's grant takes the username and password as headers and the token as `Authorization` with `X-APP-Key`; `Completed` is the only paid status and execute after a cancel is not attempted; Nagad accepts our 32-character order id, the `X-KM-IP-V4` header set to `127.0.0.1` (the patient's address is not sent), and answers `verify/payment` with `status`, `amount` and `issuerPaymentRefNo`. Any of these wrong is a change to one adapter file and its stand-in test.

Then one real payment of the smallest fee, refunded, before the first patient.

### Import suggestions from a model (optional, off by default)

The import maps a hospital's own export with rules and the administrator's choices, and needs nothing else. A model can additionally suggest columns for the headings the rules do not know (`FR-IMP-16`). It is switched on in `deploy/.env`:

```
MAPPING_PROVIDER=claude
MAPPING_API_KEY=…          # an Anthropic API key
```

**What leaves the server when it is on:** for a file whose headings are not already known, the column *headings* and what kind of value each column holds. Never a row, never a patient (`FR-IMP-17`). To see exactly what would be sent for a given file before switching anything on:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec api \
  pnpm mapping:try --set patients --file /path/to/export.csv
```

It costs one short request per new export format; a format a hospital has confirmed once is remembered and costs nothing. If the provider is unreachable or the key is wrong, the import screen says suggestions are not available and carries on without them.

## S4. Updating

```bash
git pull
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

The `migrate` service runs on every `up` and applies only migrations the
database has not seen; the API waits for it to finish. Take a backup first
(`S5`) — migrations are forward-only.

**A server first started before plan 1.7** needs two things once, before
that `up`: `API_DB_USER`, `API_DB_PASSWORD` and `BACKUP_SECOND_DIR` added to
`deploy/.env` (`S2`), and the uploaded files handed to the account the API now
runs as, because the volume was made by a version that ran as root:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env run --rm --user root --no-deps --entrypoint chown api -R node:node /data/files
```

## S5. Backups, and putting one back

Every night the `backup` service writes three files to `deploy/backups/`:
`db-<stamp>.dump` (the whole database), `files-<stamp>.tar.gz` (uploaded lab
reports) and `sums-<stamp>.sha256` (their checksums), and removes those older
than `BACKUP_KEEP_DAYS`. A night is not counted as a backup until three
things have happened:

1. **The dump has been restored** into a scratch database on the same
   server, which must hold at least what the live one held when the dump
   began; the scratch is then dropped.
2. **The files archive reads back.**
3. **Both have been copied to `BACKUP_SECOND_DIR`** and their checksums
   match there.

`BACKUP_SECOND_DIR` is a folder on **another disk or another machine** the
hospital controls — an external drive, or a share from a second machine
mounted on this server. A backup on the same disk does not survive the disk.
They hold patient data: not a service outside Bangladesh without the
hospital's agreement (`FR-SEC-07`). The stack cannot tell whether the folder
you name really is another disk; that is for whoever sets it up to make true.

**Whether last night worked is visible without reading a log:**

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env ps backup          # healthy, or unhealthy
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec backup sh /deploy/backup.sh check
```

The second prints one line — `backup ok: 20261002-200003, checked by restore,
copied to the second location, 9 hours ago`, or `backup FAILING:` and the
reason. It fails when the last run failed, when no second location is
configured, and when the last good backup is more than 26 hours old
(`BACKUP_MAX_AGE_HOURS`).

**The API says the same, and more, at its readiness address** (plan I2), so
one address tells whoever watches the server how all of it is doing:

```bash
curl -s https://api.<your-domain>/readyz
```

`data.signals.attention` is empty when nothing is wrong. Otherwise it holds
fixed words: `backup_failed`, `backup_stale`, `backup_none` (the backup has
recorded nothing in a day of the server running), `messages_overdue` (the
sender is not sending), `worker_late` (something the server does on a clock
has stopped). The rest of `signals` gives the ages and counts behind them.
None of it makes the API unready: a failed backup is not a reason to stop a
reception desk. A free uptime checker pointed at that address and set to
look for an empty `attention` is an alert; this repository sets none up,
because it needs an account somebody owns. Until one exists, **somebody has
to look each morning**.

A backup on demand:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env run --rm backup once
```

Putting one back **replaces everything** with the backup's contents. On a new
machine — the old disk is gone — configure `deploy/.env` with the **same**
values as before, copy the backup files into `deploy/backups/`, and start the
database alone first (`docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d db`); then:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env stop api console patient
docker compose -f deploy/docker-compose.yml --env-file deploy/.env run --rm --entrypoint sh backup \
  /deploy/restore.sh /backups/db-<stamp>.dump /backups/files-<stamp>.tar.gz
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d
```

Practise this once on a spare machine before the pilot starts; a restore
nobody has run is a hope, not a backup.

Trying this on Windows in Git Bash: run `export MSYS_NO_PATHCONV=1` first, or
Git Bash rewrites `/deploy/restore.sh` and `/backups/…` into Windows paths
before Docker sees them. A Linux server needs nothing.

## S6. What runs how on this server

- **`NODE_ENV=production`, `DEMO_MODE=false`.** No demonstration banner data,
  no password-less picker, no seeding: `db:seed` and `db:reset` refuse to run
  under `NODE_ENV=production` whatever `DEMO_MODE` says, and the image sets
  it, so no flag typed on this server truncates its database (`FR-SEC-08`).
  Staff sign in with their own accounts (`FR-SEC-06`).
- **Files on the server's disk** (`STORAGE_PROVIDER=local`, a named volume),
  served only through signed, expiring links.
- **No online payment** (`PAYMENT_PROVIDER=off`): the patient app offers
  paying at the hospital only, and the API refuses any other method before
  writing anything. It never pretends a payment was taken.
- **SMS recorded, not sent** (`SMS_PROVIDER=log`) until pilot step 27. The
  API's log gets one line per message, naming the message and its template;
  no phone number, no text and no sign-in code is ever printed. What a message
  said is in the `notifications` table, without its link, for 90 days.
- **A guest proves the phone with a code** before booking (`FR-GST-03`) — on by
  default whenever `DEMO_MODE` is off.
- **Administrators sign in with two-step verification** (`FR-SEC-10`); any
  other account may turn it on from the console picker.
- **Errors go to the containers' logs** (`docker compose logs api`); nothing is
  sent to an error-reporting service. Each container keeps five files of ten
  megabytes and drops the oldest, so the logs cannot fill the disk.
- **The API does not own the database.** It connects as `API_DB_USER`, which
  reads and writes rows and cannot change the schema, empty a table, create a
  role, or alter or remove an audit row. `POSTGRES_USER` owns the database
  and is used only by the migrations and the backup (`DATABASE.md` §5.1).
  **Hospitals are separated by the database itself** (plan B1, migration
  0043, `DATABASE.md` §5.2): the API's role does not bypass row-level
  security, and a member of one hospital's staff cannot reach another
  hospital's rows whatever a route or a query forgets. This holds because the
  API connects as its own role and not as the owner; **`pnpm db:role` must
  have run after the upgrade that brings 0043**, which the `migrate` service
  does by itself on every start. An API left connecting as `POSTGRES_USER` is
  not bound by any of it.
- **The API and the two web apps do not run as root** inside their
  containers. The database, the web server and the backup run as their images
  ship them.
- **Each service reports its own health** (`docker compose ps`): the API is
  healthy only while it can reach the database; the web server waits for the
  three it serves; the backup is healthy only while last night's backup is
  good (`S5`). Nothing restarts or alerts on it — it is there to be read.

## S7. When something is wrong

| Symptom | Look at |
|---|---|
| A site shows a certificate error | DNS for that name does not point at this server yet, or port 80 is blocked (Let's Encrypt needs it): `docker compose … logs web` |
| The API never becomes healthy | `docker compose … logs migrate api` — usually a value missing from `deploy/.env`; the API lists every problem at once. `password authentication failed` for `API_DB_USER` means `migrate` did not finish: it is what sets that password |
| `backup` is `unhealthy` | `docker compose … exec backup sh /deploy/backup.sh check` says why. `only on this disk` means `BACKUP_SECOND_DIR` is empty (`S2`) |
| An upload fails after an update, with `EACCES` in the API log | The files volume was made by a version that ran as root: `S4` |
| The console signs in but shows nothing | The facility has no departments or doctors yet: `S-B-11` |
| A patient cannot find the hospital | Not live yet, or no doctor's BMDC number verified (`S3`) |
| Every administrator's two-step code is refused after a restore or a move | `TOTP_ENCRYPTION_KEY` is not the value the database was written with (the API log says the secret does not open). Put the old value back; failing that, `pnpm staff:reset-2fa` each administrator (`S3`) |

## S8. The reception pilot: which code, and the dry run

**The code.** The reception pilot is deployed from one exact commit, and the
dry run and any first deployment use that same commit (owner's decision,
2026-10-05):

```
fb1d1d816c8204f68fe1c0c95666baf68b0dbb76
```

```bash
git fetch origin
git checkout fb1d1d816c8204f68fe1c0c95666baf68b0dbb76
git rev-parse HEAD        # must print the line above, and nothing else
```

Not `main`: `main` is the demonstration's release of 27 September and has
none of the pilot's work on it, and it is not moved for this. That commit
passed the whole gate here and all three CI jobs, the reception pilot's own
path under the production configuration among them
(`e2e/production/reception-pilot.prod.spec.ts`). If the dry run finds a real
blocker, only that is fixed, on a small branch, the gate is run again, and
the new commit replaces the one above, here, before anything is redeployed.

**What the pilot is.** One hospital on its own server and database, one
department, one to three chambers, reception only: staff sign-in,
registration at the counter and walk-ins, doctor arrived, call next, done,
late, absent, bring back, pause and resume, undo, end chamber, and the four
counters on the console. Pay at the hospital. Outside it for now: the
doctor's screen, the ward board, the ER console, the lab, the pharmacy, the
patient app and live tracking, SMS, online payment.

**The dry run**, on the hospital's own hardware and network, before any real
patient. Each step either passes or is written down as what happened.

1. The stack starts from one command (`S3`); `GET /api/v1/config` says
   `demo: false`; the database holds no demonstration data.
2. The first administrator is made by the command in `S3`, signs in, sets up
   two-step verification and keeps the recovery codes.
3. A department, the doctors and their schedules are entered in settings;
   today's and tomorrow's chambers appear.
4. A receptionist's account is made in settings and signs in **from every
   counter PC**, with no certificate warning on any of them.
5. A whole mock chamber on the reception console: register twenty walk-ins,
   doctor arrived, call, done, late, absent, bring back, pause, resume, undo.
6. The network cable is pulled mid-chamber: five actions are taken, the page
   is reloaded, the cable goes back. All five arrive once, in order.
7. Two counters on one chamber press *next* together: one calls the patient,
   the other is told the queue moved.
8. The chamber is ended. The next morning only that day's chamber is
   offered, and anything left from the day before says which day it is from.
9. The nightly backup runs to the second disk; it is restored onto a spare
   machine and the administrator signs in there (`S5`).
10. The morning check is written down and given to a named person: the
    backup is healthy and the API is ready (`docker compose … ps`).
11. The operating rules are agreed with the desk: nobody changes shift with
    a pending count showing; if the server is out of reach the queue on
    screen is still worked and new patients go on paper; a chamber is ended
    by a person.
12. The counter PCs' clocks are right, and each uses one supported browser.
