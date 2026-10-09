/**
 * Cross-origin access, by allowlist (BACKEND.md §3).
 *
 * The API and the browser apps are separate deployments on separate origins —
 * the patient PWA, the staff console, the API (FRONTEND.md §10) — so every
 * request from a browser is cross-origin and the interesting ones are
 * preflighted.
 *
 * ## Why an allowlist and not `*`
 *
 * Every endpoint here is authenticated by a bearer token. `Access-Control-
 * Allow-Origin: *` would let any page on the internet call this API with a
 * token it had got hold of, and read the reply — a patient's queue position,
 * a hospital's whole session. The origins that may do that are the two we
 * deploy, and they are named.
 *
 * Written rather than taken from `cors`: this is twenty lines, the package is
 * a dependency, and CLAUDE.md §7 asks before adding one. A request with no
 * `Origin` header — curl, a health check, the workers — is not a browser and
 * is left alone.
 */

import { allowedOrigins } from '../config/links.js';
import { originAllowed } from '../services/portal.service.js';

import type { NextFunction, Request, Response } from 'express';

// The list itself is in `config/links.ts`, which the socket handshake reads
// too: two copies of an allowlist is how one of them comes to be wrong.
export { allowedOrigins };

/** Headers a browser app actually sends. Nothing wider. */
const ALLOWED_HEADERS = ['authorization', 'content-type', 'idempotency-key'] as const;

/**
 * The verbs this API's routers actually use.
 *
 * `PUT` joined the list with step 17: `PUT /hospitals/:id/pharmacy-stock`
 * replaces a pharmacy's flags wholesale (`FR-PHR-02`), and a PUT missing from
 * here fails in a way that is easy to miss — the preflight answers 200, and
 * the browser then blocks the real request on its own. Nothing server-side
 * logs a thing, because the request never arrives.
 *
 * `PUT /hospitals/:id/capabilities` (step 15) had the same shape and the same
 * fault; nothing had exercised it from a browser either.
 */
const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

/** The one route any origin may read (see `cors`). */
const CONFIG_PATH = '/api/v1/config';

export function cors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.get('origin');

  // Not a browser request. Nothing to negotiate.
  if (origin === undefined || origin === '') {
    next();
    return;
  }

  // The fixed list answers at once. A hospital's portal is at an address of
  // its own (`FR-BRD-07`), which `portal.service` knows; it remembers the
  // recorded domains, so this is a read of the database at most twice a minute.
  if (allowedOrigins().includes(origin)) {
    allow(origin, req, res, next);
    return;
  }
  originAllowed(origin).then((allowed) => {
    if (allowed) {
      allow(origin, req, res, next);
      return;
    }
    // One question may be asked from anywhere: whose address is this
    // (`GET /config`, `FR-BRD-07`). The patient app opened at a name nobody
    // has recorded has to be able to learn that it is nobody's portal, and the
    // answer is public: it holds nothing a person could not read by asking
    // directly. Without credentials, and nothing else is opened by it.
    if (req.path === CONFIG_PATH && (req.method === 'GET' || req.method === 'OPTIONS')) {
      res.setHeader('access-control-allow-origin', '*');
      if (req.method === 'GET') {
        next();
        return;
      }
      // The browser asks first, because the app's client sends a JSON
      // content type with every request. Reading is all that is allowed.
      res.setHeader('access-control-allow-methods', 'GET');
      res.setHeader('access-control-allow-headers', ALLOWED_HEADERS.join(', '));
      res.setHeader('access-control-max-age', '600');
      res.status(204).end();
      return;
    }
    // No CORS headers, so the browser refuses the response. Deliberately not a
    // 403: a disallowed origin should learn nothing about whether the endpoint
    // exists, and the request itself may still be perfectly valid from a
    // non-browser caller.
    next();
  }, next);
}

function allow(origin: string, req: Request, res: Response, next: NextFunction): void {
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('access-control-allow-credentials', 'true');
  // The allowed origin varies by request, so a cache must key on it.
  res.setHeader('vary', 'Origin');

  if (req.method === 'OPTIONS') {
    res.setHeader('access-control-allow-methods', ALLOWED_METHODS.join(', '));
    res.setHeader('access-control-allow-headers', ALLOWED_HEADERS.join(', '));
    res.setHeader('access-control-max-age', '600');
    res.status(204).end();
    return;
  }

  next();
}
