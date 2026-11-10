// Part A, the opening: what the product is, who it serves, how a day runs,
// and the principles visible on every screen.
const T = (rows, head) =>
  `<table>${head ? `<tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>` : ''}${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;

const step = (x, n, title, text, colour) =>
  `<g><circle cx="${x + 70}" cy="40" r="22" fill="${colour}"/><text x="${x + 70}" y="47" text-anchor="middle" font-size="18" font-weight="800" fill="#fff">${n}</text><text x="${x + 70}" y="90" text-anchor="middle" font-size="14" font-weight="700" fill="#0f1f3d">${title}</text>${text
    .map((line, i) => `<text x="${x + 70}" y="${110 + i * 16}" text-anchor="middle" font-size="11.5" fill="#45597a">${line}</text>`)
    .join('')}</g>`;
const flow = (steps) =>
  `<div class="diagram"><svg viewBox="0 0 1000 170" font-family="Anek Bangla, Segoe UI, Arial"><defs><marker id="f" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#f05a1f"/></marker></defs>${steps
    .map((s, i) => step(i * (1000 / steps.length) + (1000 / steps.length - 140) / 2, i + 1, s[0], s[1], s[2] ?? '#0b5ed7'))
    .join('')}${steps
    .slice(0, -1)
    .map((_, i) => {
      const w = 1000 / steps.length;
      return `<line x1="${i * w + w / 2 + 28}" y1="40" x2="${(i + 1) * w + w / 2 - 28}" y2="40" stroke="#f05a1f" stroke-width="2" marker-end="url(#f)"/>`;
    })
    .join('')}</svg></div>`;

const LIVE = `<div class="diagram"><svg viewBox="0 0 1000 230" font-family="Anek Bangla, Segoe UI, Arial">
<defs><marker id="g" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#f05a1f"/></marker></defs>
<rect x="20" y="60" width="220" height="110" rx="14" fill="#eef4fd" stroke="#0b5ed7" stroke-width="1.6"/>
<text x="130" y="95" text-anchor="middle" font-size="16" font-weight="800" fill="#0a3f8f">Reception counter</text>
<text x="130" y="118" text-anchor="middle" font-size="12" fill="#45597a">Nazma taps</text>
<rect x="70" y="128" width="120" height="30" rx="8" fill="#0b5ed7"/><text x="130" y="148" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">Finish and call next</text>
<rect x="390" y="70" width="220" height="90" rx="14" fill="#fff4dc" stroke="#d99a00" stroke-width="1.6"/>
<text x="500" y="105" text-anchor="middle" font-size="16" font-weight="800" fill="#7a5600">MedLiveBD</text>
<text x="500" y="127" text-anchor="middle" font-size="12" fill="#7a5600">records it, recalculates every wait</text>
<line x1="240" y1="115" x2="390" y2="115" stroke="#f05a1f" stroke-width="2.4" marker-end="url(#g)"/>
<text x="315" y="105" text-anchor="middle" font-size="12" font-weight="700" fill="#a33a10">one tap</text>
${[0, 1, 2, 3]
  .map((i) => {
    const y = 10 + i * 55;
    return `<rect x="760" y="${y}" width="220" height="44" rx="10" fill="#e9f7f5" stroke="#0f9f95" stroke-width="1.4"/><text x="870" y="${y + 19}" text-anchor="middle" font-size="12.5" font-weight="700" fill="#0b5c55">${['Rahela’s phone at home', 'Sabbir’s phone in the car', 'The doctor’s screen', 'The other counters'][i]}</text><text x="870" y="${y + 35}" text-anchor="middle" font-size="11" fill="#2f6f69">${['“Leave in 40 minutes”', '“Ahead of you: 6”', 'next patient’s history open', 'same queue, same second'][i]}</text><line x1="610" y1="115" x2="760" y2="${y + 22}" stroke="#f05a1f" stroke-width="1.8" marker-end="url(#g)"/>`;
  })
  .join('')}
<text x="685" y="225" text-anchor="middle" font-size="13" font-weight="800" fill="#a33a10">in under 2 seconds</text>
</svg></div>`;

module.exports = [
  {
    type: 'cover',
    title: 'MedLiveBD — the complete guidebook',
    subtitle: 'What the platform is, what it is becoming, every screen explained with points and arrows, and how it is built. One book for hospitals, clinics, partners and the people who will build it with us.',
    parts:
      '<div><b>Part A — For everyone</b>Hospitals, clinics, partners, staff and anyone who is not a programmer: the idea, the people it serves, and a guided tour of every screen.</div><div><b>Part B — For engineers</b>Developers, testers and operations: architecture, the live queue engine, the database and its security, the API, deployment, workflow and tests.</div>',
    edition: 'Edition of November 2026 · Every screen in this book shows invented demonstration data (six fictional hospitals, fictional people). No real patient appears anywhere.',
  },
  { type: 'toc' },
  {
    type: 'part',
    letter: 'A',
    title: 'For everyone',
    lead: 'Start here if you run a hospital or clinic, work at a counter or in a ward, are considering a partnership, or simply want to understand what MedLiveBD does. No technical knowledge is needed: every screen is shown and every important button is pointed out.',
    html: '<div class="who"><div><b>How to read the screenshots</b><br>Orange numbered markers point at buttons and panels. The numbered list beside each picture explains them in order.</div><div><b>About the data</b><br>All hospitals, doctors and patients are invented for demonstration and labelled “(Demo)”. Patient names stay in Bangla even when the screen is in English, because names are data, not interface.</div><div><b>Languages</b><br>MedLiveBD is Bangla first. Most screenshots here are in English so every reader can follow; key screens are also shown in Bangla.</div></div>',
  },
  {
    type: 'chapter',
    num: 'A1',
    title: 'What MedLiveBD is',
    lead: 'MedLiveBD is a healthcare platform for Bangladesh that keeps a hospital\'s live state — who is being seen, how long each person will wait, which beds are free, what the emergency room can take — true in real time, and shares the right part of it with patients.',
    html: `
<h3>The problem it solves</h3>
<ul>
<li>A patient books a “serial” but has no idea when the doctor will actually arrive, so families wait three or four hours in corridors.</li>
<li>Doctors are delayed by traffic, surgery and second chambers, and nobody downstream is told.</li>
<li>A patient who arrives late often loses the serial entirely.</li>
<li>Reports and prescriptions live on paper; lost paper means repeated tests and money spent twice.</li>
<li>In an emergency, families drive from hospital to hospital asking whether a bed, an ICU or a burn unit is free. Minutes decide outcomes.</li>
<li>Hospitals lose money to no-shows, unmanaged queues and referrals that leak elsewhere — and cannot see any of it.</li>
</ul>
<h3>The idea</h3>
<p>Most healthcare apps treat hospital information as a <b>listing</b>: names, specialities, a phone number, a booking form. MedLiveBD treats it as <b>live state</b>. When reception taps “next”, every waiting patient's phone updates within two seconds. When a ward frees a bed, the public count changes. When nobody has confirmed a figure for a while, the screen says so.</p>
<h3>Two sides, one system</h3>
<p><b>For patients and families</b>: find a doctor or a bed across participating hospitals, book with or without an account, follow the live serial from home, get emergency help with no login, and keep visits and reports in one place.</p>
<p><b>For hospitals and clinics</b>: consoles their staff prefer to paper — reception, registration, doctor, wards, emergency, laboratory, pharmacy, administration — in the hospital's own private workspace.</p>
<div class="box"><b>The one promise.</b> Reception taps <i>next</i>, and every waiting patient's phone updates within two seconds. Everything else in the product supports that.</div>`,
  },
  {
    type: 'text',
    crumb: 'A1 · What MedLiveBD is',
    title: 'How the live queue works, in one picture',
    html: `${LIVE}
<div class="cards"><div class="card"><h3>For the patient</h3>A serial number, the person now being served, how many are ahead, and an estimated time with an honest margin (“9:08 PM ±7 min”). Leave home when the phone says so, not three hours early.</div><div class="card"><h3>For reception</h3>One button finishes the current patient and calls the next. Late patients are put back a few places instead of being dropped. Walk-ins are added in seconds. It all works offline and catches up later.</div><div class="card"><h3>For the director</h3>Today's chambers, who is waiting, average and longest waits, promises kept, no-shows and the money recovered from freed chairs — read from the same live record, never typed twice.</div></div>
<div class="box teal"><b>Why it can be trusted.</b> Every change to a queue is recorded as a permanent event — who did it, when, from which counter. The queue on every screen is calculated from those events by one shared rule, so two screens can never disagree, and any dispute can be replayed exactly.</div>`,
  },
  {
    type: 'text',
    crumb: 'A1 · What MedLiveBD is',
    title: 'One platform, three faces',
    html: `
<div class="cards"><div class="card"><h3>1 · The patient network</h3>The main patient app. A patient searches for what they need — a doctor, a speciality, a hospital, an ICU, a burn unit, a bed, an open serial — and sees which participating hospitals can provide it now, live figures first, each with its age.</div><div class="card"><h3>2 · A private workspace per hospital</h3>The staff consoles live inside each hospital's own workspace. Hospital A never sees hospital B's patients or internal data. A hospital shares only public operational figures with the network: beds, capabilities, who is sitting, open serials, and how old each figure is.</div><div class="card"><h3>3 · A hospital-branded app</h3>The same patient app, limited to one hospital and in its colours, at its own address — installable on a phone with the hospital's name and icon. Emergency search stays network-wide even there: patient safety comes before brand.</div></div>
<h3>What is in the product today</h3>
${T(
  [
    ['Patient app', 'search across hospitals, booking (guest or account), live serial, standby list, emergency triage and “I’m on my way”, bed search and requests, medicine availability, health records and consent codes, Bangla and English'],
    ['Reception', 'live queue, call next, done, late, no-show, bring back, check-in, walk-in, pause and resume, undo, end chamber, standby offers, token slip with QR code, offline working'],
    ['Registration desk', 'find a patient by phone, register a new one, give a serial in any open chamber, print the slip'],
    ['Doctor', 'today\'s queue, the patient\'s history at this hospital, diagnosis, prescription, test orders, advice, follow-up, sign and call next, declare a delay, consented records from elsewhere'],
    ['Wards and beds', 'live bed board, admit, transfer, discharge, reserve, cleaning, out of service, expected discharge, patients\' bed requests'],
    ['Emergency', 'incoming alerts from families, triage colours, walk-ins, referrals between hospitals, admission to a ward, capabilities shared with the network'],
    ['Laboratory and pharmacy', 'test orders through their stages, report upload to the patient; medicine stock shown to patients'],
    ['Administration', 'today at a glance, nine reports, exports, staff and roles, reception desks, doctors and schedules, wards and beds, settings, branding, data import'],
    ['Platform and national', 'hospital onboarding and review; aggregate national capacity, emergency load, disease signals and benchmarks with no patient identity'],
  ],
  ['Area', 'What it does'],
)}`,
  },
  {
    type: 'chapter',
    num: 'A2',
    title: 'Who it is for',
    lead: 'MedLiveBD is designed around real people. Every design argument is settled by asking what these six would need.',
    html: `
<div class="cards"><div class="card"><h3>Rahela, 62 — patient</h3>Diabetic and hypertensive, sees a cardiologist every few months. Reads Bangla only. Cannot tolerate small text or multi-step flows. Wants to know one thing: <i>when should I leave the house?</i></div>
<div class="card"><h3>Sabbir, 29 — attendant</h3>Books for his mother and his daughter from his own phone. Needs several profiles, forwards details to relatives, pays with bKash.</div>
<div class="card"><h3>Nazma, 24 — receptionist</h3>150+ patients a day at one counter. The phone rings constantly with “how long until my turn?”. Types fast, hates the mouse, abandons anything slower than her notebook. Her internet drops several times a day.</div>
<div class="card"><h3>Dr Rezaul, 47 — cardiologist</h3>Sits in two chambers and is often late. Sees a patient in 5–8 minutes. Will not type long notes. Wants the patient's history already open when they sit down.</div>
<div class="card"><h3>Mr Hasan, 51 — hospital director</h3>Signs the agreement. Cares about patient volume, revenue leakage, staff punctuality and complaints. Values anything that shows him money he is losing.</div>
<div class="card"><h3>An emergency family</h3>Panicked, one-handed, possibly in a moving car. Needs the shortest path to a hospital that can actually take the patient — with no login, no payment, no form in the way.</div></div>`,
  },
  {
    type: 'text',
    crumb: 'A2 · Who it is for',
    title: 'Roles and what each can do',
    html: T(
      [
        ['Patient', 'their own profiles', 'book, cancel, follow the serial, see their own records, share them with a doctor by code'],
        ['Attendant', 'profiles linked to their phone', 'everything a patient can do, for the people they book for'],
        ['Receptionist', 'one hospital, its counters', 'register, book, run the queue, check patients in, print slips'],
        ['Doctor', 'their chambers and patients', 'see history, write the visit and prescription, order tests, declare a delay'],
        ['Ward staff', 'one hospital\'s wards', 'admit, transfer, discharge, update bed state, answer bed requests'],
        ['Emergency coordinator', 'one hospital\'s ER', 'triage, accept incoming patients, refer out, update capabilities'],
        ['Lab staff', 'one facility', 'move tests through their stages, upload reports'],
        ['Pharmacy staff', 'one facility', 'keep medicine stock true for patients'],
        ['Hospital administrator', 'one hospital', 'everything at the hospital: figures, reports, staff, settings, import'],
        ['Platform administrator', 'all organisations', 'onboarding, review, verification, modules — never a patient\'s data'],
        ['Government viewer', 'national aggregates', 'read-only dashboards; can never reach a row that identifies a patient'],
      ],
      ['Role', 'Scope', 'Can'],
    ) + '<div class="box"><b>Every person has their own account.</b> Shared counter logins are not possible by design: every action records who did it. A person can hold several roles (a doctor who is also an administrator). Every time staff open an identifiable patient record, an audit entry is written.</div>',
  },
  {
    type: 'chapter',
    num: 'A3',
    title: 'A day in the life',
    lead: 'Follow one visit from booking to report. Each step is a screen you will see in the tour that follows.',
    html: flow([
      ['Book', ['from home, in Bangla,', 'no account needed']],
      ['Follow', ['live serial: when', 'to leave home']],
      ['Arrive', ['check-in at the counter;', 'walk-ins get a slip'], '#0f9f95'],
      ['Called', ['reception taps next;', 'every screen updates'], '#0f9f95'],
      ['Consult', ['history open; write,', 'prescribe, order tests'], '#7c3aed'],
      ['Records', ['visit and report', 'in the patient\'s wallet'], '#c2410c'],
    ]) + `
<div class="ch-body" style="margin-top:4px">
<p><b>07:30</b> — Rahela's son books her a serial with Dr Ayesha at Shapla General for the evening chamber. He gets serial 18 and a link.</p>
<p><b>17:20</b> — The doctor arrives late. Reception records it; Rahela's phone already shows the new estimate. She stays home.</p>
<p><b>18:40</b> — Her phone says it is time to leave. At the counter Nazma checks her in with one tap.</p>
<p><b>19:05</b> — A patient ahead is late; Nazma marks them late and they go back three places instead of losing their turn.</p>
<p><b>19:30</b> — Rahela is called. Dr Ayesha sees her last two visits at this hospital, writes the diagnosis, prescribes, orders a blood test and presses <i>Sign &amp; Next</i>.</p>
<p><b>Next day</b> — The lab uploads the report. It appears in Rahela's records, and the doctor sees it at the follow-up.</p>
<p><b>Meanwhile</b> — A burn case in the city: a family opens Emergency, sees which hospitals have a burn unit and space right now, taps “I’m on my way”, and the emergency room is warned before they arrive.</p>
</div>`,
  },
  {
    type: 'chapter',
    num: 'A4',
    title: 'Principles you will notice on every screen',
    lead: 'These rules settle design arguments, in this order. Once you know them, every screen in the tour makes sense.',
    html: `
<div class="cards">
<div class="card"><h3>1 · Live beats listed</h3>If a number can be live, it is live. If it cannot, it shows its age: “Updated 9 min ago”.</div>
<div class="card"><h3>2 · Honest when unsure</h3>No invented availability. If the system does not know, it says “not known” or “may be out of date”. A wrong “bed available” can kill someone.</div>
<div class="card"><h3>3 · Designed for the 60-year-old</h3>One question per screen, large buttons, plain Bangla, no jargon — so the 25-year-old coasts.</div>
<div class="card"><h3>4 · Staff speed is sacred</h3>Anything slower than the paper notebook is a bug. Keyboard shortcuts at the counter: N next, A doctor arrived, P pause, W walk-in.</div>
<div class="card"><h3>5 · Every number has a visible consequence</h3>Staff see where their data appears publicly. That is why they keep it true.</div>
<div class="card"><h3>6 · Bangla is the product</h3>Bangla by default, with Bangla digits; English is a toggle on every screen.</div>
<div class="card"><h3>7 · Emergency never gates</h3>No login, payment or form between a person and emergency information.</div>
<div class="card"><h3>8 · The patient owns their records</h3>Hospitals hold data; patients carry it, and decide who else may see it.</div>
<div class="card"><h3>And: it keeps working offline</h3>Counters, wards and the ER keep working when the internet drops, show that they are offline, and catch up exactly once when it returns.</div>
</div>`,
  },
];
