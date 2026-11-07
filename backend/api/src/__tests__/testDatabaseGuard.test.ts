/**
 * A test run never connects to a database that is not a test database
 * (`FR-SEC-08`): the guard in `config/db.ts`, which holds even when a suite is
 * started from a folder where its own setup does not load.
 */

import { describe, expect, it } from 'vitest';

import { assertTestDatabase } from '../config/db.js';

describe('the test-database guard (FR-SEC-08)', () => {
  it('refuses a hosted or development database under test', () => {
    expect(() => {
      assertTestDatabase('postgresql://u:p@pooler.supabase.com:5432/postgres', true);
    }).toThrow(/must end in _test/);
    expect(() => {
      assertTestDatabase('postgresql://u:p@localhost:5432/healthcare_dev', true);
    }).toThrow(/must end in _test/);
    expect(() => {
      assertTestDatabase('not a url', true);
    }).toThrow(/must end in _test/);
  });

  it('allows a _test database under test, and anything outside a test', () => {
    expect(() => {
      assertTestDatabase('postgresql://u:p@localhost:5432/healthcare_api_test', true);
    }).not.toThrow();
    expect(() => {
      assertTestDatabase('postgresql://u:p@pooler.supabase.com:5432/postgres', false);
    }).not.toThrow();
  });
});
