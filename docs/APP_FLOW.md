# App & Web Flow Document
## National Healthcare Platform — Bangladesh

**Document:** `APP_FLOW.md` — 2 of 4 (`PRD.md`, **`APP_FLOW.md`**, `FRONTEND.md`, `BACKEND.md`)
**Version:** 1.0
**Depends on:** `PRD.md` (requirement IDs referenced throughout as `FR-XXX-NN`)
**Purpose:** every screen, every control, what each control is wired to, what happens after the tap, and what the user sees in success, failure, empty, loading, and offline states.

---

## 0. How to read this document

### 0.1 Two products, one system

| Product | Surface | Who | Delivery |
|---|---|---|---|
| **Part A — Public** | Mobile-first PWA (installable) | Patients, attendants, anyone in an emergency | `app.[domain]` — phone-sized, works on desktop but designed for phones |
| **Part B — Hospital** | Desktop web console | Receptionists, doctors, ward staff, ER coordinators, lab, pharmacy, admins | `console.[domain]` — monitor-sized, keyboard-first, **never shown in the patient app** |
| **Part C — Marketing site** | Public website | Hospital decision-makers, press, patients discovering the product | `[domain]` — the front door, with the two entrances |

**Rule:** the patient app contains no hospital login, no staff entry point, no "are you a hospital?" link other than a single footer link that opens the marketing site. Staff reach the console only from the marketing site or a direct URL.

### 0.2 ID conventions

| Prefix | Meaning | Example |
|---|---|---|
| `S-A-##` | Public app screen | `S-A-08` Live Serial |
| `S-B-##` | Hospital console screen | `S-B-02` Reception Queue |
| `S-C-##` | Marketing site page | `S-C-01` Home |
| `BTN-*` | A control | `BTN-A08-LATE` |
| `MOD-*` | Modal / bottom sheet | `MOD-A08-LATE` |
| `EVT-*` | Domain event written to the log | `EVT-PATIENT_CALLED` |

### 0.3 Wiring notation

Every control row reads:

**Trigger → Optimistic UI → Call → Server effect → Broadcast → Result UI → Failure UI**

- **Optimistic UI**: what changes instantly before the server answers (required for all console actions, `FR-OFF-01`).
- **Broadcast**: which realtime channel receives the change and who is listening.
- **Failure UI**: what the user sees when the call fails — never a silent failure, never a spinner that never resolves.

### 0.4 Global interaction rules

- `GR-01` Every destructive action (cancel booking, mark no-show, discharge, decline referral) requires a confirm step. Confirm text names the consequence, not "are you sure".
- `GR-02` Every console queue action gets a 10-second **undo** toast.
- `GR-03` Every screen has four defined states: loading (skeleton), empty, error (with retry), offline (with staleness banner).
- `GR-04` Nothing blocks on the network: console writes go to the local queue first.
- `GR-05` Every live number is rendered with its freshness line.
- `GR-06` Bangla is the default language everywhere; English is a toggle (`FR-LOC-01`).
- `GR-07` Emergency is always reachable: it is the first element of the app home and a persistent item in the app's navigation.
- `GR-08` No screen requires login. Emergency search, hospital browse, and doctor browse are fully open (`FR-PAT-40`); booking, payments, bed requests, ambulance, and blood are available to **guests** with phone + name (`FR-GST-01`). Only the multi-device wallet and saved profiles require an account. All console screens require staff login.

---

# PART A — PUBLIC APP (patients)

## A0. Entry and first run

### `S-A-00` Splash / boot

| Element | ID | Behaviour |
|---|---|---|
| Logo + tagline | — | Shown ≤ 1.5 s while the app checks session token and cached data |
| Silent checks | — | (1) valid token? (2) cached hospitals? (3) network? |

**Routing after boot**
- Token valid → `S-A-02` Home.
- No token, first ever launch → `S-A-01` Language.
- No token, returning → `S-A-02` Home in guest mode (browse + emergency allowed).

### `S-A-01` Language & location

| Element | ID | Type | Wiring |
|---|---|---|---|
| বাংলা | `BTN-A01-BN` | Big choice card | Sets locale `bn` → persists local → `S-A-01b` |
| English | `BTN-A01-EN` | Big choice card | Sets locale `en` → persists local → `S-A-01b` |

`S-A-01b` Location permission

| Element | ID | Wiring |
|---|---|---|
| অনুমতি দিন (Allow) | `BTN-A01-LOC-YES` | Requests OS permission → on grant store coords → `S-A-02` |
| এখন নয় (Not now) | `BTN-A01-LOC-NO` | Skips → `S-A-02`, distance features fall back to manual area picker |

**Failure:** permission denied permanently → area picker (`MOD-A02-AREA`) is used wherever distance is needed; never ask again automatically.

---

## A1. Authentication and profiles

### `S-A-03` Phone entry (`FR-PAT-01`)

| Element | ID | Type | Wiring |
|---|---|---|---|
| Phone field | `INP-A03-PHONE` | numeric input, +880 prefix fixed | Validates 11-digit BD mobile pattern; inline error below field |
| কোড পাঠান (Send code) | `BTN-A03-SEND` | primary, disabled until valid | → `POST /auth/otp` → success: `S-A-04` with 60 s resend timer; failure: inline error + retry |
| Trouble link | `BTN-A03-HELP` | text link | Opens help sheet: what the OTP is for, support number |

**Rate limiting UI:** after 3 sends in 10 minutes, the button disables with a countdown and an explanation (`FR-SEC-05`).

### `S-A-04` OTP verify

| Element | ID | Wiring |
|---|---|---|
| 6-digit input | `INP-A04-OTP` | Auto-advance, auto-submit on 6th digit, SMS autofill where available |
| যাচাই করুন | `BTN-A04-VERIFY` | → `POST /auth/verify` → **new user** → `S-A-05` profile creation; **returning** → `S-A-02` Home |
| আবার পাঠান | `BTN-A04-RESEND` | Disabled during countdown; re-issues OTP |
| নম্বর বদলান | `BTN-A04-EDIT` | Back to `S-A-03` |

**Failures:** wrong code → shake + inline "কোড মেলেনি"; expired → offer resend; 5 wrong attempts → lock 15 min with countdown.

### `S-A-05` Create first profile (`FR-PAT-02`)

Progressive disclosure: one question per screen-block, all required fields visible in one scroll.

| Field | ID | Required | Notes |
|---|---|---|---|
| নাম | `INP-A05-NAME` | yes | Bangla or English input |
| বয়স / জন্মতারিখ | `INP-A05-AGE` | yes | Age in years or full DOB toggle |
| লিঙ্গ | `SEG-A05-SEX` | yes | Segmented: পুরুষ / নারী / অন্যান্য |
| রক্তের গ্রুপ | `SEL-A05-BLOOD` | no | Dropdown, "জানি না" allowed |
| এনআইডি | `INP-A05-NID` | no | For future health-ID linkage |

| Control | ID | Wiring |
|---|---|---|
| সংরক্ষণ করুন | `BTN-A05-SAVE` | → `POST /profiles` → set as active profile → `S-A-02` |
| পরে করব | `BTN-A05-SKIP` | Allowed; booking later forces profile creation inline |

### `S-A-06` Profile switcher (`MOD`)

Opened from the avatar on Home or from any booking step.

| Element | ID | Wiring |
|---|---|---|
| Profile rows | `ROW-A06-<id>` | Tap sets active profile → sheet closes → current screen re-renders for that profile |
| + নতুন প্রোফাইল | `BTN-A06-ADD` | → `S-A-05` in "add" mode (self / mother / father / child / other relationship selector) |
| প্রোফাইল ব্যবস্থাপনা | `BTN-A06-MANAGE` | → `S-A-19` Profiles settings |

**Rule:** the active profile is shown persistently in the app header, because booking for the wrong person is the classic failure (`FR-PAT-03`).

---

## A1.5 Guest path (no account) — `FR-GST`

Guest is a full path, not a downgrade. The app never shows a login wall; it shows a **shorter form**.

### `MOD-A07-GUEST` Guest details sheet

Opened automatically at the confirm step (`S-A-07c`) when no session token exists. Same sheet is reused by bed request, ambulance, diagnostics, and blood.

| Field | ID | Required | Notes |
|---|---|---|---|
| রোগীর নাম | `INP-GST-NAME` | yes | |
| মোবাইল নম্বর | `INP-GST-PHONE` | yes | Serial updates and receipt go here |
| বয়স | `INP-GST-AGE` | yes for bookings | Not asked for emergency or ambulance |
| লিঙ্গ | `SEG-GST-SEX` | yes for bookings | |
| আমার জন্য / অন্য কারও জন্য | `SEG-GST-FOR` | no | Only changes the label wording |

| Control | ID | Wiring |
|---|---|---|
| এগিয়ে যান | `BTN-GST-NEXT` | If this phone has booked before → prefilled details shown for one-tap confirm (`FR-GST-12`). Else → `MOD-GST-OTP` |
| অ্যাকাউন্ট আছে? লগ ইন | `BTN-GST-LOGIN` | Optional escape hatch → `S-A-03`, returns to the same step afterwards |

### `MOD-GST-OTP` One-time phone check

Shown only when money or an SMS thread follows (`FR-GST-03`). Not shown for emergency actions.

| Control | ID | Wiring |
|---|---|---|
| 6-digit input | `INP-GST-OTP` | Auto-submit; SMS autofill |
| যাচাই করুন | `BTN-GST-VERIFY` | → `POST /guest/verify` → returns a **guest token** bound to phone + device. Creates no account, asks nothing further (`FR-GST-04`) |

### Guest booking completion

1. `BTN-A07C-CONFIRM` runs the normal booking chain with the guest token in place of a user token.
2. Server creates a **guest identity** keyed by phone, and a patient record attached to it.
3. SMS is sent containing: hospital, doctor, serial, expected window, and a **tracking link** (`FR-GST-05`).
4. Tapping the tracking link opens `S-A-08` Live Serial in guest mode — identical screen, identical live updates, including the late, reschedule, and cancel controls.
5. `S-A-07d` success screen shows one soft offer: `BTN-A07D-SAVEACC` — "সব রেকর্ড এক জায়গায় রাখুন" → `S-A-05`. Dismissable, never repeated in that session (`FR-GST-11`).

### Guest live serial differences

| Aspect | Account | Guest |
|---|---|---|
| Live screen | Same | Same, opened from the SMS link or the device that booked |
| Push notifications | Yes | Yes if the PWA is installed; SMS always |
| Late / reschedule / cancel | Yes | Yes |
| Records after the visit | In wallet | Downloadable from the tracking link for a limited period, and held against the phone for later claiming (`FR-GST-08`) |
| Multi-device access | Yes | Only via the SMS link |

### `S-A-20` Claim your history (`FR-GST-09`)

Triggered automatically after an account is created with a phone that has guest activity.

| Element | ID | Wiring |
|---|---|---|
| List of past bookings and records | — | Read-only preview |
| যোগ করুন | `BTN-A20-CLAIM` | Links all guest records to the new account under a chosen profile; one confirmation, no re-entry of any detail |
| না, থাক | `BTN-A20-SKIP` | Leaves them unlinked; offer reappears in settings |

### Guest in emergency (`FR-GST-03`)

`S-A-10`, `S-A-10b`, `S-A-10c` require **nothing at all** — no name, no phone, no OTP.
`BTN-A10-ONWAY` optionally offers a phone field so the ER can call back; leaving it blank still sends the inbound alert.
`BTN-A10-AMB` (ambulance) asks name + phone in `MOD-A07-GUEST`, with OTP because a fare and a driver are involved.

---

## A2. Home

### `S-A-02` Home

Layout order is fixed and deliberate: emergency first, then care, then convenience.

| Element | ID | Type | Wiring |
|---|---|---|---|
| App header: name + area | — | — | Tap area → `MOD-A02-AREA` area picker |
| Avatar | `BTN-A02-PROFILE` | icon button | → `S-A-06` profile switcher |
| **জরুরি অবস্থা** card | `BTN-A02-EMERGENCY` | Full-width red card, top of screen | → `S-A-10` Emergency triage. **No auth check.** Preloads nearby hospital capacity on press-down for speed |
| Section: ডাক্তার দেখান | — | — | Heading + subtitle |
| Specialty card ×N | `BTN-A02-SPEC-<code>` | grid card | → `S-A-07` Specialty results, filtered by that specialty and current area |
| সব বিভাগ দেখুন | `BTN-A02-SPEC-ALL` | text link | → `S-A-07b` full specialty list |
| Quick tile: বেড | `BTN-A02-BED` | tile | → `S-A-11` Bed search |
| Quick tile: অ্যাম্বুলেন্স | `BTN-A02-AMB` | tile | → `S-A-16` Ambulance |
| Quick tile: রক্ত | `BTN-A02-BLOOD` | tile | → `S-A-17` Blood |
| Quick tile: রিপোর্ট | `BTN-A02-REPORT` | tile | → `S-A-12` Wallet (Reports tab) |
| **Active serial strip** | `BTN-A02-ACTIVE` | appears only if an active booking exists today | → `S-A-08` Live serial. Shows live position, updates via the session channel while Home is open |
| Bottom nav | `NAV-A` | হোম / সিরিয়াল / রেকর্ড / প্রোফাইল | Tabs → `S-A-02`, `S-A-09`, `S-A-12`, `S-A-19` |

**States**
- Guest: everything visible; tapping anything that needs auth opens `S-A-03` with a return-to intent.
- No location: area picker chip replaces distances.
- Offline: cached hospital list with a staleness banner; emergency card still works and says data may be stale.

---

## A3. Finding care

### `S-A-07` Specialty results (hospitals offering it)

| Element | ID | Wiring |
|---|---|---|
| Back | `BTN-A07-BACK` | → previous screen |
| Filter chips | `CHIP-A07-NEAR` / `-WAIT` / `-FEE` / `-OPEN` | Client-side re-sort: distance / current wait / fee / sitting now. Selected chip is single-select except `-OPEN` which is a toggle |
| Search field | `INP-A07-SEARCH` | Filters by hospital or doctor name, Bangla + English (`FR-PAT-15`) |
| Hospital card | `CARD-A07-<hospitalId>` | → `S-A-05h` Hospital detail. Shows: name, area, distance, travel time, doctor count, live wait, free beds, ICU, freshness (`FR-PAT-14`) |
| Empty state | — | "এই এলাকায় এখন কেউ বসছেন না" + button to widen area |

### `S-A-05h` Hospital detail

| Element | ID | Wiring |
|---|---|---|
| Header stats | — | Free beds / ICU / ER wait, each with freshness (`FR-PAT-14`) |
| Tab: ডাক্তার | `TAB-A05H-DOC` | Doctor list (default) |
| Tab: বেড | `TAB-A05H-BED` | Bed types, counts, nightly price, request button |
| Tab: টেস্ট | `TAB-A05H-LAB` | Test catalogue + prices → `S-A-13` |
| Tab: জরুরি | `TAB-A05H-ER` | ER capabilities, current load, directions |
| Doctor row | `CARD-A05H-<doctorId>` | → `S-A-06d` Doctor detail |
| সিরিয়াল নিন (on row) | `BTN-A05H-BOOK-<doctorId>` | Fast path: skips doctor detail → `S-A-07b` Session picker |
| দিকনির্দেশ | `BTN-A05H-DIRECTIONS` | Opens the device map app with hospital coordinates |
| কল করুন | `BTN-A05H-CALL` | Dials hospital number |

### `S-A-06d` Doctor detail

| Element | ID | Wiring |
|---|---|---|
| Live status pill | — | চেম্বারে আছেন · এখন চলছে #12 / আসবেন ৫:০০ / আজ বসবেন না (`FR-PAT-13`), subscribed to the session channel while open |
| Chamber schedule list | `LIST-A06D-SESSIONS` | Rows per session: day, time, hospital, serials left |
| সিরিয়াল নিন | `BTN-A06D-BOOK` | → `S-A-07b` Session picker |
| স্ট্যান্ডবাই তালিকায় যোগ | `BTN-A06D-STANDBY` | Visible only when a session is full → `POST /standby` (`FR-PAT-25`) |
| রোগীদের মতামত | `SEC-A06D-FEEDBACK` | Aggregate ratings, shown only above the volume threshold (`FR-PAT-83`) |

---

## A4. Booking

### `S-A-07b` Session picker

| Element | ID | Wiring |
|---|---|---|
| Date strip | `SEG-A07B-DATE` | Next 7 days; disabled days are greyed with a reason |
| Session card | `CARD-A07B-<sessionId>` | Shows planned window, serials taken/total, expected wait; select highlights |
| এগিয়ে যান | `BTN-A07B-NEXT` | → `S-A-07c` Confirm |

### `S-A-07c` Confirm booking

| Element | ID | Wiring |
|---|---|---|
| Profile selector | `BTN-A07C-PROFILE` | Logged in: opens `S-A-06`, defaults to active profile (`FR-PAT-03`). No account: opens `MOD-A07-GUEST` guest details sheet (`FR-GST-02`) |
| Reason field (optional) | `INP-A07C-REASON` | Free text, feeds the doctor's pre-visit summary (`FR-DOC-03`) |
| Pre-visit questions | `BTN-A07C-INTAKE` | Opens `MOD-A07-INTAKE`: 4–6 progressive questions (duration, main symptom, chronic conditions, current medicines, allergies) |
| Fee breakdown | — | Consultation + platform fee + total + due at hospital (`FR-PAT-21`) |
| Payment method | `SEG-A07C-PAY` | bKash / Nagad / card / হাসপাতালে দেব |
| নিশ্চিত করুন | `BTN-A07C-CONFIRM` | → `POST /bookings` (idempotency key) → payment sheet if prepaid → on success `S-A-07d` |

**Wiring detail for `BTN-A07C-CONFIRM`**
1. Optimistic: button shows inline spinner, screen locks (this is the one place a blocking wait is acceptable, because money).
2. Call: create booking → returns serial number + session.
3. Server effect: `EVT-BOOKING_CREATED`, SMS + push queued (`FR-NOT-03`).
4. Broadcast: session channel gains a subscriber; reception console queue list updates live.
5. Result: `S-A-07d` success screen.
6. Failure: payment failed → stay on screen, error banner, booking not created; slot taken meanwhile → offer next available serial or standby.

### `S-A-07d` Booking success

| Element | ID | Wiring |
|---|---|---|
| Serial number (large) | — | Plus doctor, hospital, date, expected window |
| লাইভ সিরিয়াল দেখুন | `BTN-A07D-LIVE` | → `S-A-08` |
| ক্যালেন্ডারে যোগ | `BTN-A07D-CAL` | Device calendar event |
| শেয়ার করুন | `BTN-A07D-SHARE` | Share sheet with a text summary (families coordinate over WhatsApp/Messenger) |
| হোমে ফিরুন | `BTN-A07D-HOME` | → `S-A-02` |

---

## A5. Live serial — the core screen

### `S-A-08` Live serial (`FR-PAT-30`–`37`)

**Subscriptions on mount:** session channel (`session:<id>`), plus a heartbeat every 30 s to detect a dead socket.

| Element | ID | Content / wiring |
|---|---|---|
| Doctor status line | — | ডাক্তার এসেছেন ৫:১২ / এখনো আসেননি / ৩০ মিনিট দেরি |
| Your number (huge) | — | Your serial |
| Now serving | — | Current called number, animates on change |
| Progress bar | — | Position within session |
| ETA block | — | আনুমানিক সময় + confidence band (`FR-QUE-13`) |
| Countdown | — | আর বাকি ~40 মিনিট, recalculated locally each minute, corrected by server events |
| Leave-home banner | `BANNER-A08-LEAVE` | Appears when travel + buffer ≥ remaining wait (`FR-PAT-32`) |
| Queue preview list | `LIST-A08-QUEUE` | Serving, next few, your row highlighted, late rows marked |
| আমি দেরি করছি | `BTN-A08-LATE` | → `MOD-A08-LATE` |
| সিরিয়াল বদলান | `BTN-A08-RESCHEDULE` | → `S-A-07b` in reschedule mode |
| বাতিল করুন | `BTN-A08-CANCEL` | → `MOD-A08-CANCEL` confirm with refund rule stated (`GR-01`, `FR-PAY-03`) |
| Freshness line | — | সর্বশেষ হালনাগাদ X মিনিট আগে (`GR-05`) |

**`MOD-A08-LATE` wiring**
1. Sheet asks: কত দেরি হবে? (10 / 20 / 30 / 45 মিনিট).
2. Optimistic: user's row moves to "late" styling instantly.
3. Call: `POST /queue/late` → server writes `EVT-PATIENT_LATE`.
4. Server effect: re-insertion after *k* patients (`FR-QUE-21`), ETAs recomputed.
5. Broadcast: session channel → reception console shows the patient as late; all other patients' ETAs shift.
6. Result: sheet closes, banner "আপনাকে ৩ জন পরে ডাকা হবে · আনুমানিক ৬:৩০".
7. Failure/offline: request is queued; banner says "জানানো হচ্ছে…" and retries; if the session ends before it lands, the app tells the user to inform the counter.

**Delay broadcast received (`EVT-DELAY_DECLARED`)**
- In-app: full-width sheet appears: "ডাক্তার ৩০ মিনিট দেরিতে আসবেন" with `BTN-A08-KEEP` (keep serial), `BTN-A08-RESCHEDULE`, `BTN-A08-CANCEL` (`FR-PAT-34`).
- Backgrounded app: push notification; tapping opens this sheet.
- No app: SMS with the same three options explained as reply keywords or a link.

**Called notification (`EVT-PATIENT_CALLED` for your serial)**
- Push + in-app takeover: "আপনার ডাক এসেছে — ৩ নম্বর কক্ষে যান", with a stop-vibration acknowledge button.

### `S-A-09` My serials (tab)

| Element | ID | Wiring |
|---|---|---|
| Today section | — | Active bookings, each → `S-A-08` |
| Upcoming section | — | Future bookings with reschedule/cancel |
| Past section | — | Completed visits → `S-A-12` record detail; each offers মতামত দিন (`FR-PAT-83`) |

---

## A6. Emergency

### `S-A-10` Emergency triage (no auth, `FR-PAT-40`)

| Element | ID | Wiring |
|---|---|---|
| ৯৯৯ এ কল করুন | `BTN-A10-999` | `tel:999` immediately; always visible at top |
| Critical warning text | — | Names the conditions that mean "call first" |
| Problem chips | `CHIP-A10-<type>` | দগ্ধ / দুর্ঘটনা / হৃদরোগ / স্ট্রোক / শ্বাসকষ্ট / শিশু / প্রসূতি / অন্যান্য. Selecting one → loads `S-A-10b` results filtered by required capability |
| অ্যাম্বুলেন্স | `BTN-A10-AMB` | → `S-A-16` with urgency pre-set |

### `S-A-10b` Emergency results (`FR-PAT-43`–`46`)

Ranking: capability match → travel time → ER load → free beds. Stale facilities are de-ranked and labelled (`FR-PAT-45`).

| Element | ID | Wiring |
|---|---|---|
| Result card | `CARD-A10-<hospitalId>` | Shows capability chip (আছে / নেই), distance, travel time, ER wait, free beds, ICU, freshness |
| আমি রওনা দিচ্ছি | `BTN-A10-ONWAY-<id>` | → `POST /emergency/inbound` → emergency console alert (`FR-EMG-01`) → confirmation screen `S-A-10c` |
| দিকনির্দেশ | `BTN-A10-NAV-<id>` | Opens map navigation |
| কল করুন | `BTN-A10-CALL-<id>` | Dials ER desk directly |
| Stale badge | — | "তথ্য ১৮ মিনিট পুরোনো" in amber when beyond threshold |

**`BTN-A10-ONWAY` wiring**
1. Optimistic: card turns to "জানানো হয়েছে" instantly.
2. Call: inbound alert with problem type, ETA estimate, and caller number (optional profile data if logged in).
3. Broadcast: ER console `hospital:<id>:emergency` channel rings an alert.
4. Result: `S-A-10c` showing directions, the hospital's ER phone, and a live "hospital acknowledged" state when the coordinator taps প্রস্তুতি নিন.
5. Failure/offline: still navigates; banner says the hospital could not be notified, advises calling.

### `S-A-10c` On the way

| Element | ID | Wiring |
|---|---|---|
| Acknowledge state | — | অপেক্ষায় → হাসপাতাল প্রস্তুত (live via channel) |
| নেভিগেশন খুলুন | `BTN-A10C-NAV` | Map app |
| ER কল | `BTN-A10C-CALL` | Dials |
| বাতিল | `BTN-A10C-CANCEL` | Notifies ER that the patient is not coming |

---

## A7. Beds, wallet, and the rest

### `S-A-11` Bed search (`FR-PAT-50`–`53`)

| Element | ID | Wiring |
|---|---|---|
| Bed type chips | `CHIP-A11-<type>` | সাধারণ / কেবিন / এইচডিইউ / আইসিইউ / সিসিইউ / এনআইসিইউ / বার্ন |
| Hospital result row | `CARD-A11-<id>` | Free count, nightly price, freshness |
| বেড অনুরোধ করুন | `BTN-A11-REQUEST-<id>` | → `MOD-A11-REQUEST` (patient profile, expected arrival, condition note) → `POST /bed-requests` → ward console pending list (`FR-BED-07`) |
| Request status | — | অনুরোধ পাঠানো → গৃহীত (hold expiry countdown) → নিশ্চিত / বাতিল |

### `S-A-12` Health wallet (`FR-PAT-60`–`65`)

| Element | ID | Wiring |
|---|---|---|
| Tab: টাইমলাইন | `TAB-A12-TL` | Visits, prescriptions, reports, chronologically |
| Tab: রিপোর্ট | `TAB-A12-REP` | Lab and imaging only |
| Tab: ওষুধ | `TAB-A12-RX` | Active prescriptions with reminder toggles (`FR-PAT-72`) |
| Record row | `CARD-A12-<recordId>` | → record detail with PDF viewer and share |
| পুরোনো কাগজ যোগ করুন | `BTN-A12-UPLOAD` | Camera/gallery → tag date, doctor, type → stored (`FR-PAT-62`) |
| QR দেখান | `BTN-A12-QR` | Full-screen QR for the doctor console to scan (`FR-PAT-63`); shows consent scope and expiry |
| কে দেখেছে | `BTN-A12-ACCESS` | Access log: hospital, person, timestamp (`FR-SEC-03`, `FR-PAT-64`) |
| সব ডাউনলোড | `BTN-A12-EXPORT` | Generates a single PDF |

### `S-A-13` Diagnostics booking
Catalogue → select tests → centre comparison (price, distance, turnaround) → home collection toggle → slot → pay → confirmation. Report lands in wallet with a push (`FR-PAT-61`).

### `S-A-14` Pharmacy
Prescription QR → nearby partner pharmacies with stock status → reserve or request delivery → dispensing recorded (`FR-PHR-01`).

### `S-A-15` Telemedicine
Same session/queue mechanics; live serial screen switches its primary action to "কলে যোগ দিন", enabled when called (`FR-PAT-73`).

### `S-A-16` Ambulance (`FR-PAT-74`)
Type selector (basic / ICU / freezer) → pickup location (auto or pin) → destination (optional) → **fare quote shown before dispatch** → নিশ্চিত করুন → driver identity + live ETA → completion. The quoted fare is locked; any change attempt is a violation flagged to support.

### `S-A-17` Blood (`FR-PAT-75`)
Request: group, units, hospital, urgency, patient name → broadcast to eligible donors nearby → responses list with contact → mark fulfilled. Donor side: availability toggle, last donation date, eligibility countdown.

### `S-A-18` Notifications centre
All notifications grouped by day; tapping routes to the relevant screen; per-category preferences link to settings.

### `S-A-19` Profile & settings

| Element | ID | Wiring |
|---|---|---|
| Profiles | `BTN-A19-PROFILES` | Add, edit, remove, set relationship, claim by phone (`FR-PAT-04`) |
| Language | `SEG-A19-LANG` | bn / en, applies to app and SMS (`FR-NOT-04`) |
| Notifications | `BTN-A19-NOTIF` | Per-category toggles; queue and emergency categories cannot be disabled while a booking is active |
| Payment methods | `BTN-A19-PAY` | Saved methods |
| Consents | `BTN-A19-CONSENT` | Per-hospital record access, revoke (`FR-PAT-64`) |
| Help & support | `BTN-A19-HELP` | FAQ, WhatsApp support, call |
| হাসপাতাল কর্তৃপক্ষ? | `BTN-A19-FORHOSPITAL` | The **only** staff-facing link in the app; opens the marketing site's hospital page in the browser |
| লগ আউট | `BTN-A19-LOGOUT` | Confirm → clears token, keeps cached public data |

---

# PART B — HOSPITAL CONSOLE (web, desktop)

Accessed at `console.[domain]`. Designed for 1280px+ monitors, mouse and keyboard, high information density, and continuous use for eight hours.

## B0. Console authentication

### `S-B-00` Staff login

| Element | ID | Wiring |
|---|---|---|
| Hospital code / email | `INP-B00-ID` | Staff identity is email or staff-ID + hospital code |
| Password | `INP-B00-PW` | |
| লগ ইন | `BTN-B00-LOGIN` | → `POST /staff/login` → if 2FA enabled → `S-B-00b` OTP → else `S-B-01` |
| পাসওয়ার্ড ভুলে গেছেন | `BTN-B00-FORGOT` | Admin-mediated reset request |
| Language toggle | `SEG-B00-LANG` | Console defaults to Bangla |

**Rules:** no self-signup (`FR-SUP-01` — accounts are created by hospital admin or platform), individual accounts only (`FR-SEC-06`), session timeout configurable per hospital with a re-auth modal that never loses queued work.

### `S-B-01` Role & counter selection

Shown when a user holds multiple roles or the hospital has multiple counters.

| Element | ID | Wiring |
|---|---|---|
| Role cards | `BTN-B01-ROLE-<role>` | রিসেপশন / ডাক্তার / ওয়ার্ড / জরুরি / ল্যাব / ফার্মেসি / ব্যবস্থাপনা → routes to that console |
| Counter selector | `SEL-B01-COUNTER` | Binds this browser to a counter; used for billing reconciliation (`FR-REC-23`) |
| Remember on this computer | `CHK-B01-REMEMBER` | Skips this screen next time |

---

## B1. Reception console — `S-B-02`

The highest-traffic screen in the system. Every primary action must be reachable by keyboard.

### B1.1 Layout

- Left: navigation rail (সিরিয়াল, রেজিস্ট্রেশন, বেড, জরুরি, টেস্ট, বিল, ড্যাশবোর্ড) + offline/sync status block.
- Top: session bar (doctor, department, planned window, actual arrival) + primary actions.
- Centre: the queue table.
- Right: now-serving card, today's counters, waitlist recovery card, last broadcast log.

### B1.2 Session bar controls

| Control | ID | Keyboard | Wiring |
|---|---|---|---|
| Session selector | `SEL-B02-SESSION` | `Alt+S` | Switches the session this counter is driving; subscribes to that session channel |
| ডাক্তার এসেছেন | `BTN-B02-ARRIVED` | `A` | Optimistic: status flips instantly → `EVT-DOCTOR_ARRIVED` with actual time → ETAs recomputed → broadcast to all patients + push/SMS "ডাক্তার এসেছেন" (`FR-REC-02`) |
| দেরি ঘোষণা | `BTN-B02-DELAY` | `D` | Opens `MOD-B02-DELAY`: 15/30/45/60/custom + optional reason → `EVT-DELAY_DECLARED` → every waiting patient notified with keep/reschedule/cancel (`FR-REC-03`, `FR-PAT-34`) |
| বিরতি | `BTN-B02-PAUSE` | `P` | `EVT-SESSION_PAUSED`; ETAs freeze and shift; resume with the same button (`FR-REC-05`) |
| আজ বসবেন না | `BTN-B02-ABSENT` | — | Confirm (`GR-01`) → cancels session, notifies all, opens bulk reschedule tool (`FR-REC-04`), triggers refund eligibility (`FR-PAY-07`) |
| ওয়াক-ইন যোগ | `BTN-B02-WALKIN` | `W` | Opens `MOD-B02-WALKIN` (see B1.4) |
| **পরবর্তী রোগী ডাকুন** | `BTN-B02-NEXT` | `Space` or `N` | The single most-used control (see B1.3) |

### B1.3 `BTN-B02-NEXT` — full wiring

1. **Guard:** if a patient is currently in chamber and not marked done, the button label reads "এই রোগী শেষ ও পরবর্তী", performing both actions.
2. **Optimistic UI:** current row moves to *done*, next waiting row becomes *in chamber*, now-serving card updates, counters increment. Zero perceived latency (`NFR-02`).
3. **Local write:** `EVT-PATIENT_DONE` (with measured duration) + `EVT-PATIENT_CALLED` appended to the local log.
4. **Sync:** pushed to server immediately when online; queued when offline (`FR-QUE-50`).
5. **Server effect:** rolling consultation rate updated (`FR-QUE-12`), all downstream ETAs recomputed (`FR-QUE-11`).
6. **Broadcast:** `session:<id>` channel → every patient device updates within 2 s (`NFR-01`); the called patient additionally receives push + SMS.
7. **Result UI:** undo toast for 10 s (`GR-02`); pressing undo appends a compensating event (never deletes history).
8. **Failure:** sync failure keeps the optimistic state and shows the pending-sync counter; a rejected event (e.g. another counter already called that patient, `FR-QUE-53`) rolls the row back with an explanatory toast.

### B1.4 Queue table

Columns: serial, patient, age, phone, status, source (app / phone / walk-in), waited, actions.

| Row action | ID | Wiring |
|---|---|---|
| দেখা শেষ | `BTN-B02-DONE-<serial>` | `EVT-PATIENT_DONE`, duration captured |
| দেরি | `BTN-B02-LATE-<serial>` | `EVT-PATIENT_LATE` → re-insert after *k* (`FR-QUE-21`) → patient notified of new position |
| অনুপস্থিত | `BTN-B02-NOSHOW-<serial>` | Enabled only after grace period (`FR-QUE-20`); confirm → `EVT-PATIENT_NO_SHOW` → slot freed → waitlist card activates |
| ফিরিয়ে আনুন | `BTN-B02-REINSTATE-<serial>` | Visible on no-show rows → `EVT-PATIENT_REINSERTED` with actor logged (`FR-QUE-22`) |
| অগ্রাধিকার | `BTN-B02-PRIORITY-<serial>` | Drag or button → `MOD` requires a reason → `EVT-PRIORITY_REORDERED` (`FR-REC-15`) |
| রোগীর তথ্য | `BTN-B02-INFO-<serial>` | Side panel: profile, previous visits at this hospital, payment status |

**`MOD-B02-WALKIN`**: phone → if existing, profile auto-fills (duplicate detection by phone, `FR-REC-20`); else quick-create (name, age, sex). Position: শেষে যোগ (default) or নির্দিষ্ট অবস্থানে (reason required). Confirm → `EVT-WALKIN_ADDED` → token print (`FR-REC-21`).

### B1.5 Right column

| Element | ID | Wiring |
|---|---|---|
| Now-serving card | — | Serial, name, elapsed time in chamber, waiting count, current rate |
| Today counters | — | Seen / waiting / late / no-show / average wait, live |
| Waitlist recovery card | `BTN-B02-OFFER` | Appears when a slot frees → "৩ জনকে প্রস্তাব পাঠান" → `EVT-SLOT_OFFERED` → standby patients receive a timed offer; acceptance appears here (`FR-REC-30`) |
| Broadcast log | — | Last few notifications sent with channel counts ("১৮ জনকে জানানো হয়েছে — অ্যাপ ১১, এসএমএস ৭") |
| Offline block | — | Status + pending-event count + last sync time; clicking shows the pending list (`FR-OFF-01`) |

### B1.6 Registration & billing screens

`S-B-03` Registration: phone-first search → existing patient or create → optional NID → save → immediate booking option.
`S-B-04` Billing: collect fee, method, print/SMS receipt (`FR-REC-22`); shift reconciliation view with expected vs collected and a variance note field (`FR-REC-23`).

---

## B2. Doctor console — `S-B-05`

> **Built in this version:** the session header, `BTN-B05-DELAY`, the patient
> panel, `INP-B05-DX`, `INP-B05-ADVICE`, `SEL-B05-FOLLOWUP`, `BTN-B05-DRAFT` and
> `BTN-B05-SIGN`.
>
> **Not built:** `TBL-B05-RX`, `BTN-B05-ADDRX` and the printing half of
> `BTN-B05-SIGN` — prescribing is out of scope for this version (`PRD.md` §9).
> `BTN-B05-SCAN` is build step 13 and `BTN-B05-TEST` is step 17. Each is absent
> from the screen rather than shown disabled: a control that cannot work should
> not be on a screen a doctor is learning.
>
> `BTN-B05-NEXT` is absent too, and deliberately: `BTN-B05-SIGN` already
> finishes the patient and calls the next one, so a second control doing half of
> that would give a doctor two ways to end a consultation and one of them would
> lose the record.

| Element | ID | Wiring |
|---|---|---|
| Session header | — | Seen / waiting / average duration / running late indicator |
| দেরি জানান | `BTN-B05-DELAY` | Same effect as reception's delay, initiated by the doctor (`FR-DOC-02`) |
| পরবর্তী রোগী | `BTN-B05-NEXT` | Same event chain as `BTN-B02-NEXT`; serialised server-side against reception (`FR-QUE-53`) |
| Patient panel | — | Pre-visit intake, chronic conditions, allergies, last visits, previous prescriptions, recent results (`FR-DOC-03`) |
| QR scan | `BTN-B05-SCAN` | Opens camera to scan the patient's wallet QR; consent recorded, access logged (`FR-PAT-63`, `FR-SEC-03`) |
| Diagnosis field | `INP-B05-DX` | Autocomplete over ICD-ish common terms, free text allowed |
| Medicine rows | `TBL-B05-RX` | Name (autocomplete over formulary, `FR-DOC-05`), strength, schedule (1+0+1), duration, instruction |
| + ওষুধ | `BTN-B05-ADDRX` | Adds a row; keyboard-first entry |
| Test chips | `BTN-B05-TEST` | Adds test orders → pushed to lab queue on save (`FR-DOC-06`) |
| Advice box | `INP-B05-ADVICE` | Printed in Bangla for the patient (`FR-DOC-07`) |
| Follow-up | `SEL-B05-FOLLOWUP` | 7/14/30 days or date → schedules patient reminder (`FR-PAT-80`) |
| খসড়া রাখুন | `BTN-B05-DRAFT` | Saves without finishing the consultation |
| **রেকর্ড দিন ও পরবর্তী** | `BTN-B05-SIGN` | Signs the visit → writes the record to the patient wallet → `EVT-PATIENT_DONE` + `EVT-PATIENT_CALLED` for the next patient (`FR-DOC-08`). Printing is part of the prescribing scope this version does not have |

**Failure handling:** if the record fails to save, the consultation is **not** marked done, and the doctor sees a retry banner with the draft preserved on screen. The record is written first and the queue advances only on success, which is what makes that order observable rather than aspirational.

---

## B3. Ward / bed board — `S-B-06`

| Element | ID | Wiring |
|---|---|---|
| Floor/ward tabs | `TAB-B06-<ward>` | Filters the board |
| Bed tile | `BTN-B06-BED-<bedId>` | Opens the right-side bed panel |
| Bed panel: ভর্তি করুন | `BTN-B06-ADMIT` | Patient search or from pending list → admit → `EVT-BED_OCCUPIED` → public counters drop by one instantly (`FR-BED-02`) |
| Bed panel: ছাড়পত্র | `BTN-B06-DISCHARGE` | Confirm → bed enters *cleaning* state with a timer → then *free* |
| Bed panel: স্থানান্তর | `BTN-B06-TRANSFER` | Choose target bed → both tiles update |
| Bed panel: সংরক্ষিত রাখুন | `BTN-B06-RESERVE` | Hold with expiry; expiry auto-releases and logs |
| Bed panel: সেবার বাইরে | `BTN-B06-OOS` | Marks out of service with reason |
| Expected discharge | `SEL-B06-EXPDIS` | Sets date → feeds tomorrow's predicted availability (`FR-BED-04`) |
| "অ্যাপে দেখাচ্ছে" card | — | Mirrors the public numbers and their freshness, so staff see the consequence of not updating (`FR-BED-06`) |
| Pending admissions | `LIST-B06-PENDING` | From ER and from app bed requests; accept → admit flow; decline → notifies patient |

---

## B4. Emergency console — `S-B-07`

| Element | ID | Wiring |
|---|---|---|
| Inbound alert card | `CARD-B07-<caseId>` | Audible + visual alert on arrival (`FR-EMG-01`) |
| প্রস্তুতি নিন | `BTN-B07-PREPARE` | Acknowledges → patient's app shows "হাসপাতাল প্রস্তুত" |
| গ্রহণ করুন | `BTN-B07-ACCEPT` | Creates an ER case record |
| ফিরিয়ে দিন | `BTN-B07-DECLINE` | Requires reason → immediately opens refer-out search for that capability (`FR-EMG-02`) |
| Triage list | `TBL-B07-TRIAGE` | Token, patient, complaint, arrival, colour (red/yellow/green), actions |
| Colour set | `BTN-B07-TRIAGE-<c>` | Sets triage category; red rows pin to top |
| ভর্তি করুন | `BTN-B07-ADMIT` | Hands off to ward board with the case attached |
| Capability toggles | `SW-B07-<capability>` | Burn / cardiac / stroke / dialysis / NICU / trauma OT → publishes to the emergency network within seconds (`FR-EMG-05`) |
| ICU/bed counters | — | Read from the bed board, not typed twice |
| Blood stock | `INP-B07-BLOOD-<group>` | Availability level, not exact counts, if the hospital prefers (`FR-EMG-06`) |
| রেফার খুঁজুন | `BTN-B07-REFER` | Search other hospitals by required capability + free bed, ranked by travel time, each with freshness (`FR-EMG-07`) |
| রেফার পাঠান | `BTN-B07-REFER-SEND-<id>` | Sends patient summary → target console receives accept/decline → timeline recorded: sent → seen → accepted → arrived (`FR-EMG-08`) |
| Incoming referrals | `LIST-B07-IN` | Accept / decline with reason (`FR-EMG-09`) |

---

## B5. Lab & pharmacy consoles

**`S-B-08` Lab**: order queue → state buttons (`নমুনা নেওয়া হয়েছে` → `প্রসেসিং` → `রিপোর্ট প্রস্তুত`) → upload report file → auto-delivery to patient wallet and ordering doctor (`FR-LAB-02`, `FR-LAB-03`). Turnaround timer visible per order.

**`S-B-09` Pharmacy**: scan prescription QR → line items with stock status → dispense (full or partial) → record → out-of-stock flag feeds public medicine search (`FR-PHR-01`, `FR-PHR-02`).

---

## B6. Hospital admin — `S-B-10`

| Section | Controls | Wiring |
|---|---|---|
| Today | Date range selector, department filter | Live KPIs (`FR-ADM-01`) |
| Trends | Wait-time chart with adoption marker | `FR-ADM-02` |
| Loss & recovery | No-show taka value, recovered value | `FR-ADM-03` |
| Revenue | By doctor / department / service / method | `FR-ADM-04` |
| Staff | Doctor punctuality, consultation duration | `FR-ADM-05` |
| Beds | Utilisation, ALOS, turnover | `FR-ADM-06` |
| Referrals | Sent / received / accepted / leaked | `FR-ADM-07` |
| Feedback | Scores, complaint categories, response time | `FR-ADM-08` |
| Export | `BTN-B10-EXPORT` | CSV / PDF (`FR-ADM-10`) |

**`S-B-11` Hospital settings**: departments, doctors (with BMDC verification status), sessions and recurrence, fees, counters, beds and wards, capabilities, notification budget, no-show grace period, refund policy, staff users and roles (`FR-ADM-11`).

---

## B7. Platform super-admin — `S-B-12`

Hospital onboarding wizard (steps: facility → departments → doctors → sessions → beds → capabilities → counters → staff → go live), doctor verification queue, feature flags, subscriptions and invoices, review moderation, system health (sync lag, stale-data offenders, notification delivery) — `FR-SUP-01`–`06`.

## B8. Government viewer — `S-B-13`

Read-only national/district capacity map, ER load heat map, symptom spike signals, anonymised benchmarking. No drill-down to an identifiable patient exists in the UI or the API for this role (`FR-GOV-06`).

---

# PART C — MARKETING WEBSITE

### `S-C-01` Home
Hero: the live-rescue promise. Two primary CTAs:

| CTA | ID | Destination |
|---|---|---|
| রোগীদের জন্য অ্যাপ | `BTN-C01-PATIENT` | App install / `app.[domain]` |
| হাসপাতালের জন্য | `BTN-C01-HOSPITAL` | `S-C-02` |

### `S-C-02` For hospitals
Problem framing (waits, no-shows, referral leakage), the consoles with screenshots, and:

| Control | ID | Wiring |
|---|---|---|
| ডেমো দেখুন | `BTN-C02-DEMO` | Lead form → super-admin pipeline |
| কনসোলে লগ ইন | `BTN-C02-LOGIN` | `console.[domain]` → `S-B-00` |
| PDF ব্রোশিওর | `BTN-C02-PDF` | Download |

### `S-C-03` For doctors · `S-C-04` About · `S-C-05` Contact · `S-C-06` Privacy · `S-C-07` Terms.

There is no pricing page. Commercial terms are discussed with a hospital
directly, not published — the site's job is to get a decision-maker to
`BTN-C02-DEMO`.

---

# PART D — CROSS-CUTTING BEHAVIOUR

## D1. State matrix (applies to every screen, `GR-03`)

| State | Public app | Console |
|---|---|---|
| Loading | Skeletons matching final layout, never spinners over whole screens | Table skeletons; controls disabled but visible |
| Empty | Plain Bangla explanation + one action | Same, plus "কী করবেন" hint |
| Error | Inline banner + পুনরায় চেষ্টা করুন | Toast + retry; work never lost |
| Offline | Amber staleness banner, cached content, blocked actions explained | Amber rail block, all writes queued, pending count |
| Stale data | Freshness line turns amber past threshold | Same + de-ranking in emergency search |

## D2. Notification → screen routing

| Event | Push/SMS opens |
|---|---|
| Booking confirmed | `S-A-07d` |
| Doctor arrived / delay declared | `S-A-08` with the delay sheet |
| Two patients away | `S-A-08` |
| Called | `S-A-08` takeover |
| Slot offered | `S-A-08` offer sheet with accept/decline and countdown |
| Report ready | `S-A-12` record detail |
| Follow-up due | `S-A-07b` prefilled with the same doctor |
| Bed request accepted | `S-A-11` request status |
| Emergency acknowledged | `S-A-10c` |

## D3. Permission gates

| Action | Requires |
|---|---|
| Browse, emergency search, call, navigate, "I'm on my way" | nothing — not even a phone number |
| Book, pay, bed request, ambulance, blood, diagnostics | guest identity (name + phone + one OTP) **or** logged-in profile (`FR-GST-01`) |
| Track a guest booking live | the SMS tracking link, or the device that booked (`FR-GST-05`) |
| Multi-device wallet, saved profiles, full history | account |
| Any console screen | staff login + role + hospital scope |
| Record view by staff | patient is in the staff member's session, or QR consent given |
| National dashboard | R11 only, aggregated data only |

## D4. Keyboard shortcuts (console)

`Space`/`N` next patient · `A` doctor arrived · `D` declare delay · `W` walk-in · `L` mark late · `X` no-show · `F` focus search · `Ctrl+Z` undo last queue action · `Esc` close panel/modal.

## D5. Event → UI propagation summary

| Event | Reception | Doctor | Patient app | Ward/ER | Admin |
|---|---|---|---|---|---|
| `EVT-DOCTOR_ARRIVED` | status flips | header updates | status + ETA update, push/SMS | — | punctuality metric |
| `EVT-PATIENT_CALLED` | row moves | patient panel loads | takeover + push | — | counters |
| `EVT-DELAY_DECLARED` | banner | header | delay sheet + push/SMS | — | punctuality |
| `EVT-PATIENT_NO_SHOW` | row marked, waitlist card | — | patient notified | — | loss metric |
| `EVT-SLOT_ACCEPTED` | new row appears | — | booking confirmed | — | recovery metric |
| `EVT-BED_OCCUPIED` / `_FREED` | — | — | bed counts update | board tile | occupancy |
| `EVT-EMERGENCY_INBOUND` | — | — | "on the way" status | ER alert | ER volume |
| `EVT-REFERRAL_SENT/ACCEPTED` | — | — | — | both ER consoles | referral report |

---

*End of `APP_FLOW.md`. Next documents: `FRONTEND.md` (stack, routing, components, design tokens, offline shell) and `BACKEND.md` (schema, APIs, realtime channels, sync protocol, notification workers, deployment).*
