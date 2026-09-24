/**
 * The national layer (BACKEND.md §7.7, `FR-GOV-01`..`FR-GOV-06`).
 *
 * Four reads, one role, no writes, no parameters. `BACKEND.md` §7.7 lists
 * the first three; `/gov/benchmarks` is `FR-GOV-04`, which `APP_FLOW.md` B8
 * puts on the same screen and the table had not yet given a route.
 *
 * ## `requireNationalRole`, not `requireRole`
 *
 * A government viewer is not a hospital's staff, and the principal says so
 * (`kind: 'national'`). Every hospital route refuses that kind before looking
 * at roles; these routes refuse every other kind. So the two sets of routes
 * cannot be crossed from either side — a receptionist cannot read the national
 * map, and a government viewer cannot open a chamber (`FR-ROLE-04`).
 */

import { Router } from 'express';

import * as gov from '../controllers/gov.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireNationalRole } from '../middleware/requireRole.js';

export const govRoutes: Router = Router();

const viewer = [requireAuth, requireNationalRole('gov_viewer')] as const;

govRoutes.get('/gov/capacity', ...viewer, gov.getCapacity);
govRoutes.get('/gov/er-load', ...viewer, gov.getErLoad);
govRoutes.get('/gov/signals', ...viewer, gov.getSignals);
govRoutes.get('/gov/benchmarks', ...viewer, gov.getBenchmarks);
