/**
 * Health routes. Public, unversioned, and mounted outside `/api/v1` because a
 * load balancer probe should not move when the API version does.
 */

import { Router } from 'express';

import { getHealth, getReady } from '../controllers/health.controller.js';

export const healthRoutes: Router = Router();

healthRoutes.get('/healthz', getHealth);
healthRoutes.get('/readyz', getReady);
