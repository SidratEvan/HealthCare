/* global fetch, performance */
// The same requests against the Node API and the Django API, on the same
// database, one server at a time (docs/django-migration/final-report.md §8).
//
//   node backend/django/tests/perf/compare.mjs
//
// Needs the local test database the Node suite builds
// (`healthcare_django_api_test`, seeded) and the Django virtualenv. Starts
// each server itself on a port of its own, measures, stops it. Local only:
// the database URL is fixed to this machine.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const DJANGO = join(REPO, 'backend', 'django');

function testEnv() {
  const values = {};
  for (const line of readFileSync(join(DJANGO, 'env', 'test.env'), 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const at = trimmed.indexOf('=');
    values[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim();
  }
  return values;
}

const base = {
  ...testEnv(),
  NODE_ENV: 'development',
  LOG_LEVEL: 'error',
  RUN_BACKGROUND_JOBS: 'false',
  DATABASE_POOL_MAX: '10',
};
if (!new URL(base.DATABASE_URL).hostname.match(/^(localhost|127\.0\.0\.1)$/)) {
  throw new Error('This benchmark runs against a local database only.');
}

const SERVERS = {
  node: {
    port: 4301,
    // `pnpm --filter @platform/api start` (tsx, no watcher), run directly so
    // that stopping it stops the server and not only pnpm.
    command: process.execPath,
    args: [join(REPO, 'backend', 'api', 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/server.ts'],
    cwd: join(REPO, 'backend', 'api'),
  },
  django: {
    port: 4302,
    command: join(
      DJANGO,
      '.venv',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
    ),
    args: [
      '-m',
      'uvicorn',
      'medlive.asgi:application',
      '--host',
      '127.0.0.1',
      '--port',
      '4302',
      '--no-proxy-headers',
      '--log-level',
      'warning',
    ],
    cwd: DJANGO,
  },
};

async function waitFor(url, deadline) {
  for (;;) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`${url} never answered`);
    await sleep(250);
  }
}

const percentile = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

async function measure(url, { requests, concurrency, init }) {
  const times = [];
  let failed = 0;
  let next = 0;
  const started = performance.now();
  const worker = async () => {
    while (next < requests) {
      next += 1;
      const at = performance.now();
      const response = await fetch(url, init?.());
      await response.arrayBuffer();
      if (!response.ok) failed += 1;
      times.push(performance.now() - at);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const seconds = (performance.now() - started) / 1000;
  times.sort((a, b) => a - b);
  return {
    p50: percentile(times, 50).toFixed(1),
    p95: percentile(times, 95).toFixed(1),
    perSecond: (requests / seconds).toFixed(0),
    failed,
  };
}

const CASES = [
  { name: 'GET /healthz', path: '/healthz', requests: 400, concurrency: 1 },
  { name: 'GET /readyz', path: '/readyz', requests: 200, concurrency: 1 },
  { name: 'GET /api/v1/hospitals', path: '/api/v1/hospitals', requests: 200, concurrency: 1 },
  { name: 'GET /api/v1/doctors', path: '/api/v1/doctors', requests: 200, concurrency: 1 },
  {
    name: 'GET /api/v1/hospitals ×10 at once',
    path: '/api/v1/hospitals',
    requests: 400,
    concurrency: 10,
  },
  {
    name: 'GET /api/v1/doctors ×10 at once',
    path: '/api/v1/doctors',
    requests: 400,
    concurrency: 10,
  },
];

const results = {};
for (const [name, server] of Object.entries(SERVERS)) {
  const child = spawn(server.command, server.args, {
    cwd: server.cwd,
    env: { ...process.env, ...base, PORT: String(server.port) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    const origin = `http://127.0.0.1:${server.port}`;
    await waitFor(`${origin}/healthz`, Date.now() + 90_000);
    // Warm: the first requests pay for imports and the pool's connections.
    for (const c of CASES) await measure(`${origin}${c.path}`, { requests: 20, concurrency: 1 });
    results[name] = {};
    for (const c of CASES) results[name][c.name] = await measure(`${origin}${c.path}`, c);
  } finally {
    child.kill();
    await sleep(1000);
  }
}

console.log('| Request | Node p50 / p95 ms | Node req/s | Django p50 / p95 ms | Django req/s |');
console.log('|---|---:|---:|---:|---:|');
for (const c of CASES) {
  const n = results.node[c.name];
  const d = results.django[c.name];
  const fail = (r) => (r.failed > 0 ? ` (${r.failed} failed)` : '');
  console.log(
    `| ${c.name} | ${n.p50} / ${n.p95}${fail(n)} | ${n.perSecond} | ${d.p50} / ${d.p95}${fail(d)} | ${d.perSecond} |`,
  );
}
