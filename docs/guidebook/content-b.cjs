// Part B — for engineers joining the project.
const T = (rows, head) =>
  `<table>${head ? `<tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>` : ''}${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;

const box = (x, y, w, h, label, sub, fill = '#eef4fd', stroke = '#0b5ed7') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/><text x="${x + w / 2}" y="${y + (sub ? h / 2 - 3 : h / 2 + 5)}" text-anchor="middle" font-size="14" font-weight="700" fill="#0f1f3d">${label}</text>${sub ? `<text x="${x + w / 2}" y="${y + h / 2 + 14}" text-anchor="middle" font-size="11" fill="#45597a">${sub}</text>` : ''}`;
const arrow = (x1, y1, x2, y2, label, dy = -6) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#f05a1f" stroke-width="2" marker-end="url(#a)"/>${label ? `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 + dy}" text-anchor="middle" font-size="10.5" fill="#a33a10" font-weight="600">${label}</text>` : ''}`;
const svg = (w, h, inner) =>
  `<div class="diagram"><svg viewBox="0 0 ${w} ${h}" font-family="Anek Bangla, Segoe UI, Arial"><defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#f05a1f"/></marker></defs>${inner}</svg></div>`;

const ARCH = svg(
  1000,
  420,
  [
    box(20, 20, 210, 70, 'Patient app (PWA)', 'Next.js 16 · phones · Bangla first', '#e9f7f5', '#0f9f95'),
    box(20, 110, 210, 70, 'Staff console', 'Next.js 16 · counters, wards, ER…', '#e9f7f5', '#0f9f95'),
    box(20, 200, 210, 70, 'Hospital portals', 'the patient app at a hospital name', '#e9f7f5', '#0f9f95'),
    box(20, 290, 210, 70, 'Company site', 'Next.js static export', '#f4f6fa', '#8d9db5'),
    box(330, 80, 260, 120, 'API (backend/api)', 'Express 5 · Zod · Kysely · jose', '#eef4fd', '#0b5ed7'),
    box(330, 230, 260, 70, 'Realtime (Socket.IO)', 'rooms per chamber and hospital', '#eef4fd', '#0b5ed7'),
    box(330, 320, 260, 70, 'Timers in the API process', 'schedules · sender · offers · payments', '#eef4fd', '#0b5ed7'),
    box(700, 60, 270, 100, 'PostgreSQL 16 + PostGIS', '63 tables · row-level security on all', '#fff4dc', '#d99a00'),
    box(700, 190, 270, 70, 'File storage', 'lab reports, documents, logos (signed URLs)', '#fff4dc', '#d99a00'),
    box(700, 290, 270, 90, 'Adapters', 'SMS · bKash · Nagad · push · travel time · mapping', '#fde8e4', '#c2410c'),
    box(395, 6, 130, 40, 'shared/domain', 'one queue reducer', '#f3e8ff', '#7c3aed'),
    arrow(230, 55, 330, 120, 'HTTPS /api/v1'),
    arrow(230, 145, 330, 140, ''),
    arrow(230, 235, 330, 160, ''),
    arrow(230, 150, 330, 255, 'WebSocket', 12),
    arrow(590, 120, 700, 110, 'SQL (scoped)'),
    arrow(590, 170, 700, 220, 'files'),
    arrow(590, 350, 700, 335, 'provider calls'),
    arrow(460, 46, 460, 80, ''),
  ].join(''),
);

const QUEUE = svg(
  1000,
  250,
  [
    box(10, 80, 150, 70, 'Tap “next”', 'reception console'),
    box(200, 80, 160, 70, 'appendEvent()', 'queue.service'),
    box(400, 20, 170, 60, 'Lock the chamber', 'SELECT … FOR UPDATE'),
    box(400, 95, 170, 60, 'Append the event', 'queue_events (seq)'),
    box(400, 170, 170, 60, 'Reduce', 'reducer(state, event)'),
    box(610, 20, 170, 60, 'Estimates', 'eta.ts, ±band'),
    box(610, 95, 170, 60, 'Persist + audit', 'queue_state, audit_log'),
    box(610, 170, 170, 60, 'Plan messages', 'notifications (same txn)'),
    box(820, 60, 170, 60, 'Commit', 'then broadcast', '#e6f6ee', '#1f9d55'),
    box(820, 140, 170, 70, 'Every screen', 'staff + patients’ copy ≤ 2 s', '#e6f6ee', '#1f9d55'),
    arrow(160, 115, 200, 115, ''),
    arrow(360, 105, 400, 50, ''),
    arrow(360, 115, 400, 125, ''),
    arrow(360, 125, 400, 200, ''),
    arrow(570, 50, 610, 50, ''),
    arrow(570, 125, 610, 125, ''),
    arrow(570, 200, 610, 200, ''),
    arrow(780, 90, 820, 90, ''),
    arrow(905, 120, 905, 140, ''),
  ].join(''),
);

const DEPLOY_SVG = svg(
  1000,
  300,
  [
    box(20, 110, 150, 70, 'Internet', 'phones, counter PCs', '#f4f6fa', '#8d9db5'),
    box(220, 100, 170, 90, 'web (Caddy 2)', 'HTTPS, certificates, ports 80/443', '#e9f7f5', '#0f9f95'),
    box(440, 20, 160, 56, 'patient', 'next start :3000'),
    box(440, 90, 160, 56, 'console', 'next start :3100'),
    box(440, 160, 160, 56, 'api', 'node :4000 + socket'),
    box(440, 230, 160, 56, 'watchdog', '/readyz → Telegram/ntfy'),
    box(650, 120, 160, 70, 'db', 'postgis 16-3.4 (internal only)', '#fff4dc', '#d99a00'),
    box(650, 220, 160, 60, 'backup', 'nightly, verified, encrypted', '#fff4dc', '#d99a00'),
    box(650, 30, 160, 60, 'migrate', 'runs once at start'),
    box(850, 210, 140, 70, 'Second disk', 'encrypted copies', '#fde8e4', '#c2410c'),
    arrow(170, 145, 220, 145, ''),
    arrow(390, 130, 440, 48, ''),
    arrow(390, 140, 440, 118, ''),
    arrow(390, 150, 440, 188, ''),
    arrow(600, 188, 650, 160, ''),
    arrow(730, 90, 730, 120, ''),
    arrow(730, 190, 730, 220, ''),
    arrow(810, 250, 850, 245, ''),
    arrow(520, 258, 600, 200, '', 0),
  ].join(''),
);

const GIT = svg(
  1000,
  170,
  [
    '<line x1="40" y1="40" x2="960" y2="40" stroke="#0a3f8f" stroke-width="4"/><text x="30" y="30" font-size="13" font-weight="700" fill="#0a3f8f">main — releases only</text>',
    '<line x1="40" y1="100" x2="960" y2="100" stroke="#0b5ed7" stroke-width="4"/><text x="30" y="90" font-size="13" font-weight="700" fill="#0b5ed7">mvp — integration</text>',
    '<path d="M180 100 C 220 150, 260 150, 300 150 L 380 150 C 420 150, 440 120, 460 100" stroke="#0f9f95" stroke-width="3" fill="none"/><text x="250" y="165" font-size="12" fill="#0f9f95">feat/… (one step)</text>',
    '<path d="M560 100 C 590 150, 620 150, 650 150 L 700 150 C 730 150, 750 120, 760 100" stroke="#c2410c" stroke-width="3" fill="none"/><text x="610" y="165" font-size="12" fill="#c2410c">fix/…</text>',
    '<path d="M860 100 C 880 70, 890 60, 900 40" stroke="#0a3f8f" stroke-width="3" fill="none" stroke-dasharray="6 4"/><text x="800" y="70" font-size="12" fill="#0a3f8f">release (gate green)</text>',
    '<circle cx="460" cy="100" r="7" fill="#0f9f95"/><circle cx="760" cy="100" r="7" fill="#c2410c"/><circle cx="900" cy="40" r="7" fill="#0a3f8f"/>',
  ].join(''),
);

module.exports = [
  {
    type: 'part',
    letter: 'B',
    title: 'For engineers',
    lead: 'How MedLiveBD is built, why it is built that way, and how to work on it without breaking what matters. Read Part A first if you have not used the product: every rule below exists to protect something you saw there.',
    html: '<div class="who"><div><b>You are</b><br>a developer, tester or operations engineer joining the project.</div><div><b>You will learn</b><br>the architecture, the code layout, the queue engine, the database and its security, the API, the apps, deployment, the workflow and the tests.</div><div><b>Source of truth</b><br>Five documents in <code>docs/</code> govern behaviour. If code and a document disagree, the document wins.</div></div>',
  },
  {
    type: 'chapter',
    num: 'B1',
    title: 'The system at a glance',
    lead: 'Three browser apps, one API, one PostgreSQL database, one realtime channel, and a small set of adapters to the outside world. Everything is TypeScript in one monorepo.',
    html: ARCH,
  },
  {
    type: 'text',
    crumb: 'B1 · The system at a glance',
    title: 'What each part does',
    html: `
<h3>The apps (frontend/)</h3>
<ul>
<li><b>Patient app</b> (<code>frontend/patient</code>): an installable web app (PWA) for phones. Search, book, follow the live serial, emergency, beds, medicines, records. Works without an account; a phone number proves who you are.</li>
<li><b>Staff console</b> (<code>frontend/console</code>): one web app with a workspace per role: reception, registration desk, doctor, ward, emergency, lab, pharmacy, administration, settings, import, platform onboarding and the national dashboard. Offline-first for queue, ward and ER.</li>
<li><b>Hospital portals</b>: the patient app served at <code>&lt;code&gt;.&lt;platform domain&gt;</code> or a hospital's own domain, in its colours and limited to it — except emergency search, which stays network-wide.</li>
<li><b>Company site</b> (<code>frontend/site</code>): the public marketing site, a static export.</li>
</ul>
<h3>The server (backend/)</h3>
<ul>
<li><b>API</b> (<code>backend/api</code>): Express 5 under <code>/api/v1</code>, 194 routes, Zod validation, JWT auth, Kysely SQL, Socket.IO realtime, and the timed jobs (session materialisation, notification sender, offer lapses, payment holds) on intervals inside the same process.</li>
<li><b>workers</b> (<code>backend/workers</code>): reserved for queue-backed jobs (pg-boss) when load demands; today the timers run in the API and are idempotent.</li>
</ul>
<h3>The shared code (shared/)</h3>
<ul>
<li><b>domain</b>: the queue reducer, ETA maths, rules, bed and ER state machines, Zod schemas, money/phone/time helpers. No I/O. Imported unchanged by the API and the console — the single reason the two can never disagree about a queue.</li>
<li><b>client</b>: typed API calls, the realtime client with reconnect, the offline outbox (Dexie/IndexedDB).</li>
<li><b>ui</b>: the design system (tokens, components, locale store, accessibility helpers).</li>
<li><b>i18n</b>: every message in Bangla and English, number and date formatters.</li>
<li><b>config</b>: shared ESLint (including the layering rule), TypeScript and Tailwind presets.</li>
</ul>
<h3>The data (database/)</h3>
<p>SQL migrations <code>0001</code>–<code>0063</code>, seeds that build a believable week of demonstration data for six invented hospitals, and scripts: migrate, verify, reset, and the API role.</p>
<div class="box"><b>One rule to remember.</b> The queue is an append-only log of events. Its state is never edited — it is computed by one function, in one place, from the log.</div>`,
  },
  {
    type: 'chapter',
    num: 'B2',
    title: 'Repository tour',
    lead: 'The repository is divided by where code runs: frontend/ runs in a browser, backend/ on a server, shared/ in both, database/ holds the schema. A lint rule enforces the boundaries.',
    html: `<pre>/
├── frontend/              everything that runs in a browser  → docs/FRONTEND.md
│   ├── patient/           Next.js PWA (patients and families)
│   ├── console/           Next.js staff console (every role)
│   └── site/              Next.js company site (static export)
├── backend/               everything that runs on a server   → docs/BACKEND.md
│   ├── api/               Express HTTP + Socket.IO + timed jobs
│   └── workers/           reserved for queue-backed jobs
├── shared/                imported by both sides
│   ├── domain/            types, queue reducer, ETA, rules, schemas (no I/O)
│   ├── client/            typed API + realtime client + offline outbox
│   ├── ui/                design system, tokens, locale store
│   ├── i18n/              messages (bn + en) and formatters
│   └── config/            eslint (layering), tsconfig, tailwind preset
├── database/              migrations, seeds, scripts           → docs/DATABASE.md
├── deploy/                docker compose, Caddyfile, setup.sh, backup, watchdog
├── e2e/                   Playwright suites (dev, built, production)
└── docs/                  PRD, APP_FLOW, FRONTEND, DATABASE, BACKEND, DEPLOY, STATUS</pre>
<div class="box teal"><b>Layering (lint-enforced).</b> <code>routes → controllers → services → repositories → db</code>. SQL lives only in repositories. Events and notifications are written only in services. <code>frontend/</code> may not import <code>backend/</code> or <code>database/</code>; <code>shared/domain</code> imports nothing.</div>`,
  },
  {
    type: 'text',
    crumb: 'B2 · Repository tour',
    title: 'Inside the API, file by file',
    html: `
<pre>backend/api/src/
├── app.ts          the middleware chain (read it top to bottom)
├── server.ts       process lifecycle, realtime, timers
├── env.ts          every setting, validated; production refusals
├── config/         db + scope, jwt, password, totp, logger, storage keys
├── middleware/     auth, guestAuth, requireRole, rateLimit, idempotency,
│                   validate, cors, securityHeaders, modules, error
├── routes/         25 route files (thin: guards + validate + controller)
├── controllers/    request → service call → response envelope
├── services/       the rules: queue, booking, clinical, beds, emergency,
│                   referral, lab, pharmacy, payment, notification,
│                   import, platform, gov, staffAuth, patientAuth …
├── repositories/   SQL only (Kysely + tagged sql)
├── realtime/       server, auth (handshake), rooms, handlers, emit
├── adapters/       sms, smsHttp, push, payments (bkash, nagad),
│                   storage, traveltime, mapping
├── errors/         AppError + the code table (codes.ts)
└── scripts/        createStaff, resetTwoFactor, tryMapping, verifyDoctor</pre>
<h3>The middleware chain, in order</h3>
<ol>
<li><b>trust proxy</b> — <code>req.ip</code> is the caller behind Caddy or Render, so limits are per person.</li>
<li><b>requestLog</b> — a request id every log line and audit row carries.</li>
<li><b>securityHeaders</b> — nosniff, frame denial, CSP, referrer and permissions policies, HSTS over HTTPS.</li>
<li><b>cors</b> — only the configured app origins and recorded hospital portals.</li>
<li><b>body parsing</b> — 256 KB limit; the report, import, logo and document routes parse their own larger bodies.</li>
<li><b>attachPrincipal</b> — a valid access token becomes <code>req.principal</code>; a broken one is refused, never downgraded.</li>
<li><b>attachGuestFromLink</b> — a tracking link becomes a guest principal for one booking.</li>
<li><b>anonymousCeiling</b> — a per-address ceiling on what is asked without an account.</li>
<li><b>database scope</b> — the principal decides the scope every SQL statement runs under (see B8).</li>
<li><b>moduleGate</b> — staff reach only the modules their hospital runs.</li>
<li><b>idempotency</b> — validates <code>Idempotency-Key</code>; money and queue routes require it.</li>
<li><b>routes</b> — each with its own <code>requireAuth</code> / <code>requireRole</code>.</li>
<li><b>notFound</b> and <b>errorHandler</b> — the only place anything becomes a response.</li>
</ol>`,
  },
  {
    type: 'chapter',
    num: 'B3',
    title: 'Technology',
    lead: 'Boring, well-understood tools, chosen so that a small team can run the system on one server in Bangladesh and grow it later without rewriting it.',
    html: T(
      [
        ['Runtime', 'Node.js 24 (22.19 minimum), TypeScript strict, pnpm 12 workspaces'],
        ['Web apps', 'Next.js 16.4, React 19, Tailwind via shared preset, Radix dialog and toast'],
        ['API', 'Express 5.3, Zod 4 (schemas shared with the apps), jose (JWT), pino logging'],
        ['Database', 'PostgreSQL 16 + PostGIS 3.4; Kysely query builder; tagged SQL in repositories'],
        ['Realtime', 'Socket.IO 4.8 (rooms per chamber and per hospital), auto-reconnect'],
        ['Offline', 'Dexie 4 over IndexedDB: one outbox per signed-in person per device'],
        ['Security', 'scrypt passwords (node:crypto, N=2^17), TOTP two-step, AES-256-GCM sealed secrets, row-level security'],
        ['Charts / QR / Excel', 'Recharts (reports), qrcode (2FA and token slip), read-excel-file (in the browser)'],
        ['Tests', 'Vitest + Supertest (176 files, 8,182 tests), Playwright (348 dev, 3 built, 85 production)'],
        ['Hosting', 'Self-hosted: Docker Compose + Caddy on a Bangladeshi server. Demonstration: Render (API), Vercel (apps), Supabase (database)'],
      ],
      ['Concern', 'Choice'],
    ) + '<div class="box warn"><b>No new dependency without asking.</b> The project deliberately has very few packages: the API has eleven direct dependencies. A new one needs the owner\'s agreement (CLAUDE.md §7).</div>',
  },
  {
    type: 'chapter',
    num: 'B4',
    title: 'The live queue engine',
    lead: 'The heart of the product. A chamber\'s queue is an append-only log of events; its state is the result of folding those events through one pure function. Every screen, phone and report reads that same state.',
    html: QUEUE,
  },
  {
    type: 'text',
    crumb: 'B4 · The live queue engine',
    title: 'Events, the reducer and replay',
    html: `
<h3>Events</h3>
<p>Every change to a queue is a row in <code>queue_events</code>: session, type, booking, actor (who and in what role), server time, client time, payload, and a per-session sequence number. Events are never updated or deleted — the API role has no DELETE on the table.</p>
${T(
  [
    ['SESSION_OPENED / SESSION_ENDED', 'the chamber opens and closes'],
    ['DOCTOR_ARRIVED / DELAY_DECLARED', 'arrival time, minutes late; a delay before or after arrival'],
    ['SESSION_PAUSED / SESSION_RESUMED', 'a break: nobody is called or marked absent'],
    ['PATIENT_CALLED / PATIENT_DONE', '“next” is usually both, in one write'],
    ['PATIENT_LATE / PATIENT_NO_SHOW / PATIENT_REINSERTED', 'late patients are re-inserted after k, never dropped'],
    ['PATIENT_ARRIVED', 'checked in at the counter'],
    ['WALKIN_ADDED / BOOKING_CANCELLED', 'roster changes'],
    ['SLOT_OFFERED / SLOT_ACCEPTED', 'a freed chair offered to standby'],
    ['PRIORITY_REORDERED', 'with a reason, by reception'],
    ['ACTION_UNDONE', 'pairs with the original; the reducer treats the pair as nothing'],
  ],
  ['Event', 'Meaning'],
)}
<h3>The reducer</h3>
<p><code>shared/domain/src/queue/reducer.ts</code> is <code>(state, event) =&gt; state</code>. It is the only code that knows what an event does to a queue. The API uses it to persist <code>queue_state</code>; the console uses the same function to draw its optimistic screen and to replay its offline outbox. <code>replay.ts</code> folds a whole log, which is how a disputed queue is reconstructed exactly (<code>FR-QUE-05</code>).</p>
<h3>Rules and estimates</h3>
<ul>
<li><code>rules.ts</code>: you cannot call next while one is in the chamber unmarked; no no-show before the grace period (2 patients or 15 minutes); a late patient goes back after 3; reordering needs a reason; nothing moves while paused.</li>
<li><code>rate.ts</code> + <code>eta.ts</code>: a rolling consultation rate, weighted toward recent patients, gives every waiting serial a time and a confidence band (“around 9:08 PM, ±7 min”). Recalculated after every event, under 500 ms for 100 patients.</li>
<li>A patient's estimate never moves earlier than what they were told without a message first (<code>FR-QUE-15</code>).</li>
</ul>`,
  },
  {
    type: 'text',
    crumb: 'B4 · The live queue engine',
    title: 'appendEvent: the one function every queue change goes through',
    html: `
<p><code>services/queue.service.ts</code> is the single entry point for every queue mutation. Routes, the sync endpoint, the doctor's sign-and-next and the timers are thin callers.</p>
<ol>
<li><b>Idempotency</b> — an event whose <code>clientEventId</code> is already in the log returns the stored result. Offline replay is therefore safe.</li>
<li><b>Authorise</b> — staff must belong to the chamber's hospital (and the database checks again); a patient may only mark their own booking late or cancel it.</li>
<li><b>Serialise</b> — <code>SELECT … FOR UPDATE</code> on the session row, so two counters pressing next at once produce one call and one “the queue moved”.</li>
<li><b>Validate</b> — the domain rules above.</li>
<li><b>Append</b> — the next <code>seq</code>; the server's clock is authoritative.</li>
<li><b>Reduce and persist</b> — <code>queue_state</code>, booking status, the doctor's average consultation time.</li>
<li><b>Estimate</b> — ETAs for everyone waiting.</li>
<li><b>Plan messages</b> — notifications (called, delayed, two away, slot offered) written in the same transaction, through the same connection (a read that went back to the pool inside the lock once starved it).</li>
<li><b>Audit</b> — <code>audit_log</code> with actor and event.</li>
<li><b>Commit, then broadcast</b> — <code>queue.updated</code> to the staff room and the patients' copy to the patients' room, never from inside the transaction.</li>
</ol>
<div class="box"><b>Undo</b> appends <code>ACTION_UNDONE</code> referencing the original; only the original actor, within 10 seconds. History is never deleted. A console undoing an action it has not sent yet simply drops it from its outbox.</div>
<div class="box teal"><b>Delays and pauses.</b> A delay declared before the doctor arrives moves the expected start; after arrival it holds the chamber for its minutes. While paused, nobody is called or marked absent, and the no-show grace restarts on resume.</div>
<div class="box ok"><b>The promise it keeps.</b> A reception tap reaches every waiting phone in under two seconds (<code>NFR-01</code>). The two-device Playwright test — the canary — proves it on every release and may never be skipped.</div>`,
  },
  {
    type: 'chapter',
    num: 'B5',
    title: 'Realtime',
    lead: 'Socket.IO rooms map one-to-one onto the things people watch: a chamber, a hospital\'s beds, its emergency room, its lab, its dashboard, a patient. The server decides which room a socket may join; the client never chooses.',
    html: T(
      [
        ['session:&lt;id&gt;:staff', 'reception, doctor', 'queue.updated (with applied), session.delayed, session.ended'],
        ['session:&lt;id&gt;', 'patients holding a booking or link', 'the patients\' copy of queue.updated, delays, end, patient.called'],
        ['hospital:&lt;id&gt;:beds', 'ward, ER, admin', 'bed.updated (no patient identity), capacity.updated, bedrequest.updated'],
        ['hospital:&lt;id&gt;:emergency', 'ER console', 'emergency.inbound / updated, capabilities.updated, referral.incoming / updated'],
        ['hospital:&lt;id&gt;:lab', 'lab console', 'test.ordered, test.updated'],
        ['hospital:&lt;id&gt;:admin', 'admin dashboard', 'metrics.tick (throttled)'],
        ['patient:&lt;id&gt;', 'that patient\'s devices', 'record.ready, booking.updated, offer.received'],
      ],
      ['Room', 'Who joins', 'Events'],
    ) +
      `<div class="cards two"><div class="card"><h3>The patients' copy</h3>A phone is sent the same queue as reception with nothing that names a person: every booking id becomes a ticket (an HMAC that means nothing elsewhere), patient ids are blanked, reasons reception typed are left out. A phone finds its own row by its own ticket.</div><div class="card"><h3>Access does not outlive itself</h3>Revoking a staff member closes their sockets at once in this process, within a minute from elsewhere (a sweep), and a revoked token is refused at the handshake. Envelope: <code>{ type, seq, serverTs, data }</code>; a resume replays missed events to staff only.</div></div>`,
  },
  {
    type: 'chapter',
    num: 'B6',
    title: 'Offline consoles and sync',
    lead: 'Counters, wards and emergency rooms lose the internet several times a day. Their consoles keep working: actions are drawn at once, queued on the device, and sent when the connection returns — exactly once, in order.',
    html: `${T(
      [
        ['POST /sync/events', 'a batch of locally queued events, each with clientEventId and clientTs'],
        ['GET /sync/session/:id?sinceSeq=', 'what the device missed while offline'],
      ],
      ['Endpoint', 'Purpose'],
    )}
<ul>
<li><b>SY-01</b> The server orders; client times only order a batch within itself. The one time taken from a console is when the doctor walked in, bounded.</li>
<li><b>SY-02</b> Every event is idempotent by its clientEventId: a replayed batch is safe.</li>
<li><b>SY-03</b> Conflicts (two counters calling different patients) resolve by arrival; the loser gets a conflict entry and rolls that row back.</li>
<li><b>SY-04</b> Bookings made online meanwhile appear as new arrivals, never dropped.</li>
<li><b>SY-06</b> A device offline more than 24 hours re-pulls the whole session.</li>
<li><b>SY-07</b> Only counter actions travel offline, each from a role its own route admits; walk-ins, undo, end, offers have their own routes.</li>
<li><b>SY-08</b> One action is shown once: the answer and the broadcast both name it by its key, and the console removes its optimistic drawing at whichever arrives first. Decided by <code>seq</code>, never by arrival.</li>
<li><b>SY-09</b> Beds and ER cases carry a <code>version</code> raised by a trigger; consoles keep the highest.</li>
</ul>
<div class="box">The outbox lives in IndexedDB, one database per signed-in person per device, so a shift change on a shared PC never sends one person's actions as another's. The console shell is cached, so it even opens with no network.</div>`,
  },
  {
    type: 'chapter',
    num: 'B7',
    title: 'The data model',
    lead: '63 tables, 30 enums, 9 views and one materialised view, all created by numbered SQL migrations. Every table has row-level security switched on.',
    html: T(
      [
        ['Organisations', 'hospitals, hospital_settings, hospital_logos, departments, doctors, doctor_hospitals, capabilities, wards, beds, reception_desks (+ _doctors, _staff), subscriptions*'],
        ['People', 'users, patients, guest_identities, guest_links, staff_users, staff_roles, sessions_auth, otp_challenges, device_tokens'],
        ['Chambers and queue', 'session_templates, sessions, bookings, queue_events, queue_state, standby_list, slot_offers, counter_shifts, sync_cursors'],
        ['Clinical', 'visits, prescriptions, prescription_items, test_orders, reports, consents, patient_documents, medicines, pharmacy_stock'],
        ['Beds and emergency', 'admissions, bed_events, bed_requests, emergency_cases, referrals, ambulances*, ambulance_requests*, blood_donors*, blood_requests*'],
        ['Money', 'payments, payment_events, invoices'],
        ['Messages', 'notifications, notification_templates, feedback'],
        ['Import', 'import_batches, import_rows, import_mapping_profiles, external_refs'],
        ['Operations', 'audit_log, backup_runs, analytics_refresh, schema_migrations'],
      ],
      ['Group', 'Tables'],
    ) + '<p style="font-size:10.5px;color:#5b6b82">* present in the schema for later phases; not used by V1 screens.</p>',
  },
  {
    type: 'text',
    crumb: 'B7 · The data model',
    title: 'Conventions every table follows',
    html: `
<div class="cards two">
<div class="card"><h3>Time</h3>Timestamps are UTC (<code>timestamptz</code>) in the database; the apps show Dhaka time. A session keeps its service date — the Dhaka date of its planned start — even past midnight.</div>
<div class="card"><h3>Money</h3>Integer poisha, never floats. ৳500 is <code>50000</code>. Fees are itemised: the hospital's fee and the platform's are separate lines.</div>
<div class="card"><h3>Phones</h3>Normalised to <code>+8801…</code> at the edge (<code>shared/domain/util/phone.ts</code>); people type 017… and it is accepted.</div>
<div class="card"><h3>Ids</h3>UUIDs (time-ordered), branded in TypeScript (<code>SessionId</code>, <code>BookingId</code>) so they cannot be mixed up.</div>
<div class="card"><h3>Soft deletion</h3>Rows carry <code>deleted_at</code>; history and audit survive. Queue events cannot be deleted at all.</div>
<div class="card"><h3>Versions</h3>Beds and ER cases have a <code>version</code> raised by trigger on every change, used by consoles to keep the newest statement.</div>
</div>
<h3>Migrations</h3>
<p>Plain SQL files <code>database/migrations/0001_…</code> to <code>0063_desk_staff.sql</code>, applied in order by <code>pnpm db:migrate</code> and recorded in <code>schema_migrations</code>. A migration is never edited after it has shipped; a change is a new migration. <code>pnpm db:verify</code> checks schema invariants (every table has RLS and a policy, enum mirrors match <code>shared/domain</code>).</p>
<h3>Views</h3>
<p>Public figures are read through views that expose counts, never rows: <code>v_public_hospital_capacity</code> (free beds by type with their age), chamber counts (<code>fn_chamber_counts</code>), the national aggregates the government viewer reads (role <code>gov_reader</code>), and the admin daily snapshot (<code>v_admin_daily</code>, refreshed).</p>
<h3>Seeds</h3>
<p><code>database/seeds</code> builds six invented hospitals, forty doctors, a week of chambers, a mid-queue session running now, patients, visits, beds, ER cases, referrals, lab orders, payments and signals. Every row is labelled demonstration data. <code>pnpm db:reset</code> truncates and reseeds (refused against a remote database unless explicitly allowed).</p>`,
  },
  {
    type: 'chapter',
    num: 'B8',
    title: 'Keeping hospitals apart: scope and row-level security',
    lead: 'The application checks who may do what. The database checks again. Every connection the API takes from its pool first states whose request it is serving, and policies on every table answer accordingly.',
    html: T(
      [
        ['hospital', 'a member of staff', 'their hospital\'s rows; another hospital\'s rows do not exist for them'],
        ['national', 'a platform administrator', 'organisations, never anything about a person'],
        ['patient', 'a signed-in account', 'its own profiles, visits, reports, bookings, payments, messages'],
        ['guest', 'a tracking link', 'the one booking it names and what was written at it'],
        ['open', 'nobody', 'what hospitals publish; no clinical or personal row'],
        ['system', 'the server\'s own work', 'jobs and operator commands'],
        ['(unset)', 'any other connection', 'nothing at all'],
      ],
      ['Scope', 'Who', 'Sees'],
    ) +
      `<div class="box"><b>How it works.</b> <code>config/dbScope.ts</code> runs each request inside an AsyncLocalStorage scope taken from its principal. <code>config/db.ts</code> sets <code>app.scope</code>, <code>app.hospital_id</code>, <code>app.person_id</code> and <code>app.booking_id</code> on the connection before any statement. Policies (migrations 0043, 0044, 0056) read them. The API connects as a role with <b>no BYPASSRLS, no superuser, no DDL</b> — created by <code>pnpm db:role</code>.</div><div class="box teal"><b>What crosses between hospitals is named and nothing else:</b> what a hospital publishes; a referral, to both ends; a visit, under the patient's live consent; whether a hospital runs an emergency desk. <code>database/tests/tenancy.test.ts</code> proves each, and that no table is left without a policy.</div>`,
  },
  {
    type: 'chapter',
    num: 'B9',
    title: 'The HTTP API',
    lead: '194 routes under /api/v1, grouped by domain. Every route declares its guard explicitly; a public route is public because it says nothing, never because a check was forgotten.',
    html: T(
      [
        ['Discovery (public)', 'config, search, hospitals, hospital detail/logo/doctors, doctors, sessions, availability'],
        ['Patient identity', 'auth/otp, auth/verify, auth/refresh, auth/logout, guest/start, guest/verify, me/profiles'],
        ['Booking', 'POST bookings, GET bookings/:id, cancel, me/bookings, me/bookings/:id/link'],
        ['Queue (console)', 'sessions/:id/queue, arrived, delay, pause, resume, end, next, walkin, reorder; bookings/:id/done, late, no-show, reinstate, check-in, slip, offer-slot; offers/:id/accept; events/:id/undo; sync/events, sync/session/:id'],
        ['Standby', 'sessions/:id/standby (join), standby/:token, accept, decline, leave'],
        ['Clinical', 'visits, visits/booking/:id, formulary, patients/:id/records, consents, consent offers, me/documents'],
        ['Beds', 'beds/:id + admit, discharge, transfer, reserve, release, clean, out of service, forecast; bed-requests'],
        ['Emergency + referral', 'emergency/search, inbound, track, cases; referrals + seen, accept, decline, cancel, arrive'],
        ['Lab + pharmacy', 'test-orders, state, report upload, patient label, files/:key (signed), pharmacy stock, medicines'],
        ['Administration', 'admin/dashboard, overview, export; payments history, refund; hospital/* settings, staff, desks, imports'],
        ['Platform + national', 'platform/hospitals (+ approve, send back, suspend, reinstate, close, verify doctor, domain, modules, agreement); hospital-applications; gov/capacity, er-load, signals, benchmarks'],
        ['Staff identity', 'staff/login, refresh, logout, me, password, 2fa, 2fa/setup, 2fa/enable, chambers'],
        ['Infrastructure', 'healthz, readyz, demo/* (demonstration only), mock-pay/* (mock provider only), webhooks/bkash, nagad, sms-dlr'],
      ],
      ['Group', 'Routes'],
    ),
  },
  {
    type: 'text',
    crumb: 'B9 · The HTTP API',
    title: 'Contracts every route keeps',
    html: `
<h3>The envelope</h3>
<pre>200  { "ok": true,  "data": { … } }
4xx  { "ok": false, "error": { "code": "QUEUE_GUARD_FAILED",
                                "message": "…", "details": { … } } }</pre>
<p>Error codes live in one table (<code>errors/codes.ts</code>) with their HTTP status. Anything unexpected becomes <code>INTERNAL</code> with nothing about it returned; the cause goes to the log, through an allowlist that never writes what a caller sent or a row's values.</p>
<h3>Validation</h3>
<p>Every body, query and path is parsed by a Zod schema from <code>shared/domain/schemas</code> — the same schema the apps use to build the request. Unknown keys are stripped; ids are UUIDs; phones are normalised.</p>
<h3>Idempotency</h3>
<p>Every write accepts an <code>Idempotency-Key</code> (16–128 characters). Booking, payment and queue routes require one. A retried booking returns the booking the first attempt made; a key reused for a different chamber or person is refused. Every queue event also carries a <code>clientEventId</code>.</p>
<h3>Rate limits (per address)</h3>
${T(
  [
    ['Anything without an account', '1,200 / minute'],
    ['Staff sign-in and two-step', '300 / 10 min, plus a per-account lock after 5 wrong tries'],
    ['Phone codes', 'per number per hour; 5 wrong codes lock the number for 15 min'],
    ['Bookings', '300 / hour'],
    ['Emergency alerts, bed requests, standby joins', '10 / 10 min each'],
    ['Hospital applications', '5 / hour'],
  ],
  ['What', 'Limit'],
)}
<p><code>ADDRESS_RATE_LIMIT_FACTOR</code> raises the address limits where a whole waiting room shares one Wi-Fi address.</p>
<h3>Files</h3>
<p>Uploads are checked by their first bytes (PDF, PNG, JPEG; WebP for logos), never by their name. Downloads are signed URLs that expire, built from keys the server made, confined to the storage folder.</p>`,
  },
  {
    type: 'chapter',
    num: 'B10',
    title: 'Identity and sign-in',
    lead: 'Staff have their own accounts (never shared counter logins); patients prove a phone number with a code; a booking without an account carries a link scoped to that one booking.',
    html: T(
      [
        ['access', 'every staff/patient request', '15 min', 'JWT_ACCESS_SECRET'],
        ['refresh', 'renewing a session', '30 days, rotated on use, reuse detected', 'JWT_REFRESH_SECRET'],
        ['staff_2fa', 'between password and code', '5 min', 'access secret, own audience'],
        ['guest (tracking link)', 'one booking\'s live serial', 'configurable days; view-only on a printed slip', 'GUEST_LINK_SECRET'],
        ['guest_device', 'a phone already proved on this device', '90 days, renewed on use', 'guest-link secret, own audience'],
        ['standby / bed_request / emergency_case', 'one row\'s status link', 'days / 24 h', 'guest-link secret, own audiences'],
        ['consent', 'a code a patient shows a doctor', 'minutes', 'guest-link secret'],
      ],
      ['Token', 'Used for', 'Lifetime', 'Signed with'],
    ) +
      `<div class="cards"><div class="card"><h3>Staff</h3>Email + password (scrypt). Five wrong tries lock the account for 15 minutes. A temporary password must be changed at first sign-in. Administrators must use an authenticator code (TOTP); anyone else may turn it on; ten recovery codes; another administrator can reset it, audited.</div><div class="card"><h3>Patients</h3>Phone + six-digit code (rate-limited, five wrong locks). Claiming: a verified number finds the bookings and imported records made under it. No password exists for patients.</div><div class="card"><h3>Demonstration</h3>With <code>DEMO_MODE=true</code> the console offers a password-less picker and codes are shown on screen. Production refuses <code>DEMO_MODE</code>, mock payments and in-memory storage at start-up.</div></div>`,
  },
  {
    type: 'chapter',
    num: 'B11',
    title: 'The web apps',
    lead: 'Two Next.js 16 apps built on one design system. They share a typed client, the queue reducer, the message catalogue and the rule that Bangla is the product and English the toggle.',
    html: `
<div class="cards"><div class="card"><h3>Design system</h3><code>shared/ui</code>: tokens for colour, type and spacing (no hex values or font names in components), Button, Input, OTP, Card, Chip, Sheet, Toast, the console frame and rail. Touch targets ≥ 44 px; WCAG AA contrast.</div>
<div class="card"><h3>Language</h3>Every string comes from <code>shared/i18n</code> in both languages; JSX holds no literals. Bangla digits in Bangla, line-height ≥ 1.65, no letter-spacing. The choice is stored as <code>platform.locale</code>.</div>
<div class="card"><h3>Four states</h3>Every screen has loading, empty, error and offline states. A live figure always renders its <code>FreshnessLine</code> (“Updated 9 min ago · This may be out of date”). Unknown is said, never invented.</div>
<div class="card"><h3>Optimistic, then true</h3>Console actions draw at once through the shared reducer and reconcile with the server's answer (SY-08). The patient app shows the server's queue only.</div>
<div class="card"><h3>Security in the page</h3>Each request gets a script nonce (<code>src/proxy.ts</code>); a strict CSP refuses any script without it. Pages are rendered per request. Staff sessions live in sessionStorage (closed with the tab).</div>
<div class="card"><h3>PWA</h3>The patient app installs, caches its shell and works on 3G; the console caches its shell to open offline. A hospital portal gets its own name, colours, icon and manifest.</div></div>
<h3>Banned patterns (FRONTEND.md §0.2)</h3>
<p>The tells of a quickly generated app never appear: indigo or violet primaries, gradient heroes and gradient text, rainbow charts; Inter/Roboto/Poppins as the brand face, Latin numerals inside Bangla sentences, fake italics or letter-spacing on Bangla; identical card grids, left-border accent strips, emoji as icons, one radius and one shadow on everything, glassmorphism, “big number + green arrow” tiles everywhere; placeholder copy, invented statistics, generic vector people. A hospital's own theme is bound by the same list. A review that finds one treats it as a bug.</p>`,
  },
  {
    type: 'chapter',
    num: 'B12',
    title: 'Adapters, messages and background work',
    lead: 'Everything outside the system sits behind an adapter with a safe stand-in, so the product runs end to end on demonstration data and switching a real provider on is a configuration change.',
    html: T(
      [
        ['SMS', 'log (records, never sends) · http (a real aggregator) · local', 'SMS_PROVIDER; templates in Bangla and English; five tries over ~20 min; quiet hours 22:00–07:00 except queue and emergency; monthly cap per hospital'],
        ['Payments', 'mock (demo only) · bKash · Nagad · off', 'PAYMENT_PROVIDER; only the provider can say a payment was made (server to server); a serial is held 15 min while it is paid'],
        ['Push', 'Web Push (VAPID)', 'for installed patient apps'],
        ['Storage', 'local disk (self-host and production) · mock (tests and demo)', 'STORAGE_PROVIDER; production refuses mock, which would lose files on restart'],
        ['Travel time', 'static matrix', 'TRAVEL_TIME_MODE; ranks emergency results'],
        ['Mapping', 'off · a model provider', 'suggests how a hospital\'s CSV columns match the template from headings only; a person confirms'],
      ],
      ['Adapter', 'Options', 'Notes'],
    ) +
      `<h3>Timers in the API process</h3>${T(
        [
          ['hourly', 'create the next seven days of chambers from weekly schedules; clear old imported rows and old message text'],
          ['sender (5 s)', 'send due notifications, retry with back-off, respect quiet hours'],
          ['offers (30 s)', 'lapse standby offers whose window closed'],
          ['payments (30 s)', 'ask providers about pending payments; release or turn to counter at the end of a hold'],
        ],
        ['Worker', 'Does'],
      )}<p>Each records a heartbeat; <code>/readyz</code> reports any that is late, the last backup, and messages overdue.</p>`,
  },
  {
    type: 'chapter',
    num: 'B13',
    title: 'Importing a hospital\'s own data',
    lead: 'A hospital brings what it already has: departments, doctors, schedules, wards and beds, staff (set A), its patient register (set B) and upcoming appointments (set C), as CSV or Excel.',
    html: `
<ol>
<li><b>Choose a set and a file.</b> Excel is opened in the administrator's browser and turned into CSV; the server never opens a spreadsheet.</li>
<li><b>Match columns.</b> Known headings match by rules (in English and Bangla, abbreviations and untidy exports included). A hospital may save its matching as a profile. Optionally a model suggests matches from <b>column headings only</b> — no patient row is ever sent to a model.</li>
<li><b>Check.</b> Every row is validated by the same schemas as the screens: errors, warnings (same person twice, odd dates, mobile numbers), and how many rows would be added or updated.</li>
<li><b>Preview and approve.</b> Nothing is written until a person approves; then it is all or nothing, in one transaction.</li>
<li><b>Re-import and undo.</b> The hospital's own identifier is kept per row (<code>external_refs</code>), so a second import updates instead of duplicating. An import can be undone while nothing has changed since (each row is fingerprinted).</li>
</ol>
<div class="box">Imported patients belong to the importing hospital (<code>FR-IMP-10</code>). When a patient later verifies their phone, they can claim the records made under it.</div>`,
  },
  {
    type: 'chapter',
    num: 'B14',
    title: 'Security model',
    lead: 'Defence in depth: validated input, explicit guards, a database that refuses what the application forgets, logs that hold no personal data, and a server that publishes only its web port.',
    html: `
<div class="cards"><div class="card"><h3>Identity</h3>Pinned HS256 with separate secrets and audiences per token kind; revocation checked on every staff request and every socket; refresh rotation with reuse detection.</div>
<div class="card"><h3>Authorisation</h3>Role on every staff route; booking scope on every patient route; hospital scope in the database (RLS) for every statement.</div>
<div class="card"><h3>Input and output</h3>Zod everywhere; parameterised SQL only; CSV exports neutralise formulas; uploads checked by magic bytes; errors return no internals.</div>
<div class="card"><h3>Browser</h3>Per-request script nonces, frame denial, strict referrer policy, CORS only to the platform's own origins.</div>
<div class="card"><h3>Logs and audit</h3>Every opening of an identifiable record writes an audit row (who, which patient, when, from where). Logs redact credentials and personal fields, and log errors through an allowlist.</div>
<div class="card"><h3>Server</h3>Only Caddy is published (80/443); the database is internal; secrets generated on the server into a 600 file; backups private, verified by restoring, and encrypted off-disk.</div></div>
<div class="box ok"><b>Checked before real patients (November 2026).</b> 84 break-in attempts against a production build — forged tokens, cross-hospital reads and writes, role escalation, SQL injection, path traversal, demo doors, CORS, password guessing, socket joins — none succeeded. The record is <code>docs/audit/security-check-2026-11-07.md</code>.</div>
<div class="box warn"><b>Optional, advised:</b> <code>STAFF_NETWORKS</code> holds staff sign-in to the hospital's own addresses at the web server, so nobody on the internet can try a staff password at all.</div>`,
  },
  {
    type: 'chapter',
    num: 'B15',
    title: 'Deployment',
    lead: 'One Docker Compose stack runs the whole platform on a server in Bangladesh. One command sets it up; one file holds its secrets.',
    html: DEPLOY_SVG,
  },
  {
    type: 'text',
    crumb: 'B15 · Deployment',
    title: 'Running a server',
    html: `
<h3>First installation</h3>
<pre>sudo bash deploy/setup.sh</pre>
<p>Installs Docker if missing, asks for the web address, the backup folder, an alert link and the two administrators, generates every secret into <code>deploy/.env</code> (mode 600), opens only SSH, 80 and 443, builds and starts the stack, waits for <code>/readyz</code>, creates the platform and hospital administrators and prints their temporary passwords once. Running it again is safe.</p>
<h3>The services</h3>
${T(
  [
    ['db', 'PostgreSQL 16 + PostGIS, not published to the network'],
    ['migrate', 'applies migrations and (re)creates the API role, then exits'],
    ['api', 'production mode, demo off, connects as the limited role'],
    ['patient, console', 'Next.js servers'],
    ['web', 'Caddy: certificates, HTTPS, optional STAFF_NETWORKS rule'],
    ['backup', 'nightly dump + files, restored into a scratch database to prove it, copied encrypted to a second disk, 14 days kept'],
    ['watchdog', 'polls /readyz; alerts to Telegram or ntfy when something needs a person, plus a daily “all well”'],
  ],
  ['Service', 'Role'],
)}
<h3>Updates</h3>
<p>Images are built elsewhere from a commit (<code>deploy/images.sh build</code>), copied as one archive with its checksum and commit, and installed on the server without building (<code>images.sh install</code>), which refuses a checkout at another commit. Downtime is under a minute; a backup comes first.</p>
<h3>Restoring</h3>
<p><code>deploy/restore.sh</code> takes a dump (decrypting a <code>.gpg</code> copy with the passphrase from <code>deploy/.env</code>) and the files archive. Keep <code>deploy/.env</code> in two safe places: without it the encrypted backups cannot be opened.</p>
<h3>The demonstration deployment</h3>
<p>The public demo runs the same code with <code>DEMO_MODE=true</code> on Render (API), Vercel (apps) and Supabase (database), refreshed daily with invented data. It is never used for real patients.</p>`,
  },
  {
    type: 'chapter',
    num: 'B16',
    title: 'How we work',
    lead: 'One step per branch, off mvp, merged back only when green, with requirement IDs in every commit. The documents decide behaviour; the code follows.',
    html: GIT,
  },
  {
    type: 'text',
    crumb: 'B16 · How we work',
    title: 'Branches, commits and the definition of done',
    html: `
<h3>Branches</h3>
<ul><li><b>main</b>: releases only; a push redeploys the public demo.</li><li><b>mvp</b>: integration; all work branches off it and merges back.</li><li><b>demo</b>: always a green commit of mvp, runnable on demo data.</li><li><b>feat/*, fix/*, chore/*</b>: one step each, short-lived, deleted after merge. Never commit straight to main, mvp or demo.</li></ul>
<h3>Commits</h3>
<pre>feat(queue): implement next-patient event chain (FR-QUE-10, FR-QUE-40)
fix(security): … (FR-SEC-08)</pre>
<p>Type (<code>feat|fix|chore|test|docs|refactor</code>), scope, plain description, and the requirement IDs it implements.</p>
<h3>Definition of done (every branch)</h3>
<ol><li>Implements the named requirements and nothing outside them.</li><li><code>pnpm typecheck</code>, <code>lint</code>, <code>format:check</code>, <code>test</code> pass.</li><li>Demo data updated so no new screen is empty.</li><li>Tests written in the same branch: unit for domain logic, an auth matrix for every new endpoint, Playwright for any user-visible flow.</li><li>Loading, empty, error and offline states exist.</li><li>Both <code>bn</code> and <code>en</code> keys exist; no hard-coded strings.</li><li>No banned pattern; every live figure shows its freshness.</li><li><code>docs/</code> updated if behaviour changed; commit messages cite IDs.</li></ol>
<h3>Code rules</h3>
<ul><li>TypeScript strict; no <code>any</code>; no <code>@ts-ignore</code> without a reason.</li><li>The queue reducer exists once, in <code>shared/domain</code>.</li><li>Tokens only in components: no hex colours, font names or spacing values.</li><li>Money is integer poisha; timestamps UTC; phones <code>+8801…</code>.</li><li>Never log patient identifiers, codes, tokens or payment references.</li><li>No new dependency without asking.</li></ul>`,
  },
  {
    type: 'text',
    crumb: 'B16 · How we work',
    title: 'Commands you will use every day',
    html: `
<pre>pnpm install
pnpm dev               # all apps          pnpm dev:api | dev:patient | dev:console
pnpm db:migrate        # apply migrations  (local database by default)
pnpm db:reset          # truncate + reseed demonstration data
pnpm db:verify         # schema invariants
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
pnpm verify            # all four above
pnpm build             # every package
pnpm test:e2e          # Playwright against dev servers
pnpm test:e2e:built    # against the console as built (offline reload)
pnpm test:e2e:prod     # production configuration, DEMO_MODE=false, limited DB role
pnpm staff:create      # a hospital's first administrator (--platform for the platform's)
pnpm mapping:try       # what a model would be sent for a CSV (headings only)</pre>
<div class="box warn"><b>Safety rails you will meet.</b> Test suites refuse any database whose name does not end in <code>_test</code>; Playwright refuses a non-local database and will not reuse servers it did not start; <code>db:migrate/seed/reset</code> refuse a remote host unless <code>ALLOW_REMOTE_DB=1</code> (and <code>ALLOW_DESTRUCTIVE_DB=1</code> to reset). Run suites from the repository root.</div>
<h3>Local set-up in ten minutes</h3>
<ol><li>Install Node 24, pnpm 12, Docker Desktop.</li><li><code>docker compose up -d</code> (local PostgreSQL + PostGIS).</li><li>Copy <code>.env.example</code> to <code>.env</code>; set a local <code>DATABASE_URL</code> and four secrets of 32+ characters.</li><li><code>pnpm install</code>, <code>DEMO_MODE=true pnpm db:migrate</code>, <code>pnpm db:reset</code>.</li><li><code>pnpm dev</code>; open <code>localhost:3000</code> (patients) and <code>localhost:3100</code> (staff).</li></ol>`,
  },
  {
    type: 'chapter',
    num: 'B17',
    title: 'Testing',
    lead: 'Tests are written with the feature, in the same branch, against seeded demonstration data. How much is run depends on what a change touches; the canary always runs when the queue or live screens are touched.',
    html: T(
      [
        ['Unit + integration', 'Vitest + Supertest', '176 files · 8,182 tests: domain logic, every route\'s auth matrix, repositories against a real PostgreSQL, tenancy policies, backups, watchdog'],
        ['Browser (dev)', 'Playwright', '348 tests: every user-visible flow, including the two-device canary, guest booking, no-show recovery, emergency burn case, offline console'],
        ['Browser (built)', 'Playwright', '3 tests that need next build (the console opening offline)'],
        ['Browser (production)', 'Playwright', '85 tests: built apps, DEMO_MODE=false, the limited database role, CSP, the pilot path'],
      ],
      ['Suite', 'Tool', 'What'],
    ) +
      `<h3>Two levels</h3>${T(
        [
          ['Focused', 'screens, navigation, copy, search UI, onboarding and mapping UI', 'typecheck, lint, format, the unit tests for what changed, the browser spec(s) for the flow'],
          ['Strict', 'queue engine, migrations, tenancy, auth, records, import writes, realtime, anything destructive', 'the above plus the API and schema suites for the area, the browser specs that stand on it, and the canary'],
          ['Release', 'a push to main', 'pnpm verify, pnpm build and every browser suite, once'],
        ],
        ['Level', 'For', 'Run'],
      )}<div class="box warn"><b>A flaky test is a bug.</b> Fix it or remove the flakiness; never retry-loop around it. The canary <code>e2e/two-device-queue.spec.ts</code> must never be skipped or marked flaky.</div>`,
  },
  {
    type: 'chapter',
    num: 'B18',
    title: 'The documents',
    lead: 'Five documents are the source of truth. They give every requirement, screen and control an ID, and code cites those IDs.',
    html: T(
      [
        ['docs/PRD.md', 'scope and requirements', 'FR-QUE-14, FR-SEC-11, NFR-01'],
        ['docs/APP_FLOW.md', 'screens, controls and their trigger → call → effect → broadcast → failure chains', 'S-A-08 (live serial), S-B-02 (reception), BTN-B02-NEXT'],
        ['docs/FRONTEND.md', 'design system and client architecture, banned patterns', '§0.2 banned patterns, §11.1 optimistic UI'],
        ['docs/DATABASE.md', 'tables, columns, enums, indexes, RLS, migration order', 'DB-P4 (UTC), DB-P5 (poisha), DB-P6 (phones)'],
        ['docs/BACKEND.md', 'services, files, APIs, realtime, sync, workers', 'SY-08, §4.1 appendEvent'],
      ],
      ['Document', 'Authority over', 'Example IDs'],
    ) +
      `<p><code>docs/DEPLOY.md</code> covers running servers; <code>docs/STATUS.md</code> records where the build is and what is undecided (no authority over behaviour); <code>docs/audit/</code> holds readiness and security records; <code>CLAUDE.md</code> holds the working agreement.</p><div class="box"><b>If code and a document disagree, the document wins</b> — fix the code. If a document is wrong or silent, stop and propose the edit; never invent behaviour. Never add a feature that is not in the PRD, never skip one that is.</div>`,
  },
  {
    type: 'text',
    crumb: 'B18 · The documents',
    title: 'Adding a feature, step by step',
    html: `
<ol>
<li><b>Find the requirement.</b> It has an ID in <code>PRD.md</code>; its screens and controls are in <code>APP_FLOW.md</code>. If it is not there, it is a document change first.</li>
<li><b>Branch</b> off mvp: <code>feat/&lt;step&gt;</code>.</li>
<li><b>Schema</b>: a new migration if needed, with RLS policies for <code>app_tenant</code>, and the enum mirrors in <code>shared/domain</code>.</li>
<li><b>Domain</b>: pure functions and Zod schemas in <code>shared/domain</code>, with unit tests.</li>
<li><b>Repository</b>: SQL only, through Kysely.</li>
<li><b>Service</b>: the rules, events, notifications, audit.</li>
<li><b>Controller + route</b>: guard (<code>requireAuth</code>, <code>requireRole</code>), <code>validate</code>, idempotency for writes; an auth-matrix test for every role and for another hospital.</li>
<li><b>Client and screen</b>: typed call in <code>shared/client</code>, components from <code>shared/ui</code>, strings in <code>shared/i18n</code> (bn and en), the four states, freshness lines.</li>
<li><b>Seeds</b>: demonstration data so the screen is never empty.</li>
<li><b>Playwright</b>: the user-visible flow.</li>
<li><b>Docs and status</b>: update what changed; record decisions in <code>STATUS.md</code>.</li>
<li><b>Gate, merge, push</b>: at the level the change needs; requirement IDs in the commit.</li>
</ol>
<h3>When something goes wrong</h3>
${T(
  [
    ['The API will not start', 'env.ts lists every missing or invalid setting at once; production refuses demo mode, mock payments and mock storage'],
    ['A test touches the wrong database', 'it cannot: suites need a database named *_test; run from the repository root'],
    ['The canary misses 2 s just after a checkout', 'the dev servers are compiling; warm them with another spec first'],
    ['A browser suite times out under load', 'run one heavy job at a time on a small machine'],
    ['Every admin code refused after a restore', 'TOTP_ENCRYPTION_KEY differs from the one the database was written with'],
    ['Staff cannot sign in after setting STAFF_NETWORKS', 'the server sees another address (a proxy in front); empty the value and run up -d web'],
  ],
  ['Symptom', 'Cause / fix'],
)}`,
  },
  {
    type: 'text',
    crumb: 'B18 · The documents',
    title: 'Technical glossary',
    html: T(
      [
        ['Session / chamber', 'one doctor sitting in one room on one date; all queue activity belongs to it'],
        ['Serial', 'a patient\'s number in a session'],
        ['Queue event', 'an immutable fact in queue_events; the queue is derived from them'],
        ['Reducer', 'the pure function (state, event) → state in shared/domain'],
        ['seq', 'the per-session event sequence; decides which statement is newer'],
        ['clientEventId', 'the console\'s key for an action; makes replays idempotent'],
        ['Patients\' copy', 'the identifier-free queue sent to phones'],
        ['Ticket', 'an HMAC standing for a booking in the patients\' copy'],
        ['Principal', 'who a request is: staff, national, patient, guest'],
        ['Scope', 'what the database lets a connection see (hospital, national, patient, guest, open, system)'],
        ['RLS', 'row-level security: PostgreSQL policies on every table'],
        ['Workspace', 'a hospital\'s private space on the shared platform'],
        ['Module', 'a part of the product a hospital can switch on or off (queue, beds, emergency, lab, pharmacy, dashboard)'],
        ['Portal', 'the patient app at a hospital\'s own address, in its colours'],
        ['Freshness', 'the age of a live figure, always shown'],
        ['Adapter', 'the interface to an outside provider, with a stand-in for tests and the demo'],
        ['Canary', 'the two-device test: a reception tap reaches a phone in under 2 s'],
        ['Gate', 'the checks a branch must pass before it merges; the release gate before main'],
        ['DEMO_MODE', 'the demonstration switch: password-less picker, codes on screen, demo labels'],
        ['FR-… / NFR-… / S-… / BTN-…', 'requirement, non-functional requirement, screen and control IDs'],
      ],
      ['Term', 'Meaning'],
    ),
  },
];
