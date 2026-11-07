# MedLiveBD — start here

For MARKS Group: the people who will set up the server, and the people who
will run the pilot. Plain words first; the technical detail behind each step
is in `docs/DEPLOY.md` Part S.

---

## 1. What the pilot does

- **Reception** registers patients at the counter, gives each a serial for a
  doctor's chamber, and moves the queue: *call next*, *late*, *no-show*,
  *bring back*. It keeps working if the internet drops, and catches up when
  it returns.
- **Every screen showing that chamber updates within two seconds** of a tap:
  the other counters and the doctor's screen. (Once SMS is switched on,
  patients also get a link and follow their place in the queue on their own
  phone.)
- **Doctors** see their queue, write the visit (complaint, diagnosis,
  prescription) and call the next patient from their own screen.
- **Administration** sets up departments, doctors, schedules, counters and
  staff accounts, and sees the day's figures and reports.
- **Beds and emergency** boards are included, and can be switched on or off
  per hospital.

**Not in the first pilot, on purpose:**

| What | Why | What happens instead |
|---|---|---|
| SMS to patients | Needs an SMS company account and an approved sender name | Patients are served at the counter; the serial is said there and shown on the queue screens |
| Online payment (bKash, Nagad, cards) | Needs merchant accounts | Fees are taken at the counter as today |
| Laboratory orders | Real prices are needed first; until then they would be wrong | The laboratory starts **switched off**. Send MedLiveBD your test price list and it is switched on |
| A printed token slip | Not built yet | The serial is said at the counter and shown on the queue |

## 2. One decision MARKS confirms in writing

**Any doctor at MARKS can open any MARKS patient's record.** That is how most
hospital systems work, and **every time a record is opened it is logged**:
who, which patient, when. No other hospital can see MARKS's patients. Please
confirm in the pilot agreement that this is acceptable; if it is not, the
doctor's screen is switched off and doctors keep working on paper.

## 3. What to have ready before setup

1. **A server**, in Bangladesh, in MARKS's control or a Bangladeshi data
   centre:
   - Ubuntu 24.04 (or 22.04), 4 processor cores, 8 GB memory, 200 GB disk
     (8 cores, 16 GB and 500 GB is comfortable);
   - a fixed public internet address, with ports 80 and 443 open;
   - **disk encryption** switched on when Ubuntu is installed.
2. **A web address**, for example `medlive.marksgroup.com.bd`, and whoever
   manages MARKS's domain pointing three names at the server's address:
   `app.` (patients), `console.` (staff) and `api.` (the system itself) in
   front of it. Example: `console.medlive.marksgroup.com.bd`.
3. **A second disk for backups**: an external drive or a share from another
   machine, mounted on the server (for example at `/mnt/backup`). Every night
   a full copy is made, checked by actually restoring it, **encrypted**, and
   put there.
4. **Two people's names and emails**: the MedLiveBD platform administrator
   (approves the hospital going live) and MARKS's hospital administrator
   (sets up doctors and staff). Each needs a smartphone with an authenticator
   app (Google Authenticator or Microsoft Authenticator), because
   administrators sign in with a password **and** a code from the phone.
5. *Optional but strongly advised:* a **Telegram group** for alerts. The
   server posts there if a backup fails, if it stops answering, and when it
   is fine again, plus one "all well" message every morning (`DEPLOY.md`
   S5a explains the two-minute setup).

## 4. Setting up the server — one command

Copy the MedLiveBD folder to the server, open a terminal in it, and run:

```bash
sudo bash deploy/setup.sh
```

It asks, in plain words, for the web address, the backup folder, the alert
link and the two administrators, and then does everything else:

- installs Docker (the system that runs MedLiveBD's parts) if it is missing;
- **makes every password and secret itself** and writes them to
  `deploy/.env`;
- opens the firewall for the web and remote login only;
- builds and starts everything (10–20 minutes the first time) and waits until
  it answers;
- creates the two administrators and **prints their temporary passwords once**;
- switches the laboratory off (section 1).

**Straight after it finishes:**

1. Write down the two temporary passwords and hand them to their owners.
2. **Copy `deploy/.env` off the server** to two safe places (a USB stick in
   the safe, a password manager two people can open). It holds the key that
   opens the encrypted backups. **If the server dies and this file is lost,
   the backups cannot be opened by anybody.**

Running the command again is safe: it never overwrites `deploy/.env` and
never creates the administrators twice. It is also how everything is started
again on a rebuilt machine with the same `deploy/.env`.

## 5. The first day

1. **The hospital administrator** opens `https://console.<your address>`,
   signs in with the temporary password, chooses their own password, and
   scans the QR code with the authenticator app. They write down the ten
   recovery codes it shows (each lets them in once if the phone is lost).
2. **Settings** (সেটিংস): departments, doctors (with BMDC numbers), weekly
   schedules and fees, reception counters (desks), and staff accounts for
   each receptionist and doctor. Each person gets their own account; nobody
   shares one. Chambers then appear for the next seven days by themselves.
3. *Optional:* **import** existing patients and appointments from MARKS's
   current system as a CSV or Excel file (পুরোনো তথ্য আমদানি করুন). The
   screen shows exactly what will be written before anything is, and an
   import can be undone.
4. **Ask for review** (পর্যালোচনার অনুরোধ করুন). The MedLiveBD platform
   administrator checks the setup, verifies each doctor's BMDC number, and
   approves. Until then nothing of MARKS is visible to the public.
5. **Rehearse at one counter for an hour** before real patients: register a
   few test people, call them in, mark one late and one no-show, unplug the
   network cable for five minutes and keep working, plug it back in, and
   check that the doctor's screen and the other counters follow along.

## 6. Every day

- Counters and doctors sign in with their own accounts and work as above.
- **If the Telegram alert is set up, there is nothing to check.** A message
  comes only when something needs a person, and once every morning to say
  all is well; **a morning without that message means the server is off**.
- Without alerts, somebody opens `https://api.<your address>/readyz` each
  morning: `"attention":[]` means all is well.

## 7. If something goes wrong

| What you see | What to do |
|---|---|
| A message "Last night's backup failed" | Check the backup disk is plugged in and mounted; the next night tries again. Tell MedLiveBD if it repeats |
| "The API is not answering" | `sudo docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d`; if it stays, send MedLiveBD the output of `… logs --tail 200 api` |
| A counter loses internet | Keep working; it says it is offline, and sends everything when the connection returns. Only new walk-in serials need the connection |
| An administrator lost their phone | Use a recovery code, or another administrator resets it from Settings → the person → reset two-step verification |
| The server's disk died | A new server, the same `deploy/.env`, the backup disk, and `DEPLOY.md` S5 "putting one back". Practise this once before the pilot |

## 8. Updates

MedLiveBD sends a new version as one file. On the server it is loaded with
one command, `sh deploy/images.sh install …` (`DEPLOY.md` S4), and the
system is away for under a minute. A backup is taken first.

## 9. Patient data

- Everything stays on MARKS's server in Bangladesh. Nothing is sent abroad.
- MARKS's records are visible to MARKS's staff only, each to their role
  (reception, doctor, administration), and every opening of a record is
  logged.
- Backups are made nightly, checked by restoring them, encrypted, and kept
  14 days on two disks.
- Real patients go only on this server — **never on the public demonstration
  website**, which is for showing the product with invented data.
