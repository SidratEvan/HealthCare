/**
 * Request logging and correlation.
 *
 * Written rather than taken from `pino-http` for one reason: control over what
 * is logged. CLAUDE.md §7 forbids logging patient identifiers, OTPs, tokens
 * and payment references, and the safest way to honour that is to log an
 * explicit short list of fields instead of serialising a request object and
 * relying on a redaction list to catch everything in it.
 *
 * So no bodies, no query strings, no headers beyond the ones named here. A
 * query string on this API can carry a phone number (guest lookup) or a
 * tracking-link token (FR-GST-05), and both would then sit in a log
 * aggregator for months.
 */

import { randomUUID } from 'node:crypto';

import { requestLogger } from '../config/logger.js';

import type { NextFunction, Request, Response } from 'express';

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Assigns a request id and logs the outcome once the response is finished.
 *
 * An inbound `X-Request-Id` is honoured so a trace can be followed from the
 * console through the API, but it is length-capped: it ends up in every log
 * line for this request and an unbounded one is a cheap way to fill a log
 * budget.
 */
export function requestLog(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.get(REQUEST_ID_HEADER);
  req.requestId =
    typeof inbound === 'string' && inbound !== '' && inbound.length <= 64 ? inbound : randomUUID();

  res.setHeader(REQUEST_ID_HEADER, req.requestId);

  const startedAt = process.hrtime.bigint();
  const log = requestLogger(req.requestId);

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    log.info(
      {
        method: req.method,
        // The matched route pattern where Express has one, so a log groups by
        // endpoint instead of by id — and so a path parameter that happens to
        // be a patient id never lands in a log line.
        route: routeOf(req),
        status: res.statusCode,
        durationMs: Math.round(durationMs),
        // Who, not what: an id, never a name or a number (FR-SEC-03).
        principal: req.principal === undefined ? 'anonymous' : req.principal.kind,
        principalId: req.principal?.id,
      },
      'request',
    );
  });

  next();
}

/**
 * The route pattern, falling back to the path.
 *
 * `req.route` is only populated once a handler has matched, which is why this
 * is read inside the `finish` listener rather than up front.
 */
function routeOf(req: Request): string {
  const route = (req as { route?: { path?: unknown } }).route;
  const pattern = route?.path;
  if (typeof pattern === 'string') {
    return `${req.baseUrl}${pattern}`;
  }
  // No handler matched, so there is no pattern and the raw path is all there
  // is. A 404 path is not sensitive in the way a matched one can be.
  return req.path;
}
