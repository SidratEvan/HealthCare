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

import { env } from '../env.js';

import type { NextFunction, Request, Response } from 'express';

/** The browser origins this API answers. */
export function allowedOrigins(): readonly string[] {
  return [env.WEB_BASE_URL, env.CONSOLE_BASE_URL];
}

/** Headers a browser app actually sends. Nothing wider. */
const ALLOWED_HEADERS = ['authorization', 'content-type', 'idempotency-key'] as const;

const ALLOWED_METHODS = ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] as const;

export function cors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.get('origin');

  // Not a browser request. Nothing to negotiate.
  if (origin === undefined || origin === '') {
    next();
    return;
  }

  if (!allowedOrigins().includes(origin)) {
    // No CORS headers, so the browser refuses the response. Deliberately not a
    // 403: a disallowed origin should learn nothing about whether the endpoint
    // exists, and the request itself may still be perfectly valid from a
    // non-browser caller.
    next();
    return;
  }

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
