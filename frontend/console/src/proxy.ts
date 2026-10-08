/**
 * Every page's Content-Security-Policy, with a script nonce of its own (plan
 * I2d; `NFR-08`; `BACKEND.md` §6, the headers; moved from A7).
 *
 * The policy the app sent until now said where a page may be framed and what
 * a form may post to, and nothing about scripts, because Next writes inline
 * scripts into every page and a policy that allowed inline scripts would be
 * one in name only. So each request is given a fresh nonce here, the policy
 * allows scripts carrying it and nothing else, and Next puts the nonce on
 * every script it writes (it reads the policy from the request). A script an
 * attacker managed to get into a page has no nonce and does not run.
 *
 * That needs every page rendered per request: a page built ahead of time has
 * no nonce in it and its own scripts would be refused. The root layout says
 * so (`dynamic = 'force-dynamic'`).
 *
 * Only scripts and what they can be used for are restricted. `default-src` is
 * not set: the API and the socket are another origin, and neither is how a
 * script gets in.
 * `'strict-dynamic'` lets a script that was trusted load the chunks it needs.
 * A worker (the service worker) is this origin's own. In development React's
 * refresh evaluates code, which the policy allows there and nowhere else.
 *
 * The patient app has the same file (`frontend/patient/src/proxy.ts`).
 */

import { NextResponse, type NextRequest } from 'next/server';

function policy(nonce: string): string {
  const development = process.env.NODE_ENV !== 'production';
  return [
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function proxy(request: NextRequest): NextResponse {
  const nonce = btoa(crypto.randomUUID());
  const value = policy(nonce);

  // On the request, for Next to read the nonce from; on the response, for the browser.
  const headers = new Headers(request.headers);
  headers.set('Content-Security-Policy', value);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', value);
  return response;
}

export const config = {
  // Pages, not the files a page loads: those are not documents and need no
  // policy of their own. Nor a prefetch, which renders nothing.
  matcher: [
    {
      source: '/((?!_next/static|_next/image|sw.js).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
