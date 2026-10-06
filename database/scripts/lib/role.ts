/**
 * The role the API connects as (`docs/PLATFORM_PLAN.md` 1.7).
 *
 * Until this existed the API on a hospital's server connected as the role that
 * owns the database — a superuser in the stock image. One injected statement
 * could then drop a table, read a file off the server's disk, switch off the
 * triggers that keep `queue_events` append-only, or make itself another
 * account. None of that is something an API ever needs to do.
 *
 * So there are two roles:
 *
 *   the owner     runs the migrations and the backups. Never serves a request.
 *   the API role  what `DATABASE_URL` names for the API. It reads and writes
 *                 rows, and that is all: no schema changes, no TRUNCATE, no new
 *                 roles, no superuser, and nothing but SELECT on the migration
 *                 ledger.
 *
 * Three tables are narrower still, because their history is the point of them:
 *
 *   audit_log     INSERT and SELECT only. There is no trigger guarding it, so
 *                 this grant is what stops a written audit row being changed.
 *   bed_events    INSERT and SELECT only, as its trigger already insists.
 *   queue_events  no DELETE. UPDATE stays, for the one change its trigger
 *                 allows — `undone_by_event_id` being set (`GR-02`).
 *
 * ## Bound by the tenant policies (plan B1, migration 0043)
 *
 * It does not bypass row-level security, and it is a member of `app_tenant`,
 * the role the policies are written for. So what this role can reach on any
 * connection is what that connection has said it is working for
 * (`backend/api` `config/dbScope.ts`): a hospital's staff reach that
 * hospital's rows, and a connection that has said nothing reaches none. Until
 * B1 it held BYPASSRLS, because there were no policies and without it the API
 * would have seen an empty database.
 *
 * Everything here can be run again: after every migration, on every start.
 */

import type { Client } from 'pg';

export interface ApiRole {
  readonly name: string;
  readonly password: string;
}

/** Tables whose rows are never changed or removed once written. */
const INSERT_ONLY = ['audit_log', 'bed_events'] as const;

/** A plain, lower-case identifier: it is quoted everywhere, but a name that needs quoting is a mistake. */
const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export async function ensureApiRole(client: Client, role: ApiRole): Promise<void> {
  if (!ROLE_NAME.test(role.name)) {
    throw new Error(
      `"${role.name}" is not a usable role name: lower-case letters, digits and underscores, starting with a letter.`,
    );
  }
  if (role.password === '') {
    throw new Error('The API role needs a password.');
  }

  const who = await client.query<{ current_user: string; database: string }>(
    'SELECT current_user, current_database() AS database',
  );
  const owner = who.rows[0]?.current_user;
  const database = who.rows[0]?.database;
  if (owner === undefined || database === undefined) {
    throw new Error('Could not read which role and database this connection is.');
  }
  if (owner === role.name) {
    throw new Error(
      `The API role cannot be "${owner}", the role that owns the database: the point is that they differ.`,
    );
  }

  await client.query('BEGIN');
  try {
    const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role.name]);
    if (exists.rows.length === 0) {
      await run(client, 'CREATE ROLE %I', [role.name]);
    }

    // Stated every time, so a role somebody widened by hand is narrowed again
    // on the next start. The password cannot be a bind parameter in DDL;
    // `format(%L)` quotes it on the server, and it is never printed here.
    await run(
      client,
      `ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
         NOBYPASSRLS PASSWORD %L`,
      [role.name, role.password],
    );

    await run(client, 'GRANT CONNECT ON DATABASE %I TO %I', [database, role.name]);
    await run(client, 'GRANT USAGE ON SCHEMA public, extensions TO %I', [role.name]);

    // Rows, and nothing else. TRUNCATE, REFERENCES and TRIGGER are not here.
    await run(client, 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', [
      role.name,
    ]);
    await run(client, 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', [role.name]);
    await run(client, 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO %I', [role.name]);

    // Which migrations a database is on is read by `/readyz` and written by
    // nobody but the migration runner.
    await run(client, 'REVOKE INSERT, UPDATE, DELETE ON schema_migrations FROM %I', [role.name]);

    for (const table of INSERT_ONLY) {
      await run(client, 'REVOKE UPDATE, DELETE ON %I FROM %I', [table, role.name]);
    }
    await run(client, 'REVOKE DELETE ON queue_events FROM %I', [role.name]);

    // Tables a later migration creates are the owner's; without this the API
    // would be refused on them until this ran again.
    await run(
      client,
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
      [role.name],
    );
    await run(
      client,
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I',
      [role.name],
    );

    // The government layer reads as `gov_reader` for the length of one
    // transaction (0026); the connection's own role has to be a member to
    // switch to it.
    await run(client, 'GRANT gov_reader TO %I', [role.name]);

    // The tenant policies (0043) are written for `app_tenant`. Being a member
    // is what makes them apply to this role; not bypassing row-level security,
    // above, is what makes them bind it.
    await run(client, 'GRANT app_tenant TO %I', [role.name]);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/**
 * Runs one statement whose identifiers and literals cannot be bind parameters.
 *
 * The server builds the text with `format()` — `%I` quotes an identifier, `%L`
 * a literal — so nothing here is ever interpolated by hand.
 */
async function run(client: Client, template: string, args: readonly string[]): Promise<void> {
  const placeholders = args.map((_, index) => `$${String(index + 2)}::text`).join(', ');
  const built = await client.query<{ statement: string }>(
    `SELECT format($1::text${placeholders === '' ? '' : `, ${placeholders}`}) AS statement`,
    [template, ...args],
  );

  const statement = built.rows[0]?.statement;
  if (statement === undefined) throw new Error('format() returned nothing.');
  await client.query(statement);
}
