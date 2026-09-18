/**
 * `Idempotency-Key` handling (CLAUDE.md §7: "Every write endpoint accepts an
 * idempotency key"; FR-PAY-06, FR-QUE-51).
 *
 * This middleware validates the key and attaches it. It deliberately does not
 * store anything, because the durable record belongs with the resource:
 *
 *   queue events   `queue_events.client_event_id`, unique, so a replayed
 *                  offline batch returns the stored result (SY-02)
 *   payments       `payments.idempotency_key`, unique, so a retried charge
 *                  never bills a patient twice (FR-PAY-06)
 *
 * A separate generic idempotency table would be a second place the same fact
 * is recorded, and the two could disagree. Both of the above are unique
 * indexes in the schema, which means the guarantee is the database's, not this
 * middleware's — and a guarantee a middleware provides is one a direct service
 * call can bypass.
 */

import { AppError } from '../errors/AppError.js';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

const HEADER = 'idempotency-key';

/** Methods that change state and therefore need a key. */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * A key has to be long enough not to collide by accident and short enough to
 * index. A UUID fits comfortably; so does any random string of similar size.
 */
const MIN_LENGTH = 16;
const MAX_LENGTH = 128;
const ALLOWED = /^[A-Za-z0-9_-]+$/;

export interface IdempotencyOptions {
  /**
   * When false, a missing key is allowed through.
   *
   * Used by endpoints where a repeat is harmless and the caller is a browser
   * form rather than a sync worker — a login attempt, for instance. The key is
   * still honoured if supplied.
   */
  readonly required?: boolean;
}

/**
 * Validates and attaches `req.idempotencyKey` on unsafe methods.
 *
 * Mounted globally with `required: false`, then applied per route with
 * `required: true` where a duplicate would cost a patient money or a place in
 * a queue.
 */
export function idempotency(options: IdempotencyOptions = {}): RequestHandler {
  const required = options.required ?? false;

  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!UNSAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const key = req.get(HEADER);

    if (key === undefined || key === '') {
      if (required) {
        next(
          new AppError('IDEMPOTENCY_KEY_REQUIRED', {
            details: { header: 'Idempotency-Key', method: req.method },
          }),
        );
        return;
      }
      next();
      return;
    }

    if (key.length < MIN_LENGTH || key.length > MAX_LENGTH || !ALLOWED.test(key)) {
      next(
        new AppError('VALIDATION_FAILED', {
          message: 'Idempotency-Key must be 16-128 characters of [A-Za-z0-9_-].',
          details: { header: 'Idempotency-Key' },
        }),
      );
      return;
    }

    req.idempotencyKey = key;
    next();
  };
}

/** True for a method that changes state. */
export function isUnsafeMethod(method: string): boolean {
  return UNSAFE_METHODS.has(method.toUpperCase());
}
