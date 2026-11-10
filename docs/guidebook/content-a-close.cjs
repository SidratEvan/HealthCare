// Part A, the close: where the platform is going, privacy in plain words, FAQ.
const T = (rows, head) =>
  `<table>${head ? `<tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>` : ''}${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;

module.exports = [
  {
    type: 'chapter',
    num: 'A16',
    title: 'What MedLiveBD will become',
    lead: 'One platform, never software rewritten for each hospital. The same product grows along three lines: more hospitals in the network, each hospital\'s own branded app, and connections to the services around care.',
    html: `
<h3>1 · A network of hospitals</h3>
<p>As more hospitals join, the patient app answers more questions in one place: which hospital has a cardiologist sitting tonight, an ICU bed free now, a burn unit within 30 minutes. Each hospital keeps its patients private and shares only its public figures, each with its age.</p>
<h3>2 · Every hospital's own app</h3>
<p>A hospital may appear in the network, have its own branded app and address, or both — configured, not forked: name, logo, colour, address, installable app, the modules it runs. Emergency search stays network-wide everywhere.</p>
<h3>3 · Switching on the outside world</h3>
<p>The product is built and tested against stand-ins for the services it connects to. Each is switched on with its provider once the company and the hospitals have the agreements in place:</p>
<ul><li><b>SMS</b> through a Bangladeshi aggregator, with an approved sender name — called, delayed, two away, slot offered.</li><li><b>bKash, Nagad and cards</b> for paying a serial online, with automatic refunds when a doctor does not come.</li><li><b>App stores</b> for the installed patient app.</li><li><b>A hospital's own information system</b> and the national health record, by import today and by direct connection later.</li></ul>`,
  },
  {
    type: 'text',
    crumb: 'A16 · What MedLiveBD will become',
    title: 'The road ahead',
    html: `${T(
      [
        ['Now', 'Live queues, booking, live serial, standby, emergency search and alerts, beds, lab reports, records and consent, administration, onboarding, import, national dashboard — in Bangla and English, offline-capable consoles, on demonstration data.'],
        ['First hospitals', 'The same software on a server in Bangladesh with real patients: counters, doctors and administration first; SMS and online payment as each provider is approved.'],
        ['Growing the network', 'More hospitals and clinics as workspaces of one shared platform; patients find live availability across them; hospitals\' own branded apps.'],
        ['Deeper care', 'Prescription reminders and dispensing against a prescription, telemedicine, ambulance and blood services, referrals across the network — each built on the same live record.'],
        ['National scale', 'Aggregate capacity and disease signals for public health, the national health record, and connections to hospitals\' existing systems.'],
      ],
      ['Stage', 'What it brings'],
    )}
<div class="box"><b>What stays the same at every stage.</b> Live figures with their age; honest “not known”; Bangla first; emergency never behind a login; the patient owns the record; one platform for every hospital; data about patients in Bangladesh.</div>
<div class="box teal"><b>What MedLiveBD is not.</b> Not an ERP: no payroll, HR, general accounting, inventory or insurance administration. Not a diagnostic tool: no AI diagnosis, no generated prescriptions, no treatment advice. The only AI in the product suggests how the columns of a hospital's own spreadsheet match the import template, from the column names only; a person confirms, and no patient row is ever sent to it.</div>`,
  },
  {
    type: 'chapter',
    num: 'A17',
    title: 'Privacy and safety, in plain words',
    lead: 'A hospital trusts MedLiveBD with its patients. This is how that trust is kept — the same rules described for engineers in Part B, without the technical words.',
    html: `
<div class="cards">
<div class="card"><h3>Each hospital is private</h3>Hospital A can never see Hospital B's patients, bookings or records. This is enforced twice: by the software and again by the database itself.</div>
<div class="card"><h3>Records follow the patient's consent</h3>A doctor sees a patient's visits at their own hospital. Records from another hospital open only with a code the patient shows, for a short time. The patient can see who looked.</div>
<div class="card"><h3>Every look is recorded</h3>Each time staff open an identifiable record, the system writes who, which patient, when and from where.</div>
<div class="card"><h3>Own accounts, strong sign-in</h3>No shared logins. Wrong passwords lock the account. Administrators use a code from their phone. A hospital can allow staff sign-in only from its own building.</div>
<div class="card"><h3>Data stays in Bangladesh</h3>A deployment with real patients runs on a server in Bangladesh. The demonstration holds only invented people.</div>
<div class="card"><h3>Nothing lost</h3>Every night the data is backed up, the backup is proven by restoring it, and an encrypted copy goes to a second disk. An alert goes to the hospital if anything fails.</div>
</div>
<div class="box ok"><b>Tested like an attacker would.</b> Before real patients, the system was attacked in 84 different ways — forged sign-ins, reading another hospital's patients, injecting commands, guessing passwords. None succeeded.</div>`,
  },
  {
    type: 'text',
    crumb: 'A18 · Questions',
    title: 'Frequently asked questions',
    html: `
<h3>Does a patient need a smartphone?</h3><p>No. A patient can be registered at the counter, get a printed slip and be called in person. A smartphone adds the live serial at home.</p>
<h3>Does a patient need an account?</h3><p>No. A name, a mobile number and an age book a serial. An account only adds history across devices.</p>
<h3>What happens when the internet goes down at the counter?</h3><p>The queue keeps working on screen. Actions are kept on the computer and sent when the connection returns, once and in order. Only giving a new serial waits for the connection.</p>
<h3>What if two counters press “next” at the same moment?</h3><p>One patient is called; the other counter is told the queue moved. The same patient is never called twice.</p>
<h3>Can a mistake be undone?</h3><p>Yes, within 10 seconds, by the person who made it. Nothing is ever deleted: the history keeps both the action and its undoing.</p>
<h3>Can another hospital see our patients?</h3><p>No. Only figures the hospital chooses to publish (beds, services, open serials) are shared, each with its age.</p>
<h3>Can we bring our existing data?</h3><p>Yes: departments, doctors, schedules, wards, staff, the patient register and upcoming appointments, from a spreadsheet — checked before anything is written, and undoable.</p>
<h3>Is it in Bangla?</h3><p>Bangla first, with Bangla digits, and English one tap away on every screen.</p>
<h3>Can we have our own app?</h3><p>Yes: the patient app at the hospital's own address, in its colours, installable with its icon.</p>
<h3>Where does our data live?</h3><p>On a server in Bangladesh. Backups are encrypted and kept on a second disk.</p>`,
  },
  {
    type: 'text',
    crumb: 'A18 · Questions',
    title: 'Words used in this book',
    html: `<table>
<tr><th>Word</th><th>Meaning</th></tr>
<tr><td>Chamber / session</td><td>One doctor sitting in one room on one day. All queue activity belongs to it.</td></tr>
<tr><td>Serial</td><td>A patient's number in a chamber.</td></tr>
<tr><td>Live serial</td><td>The patient's screen that follows the queue in real time.</td></tr>
<tr><td>Now serving</td><td>The serial with the doctor.</td></tr>
<tr><td>Walk-in</td><td>A patient added at the counter without a booking.</td></tr>
<tr><td>Late / no-show</td><td>A late patient is put back a few places; a no-show did not come within the grace period and can be brought back.</td></tr>
<tr><td>Standby</td><td>A waiting list for a full chamber; freed serials are offered in order.</td></tr>
<tr><td>Check-in</td><td>Recording that a patient has arrived at the hospital.</td></tr>
<tr><td>Token slip</td><td>The printed slip with the serial and a QR code to the live serial.</td></tr>
<tr><td>Freshness</td><td>How old a figure is: “Updated 9 min ago”.</td></tr>
<tr><td>Capability</td><td>Something a hospital can treat: burn unit, cath lab, dialysis…</td></tr>
<tr><td>Triage</td><td>Sorting emergency patients by how urgent they are: red, yellow, green.</td></tr>
<tr><td>Referral</td><td>Sending a patient to another hospital's emergency room, followed by both.</td></tr>
<tr><td>Consent code</td><td>A short-lived code a patient shows a doctor to open records from elsewhere.</td></tr>
<tr><td>Workspace</td><td>A hospital's private space on the platform.</td></tr>
<tr><td>Module</td><td>A part of the product a hospital switches on: queue, beds, emergency, lab, pharmacy, dashboard.</td></tr>
<tr><td>Portal</td><td>The patient app at a hospital's own address, in its colours.</td></tr>
<tr><td>Two-step verification</td><td>A code from a phone app after the password.</td></tr>
<tr><td>Demonstration data</td><td>Invented hospitals and people, labelled “(Demo)”, used to show the product.</td></tr>
</table>`,
  },
];
