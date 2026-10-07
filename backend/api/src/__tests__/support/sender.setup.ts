/**
 * After every API test: wait for the sender, and leave no message waiting.
 *
 * Since plan H1 a request hands its messages to a sender and answers; the
 * sender works from the table, taking every row that is due, whoever queued
 * it. That is the point of it on a hospital's server, and in a suite on one
 * shared database it means a message one test left queued (a gateway it made
 * refuse, due again in a quarter of a minute) would be sent by the sender of
 * a later test, through that test's stand-in gateway, and counted there.
 *
 * So each test ends with what it caused having happened (`settled`), and
 * whatever it left queued is closed, saying so. The modules are imported
 * here and not at the top: `env.setup.ts` has to have run first.
 */

import { afterEach } from 'vitest';

afterEach(async () => {
  const [{ settled }, { db }, { sql }] = await Promise.all([
    import('../../services/notification.service.js'),
    import('../../config/db.js'),
    import('kysely'),
  ]);

  await settled();
  await sql`
    UPDATE notifications
       SET state = 'failed', error = 'left_by_a_test'
     WHERE state = 'queued'
  `.execute(db);
});
