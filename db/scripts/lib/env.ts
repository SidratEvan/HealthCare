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

/**
 * Startup options every connection to this database must carry.
 *
 * PostGIS, pgcrypto and earthdistance live in the `extensions` schema (0001),
 * which is not on the default search_path — so `ST_MakePoint`, `geography` and
 * `gen_random_uuid` are unresolvable without this, and the emergency geo
 * search (FR-PAT-43) would fail at runtime with "function does not exist"
 * rather than at migration time.
 *
 * Set per connection rather than with `ALTER ROLE`, because the role a hosted
 * database hands out is not necessarily one we can alter, and a schema whose
 * correctness depends on a role grant is a schema that breaks on the next
 * environment.
 */
export const PG_CONNECTION_OPTIONS = '-c search_path=public,extensions';

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

export interface TargetOptions {
  /**
   * True for an operation that destroys data — `db:reset`, or the schema
   * rebuild the test suite performs. Forward-only migration is not
   * destructive.
   */
  readonly destructive?: boolean;
}

/**
 * Refuses to touch a database the caller has not explicitly opted into.
 *
 * The decision is made on the **host**, not the database name. An earlier
 * version treated a database called `postgres` as disposable, on the reasoning
 * that it is the throwaway default of a local container — but every Supabase
 * project's database is also called `postgres`, so that rule quietly
 * authorised `db:migrate` and `db:reset` against any hosted project, including
 * a live one, with no opt-in at all.
 *
 * So: a local host is free, and anything else needs saying out loud.
 */
export function assertSafeTarget(url: string, options: TargetOptions = {}): void {
  const { host, database } = describe(url);

  if (isLocalHost(host)) return;

  const remoteAllowed = process.env['ALLOW_REMOTE_DB'] === '1';
  const destructiveAllowed = process.env['ALLOW_DESTRUCTIVE_DB'] === '1';

  if (!remoteAllowed) {
    throw new Error(
      [
        `Refusing to run against "${database}" on "${host}".`,
        '',
        `"${host}" is not a local host, so this could be a database real`,
        'patients depend on. Nothing about the database name proves otherwise —',
        'a hosted Postgres is usually called "postgres" whether it is a scratch',
        'project or a pilot hospital.',
        '',
        'If this is your own development project, run it with:',
        '  ALLOW_REMOTE_DB=1 pnpm db:migrate',
        '',
        'Production migrations run from CI against an explicit target',
        '(BACKEND.md §12), never from a developer shell.',
      ].join('\n'),
    );
  }

  if (options.destructive === true && !destructiveAllowed) {
    throw new Error(
      [
        `Refusing to DESTROY data in "${database}" on "${host}".`,
        '',
        'ALLOW_REMOTE_DB permits a forward-only migration, which adds to a',
        'schema. This operation drops or truncates, and on a remote host that',
        'is a separate decision.',
        '',
        'If you are certain:',
        '  ALLOW_REMOTE_DB=1 ALLOW_DESTRUCTIVE_DB=1 pnpm db:reset',
      ].join('\n'),
    );
  }
}

function isLocalHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|::1|\[::1\]|host\.docker\.internal|db)$/.test(host);
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
