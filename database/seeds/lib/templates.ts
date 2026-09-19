/**
 * Installs the shipped notification copy into `notification_templates`.
 *
 * `FR-NOT-05` calls for templates that are versioned and centrally managed
 * rather than hard-coded at call sites, and that is two places rather than
 * one: the defaults are reviewed and versioned in `@platform/i18n/templates`
 * with the rest of the product, and the live copy is a table row a hospital
 * can be given different wording in without a deploy.
 *
 * This is the bridge. It runs with the reference data rather than as a
 * numbered seed module, because notification copy belongs to the platform and
 * not to any hospital — there is nothing about it that depends on which
 * facilities exist, and `seed_00_reference.sql` is where the rest of the
 * platform's own reference data would be if SQL could read a TypeScript
 * constant.
 *
 * ## Why an upsert rather than an insert
 *
 * `pnpm db:reset` truncates and reseeds (`FR-DEM-06`), so an insert would be
 * enough for the demo. But this also runs against a database that has been
 * migrated and not reset, and a hospital that has edited a row should not have
 * it silently reverted by a deploy — only the body of a row nobody has touched
 * should follow the code. The compromise is honest and simple: the upsert
 * writes the shipped body only when the version in code is newer than the
 * version in the table.
 */

import { TEMPLATES } from '@platform/i18n';

import type { Client } from 'pg';

/** How many rows were written. */
export interface TemplateSeedResult {
  readonly written: number;
}

export async function writeNotificationTemplates(client: Client): Promise<TemplateSeedResult> {
  // Two locales per definition, each a row of its own: the table's primary key
  // is (key, channel, locale), because one event reads differently in Bangla
  // and English and differently again as an SMS or a push.
  const rows = TEMPLATES.flatMap((template) => [
    { key: template.key, channel: template.channel, locale: 'bn', body: template.bn, version: template.version },
    { key: template.key, channel: template.channel, locale: 'en', body: template.en, version: template.version },
  ]);

  if (rows.length === 0) return { written: 0 };

  const values: unknown[] = [];
  const tuples = rows.map((row, index) => {
    const base = index * 5;
    values.push(row.key, row.channel, row.locale, row.body, row.version);
    return `($${String(base + 1)}, $${String(base + 2)}::notif_channel, $${String(base + 3)}, $${String(base + 4)}, $${String(base + 5)})`;
  });

  const result = await client.query(
    `INSERT INTO notification_templates (key, channel, locale, body, version)
     VALUES ${tuples.join(', ')}
     ON CONFLICT (key, channel, locale) DO UPDATE
       SET body = excluded.body, version = excluded.version, is_active = true
     WHERE notification_templates.version < excluded.version
        OR notification_templates.body = excluded.body`,
    values,
  );

  return { written: result.rowCount ?? 0 };
}
