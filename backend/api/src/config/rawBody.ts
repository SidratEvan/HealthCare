/**
 * The request body exactly as it arrived, for the routes that verify a
 * signature over it (`/webhooks/*`, BACKEND.md §7.7).
 *
 * ## Why this exists at all
 *
 * A payment provider signs the **bytes it sent**. `express.json()` consumes
 * the stream and hands back an object, and `JSON.stringify` of that object
 * does not reproduce the provider's whitespace or key order — so a signature
 * checked against a re-serialisation fails for every genuine callback. That
 * is not hypothetical: it is what happened, and the webhook tests are what
 * found it.
 *
 * Express's only hook that sees the raw bytes is `json({ verify })`, which
 * runs before any route. So the bytes are captured there and read here.
 *
 * ## Why a `WeakMap` rather than a property on the request
 *
 * Hanging it on `req` works and is the common recipe, but it means mutating a
 * function parameter and widening Express's `Request` type for one field that
 * two routes use. A `WeakMap` keyed by the request object does the same job,
 * keeps the type surface unchanged, and lets the entry go as soon as the
 * request is collected — which for a store of raw request bodies is the
 * property worth having (`DB-P7`).
 *
 * ## Only the webhooks
 *
 * `verify` declines to record anything for other paths. A copy of every
 * request body in memory is a copy of patient data in memory, and the
 * callbacks are the only bodies whose exact bytes matter.
 */

import type { IncomingMessage } from 'node:http';

const bodies = new WeakMap<IncomingMessage, string>();

/** Called from the JSON parser's `verify` hook. */
export function rememberRawBody(req: IncomingMessage, raw: string): void {
  bodies.set(req, raw);
}

/**
 * The bytes this request arrived with, or null.
 *
 * Null for any path `verify` skipped, and for a body that never went through
 * the JSON parser. A caller that needs the raw bytes and gets null must
 * refuse rather than fall back to the parsed object — see
 * `webhooks.controller`.
 */
export function rawBodyOf(req: IncomingMessage): string | null {
  return bodies.get(req) ?? null;
}
