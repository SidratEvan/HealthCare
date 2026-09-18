/**
 * Environment loading for the database scripts.
 *
 * Deliberately dependency-free. Node 20.11 can read a `.env` with
 * `--env-file`, but that flag errors when the file is absent, which is exactly
 * the situation in CI where the variables arrive from the workflow. So the
 * scripts read `process.env` first and fall back to parsing `.env` themselves.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Absolute path of the repository root, from this file's location. */
export const REPO_ROOT = resolve(import.meta.dirname, '../../..');

/** Absolute path of the migrations directory. */
export const MIGRATIONS_DIR = resolve(REPO_ROOT, 'db/migrations');

/**
 * Merges `.env` into `process.env` without overwriting anything already set.
 * A real environment variable always wins over the file.
 */
export function loadEnvFile(path = resolve(REPO_ROOT, '.env')): void {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    // No .env is normal in CI and in a container.
    return;
  }

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    if (key === '' || process.env[key] !== undefined) continue;

    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

/**
 * Reads a connection string, with a message that says what to do rather than
 * what went wrong.
 */
export function requireDatabaseUrl(variable = 'DATABASE_URL'): string {
  loadEnvFile();

  const url = process.env[variable];
  if (url === undefined || url === '') {
    throw new Error(
      [
        `${variable} is not set.`,
        '',
        'For local development:',
        '  1. cp .env.example .env',
        '  2. docker compose up -d',
        '',
        'The default DATABASE_URL in .env.example already matches the container.',
      ].join('\n'),
    );
  }
  return url;
}

/**
 * Refuses to run against anything that does not look like a development or
 * test database.
 *
 * `db:migrate` is forward-only and safe, but the scripts that follow it in
 * later steps are not: `db:reset` truncates and reseeds (DATABASE.md §7), and
 * a demo seed reaching a production database would put demonstration patients
 * in front of real staff. A production migration runs from CI against an
 * explicit target (BACKEND.md §12), never from a developer's shell.
 */
export function assertNotProduction(url: string): void {
  if (process.env['ALLOW_REMOTE_DB'] === '1') return;

  const { host, database } = describe(url);
  const looksLocal = /^(localhost|127\.0\.0\.1|::1|db|postgres)$/.test(host);
  const looksDisposable = /(_dev|_test)$|^postgres$/.test(database);

  if (!looksLocal && !looksDisposable) {
    throw new Error(
      [
        `Refusing to run against database "${database}" on host "${host}".`,
        '',
        'These scripts target development and test databases only. Production',
        'migrations run from CI against an explicit target (BACKEND.md §12).',
        '',
        'Set ALLOW_REMOTE_DB=1 if this really is what you meant.',
      ].join('\n'),
    );
  }
}

/**
 * Connection string for the throwaway test database.
 *
 * `DATABASE_URL_TEST` wins if it is set; otherwise the name is derived from
 * `DATABASE_URL` by replacing a trailing `_dev` with `_test`. Either way the
 * result must name a database ending in `_test`, and that check is not
 * cosmetic: the schema suite proves the migrations apply to a *fresh*
 * database, which means it drops and recreates the public schema. Pointed at
 * the wrong URL it would take a developer's demo data with it, and one day it
 * would be pointed at something worse.
 */
export function resolveTestDatabaseUrl(): string {
  loadEnvFile();

  const explicit = process.env['DATABASE_URL_TEST'];
  const url = explicit ?? deriveTestUrl(requireDatabaseUrl('DATABASE_URL'));
  const { database } = describe(url);

  if (!database.endsWith('_test')) {
    throw new Error(
      [
        `The test database must be named "*_test"; got "${database}".`,
        '',
        'The schema suite drops and recreates the public schema to prove the',
        'migrations apply to a fresh database. It will not do that to anything',
        'that is not obviously disposable.',
        '',
        'Set DATABASE_URL_TEST to a database whose name ends in _test.',
      ].join('\n'),
    );
  }

  return url;
}

function deriveTestUrl(devUrl: string): string {
  const parsed = new URL(devUrl);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  parsed.pathname = `/${name.replace(/_dev$/, '')}_test`;
  return parsed.toString();
}

/** Host and database name of a connection string, for messages only. */
export function describe(url: string): { host: string; database: string } {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    };
  } catch {
    return { host: '(unparseable)', database: '(unparseable)' };
  }
}
