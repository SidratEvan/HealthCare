# Product Requirements Document (PRD)
## National Healthcare Platform — Bangladesh

**Document:** PRD.md — 1 of 4 (`PRD.md`, `APP_FLOW.md`, `FRONTEND.md`, `BACKEND.md`)
**Version:** 1.0
**Owner:** Sidrat — Technical Founder
**Audience:** the build agent (Claude Code), future engineers, and pitch reviewers
**Product name:** **MedLiveBD** (owner, 6 October 2026) — referred to in this document as **the Platform**

> **How to use this file.** This is the source of truth for *what* to build and *why*.
> It does not prescribe file structure, frameworks, endpoints, or component names —
> those live in `FRONTEND.md` and `BACKEND.md`. When code and this document disagree,
> this document is right until it is explicitly changed.
> Every requirement has a stable ID (e.g. `FR-QUE-04`). Reference IDs in commits and PRs.

---

## Table of contents

1. Problem and vision
2. Who this is for
3. Product principles (the rules that settle arguments)
4. Scope: v0 prototype, v1 pilot, V1 platform, v2 scale
5. Roles and permissions
6. Core concepts and domain glossary
7. Functional requirements — Patient app
8. Functional requirements — Reception console
9. Functional requirements — Doctor app
10. Functional requirements — Ward / bed board
11. Functional requirements — Emergency console
12. Functional requirements — Diagnostics and pharmacy
13. Functional requirements — Hospital admin dashboard
14. Functional requirements — Platform super-admin
14b. Data import from a hospital's existing system
14c. Hospital onboarding, the patient network, and branded apps
15. Functional requirements — Government / national layer
16. The Live Queue Engine (the moat, specified in detail)
17. Notifications and messaging
18. Localisation and accessibility
19. Offline behaviour and data freshness
20. Payments and money flow
21. Security, privacy, and compliance
22. Non-functional requirements
23. Demo data for the prototype
24. The pitch demo script
25. Success metrics
26. Release plan
27. Out of scope
28. Open decisions

---

## 1. Problem and vision

### 1.1 The problem

Healthcare in Bangladesh runs on information that exists only inside a building.

- A patient books a "serial" but has no idea when the doctor will actually arrive, so families wait three to four hours in corridors.
- Doctors get delayed by traffic, surgeries, and multiple chambers. Nobody downstream is told.
- A patient who arrives late loses their serial entirely.
- Reports and prescriptions live on paper. Lost paper means repeated tests and money spent twice.
- In an emergency, families drive from hospital to hospital asking whether a bed, an ICU, or a burn unit is free. Minutes decide outcomes.
- Hospitals lose money to no-shows, unmanaged queues, and referrals that leak to other facilities — and they cannot see any of it.

Existing apps list doctors and take bookings. None of them own the **live state** of a hospital.

### 1.2 The vision

**One app for healthcare in Bangladesh**, built on a simple inversion:

> Every competitor treats hospital information as a static listing.
> The Platform treats hospital operations as live state.

Two sides, one system:

- **Public side** — patients and their families book, track, navigate, and keep their records.
- **Institutional side** — hospitals run their queues, beds, emergencies, diagnostics, and money through consoles their staff actually prefer to paper.

The institutional side is the product. The public app is the distribution. Neither works alone.

### 1.3 Why now

- Private facilities provide roughly two-thirds of care and hold the majority of registered beds, so a pilot can start without waiting for government procurement.
- The government has already committed to digital health record infrastructure with open APIs, so the Platform can integrate rather than compete.
- Smartphone penetration and mobile financial services (bKash, Nagad) make patient-side payment and notification viable.
- No player owns live in-hospital execution.

---

## 2. Who this is for

### 2.1 Primary personas

**P1 — Rahela, 62, patient.** Diabetic, hypertensive, visits a cardiologist every few months. Uses a smartphone her son set up. Reads Bangla only. Cannot tolerate small text, multi-step flows, or English jargon. Wants to know one thing: *when should I leave the house?*

**P2 — Sabbir, 29, attendant.** Books for his mother and his daughter from his own phone. Needs multiple profiles, needs to forward details to relatives, pays with bKash.

**P3 — Nazma, 24, receptionist.** Handles 150+ patients a day at one counter. Phone rings constantly with "how long until my turn?". Types fast, hates the mouse, will abandon any system slower than her notebook. Internet at her desk drops several times a day.

**P4 — Dr. Rezaul, 47, cardiologist.** Sits in two chambers, often arrives late. Sees a patient in 5–8 minutes. Will not type long notes. Wants the patient's history already open when they sit down.

**P5 — Mr. Hasan, 51, hospital director.** Signs the contract. Cares about patient volume, revenue leakage, staff punctuality, and complaints. Buys anything that shows him money he is losing.

**P6 — Emergency family member.** Panicked, one-handed, possibly in a moving car, needs the shortest path to a hospital that can actually take the patient.

### 2.2 Anti-personas (explicitly not optimised for)

- Medical tourists and English-first affluent users (they will be served, not centred).
- Hospitals unwilling to let a real person update live state.
- Telemedicine-only users — supported later, never the wedge.

---

## 3. Product principles

These settle design arguments. When in doubt, apply them in order.

1. **Live beats listed.** If a number can be live, it is live. If it cannot be live, it shows its age.
2. **Honest degradation.** No dummy data, no invented availability, no optimistic guesses. If the system does not know, it says so. A wrong "bed available" can kill someone.
3. **Design for the 60-year-old so the 25-year-old coasts.** One question per screen, large targets, plain Bangla, no jargon.
4. **Staff speed is sacred.** Any console action that is slower than the paper equivalent is a bug, not a trade-off.
5. **Every number entered has a visible consequence.** Staff see where their data surfaces publicly. That is why they keep it true.
6. **Bangla is the product, not a translation.** English is the secondary toggle.
7. **Emergency paths never gate.** No login wall, no payment, no onboarding between a person and emergency information.
8. **The patient owns their records.** Hospitals hold data; patients carry it.

---

## 4. Scope

### 4.1 v0 — Prototype (current build target)

Everything is clickable with seeded demo data. Real logic is required only where the demo must feel live.

**Must be genuinely working in v0:**
- Live queue engine with real state transitions and recalculation.
- Reception console driving that queue.
- Patient app live serial screen reflecting queue changes within 2 seconds.
- Emergency search with capability + travel time + freshness.
- Admin dashboard reading real numbers from the demo database.

**Can be visually complete but shallow in v0:**
- Payments (simulate success), telemedicine, pharmacy dispensing, blood donor matching, ambulance dispatch, national dashboard, SHR sync.

### 4.2 v1 — Pilot (1–3 hospitals, real patients)

Queue, booking, notifications (push + SMS), health wallet, diagnostics report delivery, bed board, admin dashboard, real payments, offline console, audit logging, consent.

Added on 2026-09-28, when the first hospital (Marks Group) asked for a real version: individual staff logins (`FR-SEC-06`), hospital settings run by the hospital itself (`FR-SUP-01`, `FR-ADM-11`), counter registration and walk-ins (`FR-REC-14`, `FR-REC-20`), import of the hospital's existing data (§14b, `FR-IMP-*`), patient phone verification (`FR-PAT-01`, `FR-GST-03`), and deployment on a server in Bangladesh (`FR-SEC-07`).

### 4.2b V1 — the platform (owner, 2026-10-05)

What is built now and shown to hospitals: **one platform connecting patients and hospitals**, not a reception pilot. It runs on demonstration data until there are agreements (`CLAUDE.md` §1.1), and it is one shared deployment with every hospital a workspace inside it (`FR-SEC-07`).

- **Patients:** search for what they need across participating hospitals (`FR-PAT-16`–`19`), compare live figures, book, follow the live serial, and find the visit and its reports afterwards.
- **Hospitals:** the consoles of §8–§13 in a private workspace, set up from screens and from the hospital's own export (`FR-ONB-*`, `FR-IMP-13`–`22`).
- **The network:** a hospital contributes public operational figures and nothing private (`FR-NET-*`).
- **Later, on the same API:** a patient app in one hospital's name (`FR-BRD-*`); only its foundation is in V1.

Not waited for, and so simulated in V1: a real SMS aggregator, bKash and Nagad, store publication, a paid penetration test. Outside V1 altogether: ambulance, blood, telemedicine, prescribing and dispensing, a direct HMS or FHIR connection, national integrations.

### 4.3 v2 — Scale

Emergency network across hospitals, ambulance dispatch, referral network, blood, pharmacy, national capacity dashboard, SHR integration, insurance rails, multi-city rollout.

---

## 5. Roles and permissions

| ID | Role | Scope | Key powers |
|---|---|---|---|
| R1 | Patient | Own profiles | Book, cancel, view own records, rate visits |
| R2 | Attendant | Linked profiles | Everything a patient can do, for linked people |
| R3 | Receptionist | One hospital, assigned counters | Register, book, run queue, collect fees |
| R4 | Doctor | Own sessions and patients | View history, prescribe, order tests, declare delay |
| R5 | Ward manager | One hospital, assigned wards | Admit, transfer, discharge, update bed state |
| R6 | Emergency coordinator | One hospital ER | Triage, accept inbound, update capability, refer out |
| R7 | Lab / diagnostics staff | One facility | Move test orders through states, upload reports |
| R8 | Pharmacy staff | One facility | Dispense against prescription, mark stock |
| R9 | Hospital admin | One hospital | All hospital data, analytics, staff management, billing |
| R10 | Platform super-admin | All hospitals | Onboarding, verification, feature flags, subscriptions |
| R11 | Government viewer | Aggregated national data | Read-only dashboards, no patient identifiers |

**Rules**
- `FR-ROLE-01` Every role is scoped to a hospital except R1, R2, R10, R11.
- `FR-ROLE-02` A user may hold several roles (a doctor who is also an admin).
- `FR-ROLE-03` Any read of an identifiable patient record by R3–R9 writes an audit entry.
- `FR-ROLE-04` R11 can never reach a row that identifies a patient.

---

## 6. Core concepts and domain glossary

| Term | Meaning in this product |
|---|---|
| **Hospital** | A facility: hospital, clinic, or diagnostic centre. |
| **Department** | Specialty unit inside a hospital (Cardiology, Medicine…). |
| **Doctor** | A verified practitioner with a BMDC registration number. |
| **Session** | One doctor sitting in one chamber on one date, with a planned start and end. All queue activity belongs to a session. |
| **Serial** | A patient's position number within a session. |
| **Booking** | A patient's claim on a serial, made in-app, by phone, or at the counter. |
| **Walk-in** | A patient inserted into a session without a prior booking. |
| **Queue event** | An immutable fact about a session (doctor arrived, patient called, marked late…). The queue is derived from these. |
| **ETA** | Estimated time a given serial will be called, recomputed after every queue event. |
| **Health wallet** | The patient's own timeline of prescriptions, reports, and visits. |
| **Capability** | A treatment ability of a hospital (burn unit, ICU, cath lab, NICU, dialysis). |
| **Freshness** | Age of a live figure, always displayed. |
| **Live session** | A session where the queue is being kept accurate in real time. This is the north-star unit of value. |

---

## 7. Functional requirements — Patient app

### 7.1 Identity and profiles

- `FR-PAT-01` Sign up and log in with phone number + OTP. No password.
- `FR-PAT-02` A user can create multiple patient profiles (self, mother, child…) with name, age or DOB, gender, blood group, and optional NID. **Not in V1 (owner, 8 October): family accounts wait for after the pilot (`PLATFORM_PLAN.md` R10).** The people already booked under a proved phone are listed as they are (`FR-GST-12`), and are not presented as a family.
- `FR-PAT-03` Every booking, record, and notification is attached to a profile, not just an account.
- `FR-PAT-04` A profile can later be claimed by its own phone number, transferring ownership of records.
- `FR-PAT-05` Language preference (bn default, en optional) is stored per account and applies to app and SMS.

**Acceptance:** a son books for his mother; the mother's records stay under her profile; both see the same serial.

### 7.1b Guest use — booking without an account (`FR-GST`)

Many people will never create an account. Guest mode is a first-class path, not a degraded one: **anything a logged-in patient can do, a guest can do**, with the single difference that a guest's history is not carried between devices until they claim it.

- `FR-GST-01` Booking, emergency actions, bed requests, ambulance requests, blood requests, and diagnostics booking are all available without an account.
- `FR-GST-02` A guest supplies only what the task needs: **name + phone number**, plus age and sex when a clinical record will be created (a booking), and nothing at all for browsing or emergency search.
- `FR-GST-03` Phone ownership is confirmed by a single OTP **only when money is involved or when an SMS thread will follow** (booking, bed request, ambulance). Pure information actions (emergency search, "I'm on my way") require no OTP.
- `FR-GST-04` The OTP in `FR-GST-03` verifies the phone; it does **not** create an account, set a password, or require any further profile steps.
- `FR-GST-05` Every guest booking produces a **secure tracking link** delivered by SMS. Opening that link shows the live serial screen for that booking with no login. The link is single-booking scoped, expires after the session ends plus a grace period, and is revocable.
- `FR-GST-06` A guest receives the same notifications as an account holder for that booking: confirmation, doctor arrived, delay, two-away, called, no-show, slot offered, report ready.
- `FR-GST-07` Guests can pay by bKash, Nagad, or card, and receive the same itemised receipt by SMS.
- `FR-GST-08` Records created for a guest (prescription, test report) are stored against the phone number and held for later claiming; they are also downloadable from the tracking link for a limited period.
- `FR-GST-09` **Claiming:** when someone later signs up with a phone number that has guest bookings, all prior bookings and records attached to that number are offered for linking after OTP verification, in one confirmation step.
- `FR-GST-10` **Zero re-typing:** once an account exists, no booking flow ever asks again for name, phone, age, sex, or blood group; those come from the selected profile.
- `FR-GST-11` A guest is never blocked, nagged mid-flow, or shown an account wall. Account creation is offered exactly once, **after** a successful booking, framed as "সব রেকর্ড এক জায়গায় রাখুন".
- `FR-GST-12` Repeated guest bookings from the same phone reuse the stored guest identity: the second booking asks only to confirm the details, not to retype them.
- `FR-GST-13` Reception can create the same guest identity at the counter for a walk-in or phone booking, using phone + name; no account is created (`FR-REC-20`).
- `FR-GST-14` (**Built, plan A5:** the limit per phone number, and a flood guard per address, which is as near to "per device" as a request without a device identity gets. **Built, plan F3:** the no-show rule below, as two hospital settings, both off by default: whether to ask, and the window (90 days unless the hospital says). It counts no-shows **at this hospital only** (another hospital's attendance is that hospital's, `FR-NET-02`), applies to a **guest** booking only, and never where the deployment takes no payment online: nobody is turned away for a payment nobody can take. A booking it applies to may be paid online and is held as `FR-PAY-08` says, released if not paid; paying at the counter is refused with the reason, which the patient app says in plain words.) Abuse control: guest bookings are rate-limited per phone number and per device; three no-shows on a phone number within a rolling window may require prepayment for the next guest booking, configurable per hospital.
- `FR-GST-15` Privacy: guest data follows the same retention, consent, audit, and deletion rules as account data (`FR-SEC-03`, `FR-SEC-09`); a guest can request deletion by phone verification.

**Acceptance:** a man with no account books a cardiology serial in under 60 seconds with name, phone, one OTP, and a bKash payment; he tracks the live queue from the SMS link; two weeks later he signs up and his prescription is waiting for him.

### 7.2 Discovery

- `FR-PAT-10` Browse hospitals by distance, specialty, or name.
- `FR-PAT-11` Browse doctors by specialty, symptom category, fee range, availability today, and hospital.
- `FR-PAT-12` A doctor card shows: name, degrees, specialty, hospital, chamber times, fee, BMDC-verified badge, average consultation minutes, current live status.
- `FR-PAT-13` Live status values: *in chamber now*, *expected at HH:MM*, *not sitting today*, *unknown*.
- `FR-PAT-14` Hospital cards show live wait estimate, free beds, ICU count, and a freshness stamp. **Beds (owner, 8 October), wherever a patient is shown a bed figure (cards, the bed search, emergency results):** an exact count is shown only while the figure is within the hospital's freshness threshold (`FR-OFF-04`); a fresh zero reads as none free. Past the threshold, or never confirmed, the figure is **not known**, with the age of the last confirmation beside it, and never a number (owner's decision 10, 8 October, replacing "available or none when last confirmed"). An unknown is never shown as zero (§3.2).
- `FR-PAT-15` Search must work with Bangla and English text and tolerate common misspellings of doctor names.

- `FR-PAT-16` **One search for what a patient needs** (`S-A-07s`), reachable from the app's first screen. It takes free text over doctor names, hospital names and specialties, in Bangla and English, and offers the needs hospitals publish live as choices: a specialty, a bed kind (`FR-PAT-50`), an emergency capability (§11). Owner's direction, 2026-10-05.
- `FR-PAT-17` **Results are places that can provide it.** Each participating hospital that matches is shown with the live figures that bear on the need asked for — doctors sitting now and open serials for a specialty or a doctor, free beds of the kind asked for, the capability and when it was confirmed — each with its age (`FR-PAT-14`). Matching doctors are listed with their hospital. From a result a patient reaches booking (`FR-PAT-20`), the bed request (`FR-PAT-52`) or the emergency path (`FR-PAT-40`) without searching again.
- `FR-PAT-18` **Search offers only what the data holds.** A need no participating hospital publishes says so; a figure a hospital has not confirmed is shown as unknown or stale, never as none (§3.2). Matching is deterministic: the text as typed, in either script. `FR-PAT-15`'s tolerance of misspellings waits beyond V1.
- `FR-PAT-19` **Hospital scope.** When the app is opened for one hospital (`FR-BRD-02`), search and discovery show that hospital only, and say whose app it is.

### 7.3 Booking

- `FR-PAT-20` Booking flow: choose doctor → choose session → confirm profile → pay or choose pay-at-hospital → receive serial.
- `FR-PAT-21` Fees display as a breakdown: consultation, platform fee, total, and what is due at the hospital.
- `FR-PAT-22` Confirmation is delivered in-app **and** by SMS, containing hospital, doctor, date, serial number, and expected time window.
- `FR-PAT-23` A patient can reschedule to another session or cancel; policy and any refund rule are stated before confirming. **Rescheduling is outside V1** (owner, 5 October 2026): here, as the middle option of `FR-PAT-34`, and as the offer in `FR-REC-04`. A patient cancels and books again. No screen, message or pitch step offers a reschedule until it is built.
- `FR-PAT-24` The app prevents double-booking the same profile with the same doctor on the same day.
- `FR-PAT-25` If a session is full, the patient may join a **standby list** from the app and will be offered released slots automatically (see `FR-QUE-30`). Joining asks what a guest booking asks (`FR-GST-02`) and returns a status link that is the patient's place on the list.
- `FR-PAT-26` **Prepaid standby.** A patient may pay the consultation fee when joining. A prepaid patient is **seated automatically** when a slot is offered to them — nobody asks — and told by SMS and on the status link which serial is theirs. A prepayment for a slot that never comes is refunded in full, whether the patient leaves the list or the session ends. Owner's ruling, 2026-09-23.
- `FR-PAT-27` **Answering an offer on the phone.** A patient who did not prepay receives the offer on their status link and by SMS, sees the minutes left, and answers yes (then pays as a booking is paid, `FR-PAT-20`) or no (the slot passes to the next patient). Reception may still record a yes for somebody who rings the counter (`FR-REC-30`). Owner's ruling, 2026-09-23.
- `FR-PAT-28` **A preferred hour to arrive** (owner, 8 October; decision 1c; plan R1). Where a hospital offers it (a hospital setting, off by default), the confirm step offers, as an option and never as a requirement, one-hour windows across the chamber, counted from its start, the last cut at its end; the patient may choose one or none. It is a **preference, never a promise**: the screen says so beside the choice, the queue does not read it, a serial is called in its order, and the live serial and its estimate stay what a patient goes by (`FR-PAT-30`). The choice is kept on the booking and shown with the serial on the success screen. A window that is not one of the chamber's, or one asked of a hospital that does not offer windows, is refused.

### 7.4 Live serial (core)

- `FR-PAT-30` The live serial screen shows: doctor arrival status, current serving number, the patient's number, estimated call time, and a countdown.
- `FR-PAT-31` The screen updates within 2 seconds of a reception action, without a manual refresh.
- `FR-PAT-32` A **leave-home alert** fires when estimated travel time + buffer equals remaining wait. Travel time may be a static per-hospital estimate in v0. **Built as the banner on the live serial screen** (`BANNER-A08-LEAVE`). It is not sent as a message: which channel a message would go by is not written anywhere, and the two answers differ in what they cost a hospital and in whom they reach (`docs/STATUS.md`, question 13).
- `FR-PAT-33` **I'm running late**: the patient declares lateness with an expected arrival; the system offers to move them later in the same session and states the new position.
- `FR-PAT-34` **Doctor delay**: when a delay is declared, every waiting patient receives a notification with the new expected time and one-tap options: keep serial, reschedule, cancel.
- `FR-PAT-35` Every live figure carries a freshness line ("হালনাগাদ ২ মিনিট আগে").
- `FR-PAT-36` If the connection to the hospital is lost, the screen states that the number may be stale instead of showing a confident value.
- `FR-PAT-37` Feature-phone parity: all state changes in `FR-PAT-30`–`34` are mirrored by SMS.
- `FR-PAT-38` Once reception has checked the patient in (`FR-REC-18`), the live serial screen shows the wait the counter quoted, when it was quoted, and the minutes left against it — beside the live estimate, never instead of it. When the quote has run out the screen says so rather than counting below zero, and the leave-home alert no longer applies to somebody already here.
- `FR-PAT-39` **A serial is current until it is settled, whatever the date.** A booking is *current* while it is unresolved in a session that has not ended: the session is scheduled, running or paused, and the patient has not been seen and has not cancelled. The calendar day changing is not a reason to call it past: somebody waiting at 23:59 is still waiting at 00:01, and a chamber paused across midnight is still their chamber (`FR-QUE-06`). A booking becomes *past* when it is settled (the patient was seen, or cancelled) or when its session has actually ended. If the app cannot establish which — no connection, or an answer too old to trust — it says the status is unknown and how old its last knowledge is, and does not file the booking under past. Founder's decision, 2026-10-05. **Built** (plan A4): `bookingStanding` in `shared/domain` takes the session's status and the booking's and no date; the patient app asks the server for each booking it holds. A patient marked absent is still current while the chamber is open, because reception can bring them back; a tracking link that no longer opens is the server saying the chamber has closed or the booking was given up, and is past.

### 7.5 Emergency

- `FR-PAT-40` Emergency is reachable from the app's first screen in one tap, with no login required.
- `FR-PAT-41` The entry splits **critical** and **urgent**. Critical shows an immediate call action and the nearest capable facility, with no browsing required.
- `FR-PAT-42` The patient selects a problem type (burn, accident, cardiac, stroke, child, obstetric, breathing, other).
- `FR-PAT-43` Results are ranked by: required capability present → estimated travel time → current emergency load → free beds.
- `FR-PAT-44` Each result shows distance, travel time, capability match, free beds, ICU, emergency wait, and freshness.
- `FR-PAT-45` A facility with stale data (> configurable threshold) is shown with an explicit stale warning and ranked lower.
- `FR-PAT-46` **I'm on my way** notifies the receiving hospital's emergency console with problem type, patient age/sex if known, and ETA.
- `FR-PAT-47` The emergency screen always offers the national emergency number and ambulance request.

### 7.6 Beds and admission

- `FR-PAT-50` Search beds by type: general, cabin, HDU, ICU, CCU, NICU, isolation, burn.
- `FR-PAT-51` Each bed type shows count free, nightly price, and freshness. The count follows `FR-PAT-14`'s rule: exact only while fresh.
- `FR-PAT-52` A patient may request a bed; the hospital confirms, holds, or declines, with a hold expiry.
- `FR-PAT-53` Admission status is visible to linked family profiles. **Not in V1 (owner, 8 October; R10).**

### 7.7 Health wallet

- `FR-PAT-60` Every completed visit creates a record: hospital, doctor, date, diagnosis, prescription, tests ordered.
- `FR-PAT-61` Lab and imaging reports are pushed into the wallet when ready, with a notification; no second trip required.
- `FR-PAT-62` Patients can photograph old paper records; these are stored with date, doctor, and type tags. (**Built, plan R3**, the owner's decision 4 of 8 October:)
  - A patient signed in with a verified phone (`FR-PAT-01`) adds a photograph (JPEG, PNG or WebP) or a PDF, up to 8 MB, to one of the profiles under that phone, with what it is (a prescription, a test report, a discharge paper, or other), its date if known (never in the future) and the doctor's name if known. Not through a tracking link: an SMS link that was forwarded must not be able to add papers to somebody's record.
  - The file is checked by its contents, not its name: what is not one of those four kinds is refused.
  - It is **private**: the patient sees and opens their own, and may remove one. It is labelled **রোগীর দেওয়া কাগজ** (provided by the patient) wherever it is shown, so it is never read as a record a hospital made.
  - A clinician sees it **only under the patient's consent** (`FR-PAT-63`, `FR-SEC-04`): having treated the patient opens that hospital's own visits (`FR-DOC-10`), and a patient's own papers are not that hospital's. Every opening by staff is an audited read (`DB-P7`, `FR-SEC-03`) and appears in the patient's access log (`FR-PAT-64`).
  - It is stored where the deployment keeps every file: on the deployment's own disk on a server in Bangladesh (`FR-SEC-07`), and in the demonstration's store for the demo. Nothing is sent anywhere else, and nothing reads its contents.
- `FR-PAT-63` A QR code presents the patient's identity so a doctor console can open their history with consent.
- `FR-PAT-64` Consent is explicit and revocable per hospital; the patient can see who viewed their records and when.
- `FR-PAT-65` Records export as a single PDF.

### 7.8 Diagnostics, pharmacy, telemedicine, ambulance, blood

- `FR-PAT-70` Book lab tests and imaging, compare prices across nearby centres, schedule home sample collection.
- `FR-PAT-71` E-prescriptions carry a QR that any partner pharmacy can dispense against; dispensing is recorded.
- `FR-PAT-72` Medicine reminders derived from prescription dosage lines.
- `FR-PAT-73` Telemedicine consults use the same session and queue mechanics as physical chambers.
- `FR-PAT-74` Ambulance request shows type, published fare (fixed per km), ETA, and driver identity **before** dispatch; the quoted fare cannot change after acceptance.
- `FR-PAT-75` Blood requests broadcast to eligible nearby donors (eligibility computed from last donation date) and show hospital blood bank stock when available.

> **Outside V1** (owner, 2026-10-05): `FR-PAT-73`–`75` (telemedicine, ambulance, blood) are not built and are not on the patient app's first screen. A smaller product in which everything shown works is the requirement.

### 7.9 Follow-up, prevention, feedback

- `FR-PAT-80` Doctor-set follow-up dates generate reminders.
- `FR-PAT-81` Child vaccination schedule tracking per profile.
- `FR-PAT-82` Chronic care check-in reminders (diabetes, hypertension, pregnancy).
- `FR-PAT-83` Post-visit feedback on wait time, doctor time, cleanliness, and billing honesty; routed to hospital admin; aggregated publicly only above a volume threshold.

---

## 8. Functional requirements — Reception console

The highest-volume surface in the system. Optimise for keyboard and repetition.

### 8.1 Session control

- `FR-REC-01` Select the doctor session being run at this counter.
- `FR-REC-02` One-tap **doctor arrived**, recording actual arrival time against planned start.
- `FR-REC-03` One-tap **declare delay** with a duration (15/30/45/60 min or custom), which fans out to every waiting patient.
- `FR-REC-04` Mark a doctor **absent today**, which cancels the session and offers all patients rescheduling.
- `FR-REC-05` Pause and resume a session (prayer break, emergency call-away) with the pause reflected in patient ETAs.

### 8.2 Queue operation

- `FR-REC-10` **Call next** advances the queue and recomputes every downstream ETA.
- `FR-REC-11` Mark the current patient **done**, capturing consultation duration automatically.
- `FR-REC-12` Mark **late** — patient moves to a late pool and is re-inserted after a configurable number of subsequent patients rather than losing their turn.
- `FR-REC-13` Mark **no-show** after a configurable grace period, freeing the slot.
- `FR-REC-14` Insert a **walk-in** at the end, or at a chosen position with a logged reason.
- `FR-REC-15` Reorder for priority (elderly, emergency, referred) with a mandatory reason, recorded in the audit log.
- `FR-REC-16` Undo the last queue action within a short window.
- `FR-REC-17` The console shows, at a glance: now serving, next three, count waiting, count late, count no-show, average minutes per patient.
- `FR-REC-18` **Check in** a patient who has arrived at the counter. The console pre-fills a quoted wait from the queue's own estimate and reception may adjust it before confirming — as a restaurant confirms an order with a preparation time. The arrival time and the quote are recorded (`PATIENT_ARRIVED`), and the quote reaches the patient's screen (`FR-PAT-38`). Owner's ruling, 2026-09-23.

### 8.3 Registration and billing

- `FR-REC-20` Register a new patient in under 30 seconds: phone, name, age, gender; duplicates detected by phone number.
- `FR-REC-21` Print a token slip for walk-ins with serial, doctor, and estimated time.
- `FR-REC-22` Collect consultation fee, record method (cash, bKash, card), print or SMS a receipt.
- `FR-REC-23` End-of-shift reconciliation per counter: expected versus collected.

### 8.4 Waitlist recovery

- `FR-REC-30` When a slot frees (no-show, cancellation), the console offers it to standby patients in order and shows acceptance status.
- `FR-REC-31` Recovered slots and their taka value are recorded for the admin dashboard.
- `FR-REC-32` **Reception desks** (owner, 8 October; decision 2b; plan R4). A hospital administrator names the hospital's reception desks and assigns doctors to each; a doctor may be at more than one desk. A receptionist chooses their desk on this device, and the console lists that desk's chambers first and every other chamber of the hospital after them. **A receptionist assigned to a desk manages only that desk's doctors and their chambers** (the owner's answer to question 20, 8 October), and the **server** refuses the rest: every route that reaches a chamber (the queue, a booking and its payment, offline sync, the live channel) asks, and the console offers only those chambers. **A receptionist assigned to no desk keeps the one common workspace** (decision 2a), which is every receptionist in a hospital or clinic that has not set desks up, so a small hospital's reception stays as it is. An administrator and a doctor are not limited by desks. Taking a receptionist off every desk returns them to the common workspace. Reconciling money per desk (`FR-REC-23`) is not part of this.

---

## 9. Functional requirements — Doctor app

- `FR-DOC-01` Today's sessions with counts: seen, waiting, late, average duration.
- `FR-DOC-02` One-tap delay declaration from the doctor's own phone, without calling reception.
- `FR-DOC-03` On calling a patient, the screen opens with: pre-visit intake summary, chronic conditions, allergies, last visits, previous prescriptions, recent test results.
- `FR-DOC-04` E-prescription: diagnosis field, medicine rows (name, strength, schedule, duration), free-text advice, follow-up date. (**Built, plan R2**, the owner's decision 3 of 8 October — see below.)
- `FR-DOC-05` Medicine autocomplete over a local formulary (generic and brand names). (**Built, plan R2.** A medicine the formulary does not carry may still be written by name: the formulary helps and never decides what a doctor prescribes.)
- `FR-DOC-06` Order tests directly into the diagnostics queue.
- `FR-DOC-07` Patient-facing output prints and delivers in Bangla, including dosage instructions. (**Built, plan R2:** one printed sheet, in Bangla, from the doctor's console and from the patient's records; the browser's print, which also saves it as a PDF.)
- `FR-DOC-08` Sign and finish advances the queue (equivalent to reception's *done*).
- `FR-DOC-09` Session earnings summary.
- `FR-DOC-10` Doctor may only view records of patients in their own sessions, or with explicit patient consent. **And which records** (`FR-NET-02`; plan A8): having treated a patient opens the visits *this hospital* made; the visits another hospital made are read only under the patient's consent. The screen says that what is shown is this hospital's part, and does not say whether there is more.

**Prescribing is built (plan R2; the owner's decision 3 of 8 October).** It
had been removed on 2026-09-19; the owner restored it as written, saved,
signed and printed in the doctor's console, the patient's to see and to keep,
by authorised clinicians only, and with no AI. So:

- `FR-DOC-04`: a visit carries medicine rows beside its diagnosis, advice and
  follow-up. Each row is a medicine's name and, each optional, its strength,
  its schedule in the notation every prescription here uses (`1+0+1`:
  morning, midday, night; a dose is 0 to 9 or ½), how many days (1 to 365),
  and an instruction in Bangla. Up to twenty rows. They are saved with the
  draft and signed with the visit, in the same transaction, and like the visit
  they are final once signed.
- Only a doctor writes them, for the patient in their own chamber, exactly as a
  visit is written (`FR-DOC-08`, `FR-DOC-10`); whoever may read a visit reads
  its medicines, and nobody else.
- `FR-DOC-07`: the printed sheet carries the hospital, the doctor and their
  BMDC number, the patient, the date, the diagnosis, the medicines with their
  schedule and days, the advice and the follow-up date, in Bangla. Nothing is
  generated: every word on it is what the doctor wrote or chose.
- **Still not built:** a prescription QR and dispensing against it
  (`FR-PAT-71`, `FR-PHR-01`), and medicine reminders (`FR-PAT-72`). The
  owner's decision covers prescribing; those are further work.

What a consultation produces is still a **visit record** (`DATABASE.md` §2.4,
`visits`), which `FR-DOC-08` signs and the health wallet reads; a
prescription is that record's medicines (`prescriptions`,
`prescription_items`), and the formulary is `medicines`.

---

## 10. Functional requirements — Ward / bed board

- `FR-BED-01` Visual board of every bed with state: free, occupied, cleaning, reserved, out of service.
- `FR-BED-02` One tap changes a bed's state; admit, transfer, and discharge are two taps at most.
- `FR-BED-03` Bed metadata: ward, floor, type, nightly price, last cleaned time.
- `FR-BED-04` Expected discharge date per occupied bed, driving tomorrow's predicted availability.
- `FR-BED-05` Live counters per bed type, published to the patient app and emergency network.
- `FR-BED-06` The board displays what the public app is currently showing, so the consequence of staleness is visible to staff.
- `FR-BED-07` Pending admissions queue (from ER and from app bed requests).

---

## 11. Functional requirements — Emergency console

- `FR-EMG-01` Inbound alerts from the patient app: problem type, ETA, contact, and any stated details.
- `FR-EMG-02` Accept, prepare, or decline an inbound case; declining prompts a referral suggestion.
- `FR-EMG-03` Triage list with colour categories (red, yellow, green) and arrival times.
- `FR-EMG-04` Emergency load counter derived from active cases, not typed by hand.
- `FR-EMG-05` Capability flags per hospital (burn, cardiac, stroke, dialysis, NICU, trauma OT), toggled by the coordinator, published to the network.
- `FR-EMG-06` Blood stock by group, published as availability, not exact inventory, if the hospital prefers.
- `FR-EMG-07` **Refer out**: search other hospitals filtered by required capability and free beds, ranked by travel time, with freshness shown.
- `FR-EMG-08` A referral sends patient summary and awaits accept/decline; the full timeline is recorded (sent, seen, accepted, arrived).
- `FR-EMG-09` **Refer in**: incoming referrals appear with accept/decline and reason.

---

## 12. Functional requirements — Diagnostics and pharmacy

- `FR-LAB-01` Test order queue populated from doctor orders and app bookings.
- `FR-LAB-02` Order states: ordered → sample collected → processing → report ready → delivered.
- `FR-LAB-03` Report upload (PDF or image) auto-delivers to the patient wallet and the ordering doctor.
- `FR-LAB-04` Turnaround time per test type is measured and visible to admin.
- `FR-PHR-01` Dispense against a prescription QR; partial dispensing supported.
  **Not in this version** — see below.
- `FR-PHR-02` Out-of-stock flagging feeds medicine availability search in the patient app.

**Dispensing is out of scope for this version.** `FR-PHR-01` is downstream
of `FR-DOC-04`, which plan R2 built (§9), but a prescription carries no QR yet
(`FR-PAT-71`), so there is nothing for a pharmacy to scan, and the owner's
decision of 8 October covers prescribing only. It stays here because it
remains a requirement of the product.

What the pharmacy does instead is `FR-PHR-02`, which needs no prescription: a
counter marks what is and is not on the shelf, and that feeds the patient
app's medicine search. `S-B-09` names the missing half on screen rather than
showing a scanner that cannot work.

`FR-LAB-01`'s "and app bookings" is also not built: a patient ordering their
own test is `S-A-13`, a booking-and-payment flow that is not in step 17's
contents. Doctor orders (`FR-DOC-06`) are this version's producer, and the
`test_orders.visit_id` column is nullable so a walk-in order needs no schema
change when `S-A-13` lands.

---

## 13. Functional requirements — Hospital admin dashboard

- `FR-ADM-01` Today view: patients seen, average wait, longest wait, sessions running late, walk-in vs booked ratio. Wait runs from check-in (`FR-REC-18`) to being called, and beside it the share of patients called within the wait they were quoted.
- `FR-ADM-02` Wait-time trend over time, with the live-queue adoption date marked.
- `FR-ADM-03` No-show count and taka value, plus value recovered through waitlist.
- `FR-ADM-04` Revenue by doctor, department, service type (consultation, tests, beds, pharmacy), and payment method.
- `FR-ADM-05` Doctor punctuality: planned versus actual start, average consultation duration.
- `FR-ADM-06` Bed utilisation, average length of stay, turnover time.
- `FR-ADM-07` Referral report: sent, received, accepted, leaked.
- `FR-ADM-08` Patient feedback trends and complaint categories.
- `FR-ADM-09` Volume forecast by day and session for staffing.
- `FR-ADM-10` Export any view to CSV/PDF.
- `FR-ADM-11` Staff management: add users, assign roles, deactivate.
- `FR-ADM-12` **The hospital now, at a glance** (owner, 8 October; decision 8b; plan R6). The administrator's dashboard opens on one panel of live figures for today: doctors scheduled and sitting now; patients waiting across today's chambers; today's appointments and how many have been seen; beds free of those in service, with the age of the ward's last confirmation; and the emergency desk's cases on the way and in the ER. Each figure is read when the panel is, says its age, and is refreshed every minute while the screen is open (`FR-OFF-03`). A figure the hospital has no means of knowing is said to be absent, never shown as zero: no wards, no beds figure; no emergency desk, no emergency figure (`PRD.md` §3.2). The reports stay on their own sections below it (`FR-ADM-01`–`10`). Counts only: the panel names no patient.

---

## 14. Functional requirements — Platform super-admin

- `FR-SUP-01` Hospital onboarding wizard: departments, doctors, sessions, fees, beds, capabilities, counters.
- `FR-SUP-02` Doctor verification workflow against BMDC registration; unverified doctors cannot be published.
- `FR-SUP-03` Feature flags per hospital (queue only, queue + beds, full suite). **Built as modules** (`FR-BRD-11`, plan C4): the platform administrator switches each of the eight on the workspace; the change is audited. What a module costs, and which an agreement includes, are not in the product.
- `FR-SUP-04` Subscription and invoicing per hospital, with usage counters. **The state half is built** (plan G1, migration 0051): the platform administrator records on the workspace whether a hospital's agreement is in trial, active, overdue or ended, with a note and who set it when, and the change is audited; and reads what the hospital has used as three counts (serials taken and chambers held in thirty days, SMS sent this month), never a row. **The state is a record and switches nothing**: an agreement that has ended does not unlist a hospital or switch a module off. Taking a hospital out of the network stays suspending its workspace (`FR-ONB-06`), a separate act with a reason the hospital reads. No plan name, no amount and no invoice is in the product until a billing provider is chosen.
- `FR-SUP-05` Review moderation and abuse handling.
- `FR-SUP-06` System health view: sync lag per hospital, stale-data offenders, notification delivery rates. **Built** (plan G2, migration 0052), on each hospital's workspace on `S-B-12`: the age of each figure it publishes (beds, emergency services), measured against the hospital's own stale threshold, the one a patient's screen uses; a week's messages by what became of them (sent, failed, held back on purpose, still waiting) with the share of attempts that went; and the work that reached the server more than a minute after it was tapped, how many and how late the slowest. **What is flagged is what is wrong beyond argument**: a message that failed or is still waiting, and a figure a live hospital publishes that nobody ever confirmed. **A stale figure is ranked, not flagged**: by the ten-minute threshold most hospitals are stale most of a night, so a flag would be on every row and say nothing; each row of the list gives its oldest published figure and its age, to be read against the others. **Late sync is shown and never flagged**: a counter that kept working offline did what it was built to do (`FR-OFF-01`). With it, a workspace's **trail of changes** (`FR-ONB-07`): what was done to its settings, its state, its imports and exports, by whom, and whether they were the hospital's or the platform's; nothing done for a patient is in it (`FR-ONB-08`). The age of the last backup is the deployment's and not one hospital's; it belongs to the health endpoints. **Built** (plan I2, migration 0055): `/readyz` reports the last backup and the last good one, the messages due and unsent, and whether each piece of the server's work on a clock is going through, with what is wrong named in fixed words; none of it makes the server unready (`BACKEND.md` §12b).

> **In V1** (owner, 2026-10-05): `S-B-12` is built for onboarding — creating a workspace, review and go-live, doctor verification, suspension (`FR-ONB-*`, §14c). **Added 2026-10-06:** `FR-SUP-03` (modules per hospital, `FR-BRD-11`), the state half of `FR-SUP-04` (whether a hospital's agreement is in trial, active, overdue or ended, and its usage counters — no plan names, no amounts, no invoice until a billing provider is chosen), `FR-SUP-06` (the health view) and a workspace's audit trail are V1. `FR-SUP-05` waits: there is no patient review form to moderate.

---

## 14b. Data import from a hospital's existing system (`FR-IMP`)

A hospital that already runs a hospital management system keeps it. The Platform takes only what it runs on, and the hospital decides, set by set, what that is (§27: the Platform runs alongside an HMS, never replaces it).

- `FR-IMP-01` Existing data is brought in as four **sets**, each approved separately by the hospital: **(A) structure** — departments, doctors, chamber schedules, wards and beds, staff; **(B) patient register**; **(C) upcoming appointments**; **(D) past lab reports and visit summaries**.
- `FR-IMP-02` Only these fields are taken. **A:** department name (Bangla and English); doctor name, BMDC number, degrees, specialties, department, room, fee; schedule — doctor, weekday, start, end, serials per day; ward name, floor, bed kind, bed label, nightly price; staff name, role, counter or ward, login email. **B:** the hospital's own patient number, name, date of birth or age, sex, mobile number, blood group. **C:** patient number, doctor, date, start time, serial number, paid or not. **D:** report file, test name, date; visit diagnosis, advice, follow-up date. Never imported: national ID, address, photographs, guardian or emergency contacts, insurance, billing and accounts, payroll and HR, stock and procurement, OT lists, nursing charts, original imaging files, and any password.
- `FR-IMP-03` Bed occupancy is never imported. The ward sets each bed's state on the day the hospital goes live, because a count copied from another system is already stale (§3.1, `FR-OFF-05`).
- `FR-IMP-04` Every imported row keeps the hospital's own identifier for it. Importing the same row again updates it and never duplicates it.
- `FR-IMP-05` An import is checked row by row before anything is written: required fields, mobile numbers normalised (`DB-P6`), dates, allowed values, and duplicates within the file. The result is a preview — rows to add, update and skip, and every error with its row number and reason, in Bangla and English.
- `FR-IMP-06` Nothing is written until a hospital administrator approves the preview. An approved batch is written all or nothing.
- `FR-IMP-07` A committed batch can be undone as a whole by a hospital administrator, as long as nothing has since been built on its rows (a booking against an imported session, a visit for an imported patient); the undo names the rows that stop it.
- `FR-IMP-08` Every batch is audited: who uploaded it and when, the file's name and fingerprint, the set, the row counts, and who approved or undid it. The uploaded rows themselves are kept only as long as the batch is open, and cleared 30 days after it is committed.
- `FR-IMP-09` The first route is one CSV file per set, against a published template (column names, what each means in Bangla, allowed values, an example row). A spreadsheet is saved as CSV. A read-only connection to the hospital's database and FHIR R4 resources feed the same checks later; until then, re-importing a set is how the two systems are kept in step.
- `FR-IMP-10` Imported patients belong to the hospital, not to a patient account. They are visible only to that hospital's staff under the usual role rules, and never appear in a patient's app until the patient verifies the same mobile number and claims them (`FR-GST-09`, `FR-PAT-04`).
- `FR-IMP-11` Real imported data exists only on the hospital's own production deployment. Development, test and demo environments use synthetic files only (`FR-SEC-08`); building an importer for a hospital needs its column headers, never its rows.
- `FR-IMP-12` Set D is not in the first import release. It follows once a pilot is running and the hospital's legal adviser has agreed it.

---

### Mapping a hospital's own export (owner, 2026-10-05)

A hospital's export does not arrive in our template. A mapping step sits between the file and the check, so that the hospital uploads what it has. **The mapping proposes; a person confirms; the check in `FR-IMP-05` alone decides what is written.**

- `FR-IMP-13` A hospital administrator may upload a CSV for a set in the hospital's own column names and order. A file already in the template's shape skips the mapping step.
- `FR-IMP-14` The file is profiled on the server before anything is proposed: for each column, the kind of value it holds (text, whole number, date, time, phone number, money), how full it is, and how many different values it has. A first row that reads as data rather than as headings stops the upload and asks for the heading row; a patient's details are never taken for a column name.
- `FR-IMP-15` **Rules propose first:** the template's own names, known other names for each field in Bangla and English, and the shape of the values. Every proposal says where it came from (a rule, a saved mapping, the model, a person), how sure it is, and why, in a sentence.
- `FR-IMP-16` **A model may propose for the columns the rules could not place**, when one is configured; it is off unless set. Its answer is read against a fixed shape, anything outside the template is dropped, and it is shown as a suggestion like any other. With it off, slow or failing, the rules and the administrator's own choices carry the import unchanged.
- `FR-IMP-17` **No row is sent to a model.** It is given the set, the template's field list, the file's column names, each column's profile, and example values made up from the profile; never a value copied from a row. Real patient data does not leave Bangladesh (`FR-SEC-07`).
- `FR-IMP-18` The administrator sees every column beside the field proposed for it, changes any of them, and confirms before anything else happens. A required field with no column blocks confirmation and says which. Columns mapped to nothing are listed as not imported (`FR-IMP-02`).
- `FR-IMP-19` A confirmed mapping rewrites the file into the template's shape and hands it to the existing check. Preview, approval, the all-or-nothing write, undo and the audit (`FR-IMP-05`–`08`) are unchanged, and nothing in the mapping step writes to a hospital's records.
- `FR-IMP-20` A confirmed mapping is kept for that hospital, set and heading row, and offered when the same export arrives again. Who confirmed which columns, and from which source, is audited; cell values are not.
- `FR-IMP-21` Before approving, on the preview, the administrator is warned of what the check does not refuse: patients in the file who look like the same person (flagged, never merged), and columns that mix date or phone formats, with the reading that will be used.
- `FR-IMP-22` CSV first. Reading a spreadsheet file directly follows; until then a spreadsheet is saved as CSV (`FR-IMP-09`). (**Built, plan E1**, the owner's answer to question 19, 8 October: an Excel `.xlsx` file is read directly in the browser and handed to the importer as the CSV it already reads, so the mapping, the model's suggestions, the check, the preview, approval, the audit and undo are unchanged. A workbook with more than one sheet holding rows asks which. Dates are read from the cell, never from how the sheet displayed them. An old `.xls` file is not read: the screen says to save it as `.xlsx` or CSV. CSV stays.)

---

## 14c. Hospital onboarding, the patient network, and branded apps

Added 2026-10-05 with the owner's direction of that day (§4.2b).

### Onboarding (`FR-ONB`)

A hospital is brought onto the platform from screens, without a developer.

- `FR-ONB-01` A platform administrator creates a hospital's workspace from `S-B-12`: its name in both languages, its kind, division and district, a unique hospital code (`FR-BRD-01`), and the name and email of its first administrator, whose temporary password is shown once. A hospital can also apply by itself (`FR-ONB-09`).
- `FR-ONB-02` A workspace has a state: **setting up** → **ready for review** → **active**, and from active **suspended** or **closed**. Only an active workspace can be live, whatever a route forgets. A workspace that never went live (setting up, or ready for review) can be closed by the platform as well, with a reason: once a hospital can make a workspace by itself (`FR-ONB-09`), one nobody could dismiss would wait in the list for ever (added with plan D1, 6 October 2026).
- `FR-ONB-03` The hospital's administrator sees a checklist on `S-B-11`: what exists and what is still missing (departments, doctors and how many are verified, schedules, beds confirmed, staff), counted from the records and never stored, with the three ways to fill it (by hand, the template CSV, the hospital's own export). **Since plan D2 (6 October 2026)** the checklist also names what a patient needs to reach the place: an address and a phone number, a place on the map, and the emergency services declared where there is an emergency desk. These are named as worth adding and review does not wait for them. On the same screen the hospital corrects what it entered wrong: a department's, a ward's or a bed's details; the removal of a department nobody sits in, a ward with no bed, or a bed the ward never brought into service; and, while the workspace is still setting up, its division, district and registration number, which are what the platform reviews.
- `FR-ONB-04` **Going live is asked for by the hospital and approved by the platform.** The hospital's administrator requests review when the checklist allows it; a platform administrator approves, or sends it back with a note the hospital sees. Until approval nothing of the hospital is public.
- `FR-ONB-05` A platform administrator records a doctor's BMDC verification from `S-B-12` (`FR-SUP-02`).
- `FR-ONB-06` A platform administrator can suspend a workspace, which takes it out of every public surface at once and leaves its staff able to sign in, and reinstate it.
- `FR-ONB-07` Every one of these acts is audited: who, when, which workspace, and the note.
- `FR-ONB-09` **A hospital can apply by itself** (owner, 6 October 2026). A public form takes the facility's name in both languages, its kind, division and district, a phone number, its registration number, and its administrator's name, email, mobile and password. It creates a workspace that is **setting up** and nothing else: nothing public, no code a patient can open, no figure in the network. The form is rate-limited by address, and the administrator sets up two-step verification at first sign-in like any other. The form does not ask for a hospital code: one is made from the facility's English name and told to the applicant with the answer. A deployment holds only so many applications nobody has acted on; at that many the form says it is paused, and is not a fault.
- `FR-ONB-10` An application is a workspace like any other: the platform administrator sees it among those waiting, with that it was self-registered, and it goes live only by `FR-ONB-04`. Creating an account never publishes a hospital. The platform administrator sees what the applicant gave to be reached by (the facility's phone and registration number, the administrator's mobile), and declines an application by closing its workspace with a reason (`FR-ONB-02`).
- `FR-ONB-11` **Approved private chambers** (owner, 8 October; decision 7; plan R7). An organisation on the platform is a registered hospital, clinic, diagnostic centre or government hospital, or a doctor's **private chamber that the platform has approved**. A private chamber is a workspace like any other once it exists (its own staff, chambers, settings and modules), but only a platform administrator creates one (`FR-ONB-01`): the public application (`FR-ONB-09`) does not offer the kind, so there is no open self-registration for an unregistered chamber. What the platform checks before approving one is the platform's own process and is not decided here.
- `FR-ONB-08` The platform administrator's screen shows organisations and counts. It never shows a patient, a booking or a record (`FR-NET-02`).

### The patient network (`FR-NET`)

- `FR-NET-01` What a hospital contributes to the patient network is public operational information only: its name and address, its departments, its verified doctors with their chamber times and fees, how many serials are open, beds by kind, emergency capabilities, medicine stock flags, and the age of each figure.
- `FR-NET-02` Nothing that identifies a patient and nothing internal to a hospital (a queue by name, staff, takings, records) is visible to another hospital or to the public. Something crosses between hospitals only by a deliberate act the product already has: a referral, or a patient's consent (`FR-SEC-04`).
- `FR-NET-03` A hospital is in the network only while its workspace is active and live (`FR-ONB-02`).
- `FR-NET-04` A hospital decides which of these it publishes. A figure it does not publish is shown as not shared, never as zero. **Built (plan C5):** the hospital's administrator switches each of three figures on `S-B-11`: its open serials and who is sitting, its beds, and what its pharmacy has. What its emergency department can treat is not one of the three and is always shared while it runs an emergency desk; whether a hospital may keep that is the owner's to rule on (`docs/STATUS.md`, question 8).

### Branded patient apps (`FR-BRD`)

After an agreement a hospital may be offered the patient app in its own name. It is the same app on the same API.

- `FR-BRD-01` Every hospital has a stable, unique code. It names the hospital in an address and in an app's configuration, and does not change.
- `FR-BRD-02` The patient app has a **hospital scope**. Unset, it is the whole network. Set to a hospital's code, discovery, booking and beds are that hospital's only, and so are the serials the app lists from what this phone booked. It is configuration, never a second codebase.
- `FR-BRD-03` Everything a patient sees is drawn from tokens (`FRONTEND.md` §1–3) and one app name, so that a hospital's name and colours replace ours by configuration read from the server.
- `FR-BRD-04` The links sent to a patient and the addresses the API answers are built in one place each, so that they can later differ by hospital (`code.platform-domain`) without changing what calls them. **Hospital-aware since plan C2:** a link issued while answering a request from a hospital's portal opens in that portal; one issued with no patient's browser behind it (a counter, a worker) goes to the hospital's own domain if it has one, and otherwise to the network. Callers did not change.
- `FR-BRD-05` Not in V1: store builds per hospital and any automation of them. (A logo and a hospital's own address were here until 6 October 2026; they are `FR-BRD-06` and `FR-BRD-07` now.)
- `FR-BRD-06` **A hospital's public face is its own to set** (owner, 6 October 2026): its name in both languages, a short description, its public phone numbers and address, a logo, and its colours (the six brand tokens, refused if they fail contrast). Set by the hospital's administrator on `S-B-11`, shown wherever the hospital is shown, and in its own portal in place of ours. **Built** (plan C1, migration 0045): the description, the logo (PNG, JPEG or WebP up to 256 KB; no SVG) and the colour are set on `S-B-11`; the screen asks for one colour and makes the six tokens from it, and the server refuses a set that fails contrast whatever the screen sent. A hospital's card, its page and its own portal carry them. The logo is public only once the hospital is in the network (`FR-NET-03`).
- `FR-BRD-07` **A hospital's portal has an address.** The patient app opened at `<code>.<platform domain>`, or at a domain the hospital owns and a platform administrator has recorded for it, is that hospital's portal with no parameter. The platform's own address is the network. Pointing a domain's DNS at the platform and its certificate are outside the product; recording the domain and answering for it are inside. **Built** (plan C2, migration 0046): with `PLATFORM_DOMAIN` set, `<code>.<that domain>` is the hospital's portal and needs nothing recorded; a platform administrator records a hospital's own domain on `S-B-12`, one a hospital and no two hospitals the same. At a portal the address decides: `?scope=` there neither changes whose it is nor leaves it. A name nobody has recorded is nobody's: the app shows nothing of anybody's, says so, and points at the network. The API answers a browser at the network's addresses and at portals' and at no other, except the one public question of whose address this is. With no `PLATFORM_DOMAIN` (the demonstration) nothing changes and a portal is opened with `?scope=`.
- `FR-BRD-08` **A hospital's portal installs as that hospital's app**: the name, icon and colour a phone shows after "Add to Home Screen" are the hospital's, from the same build. **Built** (plan C3): the install description (`/manifest.webmanifest`) is made per request from whose portal it is asked at, by address or by `?scope=`: the hospital's name, a short name that fits under an icon, its description, its colour, and its logo as the icon when the logo is a square PNG of at least 192 pixels; otherwise the platform's icon under the hospital's name. The page's title, and the name and icon an iPhone takes, are the hospital's too. It never fails: what cannot be found out installs as the network's app.
- `FR-BRD-09` **Inside a hospital's portal, emergency search is still the whole network** (owner, 6 October 2026): somebody with a burn case is shown the nearest unit that can treat it, whoever runs it. Every other page is the hospital's only. **Built** (plan C6): the emergency search does not read a scope at all, and inside a portal its results say in a line that they are every participating hospital's and not only this one's. The medicine search, which was the one other page still answering for the network, is the portal's hospital's pharmacy only. A portal's first screen offers no bed search where its hospital runs no ward and no medicine search where it keeps no shelf or keeps its shelf to itself (`FR-BRD-11`, `FR-NET-04`); the emergency card and the patient's records are always there.
- `FR-BRD-10` **A shared screen shares no record.** In a hospital's portal a patient sees what they would see in the network's app: their own records, wherever made. A hospital's staff see another hospital's record only by referral or the patient's consent (`FR-NET-02`, `FR-SEC-04`), never because the patient used that hospital's portal. **Built and held by tests** (plan C6): a portal sends its hospital's code and its own address with a request, and neither is read by anything that decides who may see a record.
- `FR-BRD-11` **Modules.** A hospital runs the modules switched on for it (`FR-SUP-03`): serials and reception, doctor's console, beds, emergency, lab, pharmacy, dashboard, import. A module that is off is not offered on that hospital's consoles, refused by the API, and absent from what the hospital publishes; nothing it already holds is deleted. **Built** (plan C4, migration 0047): stored as what is off, so every hospital starts with everything; the platform switches them on the hospital's workspace (`FR-SUP-03`). Off means three things at once: the hospital's own staff are refused every route of the module (`MODULE_OFF`), by one gate that a route cannot forget; what the module publishes is gone from the network (no bed figure and no bed request; out of the emergency search, with no alert taken; no chamber to book and no serial taken; out of the medicine search); and the consoles are told, so the picker offers no console of it and settings shows no tab of it and says which are off and whom to ask. Settings, signing in and the platform's screens are nobody's module. **One rule between modules:** the doctor's console works a chamber's queue, so it is never on where serials are off.
- `FR-BRD-12` **The staff workspace is the hospital's own** (owner, 8 October; decision 9). Every hospital console shows that hospital's logo, its name and its colours, with a small **Powered by MedLiveBD** beneath. The colours are the ones the hospital set for its patients (`FR-BRD-06`); a hospital that set none keeps the platform's, and a colour that would make text unreadable is refused as it is for patients (`FR-LOC-05`). MedLiveBD stays the network's name in the patient app (`FR-BRD-03`).

---

## 15. Functional requirements — Government / national layer

- `FR-GOV-01` District and national live capacity map: beds, ICU, ventilators, burn units, blood availability.
- `FR-GOV-02` Aggregate emergency load heat map for disaster response.
- `FR-GOV-03` Symptom-category spike detection by area (dengue, diarrhoeal, fever) as an early signal.
- `FR-GOV-04` Anonymised facility benchmarking (wait times, turnaround, feedback).
- `FR-GOV-05` Designed to exchange records with the national shared health record infrastructure via published APIs; the Platform complements it and never claims to replace it.
- `FR-GOV-06` No patient identifiers are exposed in this layer under any configuration.

> **In this version** (step 20, `S-B-13`): `FR-GOV-01`–`04` and `06` are built;
> `FR-GOV-05` (exchange with the national shared health record) waits, like
> every real integration, for a counterparty (`CLAUDE.md` §1.1).
>
> - `FR-GOV-03` counts a category the **treating doctor** puts on the visit
>   (`CHIP-B05-SIGNAL`: dengue, diarrhoeal, fever, or none). Nothing else in
>   the product records a category — the booking reason and the diagnosis are
>   free text — and reading one out of free text would be the diagnostic
>   inference §27 rules out. A spike is this week at least double the usual
>   week and at least five cases.
> - `FR-GOV-01`'s ventilators and blood availability are shown as not
>   recorded: no table holds either.
> - `FR-GOV-04` names no facility; it shows the facility's kind.
> - A government viewer holds no facility (`FR-ROLE-01`): `staff_users` and
>   `staff_roles` allow a null hospital for the two national roles only.

---

## 16. The Live Queue Engine

This is the heart of the system. Specified tightly because everything else depends on it.

### 16.1 Model

- `FR-QUE-01` A **session** has: hospital, doctor, department, room, planned start, planned end, status (`scheduled`, `running`, `paused`, `ended`, `cancelled`).
- `FR-QUE-02` The queue state is **derived from an append-only event log**, never edited in place.
- `FR-QUE-03` Event types: `SESSION_OPENED`, `DOCTOR_ARRIVED`, `DELAY_DECLARED`, `SESSION_PAUSED`, `SESSION_RESUMED`, `PATIENT_CALLED`, `PATIENT_DONE`, `PATIENT_LATE`, `PATIENT_NO_SHOW`, `PATIENT_REINSERTED`, `PATIENT_ARRIVED` (`FR-REC-18`), `WALKIN_ADDED`, `BOOKING_CANCELLED`, `SLOT_OFFERED`, `SLOT_ACCEPTED`, `PRIORITY_REORDERED`, `SESSION_ENDED`.
- `FR-QUE-04` Every event stores: session, actor (user + role), timestamp (server), client timestamp, and payload.
- `FR-QUE-05` Replaying the log for a session reproduces its exact state. This is the debugging and dispute-resolution mechanism.
- `FR-QUE-06` **A session keeps its service date.** A session belongs to the date it was scheduled for — the Dhaka date of its planned start — for its whole life. Running or paused past midnight does not change that date, does not make it a session of the next day, and moves none of its bookings. Reports, the schedule job and history all group by that date. The next day's scheduled chamber for the same doctor is a separate session; the two may be open at once and neither replaces the other. Founder's decision, 2026-10-05.

### 16.2 ETA calculation

- `FR-QUE-10` Base estimate per patient = rolling average consultation duration for that doctor, seeded by their historical average, defaulting to a configured value for a new doctor.
- `FR-QUE-11` ETA for serial *n* = now + (patients remaining before *n*) × current rate, adjusted for declared delays and pauses.
- `FR-QUE-12` The rate updates continuously from completed consultations in the running session, weighted toward recent ones.
- `FR-QUE-13` ETAs are expressed as a time plus a confidence band ("around 6:05, ±15 min") rather than false precision.
- `FR-QUE-14` Recalculation is triggered by every queue event and completes in under 500 ms for a session of 100 patients.
- `FR-QUE-15` A patient's ETA never moves earlier than their booked window without an explicit notification, to avoid people missing a turn that arrived early. **Built (plan F2c, 6 October 2026):** what a patient was told is one time, the one in the last message that named one (the doctor has arrived, a delay, or this notice), or the chamber's planned start, which is the time in the confirmation. When a queue action leaves a waiting patient's estimate earlier than that by more than the estimate's own band, they are sent "your turn may come sooner, now around …" in the same write, before any screen shows the earlier time, and what they were told becomes the new time. Not sent while the chamber cannot support a time at all (the doctor has not arrived, or it is paused), nor to a patient reception has checked in.

### 16.3 Late, no-show, and recovery

- `FR-QUE-20` Grace period before no-show is configurable per hospital (default: 2 patients or 15 minutes, whichever is longer).
- `FR-QUE-21` A late-declared patient is re-inserted after *k* patients (default 3), never dropped.
- `FR-QUE-22` A no-show may be reinstated by reception; the event is logged with actor.
- `FR-QUE-30` Freed slots are offered to standby patients in order, with a short acceptance window; unaccepted offers pass to the next patient. **An offer lapses on the clock** (plan H1b): a timer records it within thirty seconds of its window closing, whoever is or is not looking at the chamber. A *declined* offer passes to the next person by itself; a *lapsed* one returns the chair to reception, who offer it again, and the next offer goes to the next person and not back to the one who did not answer. Whether a lapse should pass on by itself as a decline does is the owner's to say (`docs/STATUS.md`, question 14).
- `FR-QUE-31` Recovered slot value is attributed to the hospital's recovery metric.

### 16.4 Broadcast

- `FR-QUE-40` Each running session has a realtime channel; patient devices subscribe to their session.
- `FR-QUE-41` A queue event results in a patient-visible update within 2 seconds under normal network conditions.
- `FR-QUE-42` Patients not connected receive SMS for material changes only (called, delayed, cancelled, slot offered) to control cost.
- `FR-QUE-43` Every broadcast includes a server timestamp so clients can display freshness.

### 16.5 Conflict and offline rules

- `FR-QUE-50` Reception actions are accepted offline and queued locally with client timestamps.
- `FR-QUE-51` On reconnect, queued events are replayed in client-timestamp order; the server is authoritative for ordering collisions.
- `FR-QUE-52` Bookings made online while a console was offline are merged into the session and appear as new arrivals, never silently dropped.
- `FR-QUE-53` If two counters run the same session, the server serialises `PATIENT_CALLED` so only one patient is "now serving" at a time.

---

## 17. Notifications and messaging

- `FR-NOT-01` Channels: in-app push, SMS, and (later) IVR call for critical alerts.
- `FR-NOT-02` Channel policy: app users get push + SMS for material events; non-app users get SMS only.
- `FR-NOT-03` Material events: booking confirmed, doctor arrived, delay declared, "leave now", called soon (2 patients away), called, marked no-show, slot offered, report ready, follow-up due.
- `FR-NOT-04` All message templates exist in Bangla and English, with the patient's preferred language chosen at send time.
- `FR-NOT-05` Templates are versioned and centrally managed, never hard-coded at call sites.
- `FR-NOT-06` Per-hospital SMS budget caps and delivery reporting. **A message that fails is tried again** (plan H1): five tries over about twenty minutes (after a failure a quarter of a minute, then one minute, five, fifteen), then it is recorded as failed with what the gateway last said and how often it was asked, and the platform's health view counts it (`FR-SUP-06`). No request waits for a gateway. Delivery reports from an aggregator are plan H2. **Delivery reporting is built to the credential line** (plan H2): an aggregator's signed delivery receipts are taken (`/webhooks/sms-dlr`) and each marks the one message it names as delivered or failed; a hospital's administrator reads the month's SMS on the settings screen by what became of them, against the cap set there. With a provider that reports no delivery, which the demonstration's is, "reached the phone" is said to be unknown and is never shown as nought. Which aggregator, its account and its sender ID are outside the repository (`CLAUDE.md` §1.1).
- `FR-NOT-07` Quiet hours for non-urgent notifications; emergency and queue events override. Quiet hours are ten at night to seven in the morning in Dhaka. **A message held for them is sent when they end** (plan H1): it waits, due at seven, and goes then. Until that branch it was recorded as not sent and never was.

---

## 18. Localisation and accessibility

- `FR-LOC-01` Bangla is the default locale throughout, including numerals where the audience expects them.
- `FR-LOC-02` Every string is externalised; no hard-coded copy in components.
- `FR-LOC-03` Dates, times, and currency follow Bangladeshi conventions (12-hour clock with বিকাল/সন্ধ্যা, ৳).
- `FR-LOC-04` Minimum touch target 44×44 px; minimum body text 15 px on mobile.
- `FR-LOC-05` Text contrast meets WCAG AA (4.5:1 body, 3:1 for 24px+).
- `FR-LOC-06` All interactive elements are real buttons, links, or inputs with labels; icon-only controls carry accessible labels.
- `FR-LOC-07` Critical flows (book, live serial, emergency) are usable one-handed.
- `FR-LOC-08` No flow requires reading English.

---

## 19. Offline behaviour and data freshness

- `FR-OFF-01` Reception, ward, and emergency consoles are offline-first: full read and write capability without internet, with visible offline status and pending-sync count.
- `FR-OFF-02` The patient app degrades gracefully: cached last-known state plus an explicit staleness banner.
- `FR-OFF-03` Every live figure in any surface carries an `as of` timestamp derived from the server.
- `FR-OFF-04` Freshness thresholds are configurable; beyond threshold, a value is labelled stale and de-ranked in emergency results.
- `FR-OFF-05` No screen ever renders a placeholder value that could be mistaken for real data.

---

## 20. Payments and money flow

- `FR-PAY-01` Supported methods: bKash, Nagad, card, and pay-at-hospital.
- `FR-PAY-02` A booking may require full prepayment, a deposit, or nothing, configurable per hospital and per doctor.
- `FR-PAY-03` Refund rules for cancellation and doctor absence are stated before payment and enforced automatically.
- `FR-PAY-04` Platform fee is itemised separately from the hospital's fee; the patient always sees who gets what.
- `FR-PAY-05` Hospital settlement reports: bookings, collections, fees, payouts, disputes.
- `FR-PAY-06` Every payment has an idempotency key; retries never double-charge.
- `FR-PAY-07` Doctor absence triggers automatic refund eligibility without the patient asking.
- `FR-PAY-08` **A serial held while it is paid for** (owner, 7 October, question 15). When a patient chooses an online method the serial is theirs at once and held for the hospital's payment hold, fifteen minutes unless the hospital sets another. A second attempt within the hold keeps the first attempt's deadline. Not paid by the end of the hold: where the hospital takes payment at the counter, the serial becomes pay-at-the-counter; where this booking had to be paid first (`FR-PAY-02`, `FR-GST-14`), the serial is released. Either way the patient's screen and an SMS say which.
- `FR-PAY-09` **Only the provider says a payment was made.** The patient's browser returning with "success" proves nothing: the server asks the provider, server to server, and records what the provider answers, including the amount, which must be the amount asked for. A provider that cannot be reached leaves the payment pending, and it is asked again until the hold ends and once more after it.
- `FR-PAY-10` **A second payment for one serial is owed back.** Money a provider reports for a booking already paid, or for a serial already released, is recorded as received and marked owed back to the patient, never silently kept and never lost.
- `FR-PAY-11` **Every payment keeps its history**: created, sent to the provider, asked, paid, failed or cancelled, expired, turned to the counter, released, owed back, refunded; each with its time and nothing that identifies the patient's wallet. Readable by the hospital's administrator.
- `FR-PAY-12` **A refund a provider cannot make by API is recorded by hand** with the reference the administrator was given (a counter receipt, the provider's merchant panel); the amount is still the rule's, never typed (`FR-PAY-03`).

---

## 21. Security, privacy, and compliance

- `FR-SEC-01` Role-based access control on every endpoint and every screen.
- `FR-SEC-02` Encryption in transit and at rest for all patient data.
- `FR-SEC-03` Audit log for every access to an identifiable record: who, when, which patient, from where.
- `FR-SEC-04` Consent is explicit, per hospital, revocable, and visible to the patient.
- `FR-SEC-05` OTP rate limiting and device binding to prevent account takeover.
- `FR-SEC-06` Staff accounts require individual logins; shared counter accounts are prohibited by design (each counter session identifies the operator).
- `FR-SEC-07` Data residency in Bangladesh where required; cloud region choice is a deployment decision recorded in `BACKEND.md`. **Decided 2026-09-28:** a deployment holding real patients runs on a server in Bangladesh — the hospital's own or a Bangladeshi data centre. The demo stays where it is, because it holds no real data (`FR-SEC-08`). **Amended 2026-10-05:** that deployment is **one shared platform hosted in Bangladesh**, every hospital a workspace inside it, because the patient network (`FR-NET-*`) needs several hospitals in one place. A hospital on a server of its own is an exception for a later day and is not what V1 is designed around; real patient data stays in Bangladesh either way.
- `FR-SEC-08` Demo and prototype environments contain no real patient data, ever.
- `FR-SEC-09` Deletion and export requests are supported per profile.
- `FR-SEC-10` Staff two-step verification: a code from an authenticator app after the password. Required for administrators (hospital and platform); any other staff account may turn it on. Ten single-use recovery codes for a lost phone; otherwise another administrator resets it, audited. Added 2026-09-29 to record pilot step 28 (`CLAUDE.md` §4.2).

- `FR-SEC-11` **Hospitals are kept apart by the database, not only by the application**, before two hospitals' real data share a deployment: a policy on every hospital-scoped table, keyed on the request's hospital, for the role the API connects as; and no staff read of another hospital's patients, bookings or records without a referral or a consent (`FR-NET-02`). A demonstration on synthetic data may run without it; a second real hospital may not. Owner's decision, 2026-10-05. **Built for staff** (plan B1, migration 0043, `DATABASE.md` §5.2): a member of one hospital's staff reaches that hospital's rows and no other's, a platform administrator reaches organisations and nothing about a person, and a connection that says nothing reaches nothing. It binds a deployment whose API connects as its own role, which is one holding real patients; the public demonstration's API connects as the database's owner and is not bound. **Built for a person's clinical record** (plan B3, migration 0044, `DATABASE.md` §5.3): an account reaches the visits, tests, reports, consents and stays of its own profiles and nobody else's, a tracking link what was written at the one booking it names (`FR-GST-05`), and a request that is nobody's none of it. **Built for a person's bookings, payments and messages** (plan I3, migration 0056, `DATABASE.md` §5.4): an account reaches its own bookings, profiles, payments, links, standby places and messages, a link its one booking's, and nobody none; the queue acts for a person as the server once the application has decided the request is theirs.

---

## 22. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-01 | Queue update latency (reception tap → patient device) | ≤ 2 s p95 |
| NFR-02 | Console action response (local) | ≤ 100 ms |
| NFR-03 | ETA recalculation for 100-patient session | ≤ 500 ms |
| NFR-04 | Patient app first meaningful paint on 3G | ≤ 3 s |
| NFR-05 | Offline console continuous operation | ≥ 8 hours |
| NFR-06 | Sync reconciliation after reconnect | ≤ 30 s for a day's events |
| NFR-07 | Uptime target (pilot) | 99.5% |
| NFR-08 | Concurrent live sessions per hospital | ≥ 50 |
| NFR-09 | Data retention of queue events | ≥ 2 years |
| NFR-10 | Accessibility | WCAG AA |

---

## 23. Demo data for the prototype

- `FR-DEM-01` Six facilities: two large private (Dhaka), one mid-size private (Chattogram), one government medical college, one diagnostic centre, one clinic.
- `FR-DEM-02` ~40 doctors across cardiology, medicine, gynaecology, orthopaedics, paediatrics, neurology, ENT, dermatology, with realistic Bangladeshi names, evening chamber hours, fees 500–2,000 BDT.
- `FR-DEM-03` ~200 patient profiles, ~500 historical visits with prescriptions and reports.
- `FR-DEM-04` Bed inventory across wards with live occupancy; two facilities with burn units, three with ICU.
- `FR-DEM-05` Eight ambulances, thirty blood donors, fifty pharmacy items.
- `FR-DEM-06` A seed script can reset the demo to a known state in one command, including a session mid-queue ready for the pitch.
- `FR-DEM-07` All demo content is visibly labelled as demonstration data. The label follows the server: it is shown where the server says it is a demonstration, never on a real server, and not before the server has answered — a real hospital's screen that calls its own patients display data is the worse mistake of the two (owner's decision, 2026-10-05).

---

## 24. The pitch demo script

The pitch is the whole platform (§4.2b): what a patient sees across hospitals, what one hospital's staff do, and how a hospital joins. Steps 1–8 are a hospital's day and take five minutes; 9–11 are the platform and take three more. Every step runs on demonstration data (`FR-DEM-*`).

1. A patient searches for what they need — a doctor, a specialty, an ICU bed — and sees which hospitals can provide it, each with its live figure and how old that figure is (`FR-PAT-16`–`19`). They pick a cardiologist, book a serial and see it with an estimated time.
2. Reception marks the doctor arrived; the patient screen updates live on a second device.
3. Doctor declares a 30-minute delay; every waiting patient's screen and message carry the new expected time.
4. Reception calls next three times; the patient's position and ETA move in real time.
5. A no-show is marked; the slot is offered to standby; acceptance appears; recovered revenue shows on the admin dashboard.
6. Doctor writes the visit record — diagnosis, advice in Bangla, follow-up — and signs; it lands in the patient's wallet and the next patient is called in the same tap; a lab report arrives minutes later. (Prescribing itself is out of scope for this version; see §9.)
7. Emergency: a burn case searches nearby hospitals, sees which has a free burn bed with fresh data, taps "I'm on my way"; the emergency console shows the inbound alert.
8. The admin dashboard: waits down, no-show loss recovered, occupancy visible.
9. The same patient app opened as one hospital's own (`FR-BRD-01`–`05`): that hospital's name and colours, its doctors, beds and serials only, on the same server.
10. A hospital joins (`FR-ONB-01`–`08`): the platform administrator adds it and its first administrator from a screen; the hospital's administrator signs in, sees what is still missing, and asks for review; the platform administrator verifies a doctor and approves; the hospital appears in the patient's search. No command line.
11. A hospital brings what it already holds (`FR-IMP-13`–`20`): its own patient export, with its own column names, is uploaded; the columns are matched by rules, with a model suggesting the ones the rules do not know; a person confirms; the file is checked, previewed, imported, and can be undone. The model is sent headings, never a row.

Not in the script, because it is not in V1: rescheduling (`FR-PAT-23`), ambulance and blood (`FR-PAT-73`–`75`), prescriptions (§9).

---

## 25. Success metrics

**North star:** number of **live sessions** — sessions where the queue was kept accurate end to end.

| Stage | Metric | Why |
|---|---|---|
| Prototype | Hospitals asking "when can we start?" after a demo | Demand signal |
| Pilot | Average wait time reduction; % sessions kept live; no-show rate change; reception calls per day; bed board update latency | Operational proof |
| Pilot | Patients returning for a second booking | Product value |
| Scale | Hospitals live; monthly active patients; emergency searches that convert to arrivals; referral leakage recovered | Adoption |

---

## 26. Release plan

| Phase | Contents | Exit criteria |
|---|---|---|
| P0 | Design system, demo seed, auth, roles | Roles can log into their own shells |
| P1 | Sessions, bookings, **queue engine**, reception console, live serial | Two-device live demo works end to end |
| P2 | Doctor app, visit records, health wallet | A visit produces a record the patient can open |
| P3 | Beds, emergency console, public emergency search | Capability + freshness ranked results |
| P4 | Diagnostics, pharmacy, ambulance, blood | Reports reach wallets automatically |
| P5 | Admin dashboard, national dashboard | Hospital sees loss and recovery in taka |
| P6 | Offline hardening, SMS, payments, audit, consent | Pilot-ready in a real hospital |

---

## 27. Out of scope (for now)

- Insurance claim adjudication.
- Full hospital ERP: HR, payroll, procurement, accounting.
- Clinical decision support or any diagnostic AI.
- Inpatient nursing charts, medication administration records, OT scheduling.
- Cross-border medical tourism.
- Replacing an existing hospital HMS wholesale; the Platform integrates or runs alongside.
- Any AI beyond proposing an import mapping (`FR-IMP-16`): none that diagnoses, advises on treatment, scores a doctor or a member of staff, or writes patient data.
- Software written for one hospital. The platform is configured for a hospital, never forked for it.

---

## 28. Open decisions

| # | Decision | Owner | Needed by |
|---|---|---|---|
| 1 | ~~Product name~~ **MedLiveBD**, decided 6 October 2026. The domain is still open | Founders | Before pitch |
| 2 | Legal entity in Bangladesh and contract signatory | Founders | First agreement |
| 3 | Whether to pursue national record integration before or after private traction | Founders | v2 |
| 4 | SMS aggregator | Tech | Pilot |
| 5 | ~~Hosting region and data residency~~ — decided 2026-09-28: Bangladesh (`FR-SEC-07`) | Tech | Pilot |

> Commercial terms — what the Platform charges, which modules are sold
> together, and what data terms are offered to a hospital — are deliberately
> **not** recorded in this document set. They are negotiated per agreement and
> live outside the repository.

---

*End of PRD.md. Companion documents: `APP_FLOW.md` (screen-by-screen flows and states), `FRONTEND.md` (stack, component structure, design tokens), `BACKEND.md` (data model, APIs, realtime, sync, deployment).*
