# Security check before real patients — 7 November 2026

For the owner, and for MARKS Group's IT staff. The question asked: is
MedLiveBD safe to start the MARKS pilot with real patient data, against bugs
and against people trying to break in?

## 1. Answer

**Yes, the software is ready for the MARKS pilot**, once two things are done:
the fix below is released, and the dry run (`DEPLOY.md` S8) is completed on
MARKS's own server. One real problem was found and fixed. No way in was
found. What is left is in how the server and the accounts are run
(section 5), not in the code.

Nobody can promise software with no bugs at all. What this check can say is
that each known way of breaking in was tried against the system as MARKS
will run it, and each failed. The suites that guard the rest passed today on
the released code: 8,171 of 8,171 unit and integration tests, and the browser
suites (two tests passed only when re-run alone, after timing out under load).

## 2. What was checked

**Reading the code**, all of it that decides who may do what:

- sign-in for staff and patients, tokens, two-step codes, lockout, revoking
  access;
- every one of the API's 194 routes and the check in front of each;
- the database's own rules that keep one hospital's rows from another's
  (row-level security on every table), and the limited account the API uses
  to connect to it;
- patient records, uploaded documents and lab files: who may open them, and
  that each opening is logged;
- the live-update channel (the queue screens and phones);
- the two web apps (patient and staff): script-injection, where sessions are
  kept, the browser security policy;
- the server set-up: `deploy/setup.sh`, the Docker stack, the web server
  (Caddy), the firewall, backups and their encryption;
- the libraries the system is built on (`pnpm audit`).

**Attacking a copy.** The API was built and started exactly as on MARKS's
server (production mode, demonstration off, payments off, the limited
database account) on a throwaway database of invented demo data, and 84
break-in attempts were made against it:

| What was tried | Tries | Got in |
|---|---|---|
| Forged, expired, unsigned and wrong-kind sign-in tokens | 10 | 0 |
| Staff of one hospital reading or changing another hospital's bookings, queues, records, beds, tests, emergency cases, payments and staff accounts | 21 | 0 |
| Inside one hospital, doing what the role does not allow: a receptionist opening records or settings, a lab account writing a visit, an administrator making itself a platform administrator, a printed slip's link cancelling a booking | 14 | 0 |
| SQL injection, path traversal to server files, oversized and broken requests | 13 | 0 |
| Demonstration, mock-payment and webhook doors in production | 7 | 0 |
| A foreign website calling the API from a visitor's browser; security headers | 9 | 0 |
| Guessing passwords and codes | 6 | 0 |
| Joining the live-update channel without a token, with a forged one, or for another hospital's chamber | 4 | 0 |

Every staff route needs sign-in and the right role. A wrong password five
times locks the account for fifteen minutes, and a wrong password gets the
same answer whether or not the email exists. Patient phone codes lock after five wrong
tries. The library scan finds nothing in what runs on the server; the
seventeen warnings it gives are all in testing tools, which never run there.

## 3. The problem found, and fixed

**A broken request could put a password or a patient's details in the server
log.** When a request arrives broken — cut off half-way by a weak mobile
connection, which is ordinary in Bangladesh — the server wrote the raw text of
that request into its log. A broken staff sign-in wrote the password; a broken
counter registration wrote the patient's name and phone. A database error
could also copy a row's values into the log. The log's filter blanked named
fields such as `password` and `phone`, but could not see inside a block of
raw text.

**Fixed** on `fix/log-request-bodies` (`64d7d01`): every error written to the
log now keeps only an approved list of technical fields (what failed and
where), and never what somebody sent or what a row holds. A broken request is
answered and logged as an ordinary refusal. Checked on the running copy: the
same broken requests now leave only "request refused" in the log. Tests:
`backend/api/src/__tests__/middleware.test.ts`.

Earlier today, before this check (released to `main` as `bf4ba22`): six
library advisories closed, two of them critical, and the printed token slip's
QR link made view-only (`docs/STATUS.md`).

## 4. Correct by design, noted so nobody is surprised

- **A doctor at MARKS can open the record of any patient MARKS has treated**
  (decision F-09, for MARKS to confirm in writing). Each opening is logged.
  A doctor cannot open a patient MARKS has never treated without the
  patient's consent.
- **The reception phone lookup** finds people by phone number across the
  whole deployment. On MARKS's own server that is MARKS's patients only.
- **`/readyz`** answers anybody with the server's health (database, backup,
  workers). It contains no patient data, and the morning check uses it.
- **Two-step sign-in is required for administrators only.** Other staff,
  doctors included, may switch it on themselves (section 5).
- **The console does not sign itself out when left idle.** Windows locks
  the PC instead (section 5).

## 4b. Added after the check, the same day

- **Staff sign-in only from the hospital's network** (`STAFF_NETWORKS`,
  `deploy/Caddyfile`, `DEPLOY.md` S2). Optional, off by default. When set,
  the staff console does not open outside those addresses and the web
  server refuses every staff sign-in route there, so nobody on the internet
  can guess a staff password or lock an account. Tested against Caddy itself:
  allowed and refused addresses, and fourteen ways of disguising the path
  (capitals, doubled slashes, `..`, percent-encoding, a trailing slash, a
  query): every one refused.
- **Backup files are private to the server's system account.** Each night's
  dump was written readable by every user on the server (the Linux default).
  `deploy/backup.sh` now makes every file it writes, on the server and in
  the second location, readable by its own account only. Checked by a real
  backup in the database image: every file `-rw-------`.
- **The test tools' advisories** closed (vitest 5.0.5, vite 8.3.5, undici
  8.12.3, jsdom 30.1.3). `pnpm audit` lists one left, moderate: `minimatch`
  inside the linter, whose fix is a new major eleven days old that the
  linter does not accept yet. It can only slow a lint run on a developer's
  machine, on patterns this repository writes.

## 5. What MARKS must do (none of it is code)

1. **Install the released commit** named in `docs/STATUS.md`, never an older
   one, and run the dry run in `DEPLOY.md` S8 on MARKS's own hardware,
   restore included, before the first real patient.
2. **Server:** remote login (SSH) with keys only; automatic security updates
   left on; disk encryption on the server and the backup disk; nothing else
   opened on the firewall.
3. **`deploy/.env`**: two safe copies off the server; never emailed.
4. **Set `STAFF_NETWORKS`** to MARKS's public address once the hospital is
   approved, and check one counter can still sign in.
5. **Doctors switch on two-step verification**, since a doctor's account can
   open records (`docs/MARKS_START_HERE.md` §8).
6. **Windows locks every counter and doctor's PC after 5 idle minutes**;
   staff lock it when stepping away and sign out at the end of the shift.
7. **When somebody leaves**, switch their account off the same day. It signs
   them out everywhere at once.
8. **Sign the data agreement** (who controls the data, how long it is kept,
   how a patient asks for it to be erased — decision F-16). That is legal
   work, not software.

## 6. Recommended before a second hospital, not before MARKS

- A penetration test by an outside firm, once the company is registered
  (`docs/PRD.md` §4.2b).
- Making two-step verification required for doctors, and an idle sign-out in
  the console itself: each a product decision for the owner, then a small
  branch (`FR-SEC-10`). For MARKS, `STAFF_NETWORKS`, the doctors' own
  two-step and Windows' screen lock cover both.
