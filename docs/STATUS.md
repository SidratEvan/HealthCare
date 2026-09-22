# Status

Where the build actually is, and what a new session needs to know that is not
already in `CLAUDE.md` or derivable from `git log`.

**Update this at the end of every step.** It exists so that handing the work to
a fresh session costs one file read instead of a re-explanation, and it is only
worth that if it is true.

Last updated: `feat/beds` — step 14. A ward keeps its beds true on a board,
and the number a family sees on their phone is the one the ward's own screen
says the app is showing.

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
| 11 | `feat/notifications` | merged — migration 0010, templates, the outbox, SMS/push adapters |
| 12 | `feat/doctor-console` | merged — migration 0007, `S-B-05`, the visit record, `FR-DOC-10` + audit. **E-prescriptions dropped**; `PRD.md` §9/§24/§26 and `APP_FLOW.md` B2 edited to match |
| 13 | `feat/wallet` | merged — `S-A-12`, the consent handshake (`BTN-A12-QR` → `BTN-B05-SCAN`), the access log and revoke. A pasted code stands in for the QR |
| 14 | `feat/beds` | merged — migrations 0008 + 0012, `S-B-06` the ward board, `<CapacityMirror>`, `S-A-11` bed search and bed requests, the ward's half of `FR-OFF-01` |
| 15 | `feat/emergency` | **next** — triage, search ranking, inbound alerts, ER console. `emergency_cases` already exists (0008) |

Three unplanned branches after step 11:

- `chore/deploy` — the `S-B-01` console picker, `render.yaml`, Vercel configs
  and `docs/DEPLOY.md`.
- **`feat/app-shell`** — hospital-first discovery and the patient app shell.
  Asked for directly by the owner: the booking flow went specialty → doctor,
  and he wanted specialty → hospital → doctor, which is what `APP_FLOW.md`
  always said. He also said the patient side "does not look anything like an
  app", so the same branch adds `NAV-A`, the manifest and the service worker.
  See below.
- `fix/console-past-midnight` — two date bugs that only appear in the first six
  hours of a Dhaka day. See *Things learned the hard way*.

Both of the last two were unplanned, and neither is a build step: nothing in
`CLAUDE.md` §4 is skipped or brought forward.

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

**Step 11 notifies from the queue, not from a cron.** A material event is
turned into messages by `notification.service`, the rows are written inside the
queue transaction and sent after it commits. `pg-boss` is deliberately not
installed (see the open decisions): every message this version sends is caused
by an event, so nothing needed a scheduler. The two jobs that genuinely do —
the leave-home alert and send-retry — are noted under the deliberate gaps.

`pnpm test` reports 2073.
`pnpm test:e2e` reports 66, in Chromium, against the real API and the seeded
demo database — 5 in `two-device-queue.spec.ts`, 18 in `guest-booking.spec.ts`,
5 in `offline-console.spec.ts`, 12 in `app-shell.spec.ts`, 7 in
`doctor-console.spec.ts`, 3 in `console-cold-start.spec.ts`, 8 in
`wallet.spec.ts`, 8 in `ward-board.spec.ts`.

### The demo API sleeps, and the console now says so

Render's free tier spins the API down when nobody is using it, and the first
request afterwards takes the better part of a minute. `fetch` has no timeout of
its own, so `S-B-01` sat on its loading skeleton for as long as the page stayed
open — the one `GR-03` state with no way out, because nothing ever rejected. It
was seen on a phone opening the deployed console shortly after a deploy, which
is precisely when the API is restarting.

The picker now gives each attempt twelve seconds (`AbortSignal.timeout`), tries
four times, says **সার্ভার চালু হচ্ছে** from the second attempt onward, and ends
at an error with a retry rather than a skeleton. Four attempts is a product
decision about a sleeping backend, not a test detail, which is why
`console-cold-start.spec.ts` declares a longer budget instead of trimming it.

Worth knowing when demonstrating: **open the console once a minute before
showing anyone.** Nothing is broken if the first load is slow; it is the free
tier waking.

### Step 14 — the ward board, and what the public is shown

**The definition of done is a comparison, and the E2E makes it.**
`ward-board.spec.ts` opens the ward board in one browser context and the
patient's bed search in another, and holds `<CapacityMirror>`'s published
figure and the phone's count to the same number before and after an admit.
The API suite does the same arithmetically: the board's own tally
(`tallyByKind` in `shared/domain`) equals the view's row, kind by kind.

**Schema.** 0008 creates all seven tables DATABASE.md §7 names for it —
`emergency_cases` and `referrals` are schema for steps 15–16, as 0007 was for
the lab. 0012 holds one view, `v_public_hospital_capacity`; the other `v_*`
views read tables later steps create, and a shipped migration is never edited,
so each arrives with its own step. The columns DATABASE.md §2.5 lacked are now
in it, each with the control that needed it.

**One state machine, two users.** `shared/domain/src/beds/board.ts` is the
API's guard and the console's optimistic update, the way the reducer is the
queue's. A discharged bed goes to *cleaning* and a person frees it — no timer
frees a bed nobody has looked at. A lapsed hold counts as free everywhere at
once; the logged `RELEASE` (by nobody) is written when the board or the pending
list is next read, and a bed about to be acted on is swept first. No scheduler
was needed.

**A hold is a real bed.** Holding a request reserves a bed of the kind asked
for, so the public count knows about the promise. `release` refuses a bed held
for a request — answer the request instead, so the family is told.

**Names are read on purpose.** Tiles, broadcasts and the board response carry
no patient. The bed panel and `LIST-B06-PENDING` do, each read writes
`audit_log`, and both need the connection: a copy cached on a shared ward
computer would be a read nobody logged.

**Offline** (`FR-OFF-01`, the owner's choice of full writes): a separate bed
outbox in `shared/client`, because the queue's is built around one session's
batch and each bed route is replay-safe on its own. Oldest first; a refused
action is dropped and rolled back; an unreachable one holds back everything
after it. The mirror shows "the board says N — the app still shows M" while an
admit is queued.

**Bed requests.** `POST /bed-requests` is public like a guest booking, returns
a signed status token (the `bed_request` audience on the guest-link secret),
and the phone keeps it — no SMS is sent until the hospital answers. Hold and
decline go out as `bed.request_held` / `bed.request_declined`. The status page
counts a hold down in minutes and says "expired" the moment it runs out.

**Demo data** (`FR-DEM-04`). 29 wards and 170 beds at the four facilities with
ward staff; the diagnostic centre and the clinic have none and the app says "no
inpatient beds", not "0 free". ICU at exactly Shapla, Padma and Karnaphuli
(Buriganga lost its ICU on the owner's ruling); burn units at Padma and Jamuna.
137 admissions (134 occupied beds, 3 just discharged into cleaning), four
pending requests (one held, at Shapla's cabins). Staged for the emergency
scenario: Padma's ICU full, one fresh free burn bed at Padma, two free burn beds
at Jamuna that nobody has confirmed for hours. The commit that added the seed
(`6626c87`) says 180 beds; 170 is the count.

**Freshness decays, and that is the point.** A kind's stamp is its newest bed
event. With the default ten-minute threshold, every ward turns amber ten minutes
after a reset unless someone touches the board. Before showing the burn
scenario, reset or tap a Padma burn bed.

**How to show it.** Console → pick Shapla → বেড বোর্ড খুলুন. Admit into a free
general bed at the desk; the mirror's general row drops by one, and a phone on
`/beds?kind=general` shows the same number on its next read. For a request:
phone → বেড অনুরোধ করুন → the ward's pending list → বেড রাখুন → a bed → a
duration; the phone's status page counts down.

**Supabase does not have any of this yet.** It needs `pnpm db:migrate`
(0008, 0012 — additive) and then a reseed for the beds to exist, and the
reseed is the destructive `db:reset`. Both touch the remote demo database, so
both are the owner's to run (`ALLOW_REMOTE_DB=1`, plus
`ALLOW_DESTRUCTIVE_DB=1` for the reset).

### Step 13 — the wallet, and consent

**The wallet is this device's, like the serials tab.** There are no accounts
(`CLAUDE.md` §4.1), so `S-A-12` opens every tracking link the phone holds and
shows the signed record each one carries (`FR-GST-08`). A link has four
outcomes — a record, booked-but-not-seen, expired, no answer — and each is
counted and said separately. A failed request is never shown as "no records".
When Supabase Auth lands, the page becomes one call to
`GET /patients/:id/records`, which already exists and already refuses
everybody it should.

**Consent is a handshake.** The phone asks for a code (`BTN-A12-QR`), states
the scope and the grant's length *before* showing it, and the doctor console
redeems it (`BTN-B05-SCAN`, `POST /consents/qr`). Redeeming writes the
`consents` row and its `audit_log` row together; opening the history writes
another. The patient's access log (`BTN-A12-ACCESS`) lists each hospital with
its state as a word, a revoke on the live ones, and every staff read.
Revocation is a timestamp (`DB-P2`).

**The code is pasted, not scanned** — see open decision 28. Between two
windows on one laptop it copies and pastes; between two phones it does not
travel, which is the one place the demo is weaker than the requirement.

**A guest can speak for their own booking's patient, under `DEMO_MODE` only**
— open decision 27. Without it nothing on the patient side can offer consent
or read an access log, because nothing on the patient side has an account.

**The route is `/consents/qr`, as `BACKEND.md` §7.6 names it.** The first
commit on this branch served it at `/consents/redeem`; the document wins
(`CLAUDE.md` §2), so it was renamed. §7.6 had no row for minting the code or
for the access log, and now has both.

**The console card clears when the patient changes.** It is keyed on the
booking in the chamber, so a consented history is never on screen when the
next person walks in — a wrong allergy history is worse than none.

**No consent or audit rows are seeded.** Every seeded patient is unreachable
from a phone (no `guest_links` are seeded, for the reason under *How to open
the live serial screen*), so seeded grants would appear on no screen. The
wallet fills during the demo itself: book, let the doctor sign, and the record
is there (`PRD.md` §24 step 6).

**How to show it.** Book on the phone, sign on the doctor console, open রেকর্ড.
Then কোড দেখান, copy it into the doctor console's code field, and রেকর্ড
খুলুন. Back on the phone, কে দেখেছে shows the hospital and the reads, and
অনুমতি বন্ধ করুন ends it.

### Step 12 — the doctor console and the visit record

**Migration 0007 landed behind 0010, and that is fine.** The runner applies
whatever a database has not seen, in filename order, so a fresh build runs
0007 before 0010 and an existing one runs it after. The dependency runs the
other way: 0010 deliberately left `feedback` out *because* its foreign key
needs `visits`, and 0007 creates both. 0007 also creates `medicines`,
`prescriptions`, `prescription_items`, `test_orders`, `reports`,
`patient_documents` and `consents` — the set `DATABASE.md` §7 names — so steps
13 and 17 are screens rather than schema.

**Prescribing is out of scope, not deferred.** The owner dropped it on
2026-09-19 ("no need for e prescriptions"). `FR-DOC-04`, `FR-DOC-05` and
`FR-DOC-07` are marked **not in this version** in `PRD.md` §9, `PRD.md` §24
step 6 and §26 P2 are rewritten, and `APP_FLOW.md` B2 now says which of its
controls exist. What a consultation produces is a visit record — diagnosis,
Bangla advice, follow-up date — which is what the wallet reads at step 13.

**`BTN-B05-SIGN` writes the record, then advances the queue.** In that order,
because `APP_FLOW.md` B2 fixes the failure mode: if the record does not save,
the consultation is not marked done and the draft stays on screen. The two are
not one transaction — `callNext` owns its own lock and dispatches notifications
after committing — so the window is *record committed, queue not yet advanced*,
and a second tap recovers it because `upsertVisit` is idempotent on the booking
and keeps the original `signed_at`. The recoverable order was chosen over the
atomic one deliberately; the alternative loses a record.

**Picking "doctor" in the console picker now opens the doctor console.** It
always opened reception before, whatever was chosen, which made that button a
lie. `DemoSession` carries the role; unrecognised roles land on reception,
because `hospital_admin` is `S-B-10` at step 19 and a blank screen would be
worse than a queue.

**`useReceptionQueue` is now `useSessionQueue`**, because both consoles use it.
Same socket, same reducer, same offline log — which is what makes `FR-QUE-53`
hold: the doctor's *next* and reception's *next* serialise against each other
only because both screens read the same state from the same place.

**Demo data in the same branch.** 500 signed visit records, each with a
diagnosis and Bangla advice *paired to the complaint the booking already
carried* (`assessmentFor` in `seeds/data/reference.ts`), a ten-medicine
formulary, and pre-visit intake — duration, chronic conditions, current
medicines, allergies — on every seeded booking. `FR-DOC-03` puts all four on the
doctor's screen, and the panel distinguishes *none declared* from *nobody asked*
because those are different facts.

### The patient app is an app now (`feat/app-shell`)

Two things the owner asked for directly, in one branch.

**Discovery asks for a hospital first.** `APP_FLOW.md` titles `S-A-07`
"Specialty results (**hospitals offering it**)" and the code asked for a doctor
straight after the specialty. The flow is now specialty → hospital (`S-A-07`) →
doctor (`S-A-05h`) → session → confirm, which is both what the document said and
what he asked for. Two endpoints carry it:

- `GET /hospitals?specialty=CARD` — only hospitals that offer the department,
  each card carrying the doctor count for *that* department, how many chambers
  are running now, and how many serials are still open today. Without a
  `specialty` the doctor count is null, because a count across every department
  answers a question nobody asked.
- `GET /hospitals/:id/doctors?specialty=CARD` — new. What a hospital card opens
  onto. Ordered by who is in a chamber now, then by who sits next; a doctor with
  no upcoming chamber sorts last rather than being hidden.

Both responses carry an `asOf` the server stamps, and both lists render
`<FreshnessLine>`: "who is sitting now" is a live figure and `FR-PAT-14` does
not let one on screen without its age.

**The shell.** `NAV-A` (four tabs, labels always visible per `ICO-03`, safe-area
inset), a web manifest, a service worker, and `S-A-02` Home composed to the
canvas order — emergency, then care, then convenience. The service worker
**never answers an API request from a cache**: a serial from a cache is a number
with no age (`FR-OFF-03`). It caches the shell only, so the app opens on a bad
connection and shows its own offline state rather than the browser's error page.

**`S-A-09` My serials lists this device's bookings, not an account's**, and says
so on screen. There are no accounts (`CLAUDE.md` §4.1), so a guest's identity is
one tracking link per booking; `APP_FLOW.md` A1.5 already accepts that
multi-device access for a guest is "only via the SMS link". `lib/bookings.ts`
holds the records in `localStorage`, tokens included — the token is already in an
SMS on the same phone, is scoped to one booking, and expires. When Supabase Auth
lands, that file becomes a call to `GET /me/bookings`.

**Four tabs lead to screens that are not built** — profile (`S-A-19`), ambulance
and blood (step 17), emergency (step 15). Records was the fifth until step 13,
and beds the sixth until step 14. Each says what will be there and why it is not, rather than being
hidden, greyed out, or a dead link. Hiding them would move the bar as the
product grows and teach the wrong muscle memory.

**The emergency screen carries `BTN-A10-999` and nothing else.** Triage is step
15, but the red card is the most prominent control in the patient app and it
leads here, so the screen offers the one emergency action this version can
honestly perform: a real `tel:999` link, above the fold, with the conditions
that mean *call first* named beside it. It does not rank hospitals, and it says
that it does not.

**A failed list no longer borrows the empty list's words.** The two discovery
lists used to render "no hospital offers this department" when the request had
simply failed. That is a statement about the world standing in for a statement
about us, which `PRD.md` §3.2 forbids; there is now a distinct `failed` state
with a retry (`Loadable<T>` in `frontend/patient/src/lib/types.ts`).

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
- **A date is Dhaka's or it is wrong, and the gap is six hours wide.**
  Postgres `current_date` and `now() AT TIME ZONE 'Asia/Dhaka'` name different
  days between 00:00 and 06:00 in Dhaka, and two separate bugs lived in that
  window — found only because a session happened to run at 01:05 Dhaka.
  - `GET /demo/consoles` filtered sessions on today's Dhaka date, so a chamber
    that opened at 23:50 and was still running at 01:07 offered no console. It
    hit the demo hardest: `FR-DEM-06` builds the pitch session by walking a
    mid-queue log backwards from the present, so a reset in the small hours
    files it under yesterday and the picker then listed nothing running. The
    query now also accepts a session that is *running*, whatever date it
    carries.
  - Three fixtures — `e2e/support/console.ts`, `queueFixture.ts` and
    `seeds/graph.ts` — inserted `session_date = current_date` (UTC) alongside a
    `planned_start` of `now() - 30 minutes`. Every read that filters by day uses
    `toDhakaDate`, so in that window the fixture wrote yesterday and the picker
    asked for today. **The whole E2E suite failed, the canary included**, with
    nothing wrong in the product: 7 passed of 28, every failure a sixty-second
    timeout waiting for a session card the API had correctly excluded. A
    timeout that names the browser and not the date is the worst symptom this
    class of bug has.

  If a session is not appearing and the hour is early in Dhaka, check the date
  before anything else.

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
something uploads a file — `BTN-A12-UPLOAD` (paper records) or the lab's
reports at step 17. Step 13 built neither.

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

Each is implemented one way and flagged rather than settled silently, and
needs an owner's ruling. Number 7 is recorded as settled because the answer
changed the tree; 8 and 9 are the owner's and are not code. They are grouped by
the step that raised them, so the numbering is not contiguous in the file.

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

Raised while building notifications (step 11):

14. **What one SMS costs.** `POISHA_PER_SEGMENT` is 35 in `adapters/sms.ts`, a
   placeholder until an aggregator quotes a rate. It is recorded per message so
   `FR-NOT-06`'s delivery reporting has something to sum, and every figure the
   admin dashboard shows at step 19 is built on it.

15. **Quiet hours are 22:00–07:00 Dhaka**, chosen because no document names
   them. Nothing is suppressed by them today — `FR-NOT-07` exempts queue events
   and every message this version sends is one — so the first template outside
   the `queue.*`, `booking.*` and `session.*` namespaces is when the hours
   start mattering.

Raised while building the app shell (`feat/app-shell`):

16. **`S-A-07` is missing its filters and its search.** The document gives it
   `CHIP-A07-NEAR`/`-WAIT`/`-FEE`/`-OPEN` and `INP-A07-SEARCH` (`FR-PAT-15`),
   and the hospital card is specified to carry distance, travel time, live wait,
   free beds and ICU as well. What is built is the list, the doctor count, who
   is sitting now, serials open today, and freshness. Distance already works
   when a position is passed (`?lat=&lng=`) but nothing asks for one, because
   `S-A-01` location permission is not built. Free beds and ICU, each with
   their own age, joined the card at step 14.

17. **`S-A-05h` exists only as its ডাক্তার tab, inside the booking flow.** The
   document gives it four tabs (ডাক্তার / বেড / টেস্ট / জরুরি), a header of
   bed, ICU and ER-wait stats, and `BTN-A05H-DIRECTIONS` and `-CALL`. There is
   no standalone hospital detail route; a hospital card goes straight to the
   doctor list as a step of `/book`. The বেড tab's content is `S-A-11` (step 14);
   টেস্ট is step 17 and জরুরি step 15.
   `S-A-06d` Doctor detail is likewise skipped — a doctor row goes straight to
   the session picker, which the document allows as `BTN-A05H-BOOK-<doctorId>`'s
   "fast path".

18. **The area on Home is the string `ঢাকা`.** `MOD-A02-AREA` is an area picker
   and there is no location flow, so the header states where the demo's
   facilities actually are rather than leaving the line blank. It is true, and
   it is not a picker.

19. **`BTN-A02-SPEC-ALL`** (সব বিভাগ দেখুন → `S-A-07b` full specialty list) is
   not built, because Home renders every seeded specialty and there is nothing
   left to expand to. It matters the moment the specialty list outgrows one
   screen.

20. **`frontend/` has no vitest project**, so `lib/bookings.ts` — the
   device-local booking store, which has real logic in its date bucketing and
   its pruning — has no unit test. Its behaviour is covered end to end by
   `app-shell.spec.ts` instead. Adding a fourth project pattern
   (`frontend/*/src/**/*.test.ts`) is a config decision worth making
   deliberately rather than in passing.

21. **The PWA icons are SVG only.** `manifest.webmanifest` declares `any` and
   `maskable` SVGs. Chrome on Android installs from those; some older Android
   webviews want a raster 192 and 512, and iOS ignores the manifest icons
   entirely in favour of `apple-touch-icon`, which is currently the same SVG.
   Nobody has installed it on a real handset yet — that is the next thing to
   check on a phone, not in a test.

22. **The service worker's cache is versioned by hand** (`SHELL = 'shell-v1'` in
   `public/sw.js`). Nothing bumps it automatically, and `activate` deletes every
   cache that is not the current name. A stale shell after a deploy is fixed by
   bumping that string; forgetting to is how a deploy appears not to land.

Raised while building the doctor console (step 12):

23. **Nothing joins a console account to a `doctors` row, so `FR-DOC-10` is
   enforced at hospital grain.** A doctor signs in as a `staff_users` row
   carrying the `doctor` role; "their own sessions" is `sessions.doctor_id`,
   which references `doctors`. `DATABASE.md` §2.2 gives `doctors.user_id` as
   "the doctor's own login" — a reference to `users`, which the seeds leave null
   because authentication is deferred (`CLAUDE.md` §4.1). So the individual
   identity the requirement names cannot be checked.

   What is enforced instead: a doctor-role account may read a record only if
   that patient has been booked into a chamber **at their hospital**, or if a
   live consent covers it. A consultant at Shapla cannot open the record of
   somebody who has only ever attended Padma. It is weaker in one specific way —
   a cardiologist at Shapla can read the record of a patient who saw the
   orthopaedist there. Closing that needs a `staff_users ↔ doctors` link, which
   is a schema decision and therefore the owner's. `treatedAtHospital` in
   `clinical.repo.ts` carries the same explanation at the call site.

24. **`MOD-A07-INTAKE` was never built.** `APP_FLOW.md` A4 specifies 4–6
   pre-visit questions — duration, main symptom, chronic conditions, current
   medicines, allergies — and step 9 collects only a reason. `FR-DOC-03` puts
   all of them on the doctor's screen, so the seeds now write them and the panel
   reads them, but **a booking made through the app today carries only the
   complaint**. The doctor's screen says "the patient answered nothing
   beforehand" for those, which is true and is the honest state — but the modal
   is a real gap in step 9 and the panel gets materially better the day it
   lands.

25. **`FR-DOC-09` earnings are the chamber fee times patients seen.** The fee is
   not in the queue state and should not be — the state is the event log reduced
   and a fee is not an event — so the console fetches it once per session from
   the roster, where `DB-P5` already copied it onto every booking. It is absent
   rather than zero when the roster is empty. What it does *not* account for is
   whether anybody actually paid; `payments` is step 18, and until then this is
   "billed", not "collected". The label says আদায় (collected), which will need
   revisiting at step 18.

26. **`visits.follow_up_date` is checked against `created_at`, not `now()`.** A
   check constraint cannot call `now()` and stay immutable, so
   `visits_follow_up_not_past` compares the follow-up to the row's own creation
   date in Dhaka. The effect is right for new rows and means a very old draft
   could be signed with a follow-up that is now in the past. Nothing does that
   today.

Raised while building the wallet (step 13):

27. **A guest may offer consent, read the access log and revoke — under
   `DEMO_MODE` only**, for the patient their own booking names
   (`assertSpeaksFor` in `consent.service`). It is the same kind of affordance
   as the console picker (`CLAUDE.md` §4.1) and is gated the same way, but it is
   a real escalation: a tracking link otherwise reaches one booking's record,
   and consent gives a hospital standing access to the whole history. With
   `DEMO_MODE` off a guest is refused all three, which a test pins. Needs the
   owner's yes or no; if no, the consent half of the wallet is unreachable in
   this version.

28. **`FR-PAT-63` says QR, and the build shows a code.** Drawing a QR needs an
   encoder (e.g. `qrcode`) and scanning one needs a camera pipeline
   (`BarcodeDetector` is native on Android Chrome but not on desktop Chrome, so
   a fallback such as `@zxing/browser` would be needed). Both are new
   dependencies (`CLAUDE.md` §7). The capability is identical and only
   `BTN-A12-QR` and `BTN-B05-SCAN` would change. The code is a signed token, hundreds
   of characters long, which is why it cannot be read aloud and why a QR is the
   real fix.

29. **Durations nobody documented.** A code lives three minutes
   (`CONSENT_OFFER_TTL_SECONDS`) and a grant twenty-four hours
   (`CONSENT_TTL_HOURS`). A grant is always hospital-scoped, never
   doctor-scoped, for the same reason as decision 23: nothing joins a console
   account to a `doctors` row.

Raised while building the bed board (step 14):

30. **Bed-request answers ignore quiet hours.** `FR-NOT-07` exempts emergency
   and queue events; nothing says a bed request's answer is either. It is
   exempt anyway (`ALWAYS_OVERRIDES_QUIET_HOURS` gains `bed`): a hold is
   measured in minutes, and a "your bed is held until 11:30 PM" text deferred
   to seven the next morning is a bed lost without being told.

31. **`bed.request_result` became two keys**, `bed.request_held` and
   `bed.request_declined`. One body with the outcome passed in would put copy
   outside the template table. BACKEND.md §8 is updated.

32. **Freshness means "the ward last told us something about this kind of
   bed".** There is no "the board is still right" action, so a ward whose beds
   genuinely have not changed in an hour looks stale. That is honest but may be
   harsh on a quiet ward; a confirm-the-board heartbeat would be a product
   decision (and a new event type).

33. **Inpatients share the two hundred seeded patients** (`FR-DEM-03`). Nearly
   all of them hold a serial today, so some inpatients also sit in today's OPD
   queues — the pitch session's patients included. Tiles show no names, so it is
   only visible in the bed panel. The alternative, a second population of
   inpatients, would contradict the count `FR-DEM-03` states.

34. **A bed request needs no OTP** — `FR-GST-03` is deferred with the rest of
   authentication. The request is rate-limited by nothing but one open request
   per patient per hospital. Worth a rate limit before a real deployment.

35. **The patient's bed search polls every thirty seconds.** There is no public
   realtime room (the board room is staff-only and sockets require a token), so
   "instantly" (`FR-BED-02`) is true of the published figure and of the ward's
   screen, and within thirty seconds of the phone's. An anonymous read-only
   capacity room would close the gap; it would also be the first
   unauthenticated socket, which is a security decision.

36. **"Two taps at most" (`FR-BED-02`) is counted from the open bed panel.**
   Counting the tile tap too, a discharge is three: tile, action, and the
   confirmation `GR-01` requires. The two requirements cannot both hold
   literally.

37. **Both consoles' offline outboxes live in memory.** `createDexieStore` exists
   and neither console uses it, so a reload with actions queued loses them. The
   reception console has always been this way; the ward board matches it rather
   than being the only one that differs. Wiring Dexie in is a small change for
   both.

38. **Found, not fixed: three freshness lines drop the word "minutes".** The
   reception console, the doctor console and the booking flow's hospital list
   pass a bare number into `updatedAgo`, so they read "হালনাগাদ ৩ আগে". The live
   serial screen and every step-14 screen append মিনিট. Out of this step's
   scope; a one-line `fix/` branch each.

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

## Deploying

`docs/DEPLOY.md` is the runbook: Supabase, then Render, then two Vercel
projects. Three things in it are the ones people get wrong, so they are worth
repeating here:

- **`NODE_ENV=development` on the deployed API, deliberately.** `env.ts`
  refuses to boot with `DEMO_MODE=true` under `NODE_ENV=production`, and that
  guard is right — production means real patients. A pitch demo is not
  production. `TRUST_PROXY_HOPS=1` now carries the one thing `NODE_ENV` used to
  control that matters behind a load balancer.
- **`WEB_BASE_URL` is not cosmetic.** It is half the CORS allowlist *and* the
  origin every booking's tracking link is built from. Wrong, and every SMS in
  the demo points at localhost.
- **Supabase's session pooler, port 5432**, with the password percent-encoded.

**The console has a way in now.** `ConsolePicker` is `S-B-01` standing in for
the login this version does not have (`CLAUDE.md` §4.1): pick a hospital, a
chamber and a role, no password, and the screen says so. Before it, opening the
console meant pasting a token into `sessionStorage` by hand — fine on the
machine that built it, impossible to hand to anybody. `GET /demo/consoles` and
`POST /demo/token` back it, both refused unless `DEMO_MODE` is on.

The token now lives in one place, `console.demo-session`. It used to be written
under that key and read from `console.token`, which was two stores for one
credential.

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

1. **Patient**: `http://localhost:3000` — the home screen, with the emergency
   card, the specialty grid and the bottom navigation. Tap a specialty, then
   **the hospital**, then the doctor, then the chamber; fill in name / phone /
   age and confirm. The success screen shows the serial and **লাইভ সিরিয়াল
   দেখুন** — tap it.
2. **Reception**: `http://localhost:3100`. The console picker (`S-B-01`) opens
   first: choose the hospital, the chamber and the role, no password. There is
   no login screen by design (CLAUDE.md §4.1) and the screen says so. Pick the
   session the booking was made on. The token it mints is stored under
   `console.demo-session`; `e2e/support/console.ts` shows how one is minted
   without the UI.
3. Tap **পরবর্তী রোগী ডাকুন**. The patient's "এখন চলছে" changes within two
   seconds, the progress track advances, and the ETA moves.

The patient's serial is also on **সিরিয়াল** in the bottom navigation and on the
home screen's live strip, both of which read what this device booked.

4. **The doctor's screen** (`S-B-05`): open a second console tab, pick the same
   hospital and chamber but the **ডাক্তার** role. It opens on whoever is in the
   chamber with their pre-visit answers and past visits. Type a diagnosis, tap
   **রেকর্ড দিন ও পরবর্তী** — the record is filed and the next patient is called
   in the same action (`FR-DOC-08`), which reception's tab sees immediately.

That is `PRD.md` §24 step 6, minus the prescription the owner removed from this
version.

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

- **One signature component (`FRONTEND.md` §6) remains.** `<FreshnessLine>`,
  `<QueueTable>`, `<LiveSerialCard>`, `<BedTile>` and `<CapacityMirror>` are
  built and rendering; `<DelaySheet>` lands with the delay flow it belongs to —
  see the next item.

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
- **`FR-DEM-05` is not covered.** `seed_06_ancillary` needs 0011
  (`ambulances`, `blood_donors`, `pharmacy_stock`). The file exists and declares
  what it is waiting for; the seed runner checks its tables before calling it and
  prints the skip with the migration name. It fills in at step 17. `FR-DEM-04`
  (beds) is covered as of step 14.
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
- **`pg-boss` is not installed, so there is no worker process.** Every message
  step 11 sends is caused by an event, so it is raised from the event and needs
  no scheduler — which is more accurate than a 60-second poll, not merely
  cheaper. Two jobs in `BACKEND.md` §8 genuinely need a timer and are therefore
  absent: `queue.leaveNow` (`FR-PAT-32` as a *notification*; the patient screen
  already shows the banner) and `notify.retry` (the log provider never fails).
  `backend/workers/src/index.ts` is still a stub. The outbox is built for this:
  a failed send is a `queued` or `failed` row under a partial index, so adding
  the worker is a subscriber, not a redesign.

- **`notifications` has no `booking_id` column**, because DATABASE.md §2.7 does
  not give it one. The booking travels in `params ->> 'bookingId'`, which is
  what the delivery queries and the send-once dedupe match on. A column would
  be better and needs a document change to justify.

- **Push is recorded as skipped for everybody.** Web Push needs VAPID keys, a
  service worker and a `device_tokens` row, and none of the three exists yet —
  no screen asks for notification permission. So `FR-NOT-02` ("app users get
  push + SMS; non-app users get SMS only") is already *correct* rather than
  stubbed: today every patient is a non-app user, and the adapter says so with
  `no_device_token` rather than pretending.

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
