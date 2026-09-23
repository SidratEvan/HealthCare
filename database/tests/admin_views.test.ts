/**
 * The three objects `S-B-10` reads (migration 0020; `FR-ADM-01`..`FR-ADM-07`).
 *
 * Run against the seeded demo database, like every other suite (`CLAUDE.md`
 * §6). A view is mostly SQL asserting things about other SQL, so what is
 * checked here is what a query cannot check about itself: that the totals
 * relate to each other the way the screen assumes, that a materialised view
 * can actually be refreshed without locking the dashboard out, and that none
 * of the three is a route around "hospital admin reads aggregate only"
 * (`DATABASE.md` §5).
 */

import { describe, expect, it } from 'vitest';

import { connect } from './support/database.js';

async function query<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
  const client = await connect();
  try {
    const result = await client.query<T>(sql);
    return result.rows;
  } finally {
    await client.end();
  }
}

/** Column names of a view or materialised view, as the catalogue has them. */
async function columnsOf(relation: string): Promise<string[]> {
  const rows = await query<{ column_name: string }>(`
    SELECT a.attname AS column_name
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
     WHERE c.relname = '${relation}' AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum
  `);
  return rows.map((row) => row.column_name);
}

describe('no admin view is a route to an identifiable patient', () => {
  // `DATABASE.md` §5: "hospital admin reads aggregate only". A `patient_id` in
  // any of these is one join away from being a way around that, and it would
  // be an easy column to add without noticing what it undoes.
  it.each(['v_admin_daily', 'v_no_show_loss', 'v_referral_flow'])(
    '%s carries no patient column',
    async (relation) => {
      const columns = await columnsOf(relation);

      expect(columns).not.toContain('patient_id');
      expect(columns.filter((name) => name.includes('patient'))).toEqual([]);
      expect(columns.filter((name) => name.includes('phone'))).toEqual([]);
      expect(columns.filter((name) => name.includes('name'))).toEqual([]);
    },
  );
});

describe('v_admin_daily (FR-ADM-01, FR-ADM-02, FR-ADM-04, FR-ADM-05)', () => {
  it('can be refreshed concurrently, which is what keeps a refresh off the read path', async () => {
    // CONCURRENTLY needs a unique index. Without one PostgreSQL takes an
    // ACCESS EXCLUSIVE lock and every dashboard read queues behind the
    // refresh — which, with a five-minute staleness rule, is every fifth
    // read of the day.
    const client = await connect();
    try {
      await expect(
        client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY v_admin_daily'),
      ).resolves.toBeDefined();
    } finally {
      await client.end();
    }
  });

  it('splits every booking into walk-in or booked, with nothing falling between', async () => {
    // `FR-ADM-01` asks for the ratio, and a ratio whose halves do not add up
    // to the whole is a ratio of nothing. A new `booking_source` enum value
    // that nobody classified would show up here as a shortfall.
    const rows = await query<{ mismatched: string }>(`
      SELECT count(*)::text AS mismatched
        FROM v_admin_daily
       WHERE walkin_count + booked_count <> booked_total
    `);

    expect(rows[0]?.mismatched).toBe('0');
  });

  it('never reports more patients seen than were booked', async () => {
    const rows = await query<{ impossible: string }>(`
      SELECT count(*)::text AS impossible
        FROM v_admin_daily
       WHERE seen > booked_total OR no_shows > booked_total
    `);

    expect(rows[0]?.impossible).toBe('0');
  });

  it('reports a wait only where one was measured', async () => {
    // A queue that never recorded arrivals has no wait to report, and a null
    // is the honest answer. A zero would be a claim nobody made.
    const rows = await query<{ fabricated: string }>(`
      SELECT count(*)::text AS fabricated
        FROM v_admin_daily
       WHERE (waits_measured = 0 AND avg_wait_minutes IS NOT NULL)
          OR (waits_measured > 0 AND avg_wait_minutes IS NULL)
    `);

    expect(rows[0]?.fabricated).toBe('0');
  });

  it('never reports a longest wait shorter than the average', async () => {
    const rows = await query<{ impossible: string }>(`
      SELECT count(*)::text AS impossible
        FROM v_admin_daily
       WHERE longest_wait_minutes IS NOT NULL
         AND avg_wait_minutes IS NOT NULL
         AND longest_wait_minutes < avg_wait_minutes
    `);

    expect(rows[0]?.impossible).toBe('0');
  });

  it('has a row for every hospital-day that has bookings, and only those', async () => {
    const rows = await query<{ expected: string; actual: string }>(`
      SELECT (
        SELECT count(DISTINCT (s.hospital_id, s.session_date))::text
          FROM bookings b
          JOIN sessions s ON s.id = b.session_id
         WHERE b.deleted_at IS NULL AND s.deleted_at IS NULL
      ) AS expected,
      (SELECT count(*)::text FROM v_admin_daily) AS actual
    `);

    expect(rows[0]?.actual).toBe(rows[0]?.expected);
  });
});

describe('v_no_show_loss (FR-ADM-03)', () => {
  it('counts exactly the bookings that ended as a no-show', async () => {
    const rows = await query<{ view_total: string; table_total: string }>(`
      SELECT (SELECT coalesce(sum(no_show_count), 0)::text FROM v_no_show_loss) AS view_total,
             (SELECT count(*)::text
                FROM bookings b
                JOIN sessions s ON s.id = b.session_id
               WHERE b.status = 'no_show'
                 AND b.deleted_at IS NULL AND s.deleted_at IS NULL) AS table_total
    `);

    expect(rows[0]?.view_total).toBe(rows[0]?.table_total);
  });

  it('reports prepaid money separately, so a loss figure can exclude it', async () => {
    // The column exists because a prepaid no-show is money the hospital kept.
    // `shared/domain/admin/recovery.ts` does the subtraction; this checks the
    // view gives it something to subtract.
    const columns = await columnsOf('v_no_show_loss');
    expect(columns).toContain('prepaid_poisha');
    expect(columns).toContain('forgone_poisha');
  });

  it('never counts a refunded payment as money the hospital still holds', async () => {
    const rows = await query<{ overstated: string }>(`
      SELECT count(*)::text AS overstated
        FROM v_no_show_loss
       WHERE prepaid_poisha < 0
    `);

    expect(rows[0]?.overstated).toBe('0');
  });

  it('counts recovered value only against offers somebody accepted', async () => {
    // `slot_offers_value_requires_acceptance` holds this at the row level; the
    // view could still sum the wrong rows.
    const rows = await query<{ leaked: string }>(`
      SELECT count(*)::text AS leaked
        FROM v_no_show_loss
       WHERE offers_accepted = 0 AND recovered_poisha <> 0
    `);

    expect(rows[0]?.leaked).toBe('0');
  });

  it('never reports more acceptances than offers', async () => {
    const rows = await query<{ impossible: string }>(`
      SELECT count(*)::text AS impossible
        FROM v_no_show_loss
       WHERE offers_accepted > offers_made
    `);

    expect(rows[0]?.impossible).toBe('0');
  });
});

describe('v_referral_flow (FR-ADM-07)', () => {
  it('has a row for every live hospital, including those with no referrals', async () => {
    // A hospital that has never referred anybody reads as zeroes, not as a
    // missing row: "we sent none" and "we did not look" are different answers.
    const rows = await query<{ hospitals: string; flows: string }>(`
      SELECT (SELECT count(*)::text FROM hospitals WHERE deleted_at IS NULL) AS hospitals,
             (SELECT count(*)::text FROM v_referral_flow) AS flows
    `);

    expect(rows[0]?.flows).toBe(rows[0]?.hospitals);
  });

  it('counts a leak only where the other end took the patient', async () => {
    // A declined referral is not a leak — the patient stayed. Counting it
    // would report care lost that the hospital actually kept.
    const rows = await query<{ wrong: string }>(`
      SELECT count(*)::text AS wrong
        FROM v_referral_flow
       WHERE leaked <> sent_accepted
    `);

    expect(rows[0]?.wrong).toBe('0');
  });

  it('accounts for every referral a hospital sent', async () => {
    const rows = await query<{ unaccounted: string }>(`
      SELECT count(*)::text AS unaccounted
        FROM v_referral_flow
       WHERE sent_accepted + sent_declined + sent_open > sent_total
    `);

    expect(rows[0]?.unaccounted).toBe('0');
  });

  it('reads the same rows from both ends', async () => {
    // One referral is one hospital's send and another's receipt. If the two
    // halves disagree, one of the two sides is filtering something out.
    const rows = await query<{ sent: string; received: string }>(`
      SELECT (SELECT coalesce(sum(sent_total), 0)::text FROM v_referral_flow) AS sent,
             (SELECT coalesce(sum(received_total), 0)::text FROM v_referral_flow) AS received
    `);

    expect(rows[0]?.sent).toBe(rows[0]?.received);
  });

  it('stamps a hospital that has referrals and leaves the rest unstamped', async () => {
    // `FR-ADM-07`'s section renders `<FreshnessLine>` off `as_of`. A hospital
    // with no referrals has no age, and showing one would date a figure that
    // was never taken.
    const rows = await query<{ wrong: string }>(`
      SELECT count(*)::text AS wrong
        FROM v_referral_flow
       WHERE (sent_total + received_total = 0) <> (as_of IS NULL)
    `);

    expect(rows[0]?.wrong).toBe('0');
  });
});
