/**
 * Environment validation (BACKEND.md §10).
 *
 * "env.ts validates all of these with zod at boot and refuses to start if any
 * required key is missing." The tests worth writing are the ones about what
 * must *not* boot, because every one of them describes a way this service
 * could come up looking healthy and be dangerous.
 */

import { describe, expect, it } from 'vitest';

import { EnvError, loadEnv } from '../env.js';

/** A minimal valid development environment. */
const DEV: Readonly<Record<string, string>> = {
  NODE_ENV: 'development',
  API_BASE_URL: 'http://localhost:4000',
  WEB_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://healthcare:healthcare@localhost:5432/healthcare_dev',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  GUEST_LINK_SECRET: 'c'.repeat(32),
};

/** A valid production environment. */
const PROD: Readonly<Record<string, string>> = {
  ...DEV,
  NODE_ENV: 'production',
  API_BASE_URL: 'https://api.example.com',
  WEB_BASE_URL: 'https://app.example.com',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SMS_PROVIDER: 'local',
  SMS_API_KEY: 'sms-key',
  SMS_SENDER_ID: 'HEALTH',
  VAPID_PUBLIC_KEY: 'vapid-public',
  VAPID_PRIVATE_KEY: 'vapid-private',
  PAYMENT_PROVIDER: 'live',
  SENTRY_DSN: 'https://sentry.example.com/1',
  DEMO_MODE: 'false',
};

function problemsOf(source: Record<string, string>): readonly string[] {
  try {
    loadEnv(source);
  } catch (error) {
    if (error instanceof EnvError) return error.problems.map((problem) => problem.key);
    throw error;
  }
  return [];
}

describe('development', () => {
  it('accepts a minimal environment', () => {
    const env = loadEnv({ ...DEV });

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.SMS_PROVIDER).toBe('log');
    expect(env.PAYMENT_PROVIDER).toBe('mock');
  });

  it('applies every default from the document', () => {
    const env = loadEnv({ ...DEV });

    expect(env.JWT_ACCESS_TTL).toBe('15m');
    expect(env.JWT_REFRESH_TTL).toBe('30d');
    expect(env.GUEST_LINK_TTL_DAYS).toBe(30);
    expect(env.OTP_TTL_SECONDS).toBe(300);
    expect(env.OTP_MAX_PER_HOUR).toBe(5);
    expect(env.STALE_THRESHOLD_MINUTES).toBe(10);
    expect(env.DATABASE_POOL_MAX).toBe(10);
  });

  it('leaves the cloud credentials blank, because the local stack needs none', () => {
    const env = loadEnv({ ...DEV });

    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('');
    expect(env.SENTRY_DSN).toBe('');
  });

  it('coerces numbers and booleans from strings', () => {
    const env = loadEnv({ ...DEV, PORT: '8080', DEMO_MODE: 'true' });

    expect(env.PORT).toBe(8080);
    expect(env.DEMO_MODE).toBe(true);
  });
});

describe('refusing to start', () => {
  it('lists every problem at once rather than the first', () => {
    const problems = problemsOf({ NODE_ENV: 'development' });

    expect(problems).toContain('DATABASE_URL');
    expect(problems).toContain('JWT_ACCESS_SECRET');
    expect(problems.length).toBeGreaterThan(3);
  });

  it('refuses a short secret, with the command to generate one', () => {
    try {
      loadEnv({ ...DEV, JWT_ACCESS_SECRET: 'short' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      expect((error as EnvError).message).toContain('randomBytes(32)');
    }
  });

  it('refuses a malformed URL', () => {
    expect(problemsOf({ ...DEV, API_BASE_URL: 'localhost:4000' })).toContain('API_BASE_URL');
  });

  it('refuses a port outside the valid range', () => {
    expect(problemsOf({ ...DEV, PORT: '70000' })).toContain('PORT');
  });

  it('refuses a TTL that is not a duration', () => {
    expect(problemsOf({ ...DEV, JWT_ACCESS_TTL: '15 minutes' })).toContain('JWT_ACCESS_TTL');
  });

  it('refuses an unknown provider', () => {
    expect(problemsOf({ ...DEV, SMS_PROVIDER: 'twilio' })).toContain('SMS_PROVIDER');
  });
});

describe('production', () => {
  it('accepts a complete environment', () => {
    const env = loadEnv({ ...PROD });

    expect(env.NODE_ENV).toBe('production');
    expect(env.DEMO_MODE).toBe(false);
  });

  it('refuses demo mode, which permits database reset and mock payments', () => {
    // FR-SEC-08: demo and prototype environments contain no real patient data,
    // and the converse matters just as much — a production environment must
    // not accept demo behaviour.
    const problems = problemsOf({ ...PROD, DEMO_MODE: 'true' });

    expect(problems).toContain('DEMO_MODE');
  });

  it('refuses the mock payment adapter, which approves every payment', () => {
    expect(problemsOf({ ...PROD, PAYMENT_PROVIDER: 'mock' })).toContain('PAYMENT_PROVIDER');
  });

  it('refuses a shared access and refresh secret', () => {
    // Sharing them lets a 15-minute access token be replayed as a 30-day
    // refresh token.
    const problems = problemsOf({
      ...PROD,
      JWT_ACCESS_SECRET: 'z'.repeat(32),
      JWT_REFRESH_SECRET: 'z'.repeat(32),
    });

    expect(problems).toContain('JWT_REFRESH_SECRET');
  });

  it('refuses missing storage credentials, and says what breaks', () => {
    try {
      loadEnv({ ...PROD, SUPABASE_SERVICE_ROLE_KEY: '' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as EnvError).message).toContain('no patient could open a report');
    }
  });

  it('refuses missing SMS credentials when a real provider is configured', () => {
    const problems = problemsOf({ ...PROD, SMS_API_KEY: '' });

    // Without SMS there is no tracking link, and a guest has no way to follow
    // their serial (FR-GST-05).
    expect(problems).toContain('SMS_API_KEY');
  });

  it('does not ask for SMS credentials when the log provider is deliberate', () => {
    const problems = problemsOf({
      ...PROD,
      SMS_PROVIDER: 'log',
      SMS_API_KEY: '',
      SMS_SENDER_ID: '',
    });

    expect(problems).not.toContain('SMS_API_KEY');
    expect(problems).not.toContain('SMS_SENDER_ID');
  });

  it('refuses missing push keys, which are half the notification policy', () => {
    // FR-NOT-02: app users get push and SMS for material events.
    expect(problemsOf({ ...PROD, VAPID_PRIVATE_KEY: '' })).toContain('VAPID_PRIVATE_KEY');
  });

  it('refuses a missing Sentry DSN, so a crash in a live chamber is reported', () => {
    expect(problemsOf({ ...PROD, SENTRY_DSN: '' })).toContain('SENTRY_DSN');
  });
});
