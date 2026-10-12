/** Company presentation only (S-C-01, S-C-02, S-C-04, S-C-05). No clinical API or auth. */

/**
 * `SITE_EXPORT=1` builds static files into `out/` for a static host
 * (Cloudflare Pages). A static host cannot run `headers()`, so the same
 * headers, and the `/` → `/bn` entrance, travel as `public/_headers` and
 * `public/_redirects` — keep them in step with `SECURITY_HEADERS` here.
 */
const STATIC_EXPORT = process.env.SITE_EXPORT === '1';

const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=()',
  },
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
];

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  poweredByHeader: false,
  agentRules: false,
  ...(STATIC_EXPORT
    ? { output: 'export' }
    : {
        async headers() {
          return [{ source: '/:path*', headers: SECURITY_HEADERS }];
        },
      }),
};
