/**
 * The one place the E2E suite decides which database it is talking to.
 *
 * ## Why this is not just `process.env.DATABASE_URL`
 *
 * It used to be, in both `console.ts` and `globalSetup.ts`, and that was a
 * bug with teeth. `console.ts` imports `signToken` from the API, and
 * `backend/api/src/env.ts` merges the repository's `.env` into `process.env`
 * as an import side effect. ESM evaluates imports before the importing
 * module's own body, so by the time `const DATABASE_URL = process.env[...]`
 * ran, `.env` had already put a *Supabase* URL there.
 *
 * The result was a suite split across two databases: `globalSetup` and the
 * app servers on the local container, the fixtures on Supabase. Every spec
 * failed looking for a seeded row that was seeded somewhere else — and, worse,
 * each run appended sessions, bookings and queue events to a shared remote
 * database that `queue_events` being append-only (`DB-P1`) makes impossible to
 * tidy up afterwards.
 *
 * So the suite no longer reads the ambient `DATABASE_URL` at all. A developer
 * whose `.env` points at a deployed environment — which is the normal, correct
 * thing for `.env` to do — cannot have these specs follow it there by
 * accident.
 */

/** The local container, and nothing else by default. */
const LOCAL = 'postgresql://healthcare:healthcare@localhost:5432/healthcare_dev';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Where the specs read and write.
 *
 * Overridable with `E2E_DATABASE_URL` — deliberately its own name, so that
 * pointing the API at a deployed database does not also point the tests there.
 */
export const E2E_DATABASE_URL = process.env['E2E_DATABASE_URL'] ?? LOCAL;

/**
 * Refuses a remote target.
 *
 * `globalSetup` truncates and reseeds, and the specs append events that cannot
 * be removed. Doing either to a shared database is not a mistake worth leaving
 * one environment variable away, so it has to be said out loud with
 * `E2E_ALLOW_REMOTE_DATABASE=true`.
 */
export function assertLocalDatabase(url: string = E2E_DATABASE_URL): void {
  if (process.env['E2E_ALLOW_REMOTE_DATABASE'] === 'true') return;

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('E2E_DATABASE_URL is not a valid connection URL.');
  }

  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to run the E2E suite against ${host}. These specs truncate, ` +
        'reseed and append events that cannot be undone. Point E2E_DATABASE_URL at ' +
        'the local container, or set E2E_ALLOW_REMOTE_DATABASE=true if you mean it.',
    );
  }
}
