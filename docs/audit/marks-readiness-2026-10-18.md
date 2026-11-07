# MARKS demonstration and 60-day pilot readiness — 18 October 2026

**For:** the founders, deciding what to authorise before showing MedLiveBD to
MARKS Medical College Hospital and before a 60-day pilot there.
**Code assessed:** `audit/pilot-readiness-2026-10-12` @ `b7bee62` (the newest
Patient App, Console and API; 39 commits not on `mvp`).
**Evidence:** synthetic seeded data on the local Docker database only. No code
was changed by this assessment. Builds on the 12 October audit in
[pilot-readiness-2026-10-12/](pilot-readiness-2026-10-12/README.md), whose
second pass (full gates on the fixed code) had never been run.

## 1. Verdict

| | |
|---|---|
| Overall | Feature-complete V1, not yet release-gated, never run on a real server |
| Demonstration ready | **YES, conditional**: from a controlled build, warmed up, the presenter types the details (A1–A5) |
| Real-patient pilot ready | **NO**: no server, gate red, decisions outstanding (part B) |
| Time to demonstration-ready | 1 day from a laptop; 3–5 days for the public demo |
| Time to pilot-ready | 2–4 weeks elapsed for reception at the counter, mostly waiting on MARKS IT and the dry run |

## 2. What was run (18 October)

The browser suites' own global setup truncates and reseeds the local synthetic
`healthcare_dev`, as always. Supabase, the public demo, `main`, `demo` and
`mvp` were not touched. The 228 review screenshots the specs regenerate were
restored to their committed versions afterwards.

| Command | Result | Meaning |
|---|---|---|
| `pnpm verify` | **Pass**, 169 files / 8,110 tests (456 s) | Includes the tenant matrix, queue replay/conflict, RLS, auth |
| `pnpm test:e2e` (346 cases) | **344 / 346** (1.1 h) | Every module end to end. Failures: `console-access.spec.ts:390` (doctor draft emptied after a token refresh; passed alone) and `lab-report.spec.ts:574` (fixture used up by the case before it; fails every full run) |
| `pnpm test:e2e:prod` | **79 / 84** (10.3 min) | Three canary-file failures: the fixture picked a test-created hospital with no receptionist. Two `reception-pilot.prod.spec.ts` failures: the spec expects the picker the 10 October access redesign replaced |
| Production canary alone | **6 / 6** | Reception tap reaches the patient in under 2 s, demo off, limited DB role |
| `pnpm test:e2e:built` | **3 / 3** | Offline reload, second reload keeps queued work, an unopened chamber says so |
| Doctor workspace + lab journey rerun | **12 / 12** | The lab journey failed once on a cold dev server (doctor screen missed reception's call for 10 s), then passed |

The two patient specs CI reported red on `mvp` (Padma's portal title,
`patient-search.spec.ts:96` burn search) pass on this branch.

### The doctor-draft failure, in detail

The trace's own mount diagnostic read `{"referencePresent":true,
"sameElement":false,"originalStillMounted":false}`: after the refresh the
diagnosis editor was unmounted and replaced by an empty one. The same assertion
failed once during Registration Batch 3B (10 October).

## 3. Critical remaining issues

1. **Demo.** The public demo is the 9 October build (`main` = `demo` =
   `99e4c5e`). It lacks the console redesign and every fix since: Doctor
   C1/C2, Reception C3/C4, F-01 (patients sent other patients' queue details).
   No migration is needed to release them: `main` and this branch both end at
   `0063`.
2. **Demo, privacy.** The public demo accepts and stores any phone number typed
   into it, in Singapore, until the daily refresh (`FR-SEC-08`). The owner's
   fix of 12 October (a configured list of synthetic identities under
   `DEMO_MODE`) was not built.
3. **Gate.** Red on three test defects (order-dependent canary fixture, stale
   reception-pilot spec, used-up lab fixture). The reception-pilot spec is the
   pilot's own path, so that path was unchecked on the new code.
4. **Clinical.** Intermittent loss of an unsaved diagnosis on a routine token
   refresh (above).
5. **Pilot.** No real-data server exists; the S8 dry run and a restore on target
   hardware have never been done. S8 still names `fb1d1d8` (5 October), older
   than tenant isolation, the redesign and every safety fix since.
6. **Pilot.** No SMS: no online booking or patient sign-in on the real stack
   (F-11). The pilot is counter-only until an aggregator is live.
7. **Decisions.** Hospital-wide doctor access (F-09), demo lab prices on real
   orders (F-08), no retention or erasure policy (F-16).

## 4. Module by module

“Verified” means exercised by a run on 18 October or by a named suite re-run in
the 12 October audit.

### Patient PWA — demo-ready; pilot needs SMS
- **Implemented:** network search with figure age; guest and account booking;
  live serial with ETA and freshness; late, cancel; standby offers; records
  wallet with consent; document upload (content-sniffed, size-capped);
  emergency search ranked by capability and freshness, “I'm on my way”; bed
  requests; medicine availability; branded portal and install; Bangla default.
- **Verified:** patient-search, guest-booking, guest-phone-proof, two-device,
  standby, wallet, emergency-burn, portal-install, patient-account,
  language-switch.
- **Incomplete:** payments mock (demo) / off (real); static travel time; no
  push; family accounts, ambulance, blood out of V1; refresh token in
  `localStorage` (F-13, accepted).
- **Needs production validation:** OTP and guest booking with a real SMS
  aggregator; real phones on 3G; `ADDRESS_RATE_LIMIT_FACTOR` for hospital Wi-Fi.

### Reception — demo-ready; strongest pilot module
- **Implemented:** multi-chamber desk; four-step registration with household and
  identity confirmation; atomic, replay-safe walk-ins; every queue action incl.
  undo, pause/resume, standby offer, check-in, end chamber; offline outbox with
  exactly-once replay.
- **Verified:** reception-workspace, registration-workspace,
  counter-registration, offline-console, console-undo, pause-resume,
  chamber-end, no-show-recovery; production reception, offline, undo, pause.
- **Incomplete:** `reception-pilot.prod.spec.ts` stale; registration lookup caps
  at 20 without saying so; offline reload shows serials without names
  (decision 88); `POST /sessions/:id/next` unguarded (F-03, no screen uses it).
- **Needs production validation:** counter PCs trusting the server's HTTPS; two
  counters on one chamber on the real network.

### Doctor — demo-ready; pilot blocked
- **Implemented:** encounter-owned editor; server drafts with revision checks;
  Sign & Next bound to the booking; test ordering; custom follow-up; 30-minute
  delay; prescription printed from the signed record; consent-gated history,
  every read audited.
- **Verified:** doctor-workspace 11/11, doctor-safety, doctor-console,
  doctor-midnight; production doctor-safety.
- **Incomplete:** intermittent draft loss on refresh; unsaved writing lost on a
  forced close (documented); no login-to-doctor link, so access is
  hospital-wide (F-09).

### Beds and wards — demo-ready
- **Implemented:** admit, discharge, transfer, reserve, cleaning, out of
  service, expected discharge; patient bed requests; public capacity with
  freshness; publishing switch.
- **Incomplete:** an ER admission needs a phone at the ward desk; offline the
  board says it could not load; occupancy is set on go-live day, never imported.

### Emergency — demo-ready
- **Implemented:** ER console; inbound alerts; cases with acknowledge/update;
  capabilities; referrals out and in with timeline.
- **Incomplete:** blood stock not built; `in_treatment` unused; travel times are
  placeholders; today's referrals only.

### Laboratory — demo-ready; pilot needs a price decision
- **Implemented:** bench queue with turnaround; PDF report upload (sniffed,
  10 MB); lost-reply replay that confirms only its own upload; signed expiring
  links; delivery to the wallet.
- **Incomplete:** prices from `DEMO_TEST_PRICES` in `lab.service.ts` whatever
  the mode (F-08); no catalogue administration; import set D not built.

### Pharmacy — availability only
- **Implemented:** in/out of stock flags that lapse to “unknown” after 12 hours;
  conflict-safe review; public search.
- **Not built, by scope (CLAUDE.md §4.5):** inventory quantities, batches,
  expiry, purchasing, dispensing.

### Administration — demo-ready
- **Implemented:** Today board; nine report categories, twelve CSV exports;
  every setting (departments, doctors, schedules, fees, wards and beds, staff
  and roles, desks, modules, branding, publishing); import with mapping;
  platform onboarding; national dashboard.
- **Incomplete:** billing not in this version; no department filter; national
  suppression by observations, not facilities (F-10).

### Auth, security, notifications, infrastructure
- **Implemented:** scrypt passwords, lockout, refresh rotation with reuse
  detection, administrator TOTP, immediate revocation; patient OTP with limits;
  row-level security on every request, API on a role that owns nothing; audit
  rows; CSP; production refuses demo mode, mock payments, unsafe storage; Docker
  stack with Caddy TLS and a self-checking nightly backup.
- **Incomplete:** backups unencrypted; no alerting; no off-site copy; images
  built on the server; one API process; no LAN-only mode; no wildcard
  certificate; SMS adapter never run against a real aggregator.

## 5. Execution plan

Efforts are estimates for one engineer.

### A. Before the MARKS demonstration

| ID | Work | Severity | Where | Effort | Verified by |
|---|---|---|---|---|---|
| A1 | Fix the three test defects | High | `e2e/support/console.ts` `createConsoleSession`; `e2e/production/reception-pilot.prod.spec.ts`; `e2e/lab-report.spec.ts` | 0.5–1 day | Full `test:e2e:prod` and `test:e2e` green |
| A2 | Explain and fix the doctor-draft loss on refresh | High | Console access revalidation and the Doctor editor | 1–2 days | `console-access.spec.ts:390` repeated, dev and built; doctor-safety |
| A3 | Choose what MARKS sees; merge into `mvp` and, on the owner's word, release | Critical | Git, `docs/DEMO_GUIDE.md` | 0.5 day + gate | Full gate on the merge commit; the guide's walk on the public URLs |
| A4 | Demo accepts only configured synthetic identities | Critical | Docs first, then the API's phone-taking routes | 1.5–2 days | Refusal-before-write tests per route; strict gate |
| A5 | Rehearse; wake the API; open every console once; talk track for what is simulated or absent | Medium | `docs/DEMO_GUIDE.md` | 0.5 day | Timed rehearsal on two devices |

### B. Before real patient data and the pilot

| ID | Work | Severity | Effort |
|---|---|---|---|
| B1 | MARKS IT's S1 answer: public HTTPS names or hospital network only (LAN-only not built) | Critical | 3–5 days to build if LAN-only |
| B2 | Name and gate the pilot commit; replace `fb1d1d8` in `DEPLOY.md` S8 | Critical | 0.5 day + gate |
| B3 | Server, DNS, second backup disk, hardening, uptime check on `/readyz` (F-07) | Critical | 1–2 days ops |
| B4 | The 12-step S8 dry run on MARKS hardware, restore drill, load check | Critical | 2–3 days |
| B5 | Pilot modules: Doctor needs F-09 accepted and A2 closed; Lab needs F-08 decided; otherwise off | High | Decision; 3–5 days for a catalogue |
| B6 | Data agreements: controller, retention and erasure (F-16), import (`FR-IMP-11`/`12`) | High | Legal |
| B7 | SMS aggregator; adapter matched to its real format | High | 1–3 days after the account |
| B8 | `ADDRESS_RATE_LIMIT_FACTOR`; disk sized for files and 14 nights of backups | Medium | Hours |
| B9 | Desk operating rules (S8 steps 10–11) | Medium | A meeting |

### C. After pilot launch

Encrypted off-site backups; guard or retire `/sessions/:id/next` (F-03) and
patient undo (F-12); registration lookup says when more than 20 match;
pre-built images; penetration test before the second real hospital;
scale-out (Socket.IO adapter, shared files) only when one server is not enough.

## 6. MARKS server requirements

- **Minimum (one hospital, 1–3 departments):** 4 vCPU, 8 GB RAM, 200 GB SSD,
  Ubuntu 24.04 LTS, Docker Engine + compose plugin, public static IP, ports 80
  and 443, three DNS names, a second disk or machine for backups.
- **Recommended:** 8 vCPU, 16 GB RAM, 500 GB SSD (RAID 1 or snapshots);
  full-disk encryption on server and backup disk; SSH keys only; firewall
  22/80/443; automatic security updates; UPS; external uptime check on
  `/readyz`.
- **Capacity:** measured locally, 240 phones on one chamber got each update in
  0.57 s median / 0.71 s worst. One API process. Nightly backup only (up to a
  day at risk). Updates rebuild on the server (downtime). No LAN-only mode, no
  wildcard certificate.
- **Bangladesh-hosted shared option:** the same stack on a Bangladeshi VPS;
  meets `FR-SEC-07`; tenant isolation is built and tested. The dry run is
  needed on whichever machine holds the data. Indicative costs:
  `docs/reports/MEDLIVEBD_INFRASTRUCTURE_COST_AUDIT.md` Part 6.

## 7. HMS integration

- **Exists:** CSV and `.xlsx` import of sets A (structure), B (patients) and C
  (appointments) with mapping, check, preview, approval, all-or-nothing write,
  undo and audit; MARKS's own identifier kept per row, so re-import updates;
  optional model mapping suggestions from headings only (`FR-IMP-17`); twelve
  CSV report exports; a 193-route REST API built for MedLiveBD's own apps.
- **Missing:** knowledge of MARKS's HMS; service accounts or scoped API keys; a
  published API specification; outbound events; import set D; a read-only
  database connector or FHIR R4 feed (`FR-IMP-09`, later, not before the HMS is
  known).

## 8. Decisions needed

- **Owner:** public demo or laptop; releasing `main`/`demo` (§4.6).
- **Owner and MARKS:** pilot departments and modules; F-09 in writing or Doctor
  off; Lab prices or Lab off.
- **MARKS IT:** public names or hospital network only; who holds the server and
  backup disk; who does the morning check.
- **Legal:** data controller, retention, erasure, import agreement.
- **Company:** SMS aggregator and sender ID.

## 9. Not verified

A real SMS aggregator, bKash or Nagad, any Bangladeshi server or hospital
network, CI on this branch, real devices, a physical rehearsal.

## 10. Remediation (18 October, after this assessment)

Recorded in `docs/STATUS.md`, *Latest work*.
