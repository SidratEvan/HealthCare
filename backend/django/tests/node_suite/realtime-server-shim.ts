/**
 * Stands in for `backend/api/src/realtime/server.ts` in the Django run.
 *
 * A test serves its app (`app-shim.ts`, a proxy to Django) on a local port and
 * calls `attachRealtime(httpServer)` to put the realtime server on the same
 * port. Here the realtime server is Django's: Socket.IO's polling requests
 * already reach it through the proxy, and this forwards the WebSocket upgrade
 * too, so a test's `socket.io-client` talks to the Django process end to end.
 * The returned object's `close()` ends the forwarded connections, as closing
 * the Node server ended its sockets.
 */

import { execFileSync } from 'node:child_process';
import { connect, type Socket } from 'node:net';

import { DJANGO_API_URL } from './app-shim.js';
import { bridgeHeaders } from './bridge.js';

import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';

const target = new URL(DJANGO_API_URL);

export interface ForwardedRealtime {
  close(): Promise<void>;
  /** `io.sockets.sockets.get(id)?.rooms`, read from the Django process. */
  readonly sockets: {
    readonly sockets: { get(id: string): { readonly rooms: Set<string> } | undefined };
  };
}

function roomsOf(id: string): Set<string> | null {
  // Synchronous, as the Socket.IO server's map is; a short child process asks.
  const script = `fetch(${JSON.stringify(`${DJANGO_API_URL}/__test__/realtime/rooms?sid=${encodeURIComponent(id)}`)})
    .then((r) => r.text()).then((t) => process.stdout.write(t), (e) => { console.error(e); process.exit(1); });`;
  const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  const held = (JSON.parse(out) as { data: string[] | null }).data;
  return held === null ? null : new Set(held);
}

export function attachRealtime(httpServer: HttpServer): ForwardedRealtime {
  const open = new Set<Duplex>();
  const onUpgrade = (req: IncomingMessage, client: Duplex, head: Buffer): void => {
    const upstream: Socket = connect(Number(target.port), target.hostname, () => {
      const headers: Record<string, string | string[] | undefined> = {
        ...req.headers,
        host: target.host,
        'x-medlive-test-now': String(Date.now()),
        ...bridgeHeaders(),
      };
      const lines = [`${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/1.1`];
      for (const [name, value] of Object.entries(headers)) {
        if (value === undefined) continue;
        for (const one of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${one}`);
      }
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    open.add(client);
    open.add(upstream);
    const end = (): void => {
      client.destroy();
      upstream.destroy();
      open.delete(client);
      open.delete(upstream);
    };
    upstream.on('error', end);
    upstream.on('close', end);
    client.on('error', end);
    client.on('close', end);
  };
  httpServer.on('upgrade', onUpgrade);
  return {
    sockets: {
      sockets: {
        get(id: string): { readonly rooms: Set<string> } | undefined {
          const rooms = roomsOf(id);
          return rooms === null ? undefined : { rooms };
        },
      },
    },
    async close(): Promise<void> {
      httpServer.off('upgrade', onUpgrade);
      for (const socket of open) socket.destroy();
      open.clear();
      await Promise.resolve();
    },
  };
}
