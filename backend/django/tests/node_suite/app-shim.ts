/**
 * Stands in for `backend/api/src/app.ts` when the Node API suite runs against
 * the Django server (`vitest.django.config.ts`).
 *
 * Every test builds its app with `createApp()` and hands it to supertest.
 * This returns a request handler that forwards each request to the Django
 * server unchanged, adding one header: the test's own `Date.now()`, so a test
 * that fakes the clock (`vi.setSystemTime`) moves the server's for that
 * request, as it moved the Node API's in-process (`x-medlive-test-now`,
 * honoured only under NODE_ENV=test).
 */

import {
  Agent,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

import { bridgeHeaders, drained } from './bridge.js';

export const DJANGO_API_URL = process.env['DJANGO_API_URL'] ?? 'http://127.0.0.1:4199';

const target = new URL(DJANGO_API_URL);

/**
 * Connections kept open between requests. Supertest sends thousands of
 * requests in some files (`pilotAudit`); a fresh connection for each leaves
 * Windows without an ephemeral port to connect from (EADDRINUSE).
 */
const agent = new Agent({ keepAlive: true, maxSockets: 32 });

/**
 * The request's headers less the hop-by-hop ones. Supertest sends
 * `Connection: close`; passed on, it would close every kept connection.
 */
function forwardable(headers: IncomingMessage['headers']): IncomingMessage['headers'] {
  const { connection: _connection, 'keep-alive': _keepAlive, ...rest } = headers;
  return rest;
}

export function createApp(): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    // The test's clock is read when the request is made, not after the wait.
    const now = String(Date.now());
    void drained().then(() => {
      const upstream = httpRequest(
        {
          host: target.hostname,
          port: target.port,
          method: req.method,
          path: req.url,
          agent,
          headers: {
            ...forwardable(req.headers),
            host: target.host,
            'x-medlive-test-now': now,
            ...bridgeHeaders(),
          },
        },
        (answer) => {
          res.writeHead(answer.statusCode ?? 502, answer.headers);
          answer.pipe(res);
        },
      );
      upstream.on('error', (error) => {
        res.writeHead(502, { 'content-type': 'text/plain' });
        res.end(`django proxy: ${error.message}`);
      });
      req.pipe(upstream);
    });
  };
}
