// Part A, chapters A6–A15: the staff console, workspace by workspace.
const fig = (crumb, shot, title, intro, callouts, extra = {}) => ({ type: 'figure', crumb, shot, title, intro, callouts, ...extra });

const A6 = 'A6 · Getting into the console';
const A7 = 'A7 · Reception';
const A8 = 'A8 · Registration desk';
const A9 = 'A9 · Doctor';
const A10 = 'A10 · Wards and beds';
const A11 = 'A11 · Emergency';
const A12 = 'A12 · Laboratory and pharmacy';
const A13 = 'A13 · Hospital administration';
const A14 = 'A14 · Platform onboarding';
const A15 = 'A15 · National dashboard';

module.exports = [
  // ---------------------------------------------------------------- A6
  {
    type: 'chapter',
    num: 'A6',
    title: 'Getting into the console',
    lead: 'The staff console is one web address for every role. Each person signs in with their own account and lands on the workspace their role allows. Administrators also use a code from their phone.',
    html: `<div class="cards"><div class="card"><h3>One console, many workspaces</h3>Reception, registration, doctor, ward, emergency, lab, pharmacy, administration — a person with two roles switches between them from the left rail.</div><div class="card"><h3>Own accounts only</h3>Every action records who did it. A temporary password must be changed at first sign-in. Five wrong passwords lock the account for 15 minutes.</div><div class="card"><h3>The demonstration</h3>The public demonstration opens a picker with no password, so anyone can try every role. A real deployment always asks for a sign-in.</div></div>`,
  },
  fig(A6, 'c-picker', 'The demonstration picker', 'Only on the demonstration: choose a hospital and a role, no password. A real deployment shows the sign-in screen instead.', [
    { id: 'picker-login-link', label: 'Sign in with a staff account', text: 'the real way in, also available here.' },
    { id: 'picker-apply-link', label: 'Apply to add your hospital', text: 'a hospital can apply by itself.' },
    { prefix: 'pick-hospital-', label: 'Six demonstration hospitals', text: 'invented, labelled “(Demo)”.' },
    { prefix: 'open-ward-', label: 'Hospital-wide workspaces', text: 'bed board, emergency, lab, pharmacy, dashboard.' },
    { prefix: 'open-admin-', label: 'Open the dashboard', text: 'the administrator\'s view.' },
  ]),
  fig(A6, 'c-picker-chambers', 'The picker — today\'s chambers', 'Below, every chamber of the day. Each opens either the reception console or the doctor\'s screen for that chamber.', [
    { prefix: 'chamber-card-', label: 'A chamber', text: 'doctor, speciality, room, when it starts.' },
    { prefix: 'open-receptionist-', label: 'Reception', text: 'run this chamber\'s queue.' },
    { prefix: 'open-doctor-', label: 'Doctor', text: 'the doctor\'s screen for the same chamber.' },
  ]),
  fig(A6, 'c-login', 'Staff sign-in', 'Email and password, in Bangla and English together. Every label on the console carries both languages so a shared counter works for everyone.', [
    { id: 'login-email', label: 'Email' },
    { id: 'login-password', label: 'Password' },
    { id: 'login-show-password', label: 'Show', text: 'to check what was typed.' },
    { id: 'login-submit', label: 'Sign in' },
    { id: 'login-apply-link', label: 'Apply to add your hospital' },
    { id: 'login-demo-note', label: 'Demonstration only', text: 'the demo accounts\' shared password is printed here; a real deployment has no such line.' },
  ]),
  fig(A6, 'c-login-error', 'A wrong password', 'The answer is the same whether the email exists or not, so nobody can find out which emails have accounts. After five wrong tries the account rests for 15 minutes.', [
    { id: 'login-error', label: '“The email or password is wrong.”' },
  ]),
  fig(A6, 'c-2fa-setup', 'Administrators: setting up the phone code', 'The first time an administrator signs in, the console asks for an authenticator app (Google or Microsoft Authenticator). Anyone else may turn it on too.', [
    { id: 'tfa-qr', label: 'Scan this', text: 'with the authenticator app.' },
    { id: 'tfa-secret', label: 'Or type the key', text: 'if the camera cannot scan.' },
    { id: 'tfa-setup-code', label: 'The six-digit code', text: 'the app now shows; entering it switches two-step on.' },
  ]),
  fig(A6, 'c-2fa-recovery', 'Recovery codes — shown once', 'Ten one-time codes for a lost phone. The console will not continue until the person confirms they have kept them.', [
    { id: 'tfa-recovery-codes', label: 'Ten recovery codes', text: 'each signs in once.' },
    { id: 'tfa-recovery-kept', label: '“I have kept these”', text: 'must be ticked.' },
    { id: 'tfa-recovery-continue', label: 'Continue', text: 'to the console.' },
  ]),
  fig(A6, 'c-2fa-code', 'Every later sign-in: password, then code', 'After the password, the code from the phone. A recovery code works here too; another administrator can reset a lost phone, and that reset is recorded.', [
    { id: 'tfa-code', label: 'Code from the app' },
    { id: 'tfa-submit', label: 'Verify' },
    { id: 'tfa-start-again', label: 'Start again', text: 'back to the password.' },
  ]),
  fig(A6, 'c-change-password', 'First sign-in with a temporary password', 'An administrator creates an account and hands over a temporary password. Before any workspace opens, the new person chooses their own.', [
    { id: 'password-current', label: 'The temporary password' },
    { id: 'password-new', label: 'A new password', text: 'at least ten characters.' },
    { id: 'password-repeat', label: 'Repeat it' },
    { id: 'password-submit', label: 'Save the password' },
  ]),
  fig(A6, 'c-apply', 'A hospital applies by itself', 'Open to anyone: a hospital, clinic or diagnostic centre fills in its details and its first administrator. Nothing becomes visible to patients until the platform reviews and approves it.', [
    { id: 'apply-nothing-public', label: 'Nothing is public yet', text: 'stated before anything is typed.' },
    { id: 'apply-name-bn', label: 'Name in Bangla and English' },
    { id: 'apply-kind-hospital', label: 'Kind', text: 'private hospital, clinic, diagnostic centre, government hospital.' },
    { id: 'apply-division-Dhaka', label: 'Division and district' },
    { id: 'apply-registration', label: 'Registration or licence number' },
  ]),
  fig(A6, 'c-apply-done', 'The application is received', 'A workspace in “setting up” is made, with the administrator\'s account. The administrator signs in, sets up departments, doctors and schedules, then asks for review.', [
    { id: 'apply-done-code', label: 'The workspace\'s code', text: 'chosen from the name.' },
    { id: 'apply-done-email', label: 'The administrator\'s sign-in' },
    { id: 'apply-done-not-public', label: 'Still not public' },
    { id: 'apply-done-login', label: 'Sign in' },
  ]),

  // ---------------------------------------------------------------- A7
  {
    type: 'chapter',
    num: 'A7',
    title: 'Reception',
    lead: 'The counter that drives the live queue. Built for a receptionist handling 150 patients a day with a phone ringing: big buttons, keyboard shortcuts, nothing slower than a notebook, and it keeps working when the internet drops.',
    html: `<div class="cards"><div class="card"><h3>One button for the common case</h3>“Finish and call next” closes the patient with the doctor and calls the next in one tap (keyboard: N).</div><div class="card"><h3>Never drop a patient</h3>Late patients go back three places; a no-show can be brought back; walk-ins join in seconds; anything can be undone within 10 seconds.</div><div class="card"><h3>Offline</h3>Actions are drawn at once and sent when the connection returns, exactly once and in order. Only giving a new serial needs the network.</div></div>`,
  },
  fig(A7, 'c-reception', 'The reception console', 'One chamber\'s queue. The left rail moves between workspaces; the header shows the hospital, help, language and who is signed in.', [
    { id: 'rail-hospital', label: 'Hospital and workspaces', text: 'the left rail: queue, registration, beds, emergency, tests, pharmacy, dashboard.' },
    { id: 'chamber-title', label: 'The chamber', text: 'hours and state (started, paused, ended).' },
    { id: 'now-serving', label: 'Now serving', text: 'the serial with the doctor, and the name.' },
    { id: 'count-waiting', label: 'Waiting / here', text: 'booked, and how many are actually at the hospital.' },
    { id: 'add-walkin', label: 'Add walk-in', text: 'a patient without a booking (W).' },
    { id: 'call-next', label: 'Finish and call next', text: 'the button reception presses most (N).' },
    { id: 'count-seen', label: 'Seen · Late · No-show', text: 'today\'s counts.' },
    { id: 'pause-session', label: 'Pause', text: 'a break: nobody is called or marked absent (P).' },
    { id: 'chamber-more', label: 'More', text: 'undo and end chamber.' },
    { id: 'now-serving-card', label: 'With the doctor', text: 'Done finishes without calling the next.' },
  ]),
  fig(A7, 'c-reception-queue', 'The queue, row by row', 'Every serial in order with how it was booked and where it stands. Names are shown here because this is the hospital\'s own screen; patients\' phones never see them.', [
    { prefix: 'queue-row-', label: 'Seen', text: 'done and closed.' },
    { prefix: 'quoted-', label: '“told 50 min”', text: 'what this patient was told, so a promise is visible.' },
    { prefix: 'row-more-', label: 'More', text: 'print slip, late, no-show, bring back.' },
  ]),
  fig(A7, 'c-reception-row-menu', 'A patient\'s menu', 'The actions for one serial.', [
    { prefix: 'print-slip-', label: 'Print slip', text: 'a token slip with a QR code (next page).' },
    { match: /^Late/, tag: 'button', label: 'Late', text: 'puts them back three places, never drops them.' },
    { match: /^No-show/, tag: 'button', label: 'No-show', text: 'allowed only after the grace period; can be undone or reinstated.' },
    { prefix: 'check-in-', label: 'Check in' },
  ]),
  fig(A7, 'c-token-slip', 'The token slip', 'Printed on any 80 mm receipt printer or an office printer. In Bangla. The QR code opens the patient\'s live serial — view-only: it cannot cancel anything or open records.', [
    { id: 'token-slip-demo', label: 'Demonstration mark', text: 'only on the demo.' },
    { id: 'token-slip-serial', label: 'The serial', text: 'in Bangla digits.' },
    { id: 'token-slip-estimate', label: 'Estimated time', text: 'with its margin.' },
    { id: 'token-slip-qr', label: 'QR code', text: 'scan to follow the queue on any phone.' },
  ]),
  fig(A7, 'c-reception-walkin', 'Adding a walk-in', 'Someone at the counter without a booking. Type the number; if they have been before, the system finds them; give a serial in seconds.', [
    { id: 'walkin-sheet', label: 'Walk-in', text: 'mobile number first, then name, age and sex for someone new.' },
    { id: 'walkin-confirm', label: 'Give a serial' },
  ]),
  fig(A7, 'c-reception-check-in', 'Checking a patient in', 'When a patient arrives, reception records it and can tell them roughly how long they will wait.', [
    { id: 'check-in-minutes', label: 'Expected wait', text: 'from the queue\'s estimate; change it if you know better.' },
    { id: 'check-in-confirm', label: 'Confirm' },
  ]),
  fig(A7, 'c-reception-more', 'More — undo and end chamber', 'Undo takes back the last action within 10 seconds. End chamber closes the day\'s queue — and is greyed out while a patient is still with the doctor, with the reason written underneath.', [
    { id: 'chamber-more', label: 'More' },
    { match: /^Undo/, tag: 'button', label: 'Undo', text: 'within 10 seconds, by the person who acted.' },
    { id: 'end-chamber', label: 'End chamber', text: 'not possible while someone is in the chamber.' },
  ]),
  fig(A7, 'c-reception-paused', 'A paused chamber', 'During a break nobody can be called or marked absent, and the absence grace starts again on resume. Patients\' phones show the break.', [
    { id: 'paused-banner', label: '“The chamber is on a break.”' },
    { id: 'resume-primary', label: 'Resume', text: 'the main button changes to Resume.' },
    { id: 'end-chamber', label: 'End chamber', text: 'possible from here once nobody is in the chamber.' },
  ]),
  fig(A7, 'c-reception-offline', 'Working with no internet', 'The internet dropped. The receptionist pressed “next” anyway: the screen moved at once, the action waits to be sent, and the screen says so.', [
    { id: 'mark-waiting-sync', label: '“Waiting to sync”', text: 'actions kept on this computer, to be sent.' },
    { id: 'mark-needs-connection', label: 'What needs the network', text: 'only a new serial; everything else works.' },
    { id: 'mark-called-toast', label: '“Called serial … — Undo”', text: 'the action happened on screen and can still be undone.' },
  ]),
  fig(A7, 'c-reception-standby', 'The standby list at the counter', 'When a serial frees, reception offers it to the first person on standby. Patients who already paid are seated at once.', [
    { id: 'standby-card', label: 'Standby list', text: 'how many are waiting.' },
    { id: 'standby-prepaid-count', label: '“1 paid already”', text: 'offering seats them immediately.' },
    { id: 'offline-block', label: 'Online · Last synced', text: 'the connection state, always visible.' },
  ]),
  fig(A7, 'c-reception-help', 'Help, in place', 'Every workspace has help that explains its buttons without leaving the screen.', [
    { match: /^\? Help|^Help/, tag: 'button', label: 'Help' },
  ]),
  fig(A7, 'c-reception-bn', 'Reception in Bangla', 'The default. Buttons carry both languages so a mixed team shares one counter.', [
    { id: 'call-next', label: 'এই রোগী শেষ ও পরবর্তী', text: 'Finish and call next.' },
    { id: 'language-switch', label: 'বাংলা / English' },
  ]),

  // ---------------------------------------------------------------- A8
  {
    type: 'chapter',
    num: 'A8',
    title: 'Registration desk',
    lead: 'For hospitals that register patients at a separate desk: find or register the patient by mobile number, choose any open chamber, give the serial and print the slip.',
  },
  fig(A8, 'c-registration', 'Start with the mobile number', 'Three steps on one screen: the patient, the doctor or chamber, and the serial.', [
    { id: 'finder-phone', label: '1 · Mobile number', text: 'the patient\'s, as they say it.' },
    { id: 'finder-search', label: 'Find' },
    { prefix: 'registration-chamber-', label: '3 · Doctor / chamber', text: 'every open chamber with its fee and how many are waiting.' },
    { id: 'registration-submit', label: 'Give serial', text: 'only the server issues a serial, so two desks never give the same one.' },
  ]),
  fig(A8, 'c-registration-found', 'A number that has been here before', 'Everyone booked under that number is listed (a family often shares one phone). Each look-up is recorded.', [
    { id: 'finder-phone', label: 'The number' },
    { prefix: 'finder-choose-', label: 'A person under this number', text: 'name, age, sex.' },
  ]),
  fig(A8, 'c-registration-new', 'A new patient', 'Nobody under this number: register them with name, age and sex.', [
    { id: 'finder-none', label: '“Nobody under this number”' },
    { id: 'finder-name', label: 'Name' },
    { id: 'finder-age', label: 'Age' },
    { id: 'finder-register', label: 'Register' },
  ]),
  fig(A8, 'c-registration-ready', 'Patient and chamber chosen', 'A summary before the serial is given.', [
    { id: 'registration-chosen', label: '2 · The patient', text: 'name, age, sex and number.' },
    { id: 'registration-summary', label: 'Summary', text: 'patient → doctor.' },
    { id: 'registration-submit', label: 'Give serial' },
  ]),
  fig(A8, 'c-registration-confirmed', 'Serial confirmed', 'The serial is confirmed by the server. Print the slip or register the next patient.', [
    { id: 'registration-serial', label: 'The serial' },
    { id: 'registration-print-slip', label: 'Print slip' },
    { id: 'registration-next-patient', label: 'Next patient' },
  ]),
  fig(A8, 'c-registration-slip', 'The slip for a counter patient', 'With no SMS, the slip\'s QR code is how a counter patient follows the queue on their own phone.', [
    { id: 'token-slip-serial', label: 'Serial' },
    { id: 'token-slip-qr', label: 'QR code to the live serial' },
  ]),

  // ---------------------------------------------------------------- A9
  {
    type: 'chapter',
    num: 'A9',
    title: 'Doctor',
    lead: 'Built for a doctor who sees a patient every five to eight minutes and will not type long notes. The patient\'s history is already open; the visit is written in a few fields; one button files it and calls the next patient.',
  },
  fig(A9, 'c-doctor', 'The doctor\'s screen', 'Left: what the patient told us and earlier visits at this hospital. Right: today\'s visit.', [
    { id: 'doctor-patient-identity', label: 'The patient in the chamber', text: 'serial, name, age, sex, blood group.' },
    { id: 'doctor-save-status', label: 'Save status', text: 'whether the draft is safely on the server.' },
    { id: 'intake-allergies', label: 'What the patient told us', text: 'allergies, long-term conditions, medicines.' },
    { id: 'past-visits-here-only', label: 'Earlier visits here', text: 'records from other hospitals only with the patient\'s code.' },
    { id: 'visit-diagnosis', label: 'Diagnosis' },
    { id: 'rx-add', label: '+ Medicine' },
    { id: 'visit-tests', label: 'Order tests', text: 'goes straight to the lab.' },
    { id: 'save-draft', label: 'Save draft' },
    { id: 'sign-and-next', label: 'Sign & Next', text: 'files the record and calls the next patient.' },
  ]),
  fig(A9, 'c-doctor-medicine', 'Writing a prescription', 'Typing a few letters offers medicines from the formulary; each row takes strength, schedule (morning+midday+night), days and an instruction.', [
    { id: 'rx-name-0', label: 'Medicine', text: 'brand or generic, from the list.' },
    { id: 'rx-strength-0', label: 'Strength' },
    { id: 'rx-schedule-0', label: 'Schedule', text: '1+0+1 means morning and night.' },
    { id: 'rx-days-0', label: 'Days' },
    { id: 'rx-instruction-0', label: 'Instruction', text: 'before/after food, in Bangla.' },
    { id: 'rx-remove-0', label: 'Remove' },
  ]),
  fig(A9, 'c-doctor-written', 'The visit, written', 'Advice and the follow-up in a tap. A public-health signal (dengue, diarrhoeal, fever) can be marked for the national counts — never the patient\'s identity.', [
    { id: 'visit-tests', label: 'Tests ordered' },
    { id: 'visit-advice', label: 'Advice', text: 'printed on the patient\'s sheet.' },
    { id: 'follow-up-14', label: 'Follow-up', text: 'not needed, 7, 14, 30 days or a date.' },
    { id: 'save-draft', label: 'Save draft' },
  ]),
  fig(A9, 'c-doctor-sign', 'Sign — a last look before filing', 'A summary of what will be filed, with the patient\'s name, so a record is never filed under the wrong person.', [
    { id: 'doctor-sign-summary', label: 'This patient\'s record', text: 'serial, name, diagnosis, medicines, tests, follow-up.' },
    { id: 'doctor-confirm-sign', label: 'Yes, file this record', text: 'final: a signed record cannot be rewritten.' },
  ]),
  fig(A9, 'c-doctor-next-patient', 'The next patient, already open', 'After signing, the queue moves on and the next patient\'s history is on screen. The record is in the patient\'s wallet; the tests are on the lab\'s screen.', [
    { id: 'doctor-patient-identity', label: 'Next patient' },
    { id: 'past-visits', label: 'Their history here' },
    { id: 'consent-scan', label: 'Records from elsewhere', text: 'enter the code the patient shows.' },
  ]),
  fig(A9, 'c-doctor-delay', 'Declaring a delay', 'Running late? One tap tells every waiting patient\'s phone, with the new estimate.', [{ id: 'doctor-confirm-delay', label: 'Declare delay', text: 'minutes and an optional reason.' }]),
  fig(A9, 'c-doctor-bn', 'The doctor\'s screen in Bangla', 'Dates, times and digits in Bangla; the prescription prints in Bangla.', [
    { id: 'doctor-patient-identity', label: 'সিরিয়াল, নাম, বয়স' },
    { id: 'sign-and-next', label: 'রেকর্ড দিন ও পরবর্তী' },
  ]),

  // ---------------------------------------------------------------- A10
  {
    type: 'chapter',
    num: 'A10',
    title: 'Wards and beds',
    lead: 'The live bed board. Every change a ward makes — admit, discharge, cleaning, out of service — updates the hospital\'s public bed count with its time, so families searching for a bed see the truth.',
  },
  fig(A10, 'c-ward', 'The bed board', 'Every bed by ward, coloured by state. The counts at the top filter the board.', [
    { id: 'ward-filter-free', label: 'Free', text: 'and occupied, reserved, being cleaned, out of service.' },
    { prefix: 'bed-tile-', label: 'A bed', text: 'label and state; occupied beds show for how long.' },
    { id: 'offline-block', label: 'Online · Last synced', text: 'the board keeps working offline too.' },
  ]),
  fig(A10, 'c-ward-filter-free', 'Only the free beds', 'One tap on a count shows only those beds.', [{ id: 'ward-filter-free', label: 'Free (selected)' }]),
  fig(A10, 'c-ward-free-bed', 'A free bed', 'Tap a bed for its panel and its actions.', [
    { id: 'bed-panel', label: 'The bed', text: 'type, ward, nightly charge.' },
    { id: 'action-admit', label: 'Admit' },
    { id: 'bed-actions', label: 'Other actions', text: 'send for cleaning, take out of service, reserve.' },
  ]),
  fig(A10, 'c-ward-admit', 'Admitting a patient', 'From the emergency room, from a patient\'s bed request, or someone new.', [
    { id: 'admit-from-er', label: 'From the emergency department', text: 'a patient the ER handed over.' },
    { prefix: 'admit-request-', label: 'From a bed request', text: 'a family that requested a bed in the app.' },
    { id: 'admit-name', label: 'Or someone new', text: 'name, phone, age, sex.' },
    { id: 'admit-confirm', label: 'Review admission' },
  ]),
  fig(A10, 'c-ward-occupied-bed', 'An occupied bed', 'Who is in it and since when; discharge or transfer.', [
    { id: 'occupant', label: 'The patient', text: 'age, sex, admitted when.' },
    { id: 'action-transfer', label: 'Transfer' },
    { match: /^Discharge/, tag: 'button', label: 'Discharge' },
  ]),
  fig(A10, 'c-ward-transfer', 'Transferring to another bed', 'Every free bed across wards, so a move is one choice.', [{ id: 'transfer-chooser', label: 'Move to which bed?' }]),
  fig(A10, 'c-ward-requests', 'Waiting for admission', 'Patients the ER handed over and bed requests from families, in one list with what they need.', [
    { id: 'pending-handoffs', label: 'From the ER', text: 'triage colour and the bed type needed.' },
    { prefix: 'admit-handoff-', label: 'Admit to a bed' },
    { prefix: 'pending-', nth: 1, label: 'A family\'s request', text: 'from the patient app.' },
    { id: 'pending-held', label: 'Held until 8:42 PM', text: 'a bed held for them.' },
  ]),

  // ---------------------------------------------------------------- A11
  {
    type: 'chapter',
    num: 'A11',
    title: 'Emergency',
    lead: 'The emergency room\'s console: who is on the way, who is here, how sick, and what this ER can take right now — which is exactly what families searching for help see.',
  },
  fig(A11, 'c-er', 'The emergency console', 'Load at the top, then incoming patients and referrals, the triage list, and on the right what the ER can take.', [
    { id: 'er-load', label: 'Load', text: 'on the way, in the ER, critical — counted from the cases, never typed.' },
    { id: 'er-sound-enable', label: 'Alert sound', text: 'rings when a family taps “I am on my way”.' },
    { id: 'er-walkin', label: 'Add a patient', text: 'someone who walked in.' },
    { id: 'er-inbound-empty', label: 'On the way', text: 'families\' alerts appear here.' },
    { id: 'er-incoming', label: 'Referred to us', text: 'from another hospital\'s ER, with accept or decline.' },
    { id: 'er-capabilities', label: 'What we can take now', text: 'switched on here = shown to patients.' },
  ]),
  fig(A11, 'c-er-triage', 'Triage, capabilities and beds', 'Each patient with a token, problem, time and triage colour. On the right, the capabilities to confirm and the beds from the bed board.', [
    { prefix: 'er-row-', label: 'A patient', text: 'token ER-4, heart, 58, male.' },
    { prefix: 'er-triage-red-', label: 'Triage', text: 'red, yellow, green.' },
    { id: 'er-handed-off', label: 'Handed to the ward', text: 'needs a CCU bed.' },
    { id: 'er-capabilities-confirm', label: 'All correct — confirm', text: 'refreshes the age patients see.' },
    { id: 'er-beds', label: 'Beds from the bed board' },
    { id: 'er-referrals-today', label: 'Today\'s referrals' },
  ]),
  fig(A11, 'c-er-walkin', 'A patient walks in', 'What happened, age and sex — enough to triage. A name is optional at first.', [{ id: 'er-walkin-form', label: 'What happened?' }, { id: 'er-walkin-save', label: 'Add' }]),
  fig(A11, 'c-er-refer', 'Referring to another hospital', 'Which ERs have the capability and a free bed, fresh figures first, with distance and time.', [
    { id: 'er-refer-sheet', label: 'The patient and what is needed' },
    { id: 'er-refer-results', label: 'ERs that can take them' },
    { prefix: 'er-refer-send-', label: 'Send referral', text: 'the other ER\'s console rings; both follow the steps.' },
  ]),
  fig(A11, 'c-er-admit', 'Admitting from the ER', 'Choose the bed type; the ward sees the patient in its waiting list.', [{ id: 'er-admit-kinds', label: 'Which bed?' }]),
  fig(A11, 'c-er-decline', 'Declining a referral', 'With a reason, so the sending ER can find another place at once.', [{ id: 'er-incoming-decline-reason', label: 'Reason' }, { id: 'er-incoming-decline-confirm', label: 'Decline and tell them' }]),

  // ---------------------------------------------------------------- A12
  {
    type: 'chapter',
    num: 'A12',
    title: 'Laboratory and pharmacy',
    lead: 'Tests the doctor orders arrive on the lab\'s screen; the report goes to the patient when it is uploaded. The pharmacy keeps its stock true for the patients searching for a medicine.',
  },
  fig(A12, 'c-lab', 'The lab console', 'Orders by stage. A patient\'s name is hidden until someone needs it.', [
    { id: 'lab-filters', label: 'In progress · Reported · All' },
    { id: 'lab-stage-ordered', label: 'Stages', text: 'ordered, sample collected, processing.' },
    { prefix: 'lab-order-', label: 'An order', text: 'the test and its reference.' },
    { id: 'lab-search', label: 'Find a test', text: 'by name, e.g. CBC; each order\'s button moves it to its next stage.' },
    { id: 'lab-turnaround', label: 'Turnaround', text: 'ordered to report ready, measured.' },
  ]),
  fig(A12, 'c-lab-patient', 'Showing the patient', '“Show the patient” reveals the name for labelling the sample — and that viewing is recorded.', [{ prefix: 'lab-patient-', label: 'The patient\'s name' }]),
  fig(A12, 'c-lab-upload', 'Uploading the report', 'A PDF or a photo. Checked for what it really is, stored privately, and delivered to the patient\'s records.', [
    { prefix: 'lab-report-file-', label: 'The report file' },
    { prefix: 'lab-report-submit-', label: 'Submit the report' },
  ]),
  fig(A12, 'c-lab-reported', 'Reported', 'Delivered reports, for looking back.', [{ id: 'lab-filters', label: 'Reported (selected)' }]),
  fig(A12, 'c-pharmacy', 'The pharmacy', 'Each medicine in stock, out of stock or not known — what patients see when they search.', [
    { id: 'pharmacy-filter-in_stock', label: 'In stock · Not known · Out of stock' },
    { id: 'pharmacy-confirm-all', label: 'The whole list is correct', text: 'one tap refreshes every age.' },
    { id: 'pharmacy-search', label: 'Find a medicine' },
    { prefix: 'stock-in-', label: 'In stock / Out of stock' },
  ]),
  fig(A12, 'c-pharmacy-search', 'Finding a medicine', 'Prescription dispensing is not in this version; the screen says so rather than showing an empty tab.', [{ id: 'pharmacy-search', label: 'Napa' }, { id: 'pharmacy-dispense-absent', label: 'Not in this version', text: 'said plainly.' }]),

  // ---------------------------------------------------------------- A13
  {
    type: 'chapter',
    num: 'A13',
    title: 'Hospital administration',
    lead: 'The administrator\'s workspace: the hospital right now, reports, staff and desks, doctors and departments, settings, and importing existing data. Figures come from the same live record the counters write — nothing is typed twice.',
  },
  fig(A13, 'c-admin', 'Today — the hospital now', 'Five figures across the top, then what needs attention, today\'s chambers and today\'s figures.', [
    { match: /^Today/, tag: 'button', label: 'Today · Reports · Staff & Desks · Doctors · Settings', text: 'the administrator\'s sections.' },
    { id: 'admin-now-doctors', label: 'Today\'s doctors', text: 'sitting now of scheduled.' },
    { id: 'admin-now-waiting', label: 'Patients waiting' },
    { id: 'admin-now-appointments', label: 'Appointments', text: 'seen of booked.' },
    { id: 'admin-now-beds', label: 'Beds free', text: 'with the figure\'s age.' },
    { id: 'admin-now-emergency', label: 'Emergency', text: 'on the way, in the ER.' },
    { id: 'admin-attention', label: 'Needs attention', text: 'late doctors, long waits, stale figures.' },
  ]),
  fig(A13, 'c-admin-chambers', 'Today\'s chambers', 'Every chamber grouped by reception desk: doctor, room, status, planned and started times, waiting.', [{ id: 'admin-chambers', label: 'Today\'s chambers' }, { id: 'admin-chamber-row', label: 'A chamber', text: 'running since 5:52 PM.' }]),
  fig(A13, 'c-admin-figures', 'Today\'s figures', 'Patients seen, serials booked, no-shows, waits and promises kept — for the day or a range.', [
    { id: 'admin-seen', label: 'Patients seen' },
    { id: 'admin-avg-wait', label: 'Average wait', text: 'from check-in to call.' },
    { id: 'admin-quotes-kept', label: 'Called within the quote', text: 'how often the time patients were told was kept.' },
  ]),
  fig(A13, 'c-reports-today', 'Reports — Today', 'Nine reports, each with export and print. Figures are the hospital\'s own; nothing identifies a patient in an export.', [
    { prefix: 'admin-tab-', label: 'The reports', text: 'today, trend, no-show loss, revenue, staff, beds, referrals, feedback, forecast.' },
    { id: 'admin-loaded-range', label: 'The range shown' },
    { id: 'admin-export', label: 'Export (CSV)' },
    { id: 'admin-print', label: 'Print' },
  ]),
  fig(A13, 'c-reports-trend', 'Reports — Trend', 'Patients seen and waits over time.', [{ id: 'admin-tab-trend', label: 'Trend' }]),
  fig(A13, 'c-reports-loss', 'Reports — No-show loss and recovery', 'Money lost to no-shows, and recovered by offering freed serials to standby patients.', [{ id: 'admin-tab-loss', label: 'No-show loss' }]),
  fig(A13, 'c-reports-revenue', 'Reports — Revenue', 'Collections by doctor and method, itemised.', [{ id: 'admin-tab-revenue', label: 'Revenue' }]),
  fig(A13, 'c-reports-staff', 'Reports — Staff', 'Doctors\' punctuality and pace.', [{ id: 'admin-tab-staff', label: 'Staff' }]),
  fig(A13, 'c-reports-beds', 'Reports — Beds', 'Occupancy and turnover by ward and type.', [{ id: 'admin-tab-beds', label: 'Beds' }]),
  fig(A13, 'c-reports-referrals', 'Reports — Referrals', 'Patients sent out and received, and to whom.', [{ id: 'admin-tab-referrals', label: 'Referrals' }]),
  fig(A13, 'c-reports-feedback', 'Reports — Feedback', 'What patients said about waiting and the doctor.', [{ id: 'admin-tab-feedback', label: 'Feedback' }]),
  fig(A13, 'c-reports-forecast', 'Reports — Forecast', 'Tomorrow\'s expected load from the schedules and history.', [{ id: 'admin-tab-forecast', label: 'Forecast' }]),
  fig(A13, 'c-staff', 'Staff & Desks — staff', 'Every account with its roles. Each person has their own login.', [
    { id: 'management-group-home', label: 'Staff · Reception desks · Who can run which queue' },
    { id: 'management-search', label: 'Find by name or email' },
    { id: 'management-add', label: '+ Add staff member' },
    { prefix: 'management-person-', label: 'A person', text: 'roles and hospital.' },
    { prefix: 'management-change-', label: 'Change' },
  ]),
  fig(A13, 'c-staff-person', 'A staff member', 'Roles, active or not, reset password, reset two-step. Switching an account off signs the person out everywhere at once.', [{ prefix: 'settings-staff-', label: 'The person\'s settings' }]),
  fig(A13, 'c-staff-add', 'Adding a staff member', 'Name, email and roles: reception, doctor, ward, emergency, lab, pharmacy, administration.', [{ id: 'settings-add-staff', label: 'Add staff member' }, { id: 'settings-add-staff-submit', label: 'Add' }]),
  fig(A13, 'c-staff-confirm', 'Review before saving', 'Every change to people is shown as before → after and confirmed.', [{ id: 'management-confirm', label: 'Before / after' }, { id: 'management-confirm-save', label: 'Confirm and save' }]),
  fig(A13, 'c-staff-temp-password', 'The temporary password', 'Shown once, to hand to the person; they choose their own at first sign-in.', [{ id: 'settings-temp-password-value', label: 'Temporary password' }]),
  fig(A13, 'c-desks', 'Reception desks', 'A desk groups the chambers and receptionists that work together; each receptionist sees their desk\'s queues.', [{ id: 'settings-desks', label: 'Reception desks' }, { id: 'desk-add-form', label: 'Add a desk', text: 'names in Bangla and English.' }]),
  fig(A13, 'c-access', 'Who can run which queue', 'Which receptionist may run which doctor\'s chamber.', [{ id: 'management-group-access', label: 'Who can run which queue' }]),
  fig(A13, 'c-doctors', 'Doctors', 'The hospital\'s doctors with BMDC numbers, fees, rooms and weekly schedules. Chambers for the next seven days appear by themselves from the schedules.', [
    { id: 'management-search', label: 'Find by name or BMDC number' },
    { id: 'management-add', label: '+ Add doctor' },
    { prefix: 'management-person-', label: 'A doctor', text: 'BMDC number, qualifications.' },
  ]),
  fig(A13, 'c-doctor-person', 'A doctor\'s details', 'Fee and room, weekly schedule, and identity. A verified doctor\'s identity cannot be changed here.', [
    { prefix: 'settings-doctor-fee-', label: 'Save fee and room' },
    { id: 'doctor-identity', label: 'Doctor information', text: 'verified identity is locked.' },
    { prefix: 'settings-doctor-active-', label: 'Deactivate' },
  ]),
  fig(A13, 'c-departments', 'Departments', 'A department in use by doctors cannot be removed — the screen says how many.', [{ id: 'settings-departments', label: 'Departments' }, { id: 'settings-dept-in-use-CARD', label: '“Doctors listed here: 2, so it cannot be removed”' }]),
  fig(A13, 'c-settings', 'Settings', 'Whether patients can see the hospital, and every group of settings.', [
    { id: 'settings-live', label: 'Patients can see this facility' },
    { id: 'settings-group-profile', label: 'Name, address and contact' },
    { id: 'settings-group-face', label: 'Your hospital in the patient app', text: 'logo, colour, description, what is published.' },
    { id: 'settings-group-rules', label: 'Queue rules' },
    { id: 'settings-group-beds', label: 'Wards and beds' },
    { id: 'settings-group-capabilities', label: 'Emergency services' },
    { id: 'settings-group-identity', label: 'Registration details' },
    { id: 'settings-group-sms', label: 'This month\'s SMS' },
  ]),
  fig(A13, 'c-settings-profile', 'Settings — name, address and contact', 'What patients see about the hospital.', [{ id: 'settings-profile', label: 'Profile' }]),
  fig(A13, 'c-settings-face', 'Settings — the hospital in the patient app', 'The hospital\'s own portal address and the description patients read, in both languages.', [
    { id: 'settings-portal', label: 'Portal address', text: 'the hospital\'s own patient app.' },
    { id: 'settings-description-bn', label: 'Description in Bangla' },
    { id: 'settings-description-en', label: 'Description in English' },
  ]),
  fig(A13, 'c-settings-logo', 'Settings — the logo', 'A PNG, JPEG or WebP image, shown beside the hospital\'s name everywhere — never an empty box if it fails to load.', [
    { id: 'settings-logo-preview', label: 'Current logo' },
    { id: 'settings-logo-file', label: 'Choose a file' },
    { id: 'settings-logo-save', label: 'Save' },
  ]),
  fig(A13, 'c-settings-brand', 'Settings — the colour', 'One colour. The app makes a readable palette from it, darkening it only as far as white text needs, and previews it with its own components.', [
    { id: 'settings-brand-colour', label: 'Colour' },
    { id: 'settings-brand-preview', label: 'Preview' },
  ]),
  fig(A13, 'c-settings-publishing', 'Settings — what the hospital publishes', 'Each public figure can be shared or kept private: bed counts, serial counts, pharmacy stock.', [{ id: 'settings-publishing', label: 'Publishing' }, { prefix: 'settings-publish-', label: 'A figure', text: 'shared or not.' }]),
  fig(A13, 'c-settings-rules', 'Settings — queue rules', 'The no-show grace, how many places a late patient goes back, payment holds, arrival windows.', [{ id: 'settings-rules', label: 'Queue rules' }]),
  fig(A13, 'c-settings-beds', 'Settings — wards and beds', 'Wards, their beds, types and nightly charges. A bed in use cannot be removed.', [
    { prefix: 'settings-ward-', label: 'A ward' },
    { prefix: 'settings-bedchip-', label: 'A bed', text: 'tap to rename or remove.' },
    { prefix: 'settings-add-beds-', label: 'Add beds' },
  ]),
  fig(A13, 'c-settings-capabilities', 'Settings — emergency services', 'What the hospital can treat: burn unit, cath lab, dialysis, NICU…', [{ id: 'settings-capabilities', label: 'Capabilities' }]),
  fig(A13, 'c-settings-identity', 'Settings — registration details', 'District and registration number, used in review; locked once verified.', [{ id: 'settings-identity-locked', label: 'Locked once verified', text: 'a change goes through the platform.' }]),
  fig(A13, 'c-settings-sms', 'Settings — this month\'s SMS', 'Messages sent, delivered, failed, held for quiet hours, against the monthly cap.', [{ id: 'settings-sms-month', label: 'This month' }]),
  fig(A13, 'c-import', 'Data import', 'A hospital brings what it already has, one set at a time: structure (departments, doctors, schedules, wards, staff), the patient register, upcoming appointments.', [
    { id: 'import-guide', label: '1 Which set · 2 File · 3 Confirm the matching' },
    { id: 'import-template', label: 'Download the template' },
    { id: 'import-file', label: 'A CSV or Excel file', text: 'the template or the hospital\'s own export.' },
    { id: 'import-check', label: 'Check', text: 'nothing is written yet.' },
    { id: 'import-history', label: 'Imports so far', text: 'with undo.' },
  ]),
  fig(A13, 'c-import-mapping', 'Matching the columns', 'The hospital\'s own export has its own column names. Each is matched to what MedLiveBD needs, with the reason; a person confirms.', [
    { id: 'import-mapping', label: 'Match your file\'s columns' },
    { id: 'map-ref', label: 'Your own ID', text: 'kept, so a second import updates instead of duplicating.' },
    { id: 'map-why-ref', label: 'Why', text: '“Proposed by a rule · high confidence”.' },
  ]),
  fig(A13, 'c-import-preview', 'The check result', 'How many rows would be added, updated, skipped, and any errors — before anything is written.', [
    { id: 'import-count-add', label: 'Add 8' },
    { id: 'import-count-update', label: 'Update' },
    { id: 'import-count-skip', label: 'Skip' },
    { id: 'import-commit', label: 'Import', text: 'all or nothing.' },
  ]),
  fig(A13, 'c-import-confirm', 'Confirm the import', 'A last confirmation, then the whole file is written in one go.', [{ id: 'import-confirm', label: 'Confirm' }, { id: 'import-confirm-yes', label: 'Yes, import' }]),
  fig(A13, 'c-import-history', 'Done — and undoable', 'The import is listed with what it wrote, and can be undone while nothing has changed since.', [{ id: 'import-history', label: 'Import history' }, { prefix: 'import-undo-', label: 'Undo' }]),

  // ---------------------------------------------------------------- A14
  {
    type: 'chapter',
    num: 'A14',
    title: 'Platform onboarding',
    lead: 'MedLiveBD\'s own workspace for bringing hospitals onto the platform: create or review a workspace, see how ready it is, verify doctors, switch modules on or off, and approve it to go live. It shows organisations — never a patient.',
  },
  fig(A14, 'c-platform', 'Hospital onboarding', 'Every organisation on the platform with its state.', [
    { id: 'platform-no-patients', label: 'Organisations only', text: 'no patient data on this screen, ever.' },
    { id: 'platform-new', label: 'Add a hospital' },
    { id: 'platform-filter-ready_for_review', label: 'Filters', text: 'waiting for review, needs attention, setting up, live, suspended, closed.' },
    { prefix: 'platform-row-', label: 'A hospital', text: 'its state, kind and division.' },
    { id: 'platform-row-stalest', label: 'Oldest published figure', text: 'how fresh its public data is.' },
  ]),
  fig(A14, 'c-platform-workspace', 'A hospital\'s workspace — the decision', 'The foot of a workspace: its verified doctors, a note to the hospital, and the decisions its state allows (approve, send back, suspend, reinstate, close).', [
    { prefix: 'platform-doctor-', label: 'Doctors', text: 'each with its BMDC number, verified by the platform.' },
    { id: 'platform-note', label: 'A note to the hospital', text: 'recorded with the decision.' },
    { id: 'platform-act-suspend', label: 'Suspend', text: 'a live hospital disappears from the network until reinstated.' },
    { id: 'platform-act-close', label: 'Close permanently', text: 'only after ticking that you are sure.' },
  ]),
  fig(A14, 'c-platform-readiness', 'Readiness & decision', 'The checklist a hospital completes before review — departments, doctors, weekly chambers, staff, address, map place, emergency services, beds, verified doctors — each marked done or still to do.', [
    { id: 'platform-section-readiness', label: 'Readiness & decision', text: 'the first of four tabs.' },
    { id: 'platform-section-services', label: 'Services & address' },
    { id: 'platform-section-access', label: 'Administrator access' },
    { id: 'platform-section-health', label: 'Health & history' },
    { id: 'platform-check-departments', label: 'A check', text: '“Done · Departments: 8”.' },
    { id: 'platform-check-verified_doctors', label: 'Verified doctors', text: 'patients can book only verified doctors.' },
  ]),
  fig(A14, 'c-platform-services', 'Services & address — modules', 'Which parts of the product this hospital runs. A module that is off is not shown to its staff or its patients.', [
    { id: 'platform-section-services', label: 'Services & address (open)' },
    { id: 'platform-module-queue', label: 'Serials and reception' },
    { id: 'platform-module-doctor', label: 'Doctor\'s console' },
    { id: 'platform-module-lab', label: 'Lab', text: 'and beds, emergency, pharmacy, dashboard, data import.' },
    { id: 'platform-modules-save', label: 'Save modules' },
  ]),
  fig(A14, 'c-platform-access', 'Administrator access — agreement and usage', 'Whether the hospital\'s agreement is in a trial, active, overdue or ended — the state only; terms are kept outside the product — and how much it uses.', [
    { id: 'platform-section-access', label: 'Administrator access (open)' },
    { id: 'platform-agreement-recorded', label: 'Now', text: 'the state and when it was set.' },
    { id: 'platform-agreement-active', label: 'Trial · Active · Overdue · Ended' },
    { id: 'platform-agreement-save', label: 'Save agreement state' },
    { id: 'platform-usage', label: 'Usage' },
  ]),
  fig(A14, 'c-platform-access-more', 'Usage, as three counts', 'Serials taken, chambers held and messages sent in the last 30 days — counts, never rows.', [
    { id: 'platform-usage-serials', label: 'Serials' },
    { id: 'platform-usage-chambers', label: 'Chambers' },
    { id: 'platform-usage-messages', label: 'Messages' },
  ]),
  fig(A14, 'c-platform-health', 'Health & history', 'Is the hospital\'s data fresh, are its messages reaching people, is its work on time.', [
    { id: 'platform-section-health', label: 'Health & history (open)' },
    { id: 'platform-health-fine', label: '“Nothing needs attention right now.”' },
    { id: 'platform-health-figure-beds', label: 'How old its published figures are', text: 'bed figures, emergency services.' },
    { id: 'platform-health-messages', label: 'Messages in the last 7 days', text: 'sent, failed, held for quiet hours, waiting.' },
  ]),
  fig(A14, 'c-platform-health-more', 'Late work and the trail', 'Work that arrived late, and every change to the organisation: who did what, and when.', [
    { id: 'platform-health-sync', label: 'Work that arrived late' },
    { id: 'platform-trail', label: 'Trail of changes' },
    { id: 'platform-trail-show', label: 'Show the trail' },
  ]),
  fig(A14, 'c-platform-applied', 'A hospital that applied by itself', 'The application from chapter A6, in “setting up”. It is the hospital\'s move until it asks for review.', [{ id: 'platform-workspace', label: 'Setting up' }]),
  fig(A14, 'c-platform-new', 'Creating a workspace', 'For a hospital onboarded by MedLiveBD: names, a code, kind, division, and the first administrator.', [{ id: 'platform-new-form', label: 'A new hospital workspace' }, { id: 'platform-create', label: 'Create the workspace' }]),
  fig(A14, 'c-platform-review', 'Review before creating', 'Every field shown once more before anything is created.', [{ id: 'management-confirm', label: 'What will be created' }, { id: 'management-confirm-save', label: 'Confirm and save' }]),
  fig(A14, 'c-platform-created', 'The workspace exists', 'The first administrator\'s temporary password, shown once, to be handed over; they choose their own and set up two-step at first sign-in.', [
    { id: 'platform-temp-password', label: 'Temporary password' },
    { id: 'platform-password-handed', label: '“I have handed it over”' },
    { id: 'platform-created-done', label: 'Done' },
  ]),

  // ---------------------------------------------------------------- A15
  {
    type: 'chapter',
    num: 'A15',
    title: 'National dashboard',
    lead: 'For a government viewer: district and national totals only — capacity, emergency load, disease signals and benchmarks. No patient and no facility is identifiable from it, by design and by the database.',
  },
  fig(A15, 'c-gov-capacity', 'Capacity', 'Free beds by type, nationwide and by district, with their age. What no facility reports is said, not invented.', [
    { id: 'gov-aggregate-only', label: 'Totals only', text: 'no patient, no facility.' },
    { id: 'gov-tab-capacity', label: 'Capacity · Emergency load · Disease signals · Benchmarks' },
    { id: 'gov-beds-free', label: 'Free beds', text: '30 of 168.' },
    { id: 'gov-unrecorded', label: 'Not recorded', text: 'ventilators, blood stock.' },
    { id: 'gov-by-kind', label: 'By bed type' },
  ]),
  fig(A15, 'c-gov-er', 'Emergency load', 'People in emergency rooms now and on the way, by district and hour.', [{ id: 'gov-er-open', label: 'In emergency now' }, { id: 'gov-heatmap', label: 'By district and hour' }]),
  fig(A15, 'c-gov-signals', 'Disease signals', 'Doctors\' public-health marks, counted by district and week. A district well above its usual week is flagged.', [{ id: 'gov-spike-Dhaka-dengue', label: 'Spike', text: 'Dhaka, dengue: 9 this week, usually 1.' }, { id: 'gov-signals', label: 'All signals' }]),
  fig(A15, 'c-gov-benchmarks', 'Benchmarks', 'How kinds of facility compare on waits, lab turnaround and patients\' ratings — no facility named.', [
    { id: 'gov-measure-wait', label: 'Average wait' },
    { id: 'gov-measure-turnaround', label: 'Lab turnaround' },
    { id: 'gov-measure-score_wait', label: 'Patient rating: waiting' },
  ]),
];
