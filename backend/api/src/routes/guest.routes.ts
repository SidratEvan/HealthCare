/**
 * Guest routes (BACKEND.md §7.1).
 *
 * `GET /guest/link/:token` is the only one built. It carries no `requireAuth`
 * on purpose: the token in the path *is* the credential, and demanding a
 * second one would mean a login wall in front of the screen whose whole point
 * is that there is none (`FR-GST-01`, `FR-GST-05`).
 *
 * The service is what decides whether the token is live — expired, revoked and
 * never-existed all return the same 410, so a caller guessing at tokens learns
 * nothing from the difference.
 */

import { Router } from 'express';

import { trackingLinkParams, trackingReportParams } from '@platform/domain';

import * as guest from '../controllers/guest.controller.js';
import { validate } from '../middleware/validate.js';

export const guestRoutes: Router = Router();

guestRoutes.get(
  '/guest/link/:token',
  validate({ params: trackingLinkParams }),
  guest.openTrackingLink,
);

// The report behind one of that booking's tests (`TAB-A12-REP`, `FR-GST-08`).
// Scoped to the link's own booking in the service: a live token must not open
// a report from somebody else's visit.
guestRoutes.get(
  '/guest/link/:token/reports/:reportId',
  validate({ params: trackingReportParams }),
  guest.reportUrl,
);
