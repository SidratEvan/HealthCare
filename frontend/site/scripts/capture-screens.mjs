/**
 * Captures the company site's product screens (`public/screens/*.webp`) from
 * the real patient app and console, on freshly seeded demonstration data
 * (FR-DEM-07, FR-SEC-08).
 *
 *   node frontend/site/scripts/capture-screens.mjs [--reset]
 *
 * Fails closed. It runs only against a database named `healthcare_capture` on
 * a local host — never the shared dev database tests write to, never a hosted
 * one — and only when nothing is already listening on the app ports, so every
 * write (a guest booking, demo sign-ins) goes through servers it started
 * itself, bound to that database. `--reset` truncates and reseeds it first.
 */
/* global fetch, setTimeout, localStorage, document -- Node 22, and the page Playwright runs in */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../../..');
const require = createRequire(join(REPO, 'package.json'));
const { chromium } = require('@playwright/test');
const { Client } = require('pg');

const CAPTURE_DATABASE = 'healthcare_capture';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const DATABASE_URL =
  process.env['CAPTURE_DATABASE_URL'] ??
  `postgresql://healthcare:healthcare@localhost:5432/${CAPTURE_DATABASE}`;
const PORTS = { patient: 3000, console: 3100, api: 4000 };
const API = `http://localhost:${String(PORTS.api)}`;
const PATIENT = `http://localhost:${String(PORTS.patient)}`;
const CONSOLE = `http://localhost:${String(PORTS.console)}`;
const OUT = join(REPO, 'frontend/site/public/screens');

function fail(message) {
  console.error(`capture-screens: refusing — ${message}`);
  process.exit(1);
}

// --- 1. the target, by its address and then by asking it -------------------
const target = new URL(DATABASE_URL);
if (!LOCAL_HOSTS.has(target.hostname)) fail(`${target.hostname} is not a local host.`);
if (target.pathname !== `/${CAPTURE_DATABASE}`) {
  fail(`the database must be "${CAPTURE_DATABASE}", not "${target.pathname.slice(1)}".`);
}
const probe = new Client({ connectionString: DATABASE_URL });
await probe.connect();
const { rows: identity } = await probe.query(
  'SELECT current_database() AS name, inet_server_addr()::text AS address',
);
await probe.end();
const address = identity[0]?.address ?? null;
if (identity[0]?.name !== CAPTURE_DATABASE) fail(`connected to "${identity[0]?.name}".`);
if (address !== null && !/^(127\.|::1|172\.|192\.168\.|10\.)/.test(address)) {
  fail(`the server reports address ${address}, which is not local.`);
}

// --- 2. nothing else may be answering on the app ports ----------------------
async function listening(port) {
  return await new Promise((done) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('error', () => {
      done(false);
    });
  });
}
for (const [name, port] of Object.entries(PORTS)) {
  if (await listening(port)) fail(`port ${String(port)} (${name}) is in use; stop it first.`);
}

// DEMO_PHONES: the capture's local database only (FR-DEM-08).
const env = {
  ...process.env,
  DATABASE_URL,
  DEMO_MODE: 'true',
  DEMO_PHONES: 'any',
  NODE_ENV: 'development',
};
if (process.argv.includes('--reset')) {
  const reset = spawnSync('pnpm db:reset', { cwd: REPO, env, shell: true, stdio: 'inherit' });
  if (reset.status !== 0) fail('the reset failed.');
}

// --- 3. our own servers, bound to the capture database -----------------------
const children = [];
function start(command, extra) {
  const child = spawn(command, {
    cwd: REPO,
    env: { ...env, ...extra },
    shell: true,
    stdio: 'ignore',
  });
  children.push(child);
}
function stop() {
  for (const child of children) {
    if (child.pid !== undefined) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
  }
}
process.on('exit', stop);
async function ready(url) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((wait) => setTimeout(wait, 1000));
  }
  fail(`${url} never answered.`);
}
const web = { NEXT_PUBLIC_API_URL: `${API}/api/v1`, NEXT_PUBLIC_SOCKET_URL: API };
start('pnpm dev:api', { ADDRESS_RATE_LIMIT_FACTOR: '100' });
start('pnpm dev:console', web);
start('pnpm dev:patient', web);
await ready(`${API}/healthz`);
await ready(CONSOLE);
await ready(PATIENT);

// --- 4. the seeded chamber the demo guide walks through ----------------------
const db = new Client({ connectionString: DATABASE_URL });
await db.connect();
const { rows } = await db.query(`
  SELECT h.id AS hospital, s.id AS session, s.doctor_id AS doctor
    FROM sessions s
    JOIN hospitals h ON h.id = s.hospital_id
    JOIN departments d ON d.id = s.department_id
   WHERE h.code = 'SHAPLA' AND d.code = 'CARD' AND s.status = 'running'
     AND s.deleted_at IS NULL
   ORDER BY s.planned_start LIMIT 1`);
await db.end();
const chamber = rows[0];
if (chamber === undefined) fail('the seed has no running Shapla cardiology chamber; use --reset.');

// --- 5. capture --------------------------------------------------------------
// Next's own image encoder, from where pnpm keeps it — no new dependency.
const sharp = createRequire(
  realpathSync(join(REPO, 'frontend/site/node_modules/next/package.json')),
)('sharp');
await mkdir(OUT, { recursive: true });
const raw = await mkdtemp(join(tmpdir(), 'medlivebd-screens-'));
const browser = await chromium.launch();

async function context(locale, mobile) {
  const ctx = await browser.newContext(
    mobile
      ? {
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
        }
      : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 },
  );
  await ctx.addInitScript((value) => {
    localStorage.setItem('platform.locale', value);
  }, locale);
  return ctx;
}
async function save(page, name, width) {
  // The development-server badge is not part of the product.
  await page.evaluate(() => {
    for (const element of document.querySelectorAll('nextjs-portal')) element.remove();
  });
  await page.waitForTimeout(600);
  const file = join(raw, `${name}.png`);
  await page.screenshot({ path: file });
  await sharp(file)
    .resize({ width })
    .webp({ quality: 82 })
    .toFile(join(OUT, `${name}.webp`));
  console.log('saved', name);
}

const booking = await context('bn', true);
const book = await booking.newPage();
await book.goto(`${PATIENT}/book?specialty=CARD`);
await book.getByTestId(`hospital-${chamber.hospital}`).click();
await book.getByTestId(`doctor-${chamber.doctor}`).click();
await book.getByTestId(`session-${chamber.session}`).click();
await book.getByLabel('রোগীর নাম').fill('ডেমো রোগী');
await book.getByLabel('মোবাইল নম্বর').fill('01380000001');
await book.getByLabel('বয়স').fill('34');
await book.getByRole('button', { name: 'বিকাশ' }).click();
await book.getByTestId('confirm-booking').click();
await book.getByTestId('booking-success').waitFor({ timeout: 60_000 });
const tracking = await book.getByTestId('tracking-link').getAttribute('href');
await booking.close();
if (tracking === null) fail('the booking issued no tracking link.');

for (const locale of ['bn', 'en']) {
  const ctx = await context(locale, true);
  const page = await ctx.newPage();
  await page.goto(new URL(tracking, PATIENT).href);
  await page.getByTestId('live-serial').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  await save(page, `patient-${locale}`, 780);
  await ctx.close();
}

const consoles = [
  ['reception', `open-receptionist-${chamber.session}`],
  ['doctor', `open-doctor-${chamber.session}`],
  ['ward', `open-ward-${chamber.hospital}`],
  ['lab', `open-lab-${chamber.hospital}`],
  ['admin', `open-admin-${chamber.hospital}`],
];
for (const locale of ['bn', 'en']) {
  for (const [key, testId] of consoles) {
    const ctx = await context(locale, false);
    const page = await ctx.newPage();
    await page.goto(CONSOLE);
    await page.getByTestId('console-picker').waitFor({ timeout: 120_000 });
    await page.getByTestId(`pick-hospital-${chamber.hospital}`).click();
    await page.getByTestId(testId).click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2500);
    await save(page, `${key}-${locale}`, 1440);
    await ctx.close();
  }
}

await browser.close();
stop();
console.log(`raw captures kept in ${raw}`);
