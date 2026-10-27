/**
 * Global setup for running the Node API suite against Django.
 *
 * Builds the suite's database exactly as the Node run does (migrations, the
 * demo seed, the `healthcare_api` role), then starts the Django server on
 * that database, as that role, with the suite's own test secrets
 * (`backend/django/env/test.env`), and stops it afterwards.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import buildApiDatabase, {
  API_TEST_ROLE,
} from '../../../../database/tests/support/api-global-setup.js';

// The Django run's own database, never the Node run's (`healthcare_api_test`).
process.env['DATABASE_URL_API_TEST'] =
  process.env['DATABASE_URL_DJANGO_TEST'] ??
  'postgresql://healthcare:healthcare@localhost:5432/healthcare_django_api_test';

const HERE = dirname(fileURLToPath(import.meta.url));
const DJANGO_ROOT = resolve(HERE, '../..');
const PORT = Number(new URL(process.env['DJANGO_API_URL'] ?? 'http://127.0.0.1:4199').port);

function testEnv(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of readFileSync(join(DJANGO_ROOT, 'env', 'test.env'), 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const at = trimmed.indexOf('=');
    values[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim();
  }
  return values;
}

async function waitForHealth(deadline: number): Promise<void> {
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${String(PORT)}/healthz`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline)
      throw new Error('The Django server did not answer /healthz in time.');
    await new Promise((done) => setTimeout(done, 250));
  }
}

let server: ChildProcess | null = null;

export default async function setup(): Promise<() => Promise<void>> {
  await buildApiDatabase();

  const python = join(
    DJANGO_ROOT,
    '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...testEnv(),
    PORT: String(PORT),
    PYTHONUNBUFFERED: '1',
  };
  delete env['DATABASE_URL_OWNER_TEST'];
  // Serve the database this run built, including custom local ports (FR-SEC-08).
  const database = new URL(process.env['DATABASE_URL_API_TEST'] ?? '');
  database.username = API_TEST_ROLE.name;
  database.password = API_TEST_ROLE.password;
  env['DATABASE_URL'] = database.toString();
  server = spawn(
    python,
    [
      '-m',
      'uvicorn',
      'medlive.asgi:application',
      '--host',
      '127.0.0.1',
      '--port',
      String(PORT),
      '--no-proxy-headers',
      '--log-level',
      'warning',
    ],
    { cwd: DJANGO_ROOT, env, stdio: ['ignore', 'inherit', 'inherit'] },
  );
  await waitForHealth(Date.now() + 60_000);

  return () => {
    server?.kill();
    server = null;
    return Promise.resolve();
  };
}
