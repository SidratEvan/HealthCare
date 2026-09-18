/**
 * Request validation against the zod schemas shared with the client
 * (BACKEND.md §0: "Validation — Zod, schemas shared with the client. One
 * contract, both sides.").
 *
 * The schemas themselves live in `@platform/domain/schemas`, so the console's
 * React Hook Form and this middleware reject the same input for the same
 * reason — and a form that passes client-side validation does not then fail
 * server-side with a different message.
 */

import { validationFailed } from '../errors/AppError.js';

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';

export interface ValidationSchemas {
  readonly body?: ZodType;
  readonly query?: ZodType;
  readonly params?: ZodType;
}

/**
 * Validates and replaces `req.body`, `req.query` and `req.params`.
 *
 * Replacing rather than merely checking is the point: after this middleware the
 * handler sees parsed, coerced, stripped data. An unexpected field cannot reach
 * a repository and become a column, and a numeric query parameter arrives as a
 * number rather than a string.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const issues: { path: string; message: string }[] = [];

    if (schemas.params !== undefined) {
      const result = schemas.params.safeParse(req.params);
      if (result.success) {
        req.params = result.data as typeof req.params;
      } else {
        issues.push(...collect(result.error.issues, 'params'));
      }
    }

    if (schemas.query !== undefined) {
      const result = schemas.query.safeParse(req.query);
      if (result.success) {
        // Express 5 makes `req.query` a getter, so it is redefined rather
        // than assigned.
        Object.defineProperty(req, 'query', { value: result.data, configurable: true });
      } else {
        issues.push(...collect(result.error.issues, 'query'));
      }
    }

    if (schemas.body !== undefined) {
      const result = schemas.body.safeParse(req.body);
      if (result.success) {
        req.body = result.data;
      } else {
        issues.push(...collect(result.error.issues, 'body'));
      }
    }

    if (issues.length > 0) {
      // Every problem at once. A booking form with three bad fields should not
      // take three round trips to fix (FRONTEND.md §5.2).
      next(validationFailed({ issues }));
      return;
    }

    next();
  };
}

/**
 * Flattens zod issues into `{ path, message }` pairs.
 *
 * The message is zod's, which is developer-facing and in English. The client
 * maps `VALIDATION_FAILED` plus the path to Bangla copy — a server never sends
 * prose for a patient to read (I18N-03).
 */
function collect(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
  source: string,
): { path: string; message: string }[] {
  return issues.map((issue) => ({
    path: [source, ...issue.path.map(String)].join('.'),
    message: issue.message,
  }));
}
