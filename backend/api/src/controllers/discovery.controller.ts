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

import { env } from '../env.js';
import { notFound } from '../errors/AppError.js';
import * as deployment from '../services/deployment.service.js';
import * as discovery from '../services/discovery.service.js';
import * as portals from '../services/portal.service.js';

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
  const { scope, host } = configQuery.parse(req.query);

  // `scope` is null for the network's own app. For a hospital's, it is whose
  // app this is and in which colours (`FR-BRD-02`, `FR-BRD-03`); an unknown
  // code is a 404 rather than a silent fall back to the whole network.
  //
  // The address decides before the parameter does (`FR-BRD-07`): opened at a
  // hospital's portal the app is that hospital's with nothing asked for, and
  // `?scope=` there does not make it another's.
  const address = host === undefined ? null : await portals.addressOf(host);
  const atPortal = address?.kind === 'portal' ? address.code : null;
  const code = atPortal ?? scope;
  const scoped = code === undefined ? null : await discovery.scopeInfo(code);

  res.json({
    ok: true,
    data: {
      ...deployment.publicConfig(),
      // What the address the app was opened at is: the network's, a
      // hospital's portal, or nobody's. At nobody's the API answers a browser
      // nothing but this (`middleware/cors.ts`), so the app is told where
      // the network is and can say so.
      address: address?.kind ?? 'network',
      ...(address?.kind === 'nobodys' ? { networkUrl: env.WEB_BASE_URL } : {}),
      scope:
        scoped === null
          ? null
          : {
              code: scoped.code,
              // Public already: every hospital card carries its id. Here so
              // an app open for one hospital can tell which of the bookings
              // this phone holds are that hospital's.
              hospitalId: scoped.hospitalId,
              nameBn: scoped.nameBn,
              nameEn: scoped.nameEn,
              theme: scoped.theme,
              // Its own words and its logo (`FR-BRD-06`): what the app shows
              // in place of the platform's name and mark.
              descriptionBn: scoped.descriptionBn,
              descriptionEn: scoped.descriptionEn,
              logoVersion: scoped.logoVersion,
              logoImage: scoped.logoImage,
              // What it does not run and what it keeps (`FR-BRD-11`,
              // `FR-NET-04`): its portal offers nothing of either.
              modulesOff: scoped.modulesOff,
              notShared: scoped.notShared,
              // True when the address itself is this hospital's portal, so
              // the app knows the scope is not the visitor's to change.
              byAddress: atPortal !== null,
            },
    },
  });
}

/**
 * `GET /hospitals/:id/logo` — a hospital's logo (`FR-BRD-06`).
 *
 * Public, like the card it is shown on. The address the app is given carries
 * the logo's version (`?v=`), so what such an address names never changes
 * and a phone may keep it for a year; an address without the current version
 * is kept for five minutes. Another origin may show it: a hospital's portal
 * can be on the hospital's own domain (`FR-BRD-07`).
 */
export async function getLogo(req: Request, res: Response): Promise<void> {
  const { id } = idParams.parse(req.params);
  const file = await discovery.logo(id);
  if (file === null) throw notFound('logo');

  res.setHeader('Content-Type', file.contentType);
  res.setHeader(
    'Cache-Control',
    req.query['v'] === file.version ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
  );
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.send(file.bytes);
}
