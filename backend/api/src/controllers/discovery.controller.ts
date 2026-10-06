/**
 * Discovery controllers (BACKEND.md §3, §7.2).
 *
 * Public and unauthenticated. Thin, like every controller here: parse what the
 * route validated, call a service, shape a response.
 */

import {
  configQuery,
  doctorQuery,
  hospitalQuery,
  idParams,
  searchQuery,
  sessionQuery,
} from '@platform/domain';

import * as deployment from '../services/deployment.service.js';
import * as discovery from '../services/discovery.service.js';

import type { Request, Response } from 'express';

export async function listHospitals(req: Request, res: Response): Promise<void> {
  const query = hospitalQuery.parse(req.query);
  const { items, asOf } = await discovery.searchHospitals(query);

  res.json({ ok: true, data: { hospitals: items, asOf } });
}

/** `GET /search` — one search across the network (`S-A-07s`, `FR-PAT-16`). */
export async function search(req: Request, res: Response): Promise<void> {
  const query = searchQuery.parse(req.query);
  res.json({ ok: true, data: await discovery.search(query) });
}

export async function getHospital(req: Request, res: Response): Promise<void> {
  const { id } = idParams.parse(req.params);
  res.json({ ok: true, data: await discovery.hospitalDetail(id) });
}

/** `GET /hospitals/:id/doctors` — `S-A-05h`'s ডাক্তার tab. */
export async function getHospitalDoctors(req: Request, res: Response): Promise<void> {
  const { id } = idParams.parse(req.params);
  const specialty = typeof req.query['specialty'] === 'string' ? req.query['specialty'] : undefined;

  const { items, asOf } = await discovery.doctorsAt(id, specialty);

  res.json({ ok: true, data: { doctors: items, asOf } });
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

/**
 * `GET /config` — what this deployment offers (pilot step 26): whether it is a
 * demonstration, whether online payment exists, whether a guest proves the
 * phone before booking. Public; nothing in it is a secret.
 */
export async function getConfig(req: Request, res: Response): Promise<void> {
  const { scope } = configQuery.parse(req.query);

  // `scope` is null for the network's own app. For a hospital's, it is whose
  // app this is and in which colours (`FR-BRD-02`, `FR-BRD-03`); an unknown
  // code is a 404 rather than a silent fall back to the whole network.
  const scoped = scope === undefined ? null : await discovery.scopeInfo(scope);

  res.json({
    ok: true,
    data: {
      ...deployment.publicConfig(),
      scope:
        scoped === null
          ? null
          : {
              code: scoped.code,
              nameBn: scoped.nameBn,
              nameEn: scoped.nameEn,
              theme: scoped.theme,
            },
    },
  });
}
