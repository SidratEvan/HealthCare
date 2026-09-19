/**
 * Discovery routes (BACKEND.md §7.2) — public, no auth.
 *
 * "Public, no auth" is the whole design of this surface, not an oversight. A
 * patient looking for a cardiologist at two in the morning must not meet a
 * login wall (`FR-GST-01`), and nothing these endpoints return identifies a
 * person: facilities, doctors, chambers and session windows are what a
 * hospital already puts on a board in its own lobby.
 *
 * `attachPrincipal` still runs upstream, so a signed-in patient is recognised
 * — it simply is not required.
 */

import { Router } from 'express';

import { doctorQuery, hospitalQuery, idParams, sessionQuery } from '@platform/domain';

import * as discovery from '../controllers/discovery.controller.js';
import { validate } from '../middleware/validate.js';

export const discoveryRoutes: Router = Router();

discoveryRoutes.get('/hospitals', validate({ query: hospitalQuery }), discovery.listHospitals);
discoveryRoutes.get('/hospitals/:id', validate({ params: idParams }), discovery.getHospital);

/**
 * The doctors at one hospital (`S-A-05h`).
 *
 * `S-A-07` lists hospitals offering a specialty; this is what a card there
 * opens. The pair is the documented order — a patient picks a place they can
 * reach, then a person inside it.
 */
discoveryRoutes.get(
  '/hospitals/:id/doctors',
  validate({ params: idParams }),
  discovery.getHospitalDoctors,
);

discoveryRoutes.get('/doctors', validate({ query: doctorQuery }), discovery.listDoctors);
discoveryRoutes.get('/doctors/:id', validate({ params: idParams }), discovery.getDoctor);

discoveryRoutes.get('/sessions', validate({ query: sessionQuery }), discovery.listSessions);

/**
 * Serials taken against capacity, and the wait a patient booking now would
 * face (`S-A-07b`).
 *
 * Deliberately not under `/queue`: that surface is staff-only and carries
 * patient names. This one carries counts and a timestamp, which is what a
 * stranger choosing a chamber needs and the most they should get.
 */
discoveryRoutes.get(
  '/sessions/:id/availability',
  validate({ params: idParams }),
  discovery.getAvailability,
);
