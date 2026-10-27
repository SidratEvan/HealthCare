// Local demonstration setup (FR-DEM-06, FR-SEC-08). Never reset existing data.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

const root = resolve(import.meta.dirname, '..');
const envPath = resolve(root, '.env');
let contents = readFileSync(existsSync(envPath) ? envPath : resolve(root, '.env.example'), 'utf8');
for (const key of [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'GUEST_LINK_SECRET',
  'API_DB_PASSWORD',
]) {
  if (!parseEnv(contents)[key]) {
    const value = randomBytes(32).toString('hex');
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    contents = pattern.test(contents)
      ? contents.replace(pattern, `${key}=${value}`)
      : `${contents}\n${key}=${value}\n`;
  }
}
if (!parseEnv(contents).API_DB_USER) contents += '\nAPI_DB_USER=healthcare_local_api\n';
const config = { ...parseEnv(contents), ...process.env };
const url = new URL(config.DATABASE_URL ?? '');
if (
  config.NODE_ENV !== 'development' ||
  config.DEMO_MODE !== 'true' ||
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.pathname !== '/healthcare_dev' ||
  config.PORT !== '4000' ||
  config.WEB_BASE_URL !== 'http://localhost:3000' ||
  config.CONSOLE_BASE_URL !== 'http://localhost:3100' ||
  config.PAYMENT_PROVIDER !== 'mock' ||
  config.SMS_PROVIDER !== 'log'
) {
  throw new Error(
    'This launcher requires a local development demo: localhost/healthcare_dev, app ports 4000/3000/3100, mock payments and log SMS. The database port may be customized in .env. Check shell overrides too. Remote and production targets are refused.',
  );
}
writeFileSync(envPath, contents);
if (process.argv.includes('--env-only')) {
  console.log('Local .env ready; secrets are generated and kept out of Git.');
} else {
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    connectionString: config.DATABASE_URL,
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  try {
    if (process.argv.includes('--connection-only')) {
      console.log('Configured local PostgreSQL is reachable.');
    } else {
      const result = await client.query('SELECT count(*)::int AS count FROM hospitals');
      if (result.rows[0].count === 0) {
        // The wrapper invokes the existing seed command only for an empty DB.
        process.exitCode = 10;
      } else {
        console.log(`Keeping existing demo data (${result.rows[0].count} facilities).`);
      }
    }
  } finally {
    await client.end();
  }
}
