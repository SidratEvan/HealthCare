/**
 * Admin dashboard routes (BACKEND.md §7.7, `FR-ADM-01`..`FR-ADM-10`).
 *
 * Two endpoints, one role, no writes.
 *
 * ## No hospital in the path, on purpose
 *
 * Every other hospital-scoped router in this codebase takes the facility as a
 * path parameter and checks it with `requireHospitalScope`. This one does not:
 * the hospital comes off the principal, in the controller, and there is no way
 * for a caller to name one at all.
 *
 * The reason is what these endpoints return. `/hospitals/:id/settlement`
 * answers a question about rows a caller could already reach one at a time;
 * `/admin/dashboard` answers "what did this hospital earn, how late are its
 * doctors, where is it losing patients" in a single read. A scope check that
 * is merely *correct* is not enough for that — it has to be impossible to get
 * wrong, and a parameter nobody accepts cannot be checked incorrectly.
 *
 * ## Why the export is a GET
 *
 * It writes an `audit_log` row, which normally argues for a POST. But it is a
 * download: a browser follows a link, sets no headers and sends no body, and
 * making it a POST would mean building the file through fetch and a blob URL
 * to achieve nothing. The write it performs is a record *of* the read, not a
 * change to anything a second identical request would alter — two exports
 * produce the same file and two audit rows, which is exactly right.
 */

import { Router } from 'express';
import { z } from 'zod';

import * as admin from '../controllers/admin.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate } from '../middleware/validate.js';

export const adminRoutes: Router = Router();

/** Dhaka calendar dates, both optional: no range means today. */
const rangeQuery = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

const exportQuery = rangeQuery.extend({ view: z.string().min(1).max(40) });

adminRoutes.get(
  '/admin/dashboard',
  requireAuth,
  requireRole('hospital_admin'),
  validate({ query: rangeQuery }),
  admin.getDashboard,
);

adminRoutes.get(
  '/admin/export',
  requireAuth,
  requireRole('hospital_admin'),
  validate({ query: exportQuery }),
  admin.getExport,
);
