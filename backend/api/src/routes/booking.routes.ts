/**
 * Booking routes (BACKEND.md §7.3).
 *
 * `POST /bookings` takes `user | guest` — a guest booking is the same endpoint
 * with the same rules, not a lesser path (`FR-GST-01`). So there is no
 * `requireAuth` here: the controller decides who is booking from whatever
 * principal `attachPrincipal` found, and a request with none supplies guest
 * details instead.
 *
 * The idempotency key is required. This is the one button in the product that
 * takes money and allocates a serial, and a patient on a bad connection
 * double-tapping it must not end up with two bookings and two charges
 * (`FR-QUE-51`, `APP_FLOW.md` A4).
 */

import { Router } from 'express';

import { cancelBookingBody, createBookingBody, idParams } from '@platform/domain';

import * as booking from '../controllers/booking.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireBookingScope } from '../middleware/guestAuth.js';
import { idempotency } from '../middleware/idempotency.js';
import { validate } from '../middleware/validate.js';

export const bookingRoutes: Router = Router();

bookingRoutes.post(
  '/bookings',
  idempotency({ required: true }),
  validate({ body: createBookingBody }),
  booking.createBooking,
);

/**
 * `GET /bookings/:id` — what `S-A-08` paints before its socket connects.
 *
 * `requireBookingScope('id')` is the tracking link's fence: a guest principal
 * carries exactly one booking id (`FR-GST-05`), and a link for one booking must
 * not read another, or a forwarded SMS becomes a way to walk a hospital's
 * queue. It passes any non-guest through; the controller then checks ownership
 * against the rows, which is the only place that answer lives.
 */
bookingRoutes.get(
  '/bookings/:id',
  requireAuth,
  requireBookingScope('id'),
  validate({ params: idParams }),
  booking.getBooking,
);

/**
 * `POST /bookings/:id/cancel` (`FR-PAT-23`).
 *
 * Idempotency required, like every write that changes a queue: a patient on a
 * bad connection tapping "বাতিল করুন" twice must cancel once, and the console
 * replaying an offline shift must not append a second cancellation to a
 * booking that has already gone (`FR-QUE-51`).
 */
bookingRoutes.post(
  '/bookings/:id/cancel',
  requireAuth,
  requireBookingScope('id'),
  idempotency({ required: true }),
  validate({ params: idParams, body: cancelBookingBody }),
  booking.cancelBooking,
);
