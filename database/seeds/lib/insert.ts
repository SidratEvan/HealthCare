/**
 * Batched inserts.
 *
 * The seeds write a few thousand rows, and the target is usually Supabase in
 * Singapore rather than a container on localhost. One `INSERT` per row means
 * one round trip per row, which turns `pnpm db:reset` from four seconds into
 * four minutes — long enough that nobody runs it before a demo, which defeats
 * the point of `FR-DEM-06`.
 *
 * So rows go in as multi-row `INSERT`s, chunked to stay under PostgreSQL's
 * 65535-parameter limit, and `RETURNING` comes back in insertion order — which
 * is what lets a caller pair generated ids with the inputs that produced them.
 */

import type { Client } from 'pg';

/** PostgreSQL's hard limit on bind parameters in one statement. */
const MAX_PARAMETERS = 65535;

export interface InsertOptions {
  /** Columns, in the order each row's values are given. */
  readonly columns: readonly string[];
  /**
   * Raw SQL for a column whose value is not a parameter — a generated default,
   * or an expression such as `now()`. Keyed by column name.
   *
   * Only ever called with literals written in this repository; nothing from a
   * row or an environment variable reaches it.
   */
  readonly expressions?: Readonly<Record<string, string>>;
}

/**
 * Inserts `rows` into `table` and returns the `RETURNING` projection, in the
 * order the rows were given.
 *
 * @param returning a column list, e.g. `'id'` or `'id, seq'`. Pass an empty
 *   string for an insert whose output nobody needs.
 */
export async function insertRows<T extends Record<string, unknown>>(
  client: Client,
  table: string,
  options: InsertOptions,
  rows: readonly (readonly unknown[])[],
  returning = 'id',
): Promise<T[]> {
  if (rows.length === 0) return [];

  const { columns, expressions = {} } = options;
  const parameterised = columns.filter((column) => expressions[column] === undefined);
  const perRow = parameterised.length;

  for (const [index, row] of rows.entries()) {
    if (row.length !== perRow) {
      throw new Error(
        `Row ${String(index)} of the ${table} insert has ${String(row.length)} values for ${String(perRow)} parameterised columns (${parameterised.join(', ')}).`,
      );
    }
  }

  // At least one row per statement, however wide the table.
  const chunkSize = perRow === 0 ? rows.length : Math.max(1, Math.floor(MAX_PARAMETERS / perRow));
  const collected: T[] = [];

  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const values: unknown[] = [];
    const tuples: string[] = [];

    for (const row of chunk) {
      let cursor = 0;
      const placeholders = columns.map((column) => {
        const expression = expressions[column];
        if (expression !== undefined) return expression;
        values.push(row[cursor]);
        cursor += 1;
        return `$${String(values.length)}`;
      });
      tuples.push(`(${placeholders.join(', ')})`);
    }

    const sql = [
      `INSERT INTO ${table} (${columns.join(', ')})`,
      `VALUES ${tuples.join(', ')}`,
      returning === '' ? '' : `RETURNING ${returning}`,
    ]
      .filter((line) => line !== '')
      .join('\n');

    const { rows: returned } = await client.query<T>(sql, values);
    collected.push(...returned);
  }

  return collected;
}

/** Runs a statement expected to return exactly one row, and returns it. */
export async function one<T extends Record<string, unknown>>(
  client: Client,
  sql: string,
  values: readonly unknown[] = [],
): Promise<T> {
  const { rows } = await client.query<T>(sql, [...values]);
  const row = rows[0];
  if (row === undefined) throw new Error(`Expected one row from: ${sql}`);
  return row;
}

/** Runs a `count(*)` and returns it as a number. */
export async function count(client: Client, table: string, where = ''): Promise<number> {
  const clause = where === '' ? '' : ` WHERE ${where}`;
  const row = await one<{ n: string }>(client, `SELECT count(*)::text AS n FROM ${table}${clause}`);
  return Number(row.n);
}

/** True when `table` exists in the public schema. */
export async function tableExists(client: Client, table: string): Promise<boolean> {
  const row = await one<{ present: boolean }>(
    client,
    `SELECT to_regclass($1) IS NOT NULL AS present`,
    [`public.${table}`],
  );
  return row.present;
}
