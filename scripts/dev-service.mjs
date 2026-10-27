// A process per runnable package; the Windows launcher owns its process tree.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
process.loadEnvFile(resolve(root, '.env'));
process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4000/api/v1';
process.env.NEXT_PUBLIC_SOCKET_URL = 'http://localhost:4000';
process.env.NEXT_TELEMETRY_DISABLED = '1';
const service = process.argv[2];
if (service === 'api') {
  const database = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)) {
    throw new Error('Local startup requires a local database.');
  }
  database.username = process.env.API_DB_USER;
  database.password = process.env.API_DB_PASSWORD;
  process.env.DATABASE_URL = database.toString();
}
const packages = {
  api: ['backend/api', 'tsx/cli', ['watch', 'src/server.ts']],
  patient: ['frontend/patient', 'next/dist/bin/next', ['dev', '--webpack', '--port', '3000']],
  console: ['frontend/console', 'next/dist/bin/next', ['dev', '--webpack', '--port', '3100']],
  site: ['frontend/site', 'next/dist/bin/next', ['dev', '--webpack', '--port', '3200']],
};
const selected = packages[service];
if (!selected) throw new Error('Choose api, patient, console or site.');
const binary = selected[1];
let directory = selected[0];
let args = selected[2];
const django = service === 'api' && process.env.LOCAL_API_BACKEND !== 'Node';
if (django) {
  directory = 'backend/django';
  args = [
    '-m',
    'uvicorn',
    'medlive.asgi:application',
    '--host',
    '127.0.0.1',
    '--port',
    '4000',
    '--no-proxy-headers',
  ];
}
const cwd = resolve(root, directory);
const require = createRequire(resolve(cwd, 'package.json'));
const command = django
  ? resolve(cwd, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  : process.execPath;
const child = spawn(command, django ? args : [require.resolve(binary), ...args], {
  cwd,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
