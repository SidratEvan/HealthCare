/**
 * The gate `pnpm db:seed` and `pnpm db:reset` pass through (`FR-DEM-06`,
 * `FR-SEC-08`).
 *
 * A reset truncates every table. On a hospital's own server the database host
 * is `db`, which the target check treats as local, so this gate is what stands
 * between an operator's command and a production database emptied and refilled
 * with demonstration rows. `NODE_ENV=production` refuses outright, whatever
 * `DEMO_MODE` says.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { assertDemoMode } from '../seeds/lib/demo-mode.js';

const KEYS = ['NODE_ENV', 'DEMO_MODE'] as const;

describe('assertDemoMode', () => {
  const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of KEYS) saved[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('permits a demo environment', () => {
    process.env['NODE_ENV'] = 'development';
    process.env['DEMO_MODE'] = 'true';
    expect(() => assertDemoMode('pnpm db:reset')).not.toThrow();
  });

  it('refuses when DEMO_MODE is not true', () => {
    process.env['NODE_ENV'] = 'development';
    process.env['DEMO_MODE'] = 'false';
    expect(() => assertDemoMode('pnpm db:reset')).toThrow(/DEMO_MODE is not true/);
  });

  it('refuses under NODE_ENV=production even with DEMO_MODE=true', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['DEMO_MODE'] = 'true';
    expect(() => assertDemoMode('pnpm db:reset')).toThrow(/NODE_ENV is production/);
    expect(() => assertDemoMode('pnpm db:seed')).toThrow(/Refusing pnpm db:seed/);
  });
});
