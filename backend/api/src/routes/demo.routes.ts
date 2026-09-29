/**
 * Demo sign-in (CLAUDE.md §4.1).
 *
 * Replaces `S-B-00` Staff login for the pitch version, and exists only while
 * `DEMO_MODE` is on — the service refuses otherwise, and `env.ts` refuses to
 * boot with `DEMO_MODE=true` under `NODE_ENV=production`.
 *
 * No `requireAuth`, for the obvious reason: this is how a caller gets the
 * credential that every other guarded route wants. What bounds it is that it
 * can only ever hand back a principal for a seeded staff account at a live
 * facility, and only for a role this version has a console for.
 */

import { Router } from 'express';

import { demoTokenBody } from '@platform/domain';

import * as demo from '../controllers/demo.controller.js';
import { validate } from '../middleware/validate.js';

export const demoRoutes: Router = Router();

// Whether this deployment is a demonstration — asked by the console before it
// decides between the picker and the sign-in screen (pilot step 21). Answers
// on every deployment, unlike the two routes below.
demoRoutes.get('/demo/status', demo.status);
demoRoutes.get('/demo/consoles', demo.listConsoles);

demoRoutes.post('/demo/token', validate({ body: demoTokenBody }), demo.mintToken);
