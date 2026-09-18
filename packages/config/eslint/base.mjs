// Shared ESLint rules for every workspace.
//
// Type-aware linting is on deliberately: a realtime queue engine lives and dies
// by unawaited promises and non-exhaustive switches over the event union, and
// neither is detectable without type information.
//
// Rule choices trace back to CLAUDE.md §7:
//   - no `any`
//   - no `@ts-ignore` without a stated reason
//   - never log patient identifiers, OTPs, tokens or payment references
//     (enforced structurally by banning console.* — everything goes through pino)

import path from 'node:path';

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';

/** Absolute repository root, independent of the directory eslint was run from. */
const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

/** Files that are never linted. */
export const ignores = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.next/**',
  '**/coverage/**',
  '**/playwright-report/**',
  '**/test-results/**',
  '**/*.d.ts',
  'pnpm-lock.yaml',
];

/**
 * The shared baseline. The root `eslint.config.mjs` composes it with the
 * boundaries from `./layering.mjs` and then the `overrides` exported below,
 * in that order.
 */
export const base = tseslint.config(
  { ignores },

  // ---------------------------------------------------------------------------
  // TypeScript — type-aware
  // ---------------------------------------------------------------------------
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        // Resolves each file against the nearest tsconfig.json, so a new
        // workspace needs no change here. Every .ts file in the repository
        // belongs to a tsconfig — a file that belongs to none fails lint
        // rather than being silently skipped.
        projectService: true,
        tsconfigRootDir: REPO_ROOT,
      },
    },
    plugins: { import: importPlugin },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          noWarnOnMultipleProjects: true,
          project: ['tsconfig.json', '{apps,packages}/*/tsconfig.json', 'db/tsconfig.json'],
        },
      },
    },
    rules: {
      // --- CLAUDE.md §7: strict types -------------------------------------
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': 'allow-with-description',
          'ts-expect-error': 'allow-with-description',
          'ts-nocheck': true,
          minimumDescriptionLength: 12,
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // --- Async correctness: the queue engine depends on it ---------------
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/return-await': ['error', 'always'],

      // --- Exhaustiveness: 18 queue event types, none may be forgotten ----
      //     (DATABASE.md §1 queue_event_type, FR-QUE-03)
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      // --- Import hygiene --------------------------------------------------
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'import/no-cycle': ['error', { maxDepth: Infinity, ignoreExternal: true }],
      'import/no-self-import': 'error',
      'import/no-useless-path-segments': ['error', { noUselessIndex: true }],
      'import/no-duplicates': 'error',
      'import/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
            'object',
            'type',
          ],
          pathGroups: [{ pattern: '@platform/**', group: 'internal', position: 'before' }],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],

      // --- Structured logging only (CLAUDE.md §7) --------------------------
      'no-console': 'error',

      // --- General correctness ---------------------------------------------
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-param-reassign': ['error', { props: true }],
      'no-var': 'error',
      'prefer-const': 'error',
      'object-shorthand': ['error', 'always'],

      // Money correctness (DB-P5: integer poisha, never floats) is enforced by
      // the branded types in @platform/domain, not by banning arithmetic here.
      // A lint rule broad enough to catch a float amount also catches every
      // legitimate `Math.round(seconds / 60)` in the ETA maths, and a rule that
      // people routinely disable costs more authority than it earns.
    },
  },

  // ---------------------------------------------------------------------------
  // Configuration written as ESM JavaScript (this file, eslint.config.mjs).
  // Linted without type information, because it sits outside every tsconfig.
  // ---------------------------------------------------------------------------
  {
    files: ['**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
    },
  },

  // Must stay last within the baseline: switches off everything Prettier owns.
  prettier,
);

/**
 * Relaxations for files where a baseline rule genuinely does not apply.
 *
 * Composed **after** the layering rules in the root `eslint.config.mjs`, and
 * that order is load-bearing: flat config replaces a rule's options rather than
 * merging them, so a relaxation placed before the layering block would be
 * silently re-enabled by it. A test that legitimately asserts on the append-only
 * event log would then fail the "SQL only in repositories" rule.
 */
export const overrides = tseslint.config(
  // ---------------------------------------------------------------------------
  // Tests run against seeded demo data (CLAUDE.md §6), so they assert on rows
  // and events that production code would never construct by hand.
  // ---------------------------------------------------------------------------
  {
    files: [
      '**/*.{test,spec}.{ts,tsx}',
      '**/tests/**/*.{ts,tsx}',
      '**/__tests__/**/*.{ts,tsx}',
      'e2e/**/*.{ts,tsx}',
    ],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-restricted-syntax': 'off',
      'no-console': 'off',
      // A repository test asserts on schema-level guarantees — the append-only
      // trigger on queue_events, RLS scoping, serial allocation under
      // concurrency (BACKEND.md §11) — and reaches the database directly to
      // do it. The layering rule still applies to everything that is not a test.
      'no-restricted-imports': 'off',
    },
  },

  // ---------------------------------------------------------------------------
  // Scripts, seeds and config print progress to a terminal; that is their
  // interface, not a logging mistake.
  // ---------------------------------------------------------------------------
  {
    files: ['db/**/*.ts', '**/scripts/**/*.{ts,mts}', '*.config.{ts,mts}'],
    rules: {
      'no-console': 'off',
    },
  },
);

export default base;
