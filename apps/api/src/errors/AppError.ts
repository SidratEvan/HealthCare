/**
 * The only error type the API throws on purpose.
 *
 * Everything a client sees comes through here, which is what keeps the promise
 * in BACKEND.md §9: a raw SQL or provider message never reaches a client. The
 * original cause is attached for the log and dropped from the response.
 */

import { messageFor, statusFor, type ErrorCode } from './codes.js';

/** Extra machine-readable context. Never patient identifiers (CLAUDE.md §7). */
export type ErrorDetails = Readonly<Record<string, unknown>>;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ErrorDetails | undefined;
  /** True when this was raised deliberately rather than caught and wrapped. */
  readonly expected = true;

  constructor(
    code: ErrorCode,
    options: {
      readonly message?: string;
      readonly details?: ErrorDetails;
      readonly cause?: unknown;
    } = {},
  ) {
    super(options.message ?? messageFor(code), { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = statusFor(code);
    this.details = options.details;
  }

  /** The body shape from BACKEND.md §7: `{ ok: false, error: {...} }`. */
  toBody(): {
    ok: false;
    error: { code: ErrorCode; message: string; details?: ErrorDetails };
  } {
    return {
      ok: false,
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

/** `throw unauthorized()` reads better than the constructor at a call site. */
export const authRequired = (details?: ErrorDetails): AppError =>
  new AppError('AUTH_REQUIRED', details === undefined ? {} : { details });

export const tokenInvalid = (reason: string): AppError =>
  new AppError('AUTH_TOKEN_INVALID', { details: { reason } });

export const forbiddenScope = (details?: ErrorDetails): AppError =>
  new AppError('AUTH_FORBIDDEN_SCOPE', details === undefined ? {} : { details });

export const notFound = (resource: string): AppError =>
  new AppError('NOT_FOUND', { details: { resource } });

export const validationFailed = (details: ErrorDetails): AppError =>
  new AppError('VALIDATION_FAILED', { details });

export const guardFailed = (code: string, detail: string): AppError =>
  new AppError('QUEUE_GUARD_FAILED', { message: detail, details: { guard: code } });

/**
 * Wraps anything thrown that was not an `AppError`.
 *
 * The response gets `INTERNAL` and nothing else; the cause travels to the log
 * where it belongs. This is the single place an unexpected failure becomes a
 * client-safe answer, which is why the error middleware has no other branch.
 */
export function asAppError(thrown: unknown): AppError {
  if (thrown instanceof AppError) return thrown;
  return new AppError('INTERNAL', { cause: thrown });
}

/** True when the error was raised deliberately by application code. */
export function isAppError(thrown: unknown): thrown is AppError {
  return thrown instanceof AppError;
}
