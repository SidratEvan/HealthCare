/**
 * The headers every answer from the API carries (plan A7; `NFR-08`,
 * `FR-SEC-08`; handover finding 22).
 *
 * The API answered with no security headers at all. None of them is a
 * defence by itself; each closes a door a browser would otherwise leave open
 * around an answer that may hold a patient's name:
 *
 * - `X-Content-Type-Options: nosniff` — a report file is what its type says,
 *   and is never run as a script because its bytes look like one.
 * - `X-Frame-Options: DENY` and `frame-ancestors 'none'` — nothing this
 *   server answers is drawn inside somebody else's page.
 * - `Content-Security-Policy: default-src 'none'` — this server sends data
 *   and files, never a page; an answer that a browser is tricked into
 *   rendering as one may load nothing and run nothing.
 * - `Referrer-Policy: no-referrer` — a tracking link's token is in its
 *   address, and an address is not passed on to wherever the next click goes.
 * - `Permissions-Policy` — an answer from here asks a phone for nothing.
 * - `Cache-Control: no-store`, unless a route says otherwise — a queue with
 *   names in it, a visit record, a booking are not left in a shared
 *   computer's cache for the next person at the counter.
 * - `Strict-Transport-Security`, on an answer that went out over HTTPS — a
 *   browser that has reached this server securely once does not try it in
 *   the clear again. Not sent over plain HTTP, where it means nothing and a
 *   developer's machine has no certificate.
 *
 * Written out here and not taken from a package: they are nine lines, and a
 * dependency for nine lines is one more thing to keep patched (`CLAUDE.md`
 * §7).
 */

import type { NextFunction, Request, Response } from 'express';

/** Half a year, the least a browser's preload list asks for. */
const HSTS = 'max-age=15552000; includeSubDomains';

const CONTENT_SECURITY_POLICY =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const PERMISSIONS_POLICY = 'geolocation=(), camera=(), microphone=(), payment=()';

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);

  // The default. A route that has a reason to be cached, or to say more
  // (`private, no-store` on a report file), sets its own after this.
  res.setHeader('Cache-Control', 'no-store');

  // `req.secure` follows `trust proxy`, so behind a load balancer it is the
  // patient's connection that is asked about, not the hop from the balancer.
  if (req.secure) res.setHeader('Strict-Transport-Security', HSTS);

  next();
}
