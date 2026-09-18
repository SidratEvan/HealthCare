/**
 * Environment validation (BACKEND.md §10).
 *
 * "env.ts validates all of these with zod at boot and refuses to start if any
 * required key is missing." Refusing to start is the whole point: a service
 * that boots with a blank `JWT_ACCESS_SECRET` and signs tokens with an empty
 * string is worse than one that will not boot at all, and a service that comes
 * up in production with `DEMO_MODE=true` would put demonstration patients in
 * front of real staff.
 *
 * What is required depends on where it is running. In development the Supabase
 * keys, the SMS credentials and the payment keys are all blank, because the
 * local stack uses the log provider, the mock payment adapter and the Postgres
 * container. In production none of them may be.
 */

import { z } from 'zod';

/** Secrets must be long enough that a leaked one is not brute-forceable. */
const MIN_SECRET_LENGTH = 32;

const secret = z
  .string()
  .min(
    MIN_SECRET_LENGTH,
    `must be at least ${String(MIN_SECRET_LENGTH)} characters — generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
  );

const duration = z.string().regex(/^\d+[smhd]$/, 'must look like 15m, 24h or 30d');

const boolish = z.enum(['true', 'false']).transform((value) => value === 'true');

const port = z.coerce.number().int().min(1).max(65_535);
const positiveInt = z.coerce.number().int().positive();

/**
 * An absolute http(s) URL.
 *
 * Not `z.url()`, which delegates to the WHATWG parser and therefore accepts
 * `localhost:4000` — read as protocol `localhost:` with path `4000`. That is a
 * valid URL and a useless base address, and `WEB_BASE_URL` is what the guest
 * tracking link is built from (FR-GST-05): get it wrong and every guest
 * receives an SMS with a link that cannot open.
 */
const httpUrl = z.string().refine((value) => {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== '';
  } catch {
    return false;
  }
}, 'must be an absolute http(s) URL, e.g. https://api.example.com');

const schema = z.object({
  // --- Runtime ------------------------------------------------------------
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: port.default(4000),
  API_BASE_URL: httpUrl,
  WEB_BASE_URL: httpUrl,

  // --- Database (DATABASE.md) ---------------------------------------------
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: positiveInt.max(200).default(10),

  // --- Supabase Storage: signed URLs only (BACKEND.md §0) -----------------
  SUPABASE_URL: z.string().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(''),
  SUPABASE_STORAGE_BUCKET: z.string().default('healthcare-dev'),

  // --- Auth ---------------------------------------------------------------
  JWT_ACCESS_SECRET: secret,
  JWT_REFRESH_SECRET: secret,
  JWT_ACCESS_TTL: duration.default('15m'),
  JWT_REFRESH_TTL: duration.default('30d'),

  // --- Guest tracking links (FR-GST-05) -----------------------------------
  GUEST_LINK_SECRET: secret,
  GUEST_LINK_TTL_DAYS: positiveInt.max(365).default(30),

  // --- OTP (FR-SEC-05, FR-GST-03) -----------------------------------------
  OTP_TTL_SECONDS: positiveInt.max(3_600).default(300),
  OTP_MAX_PER_HOUR: positiveInt.max(100).default(5),

  // --- SMS ----------------------------------------------------------------
  SMS_PROVIDER: z.enum(['local', 'log']).default('log'),
  SMS_API_KEY: z.string().default(''),
  SMS_SENDER_ID: z.string().default(''),
  SMS_MONTHLY_CAP: positiveInt.default(20_000),

  // --- Web Push (VAPID) ---------------------------------------------------
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  VAPID_SUBJECT: z.string().default(''),

  // --- Payments -----------------------------------------------------------
  PAYMENT_PROVIDER: z.enum(['mock', 'live']).default('mock'),
  BKASH_BASE_URL: z.string().default(''),
  BKASH_APP_KEY: z.string().default(''),
  BKASH_APP_SECRET: z.string().default(''),
  BKASH_USERNAME: z.string().default(''),
  BKASH_PASSWORD: z.string().default(''),
  NAGAD_BASE_URL: z.string().default(''),
  NAGAD_MERCHANT_ID: z.string().default(''),
  NAGAD_MERCHANT_NUMBER: z.string().default(''),
  NAGAD_PUBLIC_KEY: z.string().default(''),
  NAGAD_PRIVATE_KEY: z.string().default(''),

  // --- Emergency travel time (FR-PAT-43) ----------------------------------
  TRAVEL_TIME_MODE: z.enum(['static', 'api']).default('static'),
  MAPS_API_KEY: z.string().default(''),

  // --- Freshness (FR-OFF-04) ----------------------------------------------
  STALE_THRESHOLD_MINUTES: positiveInt.max(1_440).default(10),

  // --- Observability ------------------------------------------------------
  SENTRY_DSN: z.string().default(''),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // --- Demo mode (FR-DEM-07) ----------------------------------------------
  DEMO_MODE: boolish.default(false),
});

export type Env = z.infer<typeof schema>;

/**
 * Keys that may be blank in development but never in production, with the
 * reason each one matters, because "SUPABASE_SERVICE_ROLE_KEY is required" is
 * less useful at three in the morning than knowing what breaks without it.
 */
const PRODUCTION_REQUIREMENTS: readonly {
  readonly key: keyof Env;
  readonly because: string;
  readonly unless?: (env: Env) => boolean;
}[] = [
  { key: 'SUPABASE_URL', because: 'reports and prescriptions have nowhere to be stored' },
  {
    key: 'SUPABASE_SERVICE_ROLE_KEY',
    because: 'signed URLs cannot be issued, so no patient could open a report',
  },
  {
    key: 'SMS_API_KEY',
    because:
      'a guest booking produces an SMS tracking link, and without it the patient has no way to follow their serial (FR-GST-05)',
    unless: (env) => env.SMS_PROVIDER === 'log',
  },
  {
    key: 'SMS_SENDER_ID',
    because: 'the aggregator rejects messages without a registered sender',
    unless: (env) => env.SMS_PROVIDER === 'log',
  },
  {
    key: 'VAPID_PUBLIC_KEY',
    because: 'push is half the notification policy for app users (FR-NOT-02)',
  },
  { key: 'VAPID_PRIVATE_KEY', because: 'push notifications cannot be signed' },
  {
    key: 'SENTRY_DSN',
    because: 'a crash in a live chamber would go unreported',
  },
];

/**
 * Parses and validates the environment, or throws with every problem listed.
 *
 * Takes the source so tests can exercise it without touching the real process,
 * and so a worker can validate its own subset later.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);

  if (!parsed.success) {
    throw new EnvError(
      parsed.error.issues.map((issue) => ({
        key: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    );
  }

  const env = parsed.data;
  const problems: { key: string; message: string }[] = [];

  if (env.NODE_ENV === 'production') {
    for (const requirement of PRODUCTION_REQUIREMENTS) {
      if (requirement.unless?.(env) === true) continue;
      if (env[requirement.key] === '') {
        problems.push({
          key: String(requirement.key),
          message: `required in production — without it, ${requirement.because}`,
        });
      }
    }

    // FR-SEC-08 and FR-DEM-07: demo mode allows seeding and reset, forces the
    // mock payment adapter and shows a demonstration banner. None of that
    // belongs in front of real patients.
    if (env.DEMO_MODE) {
      problems.push({
        key: 'DEMO_MODE',
        message:
          'must be false in production — it permits database reset and mock payments (FR-SEC-08)',
      });
    }

    if (env.PAYMENT_PROVIDER === 'mock') {
      problems.push({
        key: 'PAYMENT_PROVIDER',
        message: 'must be "live" in production — the mock adapter approves every payment',
      });
    }

    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      problems.push({
        key: 'JWT_REFRESH_SECRET',
        message:
          'must differ from JWT_ACCESS_SECRET — sharing them lets a 15-minute access token be replayed as a 30-day refresh token',
      });
    }
  }

  if (problems.length > 0) throw new EnvError(problems);

  return env;
}

/** Thrown at boot, with every problem at once rather than the first. */
export class EnvError extends Error {
  readonly problems: readonly { readonly key: string; readonly message: string }[];

  constructor(problems: readonly { readonly key: string; readonly message: string }[]) {
    super(
      [
        `Environment is not valid (${String(problems.length)} problem(s)):`,
        '',
        ...problems.map((problem) => `  ${problem.key}: ${problem.message}`),
        '',
        'See .env.example for the full list (BACKEND.md §10).',
      ].join('\n'),
    );
    this.name = 'EnvError';
    this.problems = problems;
  }
}

/**
 * The validated environment, read once at module load.
 *
 * Imported directly by the infrastructure modules. Everything above the
 * infrastructure layer receives what it needs as an argument, so a service is
 * testable without an environment at all.
 */
export const env: Env = loadEnv();

export const isProduction = (): boolean => env.NODE_ENV === 'production';
export const isTest = (): boolean => env.NODE_ENV === 'test';
