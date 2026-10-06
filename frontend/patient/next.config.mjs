/**
 * Next.js configuration for the patient PWA (FRONTEND.md §9).
 *
 * `transpilePackages` is what lets the workspace packages be consumed from
 * TypeScript source rather than from a build step. That is deliberate: the
 * queue reducer in `shared/domain` is the same code the server runs
 * (`FR-QUE-05`), and a compiled copy in between is one more place the two could
 * drift.
 */

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  transpilePackages: ['@platform/ui', '@platform/client', '@platform/domain', '@platform/i18n'],

  // The patient app is a PWA served to phones on 3G. Nothing here is
  // indexed — the marketing site is a separate app (FRONTEND.md §10).
  poweredByHeader: false,

  /**
   * The headers every page carries (plan A7; `NFR-08`; handover finding 22).
   *
   * - nothing here is drawn inside somebody else's page (`X-Frame-Options`,
   *   `frame-ancestors`): a screen with a patient's serial or a hospital's
   *   queue on it is not something to be framed and overlaid;
   * - a file is what its type says (`nosniff`);
   * - an address is passed on only as far as its origin, so a tracking
   *   link's token does not travel to wherever the next click goes;
   * - the patient app may ask where the phone is, for the emergency search, and for nothing else;
   * - a browser that has reached this origin over HTTPS does not try it in
   *   the clear again. A browser ignores this header over plain HTTP, so a
   *   developer's machine is unaffected.
   *
   * The Content-Security-Policy is the part that can be stated without
   * breaking the page: where it may be framed, what a form may post to, no
   * plugins. It does not yet restrict scripts. Next writes inline scripts,
   * and a policy that allowed them all would be a policy in name only; one
   * built on a nonce per request is a change to how every page is served.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'geolocation=(self), camera=(), microphone=(), payment=()',
          },
          { key: 'Strict-Transport-Security', value: 'max-age=15552000; includeSubDomains' },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
          },
        ],
      },
    ];
  },

  // Next writes its own AGENTS.md and CLAUDE.md on first run. This repository
  // already has one, at the root, and it is the operating contract — a second
  // one inside a package would quietly compete with it (CLAUDE.md §2).
  agentRules: false,

  /**
   * Resolve `./x.js` to `./x.ts`.
   *
   * `shared/domain` is compiled for Node ESM as well as for the browser, and
   * Node ESM requires the extension on every relative import. TypeScript
   * understands that those `.js` specifiers mean the `.ts` beside them; a
   * bundler does not, unless told.
   *
   * Without this, every re-export in the shared packages fails to resolve —
   * and the alternative, dropping the extensions, would break the API, which
   * runs the same files under Node.
   */
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },

  // Turbopack has no `extensionAlias` equivalent, so `dev` and `build` both
  // pass `--webpack` (see package.json). Revisit when it gains one: Turbopack
  // is substantially faster and this is the only thing holding it off.
};
