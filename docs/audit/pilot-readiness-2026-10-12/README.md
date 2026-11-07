# MedLiveBD pilot-readiness audit — 12 October 2026

**For:** the founders, deciding whether the existing Patient App, Hospital
Console and API can carry a controlled pilot at the first hospital that signs.
**Scope:** the software as it exists. No new features, no redesign; the
company website and `mvp` are not touched.
**Companion files:** [FINDINGS.md](FINDINGS.md) (the register),
[MATRIX.md](MATRIX.md) (workflow → evidence → remaining risk),
[CHECKLIST.md](CHECKLIST.md) (progress).

> This is the **initial** report (Phase 3). Sections marked *Phase 5* are
> completed after remediation and the second audit.

---

## 1. What exists (Phase 0)

### 1.1 Branches and where each product lives

| What | Branch / commit | Notes |
|---|---|---|
| Company website (live at medlivebd.com) | `mvp` = `origin/mvp` = `cd2a676` | `mvp` holds only the site work past `97f578c`'s ancestors; not touched by this audit |
| Newest Patient App, Console, API | `fix/release-audit-2026-10-11` = `8eec772` (local only) | 31 commits not in `mvp`: the console redesign (`8d81ce8`…`97f578c`) and the 11 October release-audit fixes |
| Deployed public demo | `main` = `demo` = `99e4c5e` (9 October) | Predates the console redesign; Supabase Singapore, Render, Vercel, `DEMO_MODE=true` |
| This audit | `audit/pilot-readiness-2026-10-12` | Cut from `8eec772`; fixes are local commits |

Other worktrees found (none modified by this audit):
`HealthCare-company-site` (clean), `HealthCare-lab-pharmacy` and
`HealthCare-ward-emergency` (clean; their work is already integrated and their
tips are *older* than the integrated versions — merging them would regress),
`HealthCare-site-cinematic` (`mvp`, three untracked zip files),
`HealthCare-site-mvp` (clean), and `HealthCare-independent-audit-97f578c`
(a Codex session's detached worktree: regenerated screenshots and its own probe
files only, no source edits). The main checkout carried ~230 regenerated
screenshots, kept untouched and also saved as a git stash entry
(`pre-audit snapshot 2026-10-12`).

**Unmerged work:** everything after `97f578c` that matters for the product is
on `fix/release-audit-2026-10-11`, not on `mvp`. Nothing was pushed, merged or
deployed by this audit.

### 1.2 Architecture

- **API:** Node 22, Express, Socket.IO, Kysely over PostgreSQL 16 + PostGIS;
  ~77 k lines; 194 routes, each classified in `tenantMatrix.test.ts`.
  Layering is lint-enforced (routes → controllers → services → repositories).
- **Database:** 61 forward-only migrations; row-level security binds every
  request to its principal's scope (hospital, patient, guest link, national,
  open); the API connects as a role that owns nothing.
- **Queue engine:** an append-only event log reduced by one shared reducer
  (`shared/domain`), session row locks, idempotency keys on every write.
- **Patient App:** Next.js PWA, Bangla-first. **Console:** Next.js, offline
  outbox in IndexedDB (per person, per device).
- **Background work:** in-process database-driven ticks (offer expiry, payment
  holds, daily chambers, message sender, purges), safe across restarts.
- **Real-data deployment (designed, not yet running anywhere):**
  `deploy/docker-compose.yml` — Postgres, migrations, API, both apps, Caddy
  (TLS), nightly verified backup.

### 1.3 Integrations: what is simulated

| Integration | State on the real-data stack |
|---|---|
| SMS | `log`: nothing leaves the server. Adapter for an HTTP aggregator built, never run against a real one |
| bKash / Nagad | `off`: pay at the counter. Adapters built against stand-ins, never against the providers |
| File storage | `local` disk, signed expiring links |
| Maps / travel time | static matrix |
| Import mapping model | off by default |
| Hospital HMS, national records | none |

---

## 2. Baseline: the existing tests (Phase 2, first step)

| Command | Result |
|---|---|
| `pnpm typecheck` | Pass |
| `pnpm lint` | **Out of memory (exit 134)** on the default heap; pass with 3 GB ([F-06](FINDINGS.md#f-06)) |
| `pnpm format:check` | Pass |
| `pnpm test` (unit, UI, API, schema) | **168 files, 8,081 tests, all pass** (653 s) |
| `pnpm audit` (production and all) | No known vulnerabilities |
| Secret scan of tracked files | No credentials; one placeholder connection string in DEPLOY.md |
| `pnpm test:e2e` (development browser suite) | *Running at the time of writing; result in §6* |

A green baseline is not the claim. The previous team's suites are thorough,
especially the tenant matrix (every route, two hospitals). The audit's own
probes went where those suites do not look.

---

## 3. Independent testing done

Written for this audit (`backend/api/src/__tests__/pilotAudit.routes.test.ts`,
plus a scratch race probe kept outside the repository):

1. **What a patient is handed back** after acting on their own serial — found
   [F-01](FINDINGS.md#f-01).
2. **Replay keys across chambers and hospitals** — found
   [F-02](FINDINGS.md#f-02); across hospitals the database's row policies held.
3. **Twelve guests booking the last place at once** — exactly one serial,
   eleven `SESSION_FULL`, five distinct serials. Pass.
4. **Malformed input on every mounted route** — four hostile parameter values
   (nil UUID, non-UUID, SQL-shaped, `%00`), three hostile bodies (wrong types,
   5,000-character Bangla, `$gt` objects, role escalation fields), hostile
   query strings and broken JSON, as nobody and as staff holding every role:
   **no 5xx anywhere**. Pass.
5. **Two counters advancing one chamber at once** — the console's own path
   refuses the second tap correctly; the unused `/next` route does not
   ([F-03](FINDINGS.md#f-03)).
6. **Deployment configuration rendered** with `docker compose config` — found
   [F-05](FINDINGS.md#f-05).

Static review covered: authentication (staff scrypt, lockout, refresh rotation
with reuse detection, TOTP with replay protection, patient OTP limits),
authorisation middleware, database scoping, realtime room admission and
payloads, file upload validation and signed downloads, CSV export injection,
idempotency, booking capacity locking, bed locking, offline sync role checks,
timers across restarts, environment validation, CORS and security headers,
frontend storage and HTML injection, backup and restore scripts.

---

## 4. Initial findings (Phase 3)

Thirteen items; full entries in [FINDINGS.md](FINDINGS.md).

- **High:** [F-01](FINDINGS.md#f-01) patient-facing answers leaked other
  patients' identifiers and reception's remarks;
  [F-05](FINDINGS.md#f-05) switching SMS on would stop the self-hosted API;
  [F-08](FINDINGS.md#f-08) demo lab prices on real orders (lab module only);
  [F-09](FINDINGS.md#f-09) hospital-wide doctor access (policy).
- **Medium:** [F-04](FINDINGS.md#f-04) a production storage setting that
  boots and then refuses every upload; [F-07](FINDINGS.md#f-07) backups and
  host not hardened; [F-10](FINDINGS.md#f-10) national cohort suppression;
  [F-11](FINDINGS.md#f-11) no online booking until SMS is live.
- **Low:** [F-02](FINDINGS.md#f-02), [F-03](FINDINGS.md#f-03),
  [F-06](FINDINGS.md#f-06), [F-12](FINDINGS.md#f-12), [F-13](FINDINGS.md#f-13).

**Verified as working, not just present** (see [MATRIX.md](MATRIX.md)):
cross-hospital isolation on every route (existing matrix, re-run green) and
for replay keys (new probe); capacity under concurrency; the console's queue
race handling; malformed-input robustness; Doctor draft and signing safety
(C1/C2 suites re-run green in the baseline); refresh-token reuse revocation;
offline outbox persistence per person and device.

**Not verifiable from here:** a real SMS aggregator, bKash, Nagad, the
Bangladesh server, its DNS and certificates, CI (no access from this session),
a physical hospital rehearsal, real devices on a hospital network.

### Initial readiness assessment

**NOT READY** at `8eec772`, for two reasons inside the code — F-01 (privacy
leak to patients) and F-05 (the documented SMS switch-on stops the API) — and
because no real-data server exists yet to verify recovery on.

### Remediation order

1. F-01 (privacy), 2. F-05 (deployment outage), 3. F-04 (silent upload
failure), 4. F-02 (lost actions on key collision), 5. F-06 (tooling), then the
documentation of F-03, F-11, F-12, F-13. F-07 to F-10 need the owner or the
server, not code.

---

## 5. Remediation (Phase 4)

Five fixes, each its own commit on `audit/pilot-readiness-2026-10-12`, each
with a regression test, none changing a clinical workflow, permission or
business rule:

| Commit | Finding | Change |
|---|---|---|
| `0b08285` | F-02 | A replay key is honoured only in its own chamber; elsewhere `IDEMPOTENCY_KEY_REUSED` (online) or a conflict (offline batch) |
| `be85999` | F-01 | Patient and tracking-link callers of cancel, late and undo get the patients' copy of the queue; staff answers unchanged |
| `6fcc75b` | F-04 | Production refuses `STORAGE_PROVIDER=supabase` |
| `fcc92b4` | F-05 | Compose passes the SMS URL, receipt secret, monthly cap and bKash/Nagad settings; `deploy/.env.example` lists them and states what `SMS_PROVIDER=log` means for patients (F-11) |
| `d7cbbb7` | F-06 | `pnpm lint` runs ESLint with a 4 GB heap |

Escalated rather than changed, because each is a policy or an outside
dependency, not a bug: F-07 (server hardening and backup encryption), F-08
(lab prices), F-09 (doctor access scope), F-10 (national suppression), F-16
(retention). Left as documented Low items: F-03, F-12, F-13, F-14, F-15.

Independently retested after the fixes: the affected API suites (15 files,
802 tests), the rendered compose environment against `env.ts` (refused before,
boots after), and the full gate in §6.

### Recovery drill (synthetic, local)

The real `deploy/backup.sh` and `deploy/restore.sh`, in the stack's own
`postgis/postgis:16-3.4` image, against `medlivebd_drill`, a throwaway copy
of the seeded test database (61 migrations, 1,970 bookings, 1,529 queue
events, 200 patients) plus one uploaded file:

1. `backup.sh once`: dump and files archive written, **restored into a scratch
   database and compared**, copied to the second location, checksums matched:
   `backup ok: 20261013-025716, checked by restore, copied to the second location`.
2. Total loss: the database dropped and recreated empty (0 tables), the
   uploaded file deleted.
3. `restore.sh` **from the second-location copy**: every count back exactly,
   all 119 row-level-security policies present (same as the source), the file
   back. About 6 seconds.

Not covered by the drill: the real server, a realistic data volume, the
`migrate` service re-applying the API role after a restore, and an encrypted
second location (F-07). The DEPLOY.md §S5 rehearsal on the hospital's machine
is still required.

### Bounded load (local)

One chamber, 150 and then 240 patients' phones subscribed to its live
serial, a receptionist advancing ten times: every phone had each new state
within 270 ms median / 594 ms worst (150) and 567 / 709 ms (240). Details and
the pool-contention observation: [F-15](FINDINGS.md#f-15). This is one
developer machine, not the hospital's server or network.

## 6. Second audit and verdict (Phases 5–6)

*Completed after remediation.*
