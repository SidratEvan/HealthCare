/**
 * Next.js configuration for the staff console (FRONTEND.md §9).
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

  // The console is an internal tool behind a hospital's own network; it is not
  // indexed and has no marketing surface.
  poweredByHeader: false,

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
