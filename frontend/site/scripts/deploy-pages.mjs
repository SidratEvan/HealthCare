/**
 * Builds the company site from the committed source and uploads it to the
 * existing Cloudflare Pages project (Direct Upload) with Wrangler.
 *
 *   pnpm --filter @platform/site deploy:preview
 *   pnpm --filter @platform/site deploy:production -- --confirm=<project name>
 *
 * A preview is the default: it is served at a `*.pages.dev` address and
 * touches nothing at medlivebd.com. Production needs `--production` and the
 * project's name typed again, so it is never a slip of the fingers.
 *
 * Credentials come only from the environment or from the git-ignored
 * `frontend/site/.env.deploy.local`, and are never printed:
 *
 *   CLOUDFLARE_API_TOKEN    a token limited to "Account · Cloudflare Pages · Edit"
 *   CLOUDFLARE_ACCOUNT_ID   the account that owns the project
 *   PAGES_PROJECT           the Pages project's name, as the dashboard shows it
 *   PAGES_PRODUCTION_BRANCH the project's production branch (dashboard → Settings)
 *
 * The site holds no DNS, email or application data; neither does this script
 * touch any.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Pinned and run through `pnpm dlx`: nothing is added to the repository. */
const WRANGLER = 'wrangler@4.140.0';

const SITE = resolve(import.meta.dirname, '..');
const REPO = resolve(SITE, '../..');
const OUT = join(SITE, 'out');
const args = process.argv.slice(2);
const production = args.includes('--production');
const confirm = args.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);

function fail(message) {
  console.error(`deploy-pages: ${message}`);
  process.exit(1);
}

// --- credentials, from the environment or the ignored local file ------------
const localFile = join(SITE, '.env.deploy.local');
if (existsSync(localFile)) {
  for (const line of readFileSync(localFile, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}
for (const key of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'PAGES_PROJECT']) {
  if (!process.env[key])
    fail(`${key} is not set (environment or frontend/site/.env.deploy.local).`);
}
const project = process.env['PAGES_PROJECT'];
const productionBranch = process.env['PAGES_PRODUCTION_BRANCH'];
if (production) {
  if (!productionBranch) fail('PAGES_PRODUCTION_BRANCH is not set; read it from the dashboard.');
  if (confirm !== project) fail(`a production release needs --confirm=${project}.`);
}

// --- only committed source is released ---------------------------------------
function git(...command) {
  const result = spawnSync('git', command, { cwd: REPO, encoding: 'utf8' });
  if (result.status !== 0) fail(`git ${command.join(' ')} failed.`);
  return result.stdout.trim();
}
if (git('status', '--porcelain', '--', 'frontend/site') !== '') {
  fail('frontend/site has uncommitted changes; commit them first so the release is traceable.');
}
const commit = git('rev-parse', 'HEAD');

// --- a fresh static build -------------------------------------------------------
rmSync(OUT, { recursive: true, force: true });
const build = spawnSync('pnpm --filter @platform/site build', {
  cwd: REPO,
  env: { ...process.env, SITE_EXPORT: '1' },
  shell: true,
  stdio: 'inherit',
});
if (build.status !== 0) fail('the build failed.');

// --- what must be in the upload ------------------------------------------------
for (const file of [
  '_headers',
  '_redirects',
  'bn.html',
  'en.html',
  'bn/privacy.html',
  'robots.txt',
  'sitemap.xml',
]) {
  if (!existsSync(join(OUT, file))) fail(`the build has no ${file}.`);
}
function* files(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}
// Never a credential or a local address in a public upload.
for (const path of files(OUT)) {
  if (!/\.(html|txt|xml|js|css|json)$/.test(path)) continue;
  const text = readFileSync(path, 'utf8');
  if (text.includes(process.env['CLOUDFLARE_API_TOKEN'])) fail(`${path} contains the API token.`);
  if (/localhost:\d{4}/.test(text) && !path.includes('_next'))
    fail(`${path} names a localhost address.`);
}

// --- upload ------------------------------------------------------------------------
const branch = production ? productionBranch : 'preview';
console.log(
  `deploy-pages: ${production ? 'PRODUCTION' : 'preview'} of ${commit.slice(0, 7)} to ${project} (${branch})`,
);
const deploy = spawnSync(
  'pnpm',
  [
    'dlx',
    WRANGLER,
    'pages',
    'deploy',
    OUT,
    `--project-name=${project}`,
    `--branch=${branch}`,
    `--commit-hash=${commit}`,
    '--commit-dirty=false',
  ],
  { cwd: REPO, env: process.env, shell: process.platform === 'win32', stdio: 'inherit' },
);
process.exit(deploy.status ?? 1);
