# Product Requirements Document (PRD)
## National Healthcare Platform — Bangladesh

**Document:** PRD.md — 1 of 4 (`PRD.md`, `APP_FLOW.md`, `FRONTEND.md`, `BACKEND.md`)
**Version:** 1.0
**Owner:** Sidrat — Technical Founder
**Audience:** the build agent (Claude Code), future engineers, and pitch reviewers
**Product name:** `[TBD]` — referred to in this document as **the Platform**

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
4. Scope: v0 prototype, v1 pilot, v2 scale
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
15. Functional requirements — Government / national layer
16. The Live Queue Engine (the moat, specified in detail)
17. Notifications and messaging
18. Localisation and accessibility
19. Offline behaviour and data freshness
20. Payments and money flow
21. Security, privacy, and compliance
22. Non-functional requirements
23. Demo data for the prototype
24. The five-minute pitch demo script
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
- `FR-PAT-02` A user can create multiple patient profiles (self, mother, child…) with name, age or DOB, gender, blood group, and optional NID.
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
- `FR-GST-14` Abuse control: guest bookings are rate-limited per phone number and per device; three no-shows on a phone number within a rolling window may require prepayment for the next guest booking, configurable per hospital.
- `FR-GST-15` Privacy: guest data follows the same retention, consent, audit, and deletion rules as account data (`FR-SEC-03`, `FR-SEC-09`); a guest can request deletion by phone verification.

**Acceptance:** a man with no account books a cardiology serial in under 60 seconds with name, phone, one OTP, and a bKash payment; he tracks the live queue from the SMS link; two weeks later he signs up and his prescription is waiting for him.

### 7.2 Discovery

- `FR-PAT-10` Browse hospitals by distance, specialty, or name.
- `FR-PAT-11` Browse doctors by specialty, symptom category, fee range, availability today, and hospital.
- `FR-PAT-12` A doctor card shows: name, degrees, specialty, hospital, chamber times, fee, BMDC-verified badge, average consultation minutes, current live status.
- `FR-PAT-13` Live status values: *in chamber now*, *expected at HH:MM*, *not sitting today*, *unknown*.
- `FR-PAT-14` Hospital cards show live wait estimate, free beds, ICU count, and a freshness stamp.
- `FR-PAT-15` Search must work with Bangla and English text and tolerate common misspellings of doctor names.

### 7.3 Booking

- `FR-PAT-20` Booking flow: choose doctor → choose session → confirm profile → pay or choose pay-at-hospital → receive serial.
- `FR-PAT-21` Fees display as a breakdown: consultation, platform fee, total, and what is due at the hospital.
- `FR-PAT-22` Confirmation is delivered in-app **and** by SMS, containing hospital, doctor, date, serial number, and expected time window.
- `FR-PAT-23` A patient can reschedule to another session or cancel; policy and any refund rule are stated before confirming.
- `FR-PAT-24` The app prevents double-booking the same profile with the same doctor on the same day.
- `FR-PAT-25` If a session is full, the patient may join a **standby list** and will be offered released slots automatically (see `FR-QUE-30`).

### 7.4 Live serial (core)

- `FR-PAT-30` The live serial screen shows: doctor arrival status, current serving number, the patient's number, estimated call time, and a countdown.
- `FR-PAT-31` The screen updates within 2 seconds of a reception action, without a manual refresh.
- `FR-PAT-32` A **leave-home alert** fires when estimated travel time + buffer equals remaining wait. Travel time may be a static per-hospital estimate in v0.
- `FR-PAT-33` **I'm running late**: the patient declares lateness with an expected arrival; the system offers to move them later in the same session and states the new position.
- `FR-PAT-34` **Doctor delay**: when a delay is declared, every waiting patient receives a notification with the new expected time and one-tap options: keep serial, reschedule, cancel.
- `FR-PAT-35` Every live figure carries a freshness line ("হালনাগাদ ২ মিনিট আগে").
- `FR-PAT-36` If the connection to the hospital is lost, the screen states that the number may be stale instead of showing a confident value.
- `FR-PAT-37` Feature-phone parity: all state changes in `FR-PAT-30`–`34` are mirrored by SMS.

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
- `FR-PAT-51` Each bed type shows count free, nightly price, and freshness.
- `FR-PAT-52` A patient may request a bed; the hospital confirms, holds, or declines, with a hold expiry.
- `FR-PAT-53` Admission status is visible to linked family profiles.

### 7.7 Health wallet

- `FR-PAT-60` Every completed visit creates a record: hospital, doctor, date, diagnosis, prescription, tests ordered.
- `FR-PAT-61` Lab and imaging reports are pushed into the wallet when ready, with a notification; no second trip required.
- `FR-PAT-62` Patients can photograph old paper records; these are stored with date, doctor, and type tags.
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

### 8.3 Registration and billing

- `FR-REC-20` Register a new patient in under 30 seconds: phone, name, age, gender; duplicates detected by phone number.
- `FR-REC-21` Print a token slip for walk-ins with serial, doctor, and estimated time.
- `FR-REC-22` Collect consultation fee, record method (cash, bKash, card), print or SMS a receipt.
- `FR-REC-23` End-of-shift reconciliation per counter: expected versus collected.

### 8.4 Waitlist recovery

- `FR-REC-30` When a slot frees (no-show, cancellation), the console offers it to standby patients in order and shows acceptance status.
- `FR-REC-31` Recovered slots and their taka value are recorded for the admin dashboard.

---

## 9. Functional requirements — Doctor app

- `FR-DOC-01` Today's sessions with counts: seen, waiting, late, average duration.
- `FR-DOC-02` One-tap delay declaration from the doctor's own phone, without calling reception.
- `FR-DOC-03` On calling a patient, the screen opens with: pre-visit intake summary, chronic conditions, allergies, last visits, previous prescriptions, recent test results.
- `FR-DOC-04` E-prescription: diagnosis field, medicine rows (name, strength, schedule, duration), free-text advice, follow-up date.
- `FR-DOC-05` Medicine autocomplete over a local formulary (generic and brand names).
- `FR-DOC-06` Order tests directly into the diagnostics queue.
- `FR-DOC-07` Patient-facing output prints and delivers in Bangla, including dosage instructions.
- `FR-DOC-08` Sign and finish advances the queue (equivalent to reception's *done*).
- `FR-DOC-09` Session earnings summary.
- `FR-DOC-10` Doctor may only view records of patients in their own sessions, or with explicit patient consent.

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
- `FR-PHR-02` Out-of-stock flagging feeds medicine availability search in the patient app.

---

## 13. Functional requirements — Hospital admin dashboard

- `FR-ADM-01` Today view: patients seen, average wait, longest wait, sessions running late, walk-in vs booked ratio.
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

---

## 14. Functional requirements — Platform super-admin

- `FR-SUP-01` Hospital onboarding wizard: departments, doctors, sessions, fees, beds, capabilities, counters.
- `FR-SUP-02` Doctor verification workflow against BMDC registration; unverified doctors cannot be published.
- `FR-SUP-03` Feature flags per hospital (queue only, queue + beds, full suite).
- `FR-SUP-04` Subscription and invoicing per hospital, with usage counters.
- `FR-SUP-05` Review moderation and abuse handling.
- `FR-SUP-06` System health view: sync lag per hospital, stale-data offenders, notification delivery rates.

---

## 15. Functional requirements — Government / national layer

- `FR-GOV-01` District and national live capacity map: beds, ICU, ventilators, burn units, blood availability.
- `FR-GOV-02` Aggregate emergency load heat map for disaster response.
- `FR-GOV-03` Symptom-category spike detection by area (dengue, diarrhoeal, fever) as an early signal.
- `FR-GOV-04` Anonymised facility benchmarking (wait times, turnaround, feedback).
- `FR-GOV-05` Designed to exchange records with the national shared health record infrastructure via published APIs; the Platform complements it and never claims to replace it.
- `FR-GOV-06` No patient identifiers are exposed in this layer under any configuration.

---

## 16. The Live Queue Engine

This is the heart of the system. Specified tightly because everything else depends on it.

### 16.1 Model

- `FR-QUE-01` A **session** has: hospital, doctor, department, room, planned start, planned end, status (`scheduled`, `running`, `paused`, `ended`, `cancelled`).
- `FR-QUE-02` The queue state is **derived from an append-only event log**, never edited in place.
- `FR-QUE-03` Event types: `SESSION_OPENED`, `DOCTOR_ARRIVED`, `DELAY_DECLARED`, `SESSION_PAUSED`, `SESSION_RESUMED`, `PATIENT_CALLED`, `PATIENT_DONE`, `PATIENT_LATE`, `PATIENT_NO_SHOW`, `PATIENT_REINSERTED`, `WALKIN_ADDED`, `BOOKING_CANCELLED`, `SLOT_OFFERED`, `SLOT_ACCEPTED`, `PRIORITY_REORDERED`, `SESSION_ENDED`.
- `FR-QUE-04` Every event stores: session, actor (user + role), timestamp (server), client timestamp, and payload.
- `FR-QUE-05` Replaying the log for a session reproduces its exact state. This is the debugging and dispute-resolution mechanism.

### 16.2 ETA calculation

- `FR-QUE-10` Base estimate per patient = rolling average consultation duration for that doctor, seeded by their historical average, defaulting to a configured value for a new doctor.
- `FR-QUE-11` ETA for serial *n* = now + (patients remaining before *n*) × current rate, adjusted for declared delays and pauses.
- `FR-QUE-12` The rate updates continuously from completed consultations in the running session, weighted toward recent ones.
- `FR-QUE-13` ETAs are expressed as a time plus a confidence band ("around 6:05, ±15 min") rather than false precision.
- `FR-QUE-14` Recalculation is triggered by every queue event and completes in under 500 ms for a session of 100 patients.
- `FR-QUE-15` A patient's ETA never moves earlier than their booked window without an explicit notification, to avoid people missing a turn that arrived early.

### 16.3 Late, no-show, and recovery

- `FR-QUE-20` Grace period before no-show is configurable per hospital (default: 2 patients or 15 minutes, whichever is longer).
- `FR-QUE-21` A late-declared patient is re-inserted after *k* patients (default 3), never dropped.
- `FR-QUE-22` A no-show may be reinstated by reception; the event is logged with actor.
- `FR-QUE-30` Freed slots are offered to standby patients in order, with a short acceptance window; unaccepted offers pass to the next patient.
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
- `FR-NOT-06` Per-hospital SMS budget caps and delivery reporting.
- `FR-NOT-07` Quiet hours for non-urgent notifications; emergency and queue events override.

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

---

## 21. Security, privacy, and compliance

- `FR-SEC-01` Role-based access control on every endpoint and every screen.
- `FR-SEC-02` Encryption in transit and at rest for all patient data.
- `FR-SEC-03` Audit log for every access to an identifiable record: who, when, which patient, from where.
- `FR-SEC-04` Consent is explicit, per hospital, revocable, and visible to the patient.
- `FR-SEC-05` OTP rate limiting and device binding to prevent account takeover.
- `FR-SEC-06` Staff accounts require individual logins; shared counter accounts are prohibited by design (each counter session identifies the operator).
- `FR-SEC-07` Data residency in Bangladesh where required; cloud region choice is a deployment decision recorded in `BACKEND.md`.
- `FR-SEC-08` Demo and prototype environments contain no real patient data, ever.
- `FR-SEC-09` Deletion and export requests are supported per profile.

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
- `FR-DEM-07` All demo content is visibly labelled as demonstration data.

---

## 24. The five-minute pitch demo script

1. Patient books a cardiology serial and sees serial 18 with an estimated time.
2. Reception marks the doctor arrived; the patient screen updates live on a second device.
3. Doctor declares a 30-minute delay; all waiting patients are notified; one reschedules in a tap.
4. Reception calls next three times; the patient's position and ETA move in real time.
5. A no-show is marked; the slot is offered to standby; acceptance appears; recovered revenue shows on the admin dashboard.
6. Doctor writes an e-prescription; it lands in the patient's wallet; a lab report arrives minutes later.
7. Emergency: a burn case searches nearby hospitals, sees which has a free burn bed with fresh data, taps "I'm on my way"; the emergency console shows the inbound alert.
8. Close on the admin dashboard: waits down, no-show loss recovered, occupancy visible.

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
| P2 | Doctor app, e-prescription, health wallet | A visit produces a record the patient can open |
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

---

## 28. Open decisions

| # | Decision | Owner | Needed by |
|---|---|---|---|
| 1 | Product name and domain | Founders | Before pitch |
| 2 | Legal entity in Bangladesh and contract signatory | Founders | First agreement |
| 3 | Whether to pursue national record integration before or after private traction | Founders | v2 |
| 4 | SMS aggregator | Tech | Pilot |
| 5 | Hosting region and data residency | Tech | Pilot |

> Commercial terms — what the Platform charges, which modules are sold
> together, and what data terms are offered to a hospital — are deliberately
> **not** recorded in this document set. They are negotiated per agreement and
> live outside the repository.

---

*End of PRD.md. Companion documents: `APP_FLOW.md` (screen-by-screen flows and states), `FRONTEND.md` (stack, component structure, design tokens), `BACKEND.md` (data model, APIs, realtime, sync, deployment).*
