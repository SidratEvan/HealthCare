# MedLiveBD — showing the public demo

For whoever presents MedLiveBD to a hospital. About ten minutes end to end.
Everything in the demo is synthetic: six demonstration hospitals, each named
"(Demo)", forty doctors and two hundred made-up patients. No real person,
hospital or availability is shown (`FR-DEM-07`, `FR-SEC-08`).

## Before the meeting

1. **Wake the server (do this five minutes before).** Open
   <https://healthcare-api-m9ke.onrender.com/healthz>. The free plan sleeps
   after fifteen idle minutes and the first request takes about a minute.
   Wait for `"status":"ok"`.
2. **Fresh data, if the demo has been used.** On the owner's PC, run the
   scheduled task **HealthCare demo refresh** by hand (Task Scheduler →
   right-click → Run), or from a terminal in the repository, on a clean `mvp`
   checkout:
   ```bash
   ALLOW_REMOTE_DB=1 pnpm db:verify
   ALLOW_REMOTE_DB=1 ALLOW_DESTRUCTIVE_DB=1 DEMO_MODE=true pnpm db:reset
   ```
   A reset an hour before the meeting puts the cardiology chamber mid-queue
   at that moment. It only ever touches the demo database: the reset refuses a
   remote database without both flags, refuses without `DEMO_MODE=true`, and
   refuses outright under `NODE_ENV=production`.
3. Two screens side by side: a phone (or a narrow window) for the patient, a
   laptop for the hospital.

## The addresses

| What | Address |
|---|---|
| Patient app | <https://healthcare-patient-zeta.vercel.app> |
| Hospital consoles | <https://healthcare-console.vercel.app> |
| API health | <https://healthcare-api-m9ke.onrender.com/healthz> |

Both apps open in Bangla. **EN** at the top switches to English.

Staff accounts in the demo: none needed. The console opens on a picker
(choose a hospital, a chamber and a role) with no password, and says it is a
demonstration. A real installation has staff sign-in with a second factor
for administrators and no picker.

## The walk

**1. Search (patient).** In the patient app, type in the search box:
**কার্ডিওলজি** (cardiology), **আইসিইউ** (ICU) or **বার্ন** (burn). Each
hospital that can provide it is listed with its live figure and how old the
figure is. A figure that is old says so.

**2. Book a serial (patient).** Choose **Shapla General Hospital (Demo) →
Cardiology → Dr Ayesha Siddika**, today's chamber. Enter any name, a phone
from the demo block such as `01380000001` (no SMS is sent; never type a real
person's number) and an age, then confirm. Pay at the
hospital, or pick bKash/Nagad: a page titled **Simulated payment (demo)**
opens. No money moves; choose the outcome. You get serial 18 or so. Tap
**লাইভ সিরিয়াল দেখুন** (see the live serial).

**3. Open reception (hospital).** In the console: **Shapla General Hospital
(Demo)** → the cardiology chamber → **রিসেপশন** (Reception). Serial 6 is in
the chamber and serial 9 has said they are running late.

**4. Move the queue.** Tap **পরবর্তী রোগী ডাকুন** (call next). The patient's
screen changes within two seconds: who is being seen now, the progress, the
estimate. This is the product. Also try late, absent and bring-back on a row.
On the patient screen, **আমি দেরি করছি** (I'm running late) reaches the
console.

**5. The doctor.** A second console tab: the same hospital and chamber, role
**ডাক্তার** (Doctor). The patient in the chamber, with their past visits.
Write a diagnosis and medicines, sign, print the prescription. The record
reaches the patient's records.

**6. Beds.** Console rail → **বেড** (Beds), or on the picker **বেড বোর্ড
খুলুন**. Wards with beds free, occupied, cleaning and reserved. Admit to or
free a bed, and the public bed count in the patient app follows.

**7. Emergency.** Patient app → the emergency card → burn. Hospitals with a
burn unit come first, ranked by capability and freshness. Tap **I'm on my
way**. Console: **জরুরি বিভাগ খুলুন** (the emergency console) at that
hospital shows the patient arriving.

**8. Lab and pharmacy.** Console rail → **টেস্ট** (Tests): test orders, and a
report delivered to the patient. **ফার্মেসি** (Pharmacy): stock and what is
available.

**9. Records.** Patient app → sign in with demo patient `01310000001`. On the
demo the verification code is shown on screen (a real installation sends it
by SMS). Records, reports and prescriptions, and the consent a doctor needs to
see them.

**10. The hospital's own view.** Console picker → **Padma Specialised
Hospital (Demo)** → **ব্যবস্থাপনা** (Administration) → **ড্যাশবোর্ড খুলুন**.
Padma's logo and colours on the console, the hospital now, no-show losses and
recovery. Settings: departments, doctors, schedules, fees, wards, modules,
reception desks, and **পুরোনো তথ্য আমদানি করুন** (import an existing export:
use `database/seeds/samples/hospital-export-patients.csv`).

**11. Many hospitals, one platform.** Patient app at
<https://healthcare-patient-zeta.vercel.app/?scope=PADMA> is Padma's own
app: its name, its colours, its doctors only. `?scope=` with nothing after it
returns to the MedLiveBD network. On the console picker, **প্ল্যাটফর্ম
পরিচালনা → হাসপাতাল অনবোর্ডিং খুলুন** shows every hospital's workspace and how
a new one is created, reviewed and taken live.

## What to say about what is simulated

- **Payments** are simulated: the provider page says so, and no money moves.
  Real bKash and Nagad wait for merchant accounts.
- **SMS** is recorded, not sent. A real SMS aggregator waits for an account
  and a registered sender ID.
- **Everything else is the real software** a hospital would run, on synthetic
  data.

## If something goes wrong

| What you see | Do this |
|---|---|
| "Cannot reach the server" | The API is waking up. Wait a minute and reload. |
| No chamber running today on the picker | Reset the data (Before the meeting, step 2). |
| The patient screen does not move | Reload it once. If still stuck, check `/healthz`. |

`docs/DEPLOY.md` is the technical runbook; `docs/STATUS.md`, *Running the
pitch demo*, is the same walk on a laptop with no internet.
