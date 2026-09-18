// Architectural boundaries, enforced by lint.
//
// BACKEND.md §3:  routes → controllers → services → repositories → db
//                 "A controller never touches SQL; a repository never emits
//                  events or sends notifications; only services orchestrate."
//
// BACKEND.md §2:  shared/domain "has no I/O. Pure functions and types."
//
// CLAUDE.md §7:   "SQL only in repositories. Events and notifications only in
//                  services. The queue reducer exists once, in shared/domain."
//
// These are not style preferences. The reducer being the single definition of
// what an event means is what guarantees the console and the API can never
// disagree about the queue (FR-QUE-05), and every rule below exists to stop
// that guarantee eroding one convenient import at a time.
//
// Implementation note — read before editing a zone:
//   `import-x/no-restricted-paths` matches a zone with minimatch when the path
//   looks like a glob, and with a real path comparison when it does not. On
//   Windows the resolved glob contains backslashes, which minimatch reads as
//   escape characters, so a zone written as `backend/api/src/services/**`
//   matches nothing on a developer's machine while still matching in Linux CI.
//   Zones here are therefore plain directory (or file) paths — never globs. A
//   rule that is quiet on one platform is worse than no rule at all.

import path from 'node:path';

/** Absolute repository root, independent of the directory eslint was run from. */
const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

/** Server layers, outermost first. A layer may only import from layers below it. */
const SERVER_LAYERS = ['routes', 'controllers', 'services', 'repositories'];

/** Side-effect modules that only a service may reach (CLAUDE.md §7). */
const SIDE_EFFECT_DIRS = ['realtime', 'adapters', 'jobs'];

/** Every app that follows the server layering (BACKEND.md §3, §8). */
const SERVER_APPS = ['backend/api', 'backend/workers'];

/**
 * Builds the `import-x/no-restricted-paths` zones for one server app: each layer
 * is blocked from importing any layer above it, plus the leaf modules that only
 * services are allowed to reach.
 */
function serverZones(app) {
  const dir = (name) => `${app}/src/${name}`;
  const zones = [];

  // A layer may never import from a layer above it.
  for (const [index, layer] of SERVER_LAYERS.entries()) {
    const above = SERVER_LAYERS.slice(0, index).map(dir);
    if (above.length > 0) {
      zones.push({
        target: dir(layer),
        from: above,
        message: `${layer} may not import from an outer layer. The chain is routes → controllers → services → repositories → db (BACKEND.md §3).`,
      });
    }
  }

  // The chain may not be short-circuited downwards either: a route delegates
  // to a controller, which is the only thing that calls a service.
  zones.push({
    target: dir('routes'),
    from: [dir('services')],
    message:
      'A route may not call a service directly. Mount a controller; the chain is routes → controllers → services (BACKEND.md §3).',
  });

  // Routes and controllers are thin: parse, delegate, shape a response. They
  // never reach the data layer or the side-effect layer.
  for (const layer of ['routes', 'controllers']) {
    zones.push({
      target: dir(layer),
      from: [dir('repositories'), `${app}/src/config/db.ts`],
      message: `${layer} may not touch the data layer. Call a service; SQL lives in repositories only (CLAUDE.md §7).`,
    });
    zones.push({
      target: dir(layer),
      from: SIDE_EFFECT_DIRS.map(dir),
      message: `${layer} may not broadcast, send or enqueue. Events and notifications happen in services only (CLAUDE.md §7).`,
    });
  }

  // A repository reads and writes rows. It does not broadcast, notify, enqueue,
  // or call a payment provider.
  zones.push({
    target: dir('repositories'),
    from: SIDE_EFFECT_DIRS.map(dir),
    message:
      'A repository never emits events or sends notifications — it only reads and writes rows (BACKEND.md §3).',
  });

  // Adapters (SMS, push, payments, maps) are leaves behind an interface.
  zones.push({
    target: dir('adapters'),
    from: [dir('routes'), dir('controllers'), dir('services'), dir('repositories')],
    message:
      'An adapter is a leaf behind an interface. It may not reach back into the application (BACKEND.md §3).',
  });

  return zones;
}

/** Zones that keep the shared packages honest. */
const PACKAGE_ZONES = [
  {
    // The single most important boundary in the repository.
    target: 'shared/domain',
    from: ['frontend', 'backend', 'shared/client', 'shared/ui', 'shared/i18n', 'database'],
    message:
      'shared/domain has no I/O and no dependants (BACKEND.md §2). It is imported by everything and imports nothing — that is what makes replay deterministic (FR-QUE-05).',
  },
  {
    target: 'shared/ui',
    from: ['frontend', 'backend', 'shared/client'],
    message:
      'shared/ui is the design system. It may not import an app or the API client (FRONTEND.md §10).',
  },
  {
    target: 'shared/i18n',
    from: ['frontend', 'backend', 'shared/client', 'shared/ui'],
    message: 'shared/i18n holds messages and formatters only (FRONTEND.md §10).',
  },
  {
    target: 'shared/client',
    from: ['frontend', 'backend'],
    message: 'shared/client is consumed by apps, never the reverse (FRONTEND.md §10).',
  },
  {
    // The frontend and the backend never reach into each other. They meet at
    // the HTTP and realtime contracts, and in shared/ — nowhere else.
    target: 'frontend',
    from: ['backend', 'database'],
    message:
      'The frontend may not import server code. It talks to the API over HTTP and the session channel; anything both sides need belongs in shared/ (BACKEND.md §1).',
  },
  {
    target: 'backend',
    from: ['frontend'],
    message:
      'The backend may not import a frontend app. Anything both sides need belongs in shared/ (BACKEND.md §1).',
  },
];

/**
 * Layering, purity and single-definition rules.
 * Appended after the shared baseline in the root `eslint.config.mjs`.
 */
export const layering = [
  // ---------------------------------------------------------------------------
  // Server layering and package boundaries.
  //
  // Both sets live in one rule invocation because `import-x/no-restricted-paths`
  // is a single rule: a second config block would replace the first zone list
  // rather than add to it.
  // ---------------------------------------------------------------------------
  {
    files: ['{frontend,backend,shared}/*/src/**/*.{ts,tsx}', 'database/**/*.ts'],
    rules: {
      'import-x/no-restricted-paths': [
        'error',
        {
          basePath: REPO_ROOT,
          zones: [...SERVER_APPS.flatMap(serverZones), ...PACKAGE_ZONES],
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // SQL only in repositories (CLAUDE.md §7)
  //
  // The query builder itself is restricted, so a stray `db.selectFrom(...)` in
  // a service fails lint rather than review.
  // ---------------------------------------------------------------------------
  {
    files: ['backend/*/src/**/*.ts'],
    ignores: [
      'backend/*/src/repositories/**',
      // The data layer describing itself: the pool, and the table types that
      // `Generated<>` and `ColumnType<>` come from.
      'backend/*/src/config/db.ts',
      'backend/*/src/config/schema.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'kysely',
              message:
                'SQL lives in repositories only (CLAUDE.md §7). Call a repository instead of building a query here.',
            },
            {
              name: 'pg',
              message: 'The connection pool belongs to config/db.ts (BACKEND.md §3).',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TaggedTemplateExpression[tag.name="sql"]',
          message:
            'Raw SQL lives in repositories only (CLAUDE.md §7, BACKEND.md §3). Move this into a *.repo.ts.',
        },
        {
          selector: 'FunctionDeclaration[id.name=/^(queueReducer|reduceQueue)$/]',
          message:
            'The queue reducer exists once, in shared/domain (CLAUDE.md §7). Import it; never reimplement it in a route, a service or the client.',
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // The queue reducer exists once (CLAUDE.md §7) — client side.
  // ---------------------------------------------------------------------------
  {
    files: ['shared/{client,ui}/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'FunctionDeclaration[id.name=/^(queueReducer|reduceQueue)$/]',
          message:
            'The queue reducer exists once, in shared/domain (CLAUDE.md §7). Import it; never reimplement it in the client.',
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // shared/domain: pure, deterministic, replayable
  //
  // Replay determinism is a tested guarantee (CLAUDE.md §4 step 2), so the
  // queue and ranking code may not read the clock, the network, the filesystem
  // or a random number. Time and randomness arrive as arguments.
  // ---------------------------------------------------------------------------
  {
    files: ['shared/domain/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'http', 'https', 'crypto', 'child_process'],
              message:
                'shared/domain has no I/O (BACKEND.md §2). Pass the value in as an argument.',
            },
            {
              group: ['kysely', 'pg', 'express', 'socket.io*', 'pg-boss', 'pino', 'react', 'next*'],
              message:
                'shared/domain is pure types and functions, used by the server and the client (BACKEND.md §2).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['shared/domain/src/queue/**/*.ts', 'shared/domain/src/emergency/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'NewExpression[callee.name="Date"]',
          message:
            'Reading the clock breaks replay determinism (FR-QUE-05). Take `now: Date` as a parameter.',
        },
        {
          selector: 'MemberExpression[object.name="Date"][property.name="now"]',
          message:
            'Reading the clock breaks replay determinism (FR-QUE-05). Take `now: Date` as a parameter.',
        },
        {
          selector: 'MemberExpression[object.name="Math"][property.name="random"]',
          message:
            'Randomness breaks replay determinism (FR-QUE-05). Pass a seeded generator in if one is genuinely needed.',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'shared/domain has no I/O (BACKEND.md §2).' },
        { name: 'process', message: 'shared/domain reads no environment (BACKEND.md §2).' },
      ],
    },
  },
];

export default layering;
