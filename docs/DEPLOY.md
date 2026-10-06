# Deploying the pitch demo

Three services: the database on **Supabase**, the API on **Render**, the two
web apps on **Vercel**. Roughly forty minutes the first time.

This deploys the **pitch version** (`CLAUDE.md` §1.1). Everything it serves is
seeded demonstration data, every row is labelled as such (`FR-DEM-07`), SMS is
written to a log rather than sent, and payments always succeed. That is the
correct configuration for showing a hospital director what the product does —
not a staging environment on its way to production.

`docs/STATUS.md` records what is and is not built. At the time of writing that
is the patient app and the reception console; the doctor console, wallet, beds,
emergency and admin dashboard are later build steps.

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

1. **Patient** → pick a specialty → pick the doctor and the chamber → fill in
   name, phone and age → confirm. You get a serial.
2. Tap **লাইভ সিরিয়াল দেখুন**. This is `S-A-08`, the screen the product is for.
3. **Console** → it opens on a picker: choose the hospital, then the chamber
   the patient booked, then **রিসেপশন**. There is no password, and the screen
   says so.
4. Tap **পরবর্তী রোগী ডাকুন**.

The patient's *এখন চলছে* changes within two seconds, the progress bar advances
and the estimate moves. That is the product (`NFR-01`), and
`e2e/two-device-queue.spec.ts` is the test that keeps it true.

Also worth showing: **আমি দেরি করছি** and **বাতিল করুন** on the patient screen
both write real events the console sees, and the Render logs print every SMS
the demo would have sent.

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
- **Not a build.** The API runs TypeScript through `tsx` rather than compiled
  output. Fine for a pitch; a bundler decision before a pilot
  (`docs/STATUS.md`).
- **Not private.** Anyone with the console URL can open a console, because
  authentication is deferred (`CLAUDE.md` §4.1) and the demo picker is what
  stands in for it. Share the link accordingly.
- **Not holding real data, ever** (`FR-SEC-08`). If a real patient's details
  are ever typed into this deployment, reset it.


---

# Part S — On a hospital's own server in Bangladesh

> **Read this first (owner, 2026-10-05).** The default for real patients is
> now **one shared platform hosted in Bangladesh**, every hospital a workspace
> inside it (`FR-SEC-07` as amended, `CLAUDE.md` §1.2). This part was written
> for one hospital on a machine of its own, and it stays true for that case,
> which is now the exception: the reception-pilot candidate in S8 is such a
> deployment. The stack is the same on a shared machine. What a shared one
> needs that is not here yet: hospitals kept apart by the database before a
> second real hospital joins (`FR-SEC-11`, `PLATFORM_PLAN.md` 1.10), and an
> address for each hospital's portal (`FR-BRD-04`).

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
configured, and when the last good backup is more than 26 hours old. Nothing
sends this anywhere yet: **somebody has to look at it each morning** until an
alert exists.

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
  unless `DEMO_MODE=true` is set on purpose. Staff sign in with their own
  accounts (`FR-SEC-06`).
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
  **Hospitals are not yet separated by the database itself**: that is plan
  1.10, and until then the separation is the API's own checks.
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
