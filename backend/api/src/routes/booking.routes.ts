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

import { createBookingBody } from '@platform/domain';

import * as booking from '../controllers/booking.controller.js';
import { idempotency } from '../middleware/idempotency.js';
import { validate } from '../middleware/validate.js';

export const bookingRoutes: Router = Router();

bookingRoutes.post(
  '/bookings',
  idempotency({ required: true }),
  validate({ body: createBookingBody }),
  booking.createBooking,
);
