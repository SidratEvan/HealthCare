/**
 * `pnpm db:verify` — asserts the schema invariants from DATABASE.md §0.
 *
 * Read-only. Safe to run against any database the caller can reach, including
 * one with real rows in it, because it inspects the catalogue and never writes
 * or reads application data.
 *
 * Exits non-zero on the first run that finds anything, and prints everything
 * it found rather than stopping at the first problem.
 */

import { Client } from 'pg';

import { describe, requireDatabaseUrl } from './lib/env.js';
import { verifySchema, type Violation } from './lib/verify.js';

async function main(): Promise<void> {
  const variable = process.argv.includes('--test') ? 'DATABASE_URL_TEST' : 'DATABASE_URL';
  const connectionString = requireDatabaseUrl(variable);

  const { host, database } = describe(connectionString);
  console.log(`verifying ${database} on ${host}`);

  const client = new Client({ connectionString });
  await client.connect();

  let violations: Violation[];
  try {
    violations = await verifySchema(client);
  } finally {
    await client.end();
  }

  if (violations.length === 0) {
    console.log('schema invariants hold');
    return;
  }

  console.error(`\n${String(violations.length)} violation(s):\n`);
  for (const group of groupByRule(violations)) {
    console.error(`  ${group.rule}`);
    for (const violation of group.violations) {
      console.error(`    ${violation.subject}`);
      console.error(`      ${violation.detail}`);
    }
    console.error('');
  }

  process.exitCode = 1;
}

function groupByRule(
  violations: readonly Violation[],
): { rule: string; violations: Violation[] }[] {
  const byRule = new Map<string, Violation[]>();
  for (const violation of violations) {
    const existing = byRule.get(violation.rule);
    if (existing === undefined) {
      byRule.set(violation.rule, [violation]);
    } else {
      existing.push(violation);
    }
  }
  return [...byRule.entries()].map(([rule, group]) => ({ rule, violations: group }));
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
