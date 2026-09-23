/**
 * The Express application: middleware chain and route mounting
 * (BACKEND.md §3).
 *
 * The order below is the security model, so it is worth reading top to bottom:
 *
 *   1. trust proxy      so `req.ip` is the caller and not Render's balancer,
 *                       without which every rate limit shares one bucket
 *   2. requestLog       assigns the id every later log line and audit row uses
 *   3. body parsing     bounded, because an unbounded JSON body is a free
 *                       denial of service
 *   4. attachPrincipal  identifies the caller if they presented a token
 *   5. attachGuest      identifies a tracking-link holder (FR-GST-05)
 *   6. idempotency      validates the key on unsafe methods
 *   7. routes           each applying its own requireAuth / requireRole
 *   8. notFound         so an unmatched path still returns the error envelope
 *   9. errorHandler     the single place anything becomes a response
 *
 * Exported as a factory so a test can build an app without starting a server,
 * and so `server.ts` stays purely about the process lifecycle.
 */

import express, { json, type Express } from 'express';

import { rememberRawBody } from './config/rawBody.js';
import { env } from './env.js';
import { attachPrincipal } from './middleware/auth.js';
import { cors } from './middleware/cors.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { attachGuestFromLink } from './middleware/guestAuth.js';
import { idempotency } from './middleware/idempotency.js';
import { requestLog } from './middleware/requestLog.js';
import { API_BASE_PATH, buildApiRouter, rootRoutes } from './routes/index.js';

/**
 * Largest request body accepted.
 *
 * A prescription with twenty medicine rows is a few kilobytes, and every
 * ordinary endpoint is smaller than that.
 *
 * **One route lifts it**: `POST /test-orders/:id/report` carries the report
 * file itself (`FR-LAB-03`), and sets its own limit beside its own handler in
 * `lab.routes.ts` rather than raising this one for everybody. BACKEND.md §0's
 * "signed URLs only" is a rule about *reads* — no public bucket, every fetch
 * signed and expiring — and it holds either way; §7.6 puts the upload on the
 * endpoint, which is also the only arrangement that works identically under
 * `STORAGE_PROVIDER=mock` and against a real bucket.
 */
const BODY_LIMIT = '256kb';

export function createApp(): Express {
  const app = express();

  // Render terminates TLS and forwards the caller's address in
  // `X-Forwarded-For`. Without this, `req.ip` is the balancer's address and
  // the OTP limit in FR-SEC-05 would be shared by every caller at once.
  //
  // Driven by its own variable rather than by `NODE_ENV`: being behind a proxy
  // and being production are different facts, and the pitch deployment is the
  // first that is one without the other.
  app.set('trust proxy', env.TRUST_PROXY_HOPS === 0 ? false : env.TRUST_PROXY_HOPS);

  // Nothing in this API depends on the framework advertising itself.
  app.disable('x-powered-by');

  // Serialise objects without sorting keys or pretty-printing: response bytes
  // matter on a 3G connection in a hospital corridor (NFR-04).
  app.set('json spaces', 0);

  app.use(requestLog);

  // Before the body parser and before auth: a preflight carries neither a body
  // nor a token, and answering it is not something to do after deciding who
  // the caller is.
  app.use(cors);

  app.use(
    json({
      limit: BODY_LIMIT,
      // A provider signs the bytes it sent, not a re-serialisation of them
      // (BACKEND.md §7.7). This is the only hook that sees them; see
      // `config/rawBody.ts` for why, and for why it keeps only the webhooks'.
      verify: (req, _res, buf) => {
        if (req.url?.startsWith('/api/v1/webhooks/') !== true) return;
        rememberRawBody(req, buf.toString('utf8'));
      },
    }),
  );

  app.use(attachPrincipal);
  app.use(attachGuestFromLink);

  // Global pass: validates a key when one is supplied. Endpoints where a
  // duplicate costs money or a place in a queue apply `idempotency({
  // required: true })` themselves (FR-PAY-06, FR-QUE-51).
  app.use(idempotency());

  app.use(rootRoutes);
  app.use(API_BASE_PATH, buildApiRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
