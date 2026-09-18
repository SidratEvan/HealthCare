/**
 * The row graph the schema tests share — now a re-export.
 *
 * Step 1 wrote this module's body as an explicitly provisional stand-in: it
 * said so in its own header, because CLAUDE.md §6 requires tests to run
 * against seeded demo data rather than fixtures scattered through test files,
 * and the seeds did not exist yet.
 *
 * They exist now. The graph is built in `db/seeds/graph.ts`, out of the same
 * declared demo set (`db/seeds/data`) and the same insert helpers that
 * `pnpm db:seed` uses, so there is one description of demo data in the
 * repository rather than two that can drift. The full seed is exercised by
 * `db/tests/seeds.test.ts`.
 *
 * This file stays as the tests' import path — a test that asks for a fixture
 * should not have to know where the demo data is defined.
 */

export {
  demoTestPhone as testPhone,
  insertBooking,
  insertExtraPatient,
  insertGraph,
  GRAPH_DOCTOR,
  GRAPH_FACILITY,
  type Graph,
} from '../../seeds/graph.js';
