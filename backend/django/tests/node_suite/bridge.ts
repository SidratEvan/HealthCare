/**
 * What a Node test changed in its own process, carried to the Django server
 * with each request (`app-shim.ts`), so the original assertions hold:
 *
 * - `env`: a test writes `(env as …).DEMO_MODE = false` and expects the API
 *   to behave so. Every request says which values differ from the ones the
 *   file started with (`x-medlive-test-env`).
 * - an SMS adapter a test installs (`setSmsAdapter`, `sms-shim.ts`): the
 *   Django server hands each message to it over a loopback callback and takes
 *   its answer (`x-medlive-test-sms`).
 *
 * Django reads both only under NODE_ENV=test (`core/pipeline.py`).
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { env } from '../../../api/src/env.js';

const started: Record<string, unknown> = { ...(env as unknown as Record<string, unknown>) };

/** The values a test has changed since the file loaded; a deleted one is null. */
export function envChanges(): Record<string, unknown> {
  const now = env as unknown as Record<string, unknown>;
  const changes: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(started), ...Object.keys(now)])) {
    if (!Object.is(started[key], now[key])) changes[key] = now[key] === undefined ? null : now[key];
  }
  return changes;
}

type Handler = (message: unknown) => Promise<unknown>;

let smsHandler: Handler | null = null;
let server: Server | null = null;
let serverUrl: string | null = null;

/** Installs (or with null removes) the handler the Django server's SMS goes to. */
export function bridgeSms(handler: Handler | null): void {
  smsHandler = handler;
  if (handler !== null && server === null) {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const current = smsHandler;
        if (current === null) {
          res.writeHead(503).end();
          return;
        }
        const message: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        current(message).then(
          (answer) => {
            res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer));
          },
          (error: unknown) => {
            // A throw is not a refusal: the server has to see it thrown.
            res
              .writeHead(200, { 'content-type': 'application/json' })
              .end(JSON.stringify({ threw: true, message: String(error) }));
          },
        );
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server?.address() as AddressInfo;
      serverUrl = `http://127.0.0.1:${String(address.port)}/sms`;
    });
    server.unref();
  }
}

/** The headers every proxied request carries. */
export function bridgeHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const changes = envChanges();
  if (Object.keys(changes).length > 0) headers['x-medlive-test-env'] = JSON.stringify(changes);
  if (smsHandler !== null && serverUrl !== null) headers['x-medlive-test-sms'] = serverUrl;
  return headers;
}
