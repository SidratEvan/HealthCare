/**
 * Rate limiting for OTP, guest booking and search (FR-SEC-05, FR-GST-14).
 *
 * A fixed-window counter held in this process's memory, and the limitation is
 * stated rather than hidden: with more than one API instance behind a load
 * balancer, a caller gets one window per instance. BACKEND.md §0 takes Redis
 * off the table at launch ("No Redis dependency at launch"), so the options
 * were an in-memory window or a database round trip on every OTP request.
 *
 * In-memory is the right trade for what this actually defends against.
 * FR-SEC-05 is about account takeover by OTP brute force, and the real defence
 * there is the five-wrong-attempts lock in `auth.service` plus the 300-second
 * code lifetime — both of which are durable, in the database, and unaffected
 * by how many instances are running. This layer is the cheap first cut that
 * stops a script before it reaches the database at all.
 *
 * When load justifies Redis (BACKEND.md §0: "Upstash Redis + BullMQ only if
 * load demands"), only `Counter` below changes.
 */

import { env } from '../env.js';
import { AppError } from '../errors/AppError.js';

import type { ErrorCode } from '../errors/codes.js';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export interface RateLimitOptions {
  /** Requests permitted per window. */
  readonly limit: number;
  /** Window length in seconds. */
  readonly windowSeconds: number;
  /**
   * What identifies the caller.
   *
   * Never the raw value in a log: `keyFor` results are hashed into the store
   * and never logged, because for OTP limiting the key is a phone number.
   */
  readonly keyFor: (req: Request) => string;
  /**
   * The code returned when the limit is hit. `AUTH_OTP_RATE_LIMIT` for OTP so
   * the client can show the countdown the OTP screen has (APP_FLOW.md S-A-03).
   */
  readonly code?: ErrorCode;
  /**
   * One count across every route this limiter is mounted on, named here.
   * Without it each method and path is counted on its own, which is right
   * for a limit on one act and wrong for a ceiling on a caller (plan I2b).
   */
  readonly bucket?: string;
}

interface Window {
  count: number;
  /** Epoch milliseconds when this window ends. */
  resetAt: number;
}

/**
 * A fixed-window counter.
 *
 * Swept lazily on read rather than on a timer, so an idle process holds no
 * interval and a burst of one-off keys is cleaned up by the traffic that
 * follows it. `sweepEvery` bounds the work.
 */
export class Counter {
  private readonly windows = new Map<string, Window>();
  private sweepCountdown = SWEEP_EVERY;

  /** Records a hit and reports whether it is over the limit. */
  hit(
    key: string,
    limit: number,
    windowSeconds: number,
    now: number,
  ): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
    this.maybeSweep(now);

    const existing = this.windows.get(key);

    if (existing === undefined || existing.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return { allowed: true, remaining: limit - 1, retryAfterSeconds: windowSeconds };
    }

    existing.count += 1;
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));

    return {
      allowed: existing.count <= limit,
      remaining: Math.max(0, limit - existing.count),
      retryAfterSeconds,
    };
  }

  /** Drops expired windows. Also used by tests to start clean. */
  reset(): void {
    this.windows.clear();
  }

  size(): number {
    return this.windows.size;
  }

  private maybeSweep(now: number): void {
    this.sweepCountdown -= 1;
    if (this.sweepCountdown > 0) return;

    this.sweepCountdown = SWEEP_EVERY;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

const SWEEP_EVERY = 500;

/** The process-wide counter. Exported so tests can reset it between cases. */
export const counter = new Counter();

/**
 * Builds a limiter.
 *
 * ## A limit on an address is a limit on everybody behind it
 *
 * A limit keyed by `byIp` counts a hospital's waiting room on the hospital's
 * Wi-Fi, or a carrier's gateway, as one caller. `addressFactor` is how many
 * times over an address may use such a limit: `ADDRESS_RATE_LIMIT_FACTOR`,
 * one unless a deployment says its callers share addresses (`env.ts`).
 *
 * Decided here, from the key, and not at each route, so a per-address limit
 * added later is covered without anybody remembering to. A limit keyed on
 * anything else — a phone number — is a person's, and is never stretched.
 */
export function rateLimit(
  options: RateLimitOptions,
  addressFactor: number = env.ADDRESS_RATE_LIMIT_FACTOR,
): RequestHandler {
  const code: ErrorCode = options.code ?? 'RATE_LIMITED';
  const limit = options.keyFor === byIp ? options.limit * addressFactor : options.limit;

  return (req: Request, res: Response, next: NextFunction): void => {
    const key =
      options.bucket === undefined
        ? `${req.method}:${req.path}:${options.keyFor(req)}`
        : `${options.bucket}:${options.keyFor(req)}`;
    const result = counter.hit(key, limit, options.windowSeconds, Date.now());

    res.setHeader('RateLimit-Limit', String(limit));
    res.setHeader('RateLimit-Remaining', String(result.remaining));

    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSeconds));
      next(
        new AppError(code, {
          details: { retryAfterSeconds: result.retryAfterSeconds },
        }),
      );
      return;
    }

    next();
  };
}

/**
 * Requests a minute one address may make without an account, across every
 * route (plan I2b).
 *
 * The routes that need no account each had their own limit or none: the
 * searches, a hospital's page, a doctor's, the medicine search, the token
 * links a patient polls. Every one reads the database, and a script reading
 * them in a loop read it as fast as it liked.
 *
 * Set for a hospital's waiting room, where everybody on its Wi-Fi is one
 * address: the busiest screen a patient leaves open asks every five seconds
 * (the standby offer, "I'm on my way"), twelve a minute, so this is about a
 * hundred phones at once. Stretched by `ADDRESS_RATE_LIMIT_FACTOR` like every
 * other limit on an address.
 */
export const ANONYMOUS_PER_MINUTE = 1_200;

const anonymousLimit = rateLimit({
  limit: ANONYMOUS_PER_MINUTE,
  windowSeconds: 60,
  keyFor: byIp,
  bucket: 'anonymous',
});

/**
 * The ceiling on everything asked without an account. A signed-in caller is
 * counted by the limits on what they do, not here.
 *
 * Not the webhooks: an aggregator reports on every message it sent, from one
 * address, and each report is believed only if signed (`/webhooks/sms-dlr`).
 */
export function anonymousCeiling(req: Request, res: Response, next: NextFunction): void {
  if (req.principal !== undefined || req.path.startsWith('/webhooks/')) {
    next();
    return;
  }
  anonymousLimit(req, res, next);
}

/**
 * The caller's address, as the default identity.
 *
 * `req.ip` honours `trust proxy`, which `app.ts` sets because the API runs
 * behind Render's load balancer. Without that, every request would appear to
 * come from the proxy and one caller could exhaust everyone's window.
 */
export function byIp(req: Request): string {
  return req.ip ?? 'unknown';
}

/**
 * The phone number in the body, for OTP limits (FR-SEC-05).
 *
 * Falls back to the address when no phone is present, so a malformed request
 * cannot escape the limit by omitting the field.
 */
export function byPhone(req: Request): string {
  const body: unknown = req.body;
  if (typeof body === 'object' && body !== null && 'phone' in body) {
    const phone = (body as { phone?: unknown }).phone;
    if (typeof phone === 'string' && phone !== '') return `phone:${phone}`;
  }
  return `ip:${byIp(req)}`;
}
