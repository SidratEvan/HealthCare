/**
 * `db/seeds` — the one description of this repository's demo data.
 *
 * Everything anyone outside this directory should need comes through here: the
 * CLI entry points (`seed.ts`, `reset.ts`), the schema tests, and eventually
 * the API's `DEMO_MODE` surfaces. The declared demo set lives in `./data`, the
 * order the modules run in lives in `./run.ts`, and neither has a second copy.
 *
 * The ordered module list and the runner are in `./run.ts` rather than here, so
 * that importing a name from this barrel cannot drag the whole seed graph in
 * behind it.
 */

export { SEED_MODULES, SEED_REFERENCE_SQL, seedDemoData } from './run.js';
export type { SeedOptions, SeedResult } from './run.js';

export { insertGraph, insertBooking, insertExtraPatient, demoTestPhone } from './graph.js';
export type { Graph } from './graph.js';

export { DEMO_FACILITIES, facility } from './data/hospitals.js';
export { DEMO_DOCTORS, doctor } from './data/doctors.js';
export { DEMO_LIVE, SPECIALTIES } from './data/reference.js';

export { ACCOUNT_COUNT, GUEST_COUNT, PATIENT_COUNT } from './seed_03_patients.js';
export { HISTORY_VISIT_TARGET } from './seed_04_history.js';
export { SESSION_DAYS } from './seed_02_doctors_sessions.js';

export { DEMO_LABEL_BN, DEMO_LABEL_EN, DEMO_MARKER, isLabelled } from './lib/demo.js';
export { DEMO_SEED } from './lib/random.js';
export type { ModuleResult, SeedModule, SeedSummary } from './lib/runner.js';
