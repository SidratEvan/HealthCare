/**
 * The last middleware in the chain (BACKEND.md §3: "maps AppError → HTTP +
 * error code").
 *
 * One rule governs this file: "an error never returns a raw SQL or provider
 * message to a client" (BACKEND.md §9). A Postgres error can contain a
 * constraint name, a column value, or a fragment of a row — a bKash error can
 * contain a transaction reference. Both go to the log; neither goes on the
 * wire.
 *
 * So there are exactly two paths out of here. An `AppError` was raised
 * deliberately and its code and message are safe by construction. Anything
 * else becomes `INTERNAL`, with the cause logged and nothing about it
 * returned.
 */

import { requestLogger } from '../config/logger.js';
import { AppError, asAppError, isAppError } from '../errors/AppError.js';

import type { NextFunction, Request, Response } from 'express';

/**
 * Handles anything thrown by a route, controller, service or repository.
 *
 * Express 5 forwards a rejected promise from an async handler here
 * automatically, which is why no route needs a try/catch wrapper.
 */
export function errorHandler(
  thrown: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Express requires the four-argument shape to recognise this as an error
  // handler, and a response already sent can only be aborted.
  if (res.headersSent) {
    next(thrown);
    return;
  }

  const error = asAppError(thrown);
  const log = requestLogger(req.requestId);

  if (isAppError(thrown)) {
    // Expected: a guard refused, a token expired, a serial was taken. Part of
    // normal operation, so it is not logged at error level — a console full of
    // stack traces for "grace period still running" hides the real failures.
    log.info(
      { code: error.code, status: error.status, route: req.path, method: req.method },
      'request refused',
    );
  } else {
    log.error(
      { err: thrown, code: error.code, route: req.path, method: req.method },
      'unhandled error',
    );
  }

  res.status(error.status).json(error.toBody());
}

/**
 * Turns an unmatched path into `NOT_FOUND` rather than Express's HTML page.
 *
 * Mounted after every route. A client parsing `{ ok: false, error: { code } }`
 * should get that shape for a typo in a URL too.
 */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError('NOT_FOUND', { details: { method: req.method, path: req.path } }));
}
