/**
 * What a Node test changed in its own process, carried to the Django server
 * with each request (`app-shim.ts`, `call.ts`), so the original assertions hold:
 *
 * - `env`: a test writes `(env as …).DEMO_MODE = false` and expects the API
 *   to behave so. Every request says which values differ from the ones the
 *   file started with (`x-medlive-test-env`).
 * - an adapter a test installs (`setSmsAdapter`, `setPaymentProvider`): the
 *   Django server calls its methods over a loopback callback and takes their
 *   answers, its properties travelling in `x-medlive-test-adapters`. A method
 *   the stand-in does not have is answered as missing, so the server applies
 *   the same default the Node code applies (`verifyReceipt?.() ?? false`).
 *
 * - the rate limiter's window: each test file, and each `counter.reset()` a
 *   test makes (`ratelimit-shim.ts`), starts a new one
 *   (`x-medlive-test-rate-window`); the server empties its counter when the
 *   window it is told differs from the last.
 *
 * - the clock's heartbeats a test registered or recorded
 *   (`heartbeat-shim.ts`), in order, applied before the request is handled
 *   (`x-medlive-test-heartbeat`).
 *
 * Django reads them only under NODE_ENV=test (`core/pipeline.py`).
 */

import { randomUUID } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';

import { env } from '../../../api/src/env.js';

import type { AddressInfo } from 'node:net';

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

export type AdapterKind = 'sms' | 'payments' | 'mapping';

/** The properties of each kind the server reads without calling anything. */
const PROPERTIES: Record<AdapterKind, readonly string[]> = {
  sms: ['name', 'reportsDelivery'],
  payments: ['name', 'refundsByApi'],
  mapping: ['name'],
};

const installed = new Map<AdapterKind, Record<string, unknown>>();
let server: Server | null = null;
let serverUrl: string | null = null;

function answer(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

function ensureServer(): void {
  if (server !== null) return;
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const kind = (req.url ?? '').slice(1) as AdapterKind;
      const adapter = installed.get(kind);
      const { method, args } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        method: string;
        args: unknown[];
      };
      const given = args.map((arg) =>
        typeof arg === 'object' &&
        arg !== null &&
        (arg as Record<string, unknown>)['$undefined'] === true
          ? undefined
          : arg,
      );
      const fn = adapter?.[method];
      if (adapter === undefined || typeof fn !== 'function') {
        answer(res, { missing: true });
        return;
      }
      Promise.resolve()
        .then(() => (fn as (...a: unknown[]) => unknown).apply(adapter, given))
        .then(
          (value) => answer(res, { value: value === undefined ? null : value }),
          // A throw is not a refusal: the server has to see it thrown.
          (error: unknown) => answer(res, { threw: true, message: String(error) }),
        );
    });
  });
  server.listen(0, '127.0.0.1', () => {
    const address = server?.address() as AddressInfo;
    serverUrl = `http://127.0.0.1:${String(address.port)}`;
  });
  server.unref();
}

/** Installs (or with null removes) the stand-in the Django server's calls of this kind go to. */
export function bridgeAdapter(kind: AdapterKind, adapter: object | null): void {
  if (adapter === null) {
    installed.delete(kind);
    return;
  }
  installed.set(kind, adapter as Record<string, unknown>);
  ensureServer();
}

// A call a shim forwarded to the server without waiting (`modules-service-shim.ts`).
// Every request the test sends next waits for these first (`app-shim.ts`), so
// the order the test wrote is the order the server sees.
const pending = new Set<Promise<unknown>>();

export function track(work: Promise<unknown>): void {
  const settled = work.then(
    () => undefined,
    () => undefined,
  );
  pending.add(settled);
  void settled.finally(() => pending.delete(settled));
}

export async function drained(): Promise<void> {
  while (pending.size > 0) await Promise.all([...pending]);
}

// This module is loaded afresh by each test file, as the Node counter was.
const fileWindow = randomUUID();
let resets = 0;

export type HeartbeatOp =
  | { readonly op: 'register'; readonly worker: string; readonly everyMs: number }
  | { readonly op: 'beat'; readonly worker: string; readonly ok: boolean; readonly at: number }
  | { readonly op: 'reset' };

let heartbeats: HeartbeatOp[] = [];

/** A heartbeat a test made: the server applies it before the next request. */
export function queueHeartbeat(op: HeartbeatOp): void {
  heartbeats.push(op);
}

/** A test emptied the rate limiter's counter: the server empties its own. */
export function startRateWindow(): void {
  resets += 1;
}

/** The headers every proxied request carries. */
export function bridgeHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'x-medlive-test-rate-window': `${fileWindow}:${String(resets)}`,
  };
  if (heartbeats.length > 0) {
    headers['x-medlive-test-heartbeat'] = JSON.stringify(heartbeats);
    heartbeats = [];
  }
  const changes = envChanges();
  if (Object.keys(changes).length > 0) headers['x-medlive-test-env'] = JSON.stringify(changes);
  if (installed.size > 0 && serverUrl !== null) {
    const spec: Record<string, { url: string; props: Record<string, unknown> }> = {};
    for (const [kind, adapter] of installed) {
      const props: Record<string, unknown> = {};
      for (const name of PROPERTIES[kind]) {
        const value = adapter[name];
        if (value !== undefined && typeof value !== 'function') props[name] = value;
      }
      spec[kind] = { url: `${serverUrl}/${kind}`, props };
    }
    headers['x-medlive-test-adapters'] = JSON.stringify(spec);
  }
  return headers;
}
