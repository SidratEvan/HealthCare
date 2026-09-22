/**
 * Schema invariant checks — `pnpm db:verify`.
 *
 * DATABASE.md §7 describes this as asserting "every table has
 * created_at/updated_at/RLS". It checks those and the other principles from
 * DATABASE.md §0 that can be verified mechanically, because each one is a rule
 * that is easy to keep and easy to forget on the twentieth table:
 *
 *   DB-P1  queue_events is append-only, enforced by trigger — and so is
 *          bed_events, which DATABASE.md §2.5 makes "append-only like the queue"
 *   DB-P3  every table carries created_at and updated_at, and maintains them
 *   DB-P4  all timestamps are timestamptz — never a naive timestamp
 *   DB-P5  money is integer poisha — never a float
 *   DB-P6  identity-bearing phone columns are constrained to +8801…
 *   DB-P8  row-level security is enabled on every table
 *   DB-P9  primary keys are uuid
 *   §1     the enum label sets still match @platform/domain, which is the
 *          single definition shared with the API and the client
 *
 * A violation is reported, not thrown, so one run lists everything that is
 * wrong instead of the first thing.
 */

import { DATABASE_ENUMS } from '@platform/domain';

import type { Client } from 'pg';

export interface Violation {
  readonly rule: string;
  readonly subject: string;
  readonly detail: string;
}

/**
 * Tables that are exempt from the DB-P3 timestamp and DB-P9 key rules, with
 * the reason. Nothing is exempt from RLS.
 */
const INFRASTRUCTURE_TABLES = new Map<string, string>([
  ['schema_migrations', 'migration ledger; created before the first migration can record itself'],
  ['spatial_ref_sys', 'created by the PostGIS extension; not ours to shape'],
]);

/**
 * Tables whose primary key is a natural one, with the reason.
 *
 * DB-P9 says IDs are UUID v7 and names one exception, `bookings.serial_number`.
 * This is the second, and it is one DATABASE.md itself specifies: §2.7 gives
 * `notification_templates` the primary key `key`. It is reference data — a
 * call site asks for `queue.called` by name, in a channel, in a locale — and
 * a surrogate id would mean every lookup went through a second index to find
 * the row the key already identifies.
 *
 * Kept separate from `INFRASTRUCTURE_TABLES` because these tables are ours and
 * every other invariant still applies to them: they keep their timestamps,
 * their touch trigger and their RLS.
 */
const NATURAL_KEY_TABLES = new Map<string, string>([
  [
    'notification_templates',
    'keyed by (key, channel, locale) — reference data, and the primary key DATABASE.md §2.7 specifies',
  ],
]);

/** Runs every check and returns everything that is wrong. */
export async function verifySchema(client: Client): Promise<Violation[]> {
  const violations: Violation[] = [];

  const tables = await listTables(client);
  const applicationTables = tables.filter((t) => !INFRASTRUCTURE_TABLES.has(t.name));

  if (applicationTables.length === 0) {
    violations.push({
      rule: 'schema',
      subject: 'public',
      detail: 'No application tables found. Has `pnpm db:migrate` been run?',
    });
    return violations;
  }

  violations.push(...checkRowLevelSecurity(tables));
  violations.push(...(await checkTimestampColumns(client, applicationTables)));
  violations.push(...(await checkTouchTriggers(client, applicationTables)));
  violations.push(...(await checkNoNaiveTimestamps(client)));
  violations.push(...(await checkMoneyIsInteger(client)));
  violations.push(...(await checkPhoneConstraints(client)));
  violations.push(...(await checkPrimaryKeysAreUuid(client, applicationTables)));
  violations.push(...(await checkAppendOnlyLog(client)));
  violations.push(...(await checkEnums(client)));

  return violations;
}

interface TableRow {
  readonly name: string;
  readonly rls_enabled: boolean;
}

async function listTables(client: Client): Promise<TableRow[]> {
  const { rows } = await client.query<TableRow>(`
    SELECT c.relname AS name, c.relrowsecurity AS rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  `);
  return rows;
}

/**
 * DB-P8: row-level security is enabled on every table.
 *
 * The one exception is `spatial_ref_sys`, which PostGIS creates and reads from
 * inside its own functions — enabling RLS on it breaks coordinate transforms.
 * The migration ledger is not exempt; `applyMigrations` enables RLS on it.
 */
function checkRowLevelSecurity(tables: readonly TableRow[]): Violation[] {
  return tables
    .filter((table) => !table.rls_enabled && table.name !== 'spatial_ref_sys')
    .map((table) => ({
      rule: 'DB-P8 row-level security',
      subject: table.name,
      detail:
        'RLS is not enabled. Add `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` in the migration that creates the table. Never disable it to make something work (CLAUDE.md §8).',
    }));
}

/** DB-P3: every table carries created_at and updated_at, in UTC (DB-P4). */
async function checkTimestampColumns(
  client: Client,
  tables: readonly TableRow[],
): Promise<Violation[]> {
  const { rows } = await client.query<{ table_name: string; column_name: string }>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name IN ('created_at', 'updated_at')
      AND data_type = 'timestamp with time zone'
  `);

  const present = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));

  return tables.flatMap((table) =>
    (['created_at', 'updated_at'] as const)
      .filter((column) => !present.has(`${table.name}.${column}`))
      .map((column) => ({
        rule: 'DB-P3 audit columns',
        subject: `${table.name}.${column}`,
        detail: `Missing, or not timestamptz. Every table carries created_at and updated_at in UTC (DB-P3, DB-P4).`,
      })),
  );
}

/**
 * DB-P3, continued: a table that carries `updated_at` and does not maintain it
 * is worse than one without the column, because a stale value reads as fresh —
 * and `queue_state.updated_at` is what the freshness line on a patient's phone
 * is derived from (FR-OFF-03).
 */
async function checkTouchTriggers(
  client: Client,
  tables: readonly TableRow[],
): Promise<Violation[]> {
  const { rows } = await client.query<{ table_name: string }>(`
    SELECT DISTINCT c.relname AS table_name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
      -- The two append-only guards count: one sets updated_at on the single
      -- update it permits, the other permits none, so the column can never
      -- go stale on either.
      AND p.proname IN ('fn_touch_updated_at', 'fn_queue_events_no_mutate', 'fn_bed_events_no_mutate')
  `);

  const maintained = new Set(rows.map((row) => row.table_name));

  return tables
    .filter((table) => !maintained.has(table.name))
    .map((table) => ({
      rule: 'DB-P3 updated_at maintained',
      subject: table.name,
      detail:
        'No trigger maintains updated_at. Add `CREATE TRIGGER trg_<table>_touch BEFORE UPDATE … EXECUTE FUNCTION fn_touch_updated_at();`.',
    }));
}

/** DB-P4: all timestamps are stored UTC; conversion to Asia/Dhaka is the client's job. */
async function checkNoNaiveTimestamps(client: Client): Promise<Violation[]> {
  const { rows } = await client.query<{ table_name: string; column_name: string }>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type IN ('timestamp without time zone')
    ORDER BY table_name, column_name
  `);

  return rows.map((row) => ({
    rule: 'DB-P4 UTC timestamps',
    subject: `${row.table_name}.${row.column_name}`,
    detail:
      'Declared as `timestamp` without a time zone. Use timestamptz; display conversion to Asia/Dhaka happens in the client only (DB-P4).',
  }));
}

/** DB-P5: money is integer poisha. Never floats. */
async function checkMoneyIsInteger(client: Client): Promise<Violation[]> {
  const { rows } = await client.query<{
    table_name: string;
    column_name: string;
    data_type: string;
  }>(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (column_name LIKE '%_poisha' OR column_name LIKE '%fee%' OR column_name LIKE '%amount%'
           OR column_name LIKE '%price%' OR column_name LIKE '%fare%')
    ORDER BY table_name, column_name
  `);

  const violations: Violation[] = [];

  for (const row of rows) {
    const subject = `${row.table_name}.${row.column_name}`;

    if (['double precision', 'real', 'numeric', 'money'].includes(row.data_type)) {
      violations.push({
        rule: 'DB-P5 integer poisha',
        subject,
        detail: `Declared as ${row.data_type}. Money is integer poisha — 1 BDT = 100 poisha, never a float (DB-P5).`,
      });
      continue;
    }

    // A money column that does not say poisha invites the next reader to
    // assume taka and be wrong by two orders of magnitude.
    if (!row.column_name.endsWith('_poisha') && !row.column_name.endsWith('_minutes')) {
      violations.push({
        rule: 'DB-P5 naming',
        subject,
        detail:
          'A money column must be named `*_poisha` so its unit is unmistakable at every call site (DB-P5).',
      });
    }
  }

  return violations;
}

/** DB-P6: phone numbers are stored normalised as +8801XXXXXXXXX. */
async function checkPhoneConstraints(client: Client): Promise<Violation[]> {
  const { rows } = await client.query<{ table_name: string; column_name: string }>(`
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND (c.column_name = 'phone' OR c.column_name LIKE '%_phone')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint con
        JOIN pg_class cl ON cl.oid = con.conrelid
        WHERE cl.relname = c.table_name
          AND con.contype = 'c'
          AND pg_get_constraintdef(con.oid) LIKE '%' || c.column_name || '%~%+880%'
      )
    ORDER BY c.table_name, c.column_name
  `);

  return rows.map((row) => ({
    rule: 'DB-P6 normalised phones',
    subject: `${row.table_name}.${row.column_name}`,
    detail:
      'No CHECK constrains this to +8801XXXXXXXXX. A mis-normalised number silently splits one person into two identities (DB-P6).',
  }));
}

/** DB-P9: IDs are UUID v7. */
async function checkPrimaryKeysAreUuid(
  client: Client,
  tables: readonly TableRow[],
): Promise<Violation[]> {
  const { rows } = await client.query<{
    table_name: string;
    column_name: string;
    data_type: string;
  }>(`
    SELECT c.relname AS table_name, a.attname AS column_name, format_type(a.atttypid, NULL) AS data_type
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN unnest(con.conkey) AS k(attnum) ON true
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
    WHERE n.nspname = 'public' AND con.contype = 'p'
  `);

  const names = new Set(tables.map((t) => t.name));

  return rows
    .filter(
      (row) =>
        names.has(row.table_name) &&
        row.data_type !== 'uuid' &&
        !NATURAL_KEY_TABLES.has(row.table_name),
    )
    .map((row) => ({
      rule: 'DB-P9 uuid keys',
      subject: `${row.table_name}.${row.column_name}`,
      detail: `Primary key column is ${row.data_type}, not uuid. IDs are UUID v7, except bookings.serial_number which is a per-session integer (DB-P9).`,
    }));
}

/**
 * The append-only logs, and the guards each must carry.
 *
 * `queue_events` is DB-P1 itself. `bed_events` is "append-only like the
 * queue" (DATABASE.md §2.5): the public freshness stamp and every occupancy
 * figure are read from it, so an edited bed history is an edited claim about
 * what a hospital could take.
 */
const APPEND_ONLY_LOGS: readonly { table: string; guards: readonly string[]; why: string }[] = [
  {
    table: 'queue_events',
    guards: ['fn_queue_events_no_mutate', 'fn_queue_events_no_truncate'],
    why: 'The queue is derived from this log and disputes are settled by replaying it; it must not be editable (DB-P1, FR-QUE-05).',
  },
  {
    table: 'bed_events',
    guards: ['fn_bed_events_no_mutate', 'fn_bed_events_no_truncate'],
    why: 'Bed freshness and occupancy are read from this history; it must not be editable (DATABASE.md §2.5, FR-OFF-03).',
  },
];

/**
 * DB-P1: the event logs are append-only.
 *
 * Checked by asserting the guards exist rather than by attempting a write,
 * because `db:verify` runs against a developer's database and must not touch
 * a row. The schema tests do attempt the writes.
 */
async function checkAppendOnlyLog(client: Client): Promise<Violation[]> {
  const violations: Violation[] = [];

  for (const log of APPEND_ONLY_LOGS) {
    const { rows } = await client.query<{ proname: string }>(
      `SELECT p.proname
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE c.relname = $1 AND NOT t.tgisinternal`,
      [log.table],
    );

    const guards = new Set(rows.map((row) => row.proname));

    for (const guard of log.guards) {
      if (!guards.has(guard)) {
        violations.push({
          rule: 'DB-P1 append-only event log',
          subject: log.table,
          detail: `Missing the ${guard} trigger. ${log.why}`,
        });
      }
    }
  }

  return violations;
}

/**
 * DATABASE.md §1: the enum label sets are a contract.
 *
 * `DATABASE_ENUMS` in @platform/domain is the single definition — the same one
 * the reducer switches over and the client validates against. Comparing the
 * database to it here means a label added on one side and forgotten on the
 * other fails CI rather than reaching a console as an unhandled case.
 */
async function checkEnums(client: Client): Promise<Violation[]> {
  // enumlabel is of type `name`; pg has no array parser for name[], so it would
  // arrive as the raw string "{a,b,c}". Cast to text[] to get a real array.
  const { rows } = await client.query<{ enum_name: string; labels: string[] }>(`
    SELECT t.typname AS enum_name,
           array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    GROUP BY t.typname
  `);

  const actual = new Map(rows.map((row) => [row.enum_name, row.labels]));
  const violations: Violation[] = [];

  // DATABASE_ENUMS is declared with literal tuples so the domain gets exact
  // union types from it; widening here is what lets this loop compare them
  // against labels read out of the catalogue as plain strings.
  const expectedEnums: Record<string, readonly string[]> = DATABASE_ENUMS;

  for (const [name, expected] of Object.entries(expectedEnums)) {
    const labels = actual.get(name);

    if (labels === undefined) {
      violations.push({
        rule: 'DATABASE.md §1 enums',
        subject: name,
        detail: 'Enum type is missing.',
      });
      continue;
    }

    const missing = expected.filter((label) => !labels.includes(label));
    const unexpected = labels.filter((label) => !expected.includes(label));

    if (missing.length > 0 || unexpected.length > 0) {
      violations.push({
        rule: 'DATABASE.md §1 enums',
        subject: name,
        detail: [
          missing.length > 0 ? `missing: ${missing.join(', ')}` : undefined,
          unexpected.length > 0 ? `not in the document: ${unexpected.join(', ')}` : undefined,
          'The same labels travel through the event log, the realtime payloads and the client.',
        ]
          .filter((part): part is string => part !== undefined)
          .join(' · '),
      });
    }
  }

  return violations;
}
