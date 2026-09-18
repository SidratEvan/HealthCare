/**
 * The Socket.IO server, and the emitter that publishes through it
 * (BACKEND.md §0, §6).
 *
 * This is the only file that imports `socket.io`. Everything else in the
 * application talks to `emit.ts`'s one-method interface, which is what lets
 * the queue service be tested without a port, a client and a connection — and
 * what would let the transport be replaced without touching a service.
 */

import { Server as SocketServer } from 'socket.io';

import { logger } from '../config/logger.js';
import { env } from '../env.js';

import { authenticateSocket } from './auth.js';
import { setEmitter, type RealtimeEmitter } from './emit.js';
import { registerHandlers } from './handlers.js';

import type { RealtimeEnvelope } from './rooms.js';
import type { Server as HttpServer } from 'node:http';

/** Publishes into Socket.IO rooms. */
class SocketIoEmitter implements RealtimeEmitter {
  constructor(private readonly io: SocketServer) {}

  emit(room: string, event: string, envelope: RealtimeEnvelope): void {
    this.io.to(room).emit(event, envelope);
  }
}

/**
 * Attaches Socket.IO to the HTTP server and makes it the application's
 * emitter.
 *
 * Called once by `server.ts`. Until it is, `emit.ts` records instead of
 * sending — which is exactly what the tests want and is not a degraded mode:
 * a queue mutation that reaches the emitter has done everything asked of it,
 * and the only thing missing is a listener.
 */
export function attachRealtime(httpServer: HttpServer): SocketServer {
  const io = new SocketServer(httpServer, {
    // The consoles and the patient PWA are served from a different origin
    // (Vercel) than the API (Render), so the browser will preflight.
    cors: { origin: env.WEB_BASE_URL, credentials: true },

    // A reception console on hospital wifi and a patient on 3G both drop
    // often. Socket.IO's defaults assume a better network than this product
    // runs on; a longer window means a reconnect resumes rather than restarts.
    pingInterval: 25_000,
    pingTimeout: 60_000,

    // Polling stays enabled as a fallback: some Bangladeshi mobile networks
    // and corporate proxies still break WebSocket upgrades, and a patient who
    // cannot see their serial move is the one failure this product cannot
    // afford (NFR-01).
    transports: ['websocket', 'polling'],
  });

  io.use((socket, next) => {
    void authenticateSocket(socket, next);
  });

  registerHandlers(io);
  setEmitter(new SocketIoEmitter(io));

  logger.info({ corsOrigin: env.WEB_BASE_URL }, 'realtime attached');
  return io;
}
