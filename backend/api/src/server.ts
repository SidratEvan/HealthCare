/**
 * The process: boot, listen, and shut down without dropping work
 * (BACKEND.md §3, §12).
 *
 * Graceful shutdown is not housekeeping here. Render replaces a container on
 * every deploy, and a receptionist mid-session must not lose the tap they just
 * made: an in-flight `appendEvent` has to finish writing its row and
 * broadcasting before the process exits, or the console's optimistic state and
 * the log disagree about whether a patient was called (FR-QUE-51).
 *
 * Socket.IO attaches to this same HTTP server in step 6, when there are queue
 * rooms to join (BACKEND.md §6).
 */

import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.js';
import { closeDatabase } from './config/db.js';
import { logger } from './config/logger.js';
import { env } from './env.js';

/**
 * How long an in-flight request has to finish before the process exits
 * anyway.
 *
 * Every statement is already bounded at 15 seconds by the pool, so 20 leaves
 * room for a request that is waiting on one and no more.
 */
const SHUTDOWN_GRACE_MS = 20_000;

export function startServer(): Server {
  const server = createServer(createApp());

  server.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        nodeEnv: env.NODE_ENV,
        demoMode: env.DEMO_MODE,
        smsProvider: env.SMS_PROVIDER,
        paymentProvider: env.PAYMENT_PROVIDER,
      },
      'api listening',
    );
  });

  installShutdownHandlers(server);
  return server;
}

function installShutdownHandlers(server: Server): void {
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'shutting down');

    // Stop accepting new connections; in-flight requests keep their sockets.
    server.close(() => {
      void closeDatabase()
        .then(() => {
          logger.info('shutdown complete');
          process.exit(0);
        })
        .catch((error: unknown) => {
          logger.error({ err: error }, 'failed to close the database cleanly');
          process.exit(1);
        });
    });

    // A request that has not finished by now is not going to.
    setTimeout(() => {
      logger.warn({ graceMs: SHUTDOWN_GRACE_MS }, 'shutdown grace expired; exiting');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS).unref();
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });

  // A process in an unknown state must not keep serving a live chamber: it
  // could be holding a transaction open on `sessions` and blocking every
  // counter. Log loudly and let the platform restart it.
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled rejection');
    shutdown('unhandledRejection');
  });
}

/**
 * Started only when this file is the process entry point, so that importing it
 * in a test does not bind a port.
 *
 * Compares resolved paths rather than matching on a filename, so it keeps
 * working when the entry is `dist/server.js` instead of `src/server.ts`.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return resolve(entry) === fileURLToPath(import.meta.url);
}

if (isEntryPoint()) {
  startServer();
}
