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
GitHub. Render and Vercel both deploy from a branch — use `mvp`.

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

**New → Web Service**, from the repository, branch `mvp`.

`render.yaml` at the repository root carries the settings. If Render does not
pick it up, the four that matter are:

| Setting | Value |
|---|---|
| Region | Singapore |
| Build command | `corepack enable && pnpm install --frozen-lockfile` |
| Start command | `pnpm --filter @platform/api start` |
| Health check path | `/healthz` |

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
