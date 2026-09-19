/**
 * Discovery controllers (BACKEND.md §3, §7.2).
 *
 * Public and unauthenticated. Thin, like every controller here: parse what the
 * route validated, call a service, shape a response.
 */

import { doctorQuery, hospitalQuery, idParams, sessionQuery } from '@platform/domain';

import * as discovery from '../services/discovery.service.js';

import type { Request, Response } from 'express';

export async function listHospitals(req: Request, res: Response): Promise<void> {
  const query = hospitalQuery.parse(req.query);
  res.json({ ok: true, data: { hospitals: await discovery.searchHospitals(query) } });
}

export async function getHospital(req: Request, res: Response): Promise<void> {
  const { id } = idParams.parse(req.params);
  res.json({ ok: true, data: await discovery.hospitalDetail(id) });
}

export async function listDoctors(req: Request, res: Response): Promise<void> {
  const query = doctorQuery.parse(req.query);
  res.json({ ok: true, data: { doctors: await discovery.searchDoctors(query) } });
}

export async function getDoctor(req: Request, res: Response): Promise<void> {
  const { id } = idParams.parse(req.params);
  res.json({ ok: true, data: await discovery.doctorDetail(id) });
}

export async function listSessions(req: Request, res: Response): Promise<void> {
  const query = sessionQuery.parse(req.query);
  res.json({ ok: true, data: { sessions: await discovery.sessionsFor(query) } });
}

/** `GET /sessions/:id/availability` — what `S-A-07b` puts on a session card. */
export async function getAvailability(req: Request, res: Response): Promise<void> {
  const { id } = idParams.parse(req.params);
  res.json({ ok: true, data: await discovery.availability(id) });
}
