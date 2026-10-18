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

import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';

import { bridgeHeaders } from './bridge.js';

export const DJANGO_API_URL = process.env['DJANGO_API_URL'] ?? 'http://127.0.0.1:4199';

const target = new URL(DJANGO_API_URL);

export function createApp(): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const upstream = httpRequest(
      {
        host: target.hostname,
        port: target.port,
        method: req.method,
        path: req.url,
        headers: {
          ...req.headers,
          host: target.host,
          'x-medlive-test-now': String(Date.now()),
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
  };
}
