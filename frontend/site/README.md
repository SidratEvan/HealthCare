# frontend/site — MedLiveBD company website

The company presentation for **medlivebd.com**: the founder-approved final design
of 12 October 2026 (`docs/design/site-final/README.md`), released from `mvp`
with Wrangler (below). It tells a connected-care story through original synthetic
Bangladeshi healthcare scenes (`docs/design/site-cinematic/ASSETS.md`).
**For Hospitals** opens `/{bn,en}/hospitals`; **For Patients** opens the patient
demo (`healthcare-patient-zeta.vercel.app`, new tab, marked Demo); demonstration
requests open email to `support@medlivebd.com`. Bangla at `/bn` (the default),
English at `/en`, privacy and asset credits at `/{bn,en}/privacy` and
`/{bn,en}/credits`. The staff console is never linked.

The site itself calls no API and holds no patient data. There
are no forms, cookies, analytics or trackers; the privacy notice says exactly
that, so adding any of them means changing the notice in the same change.

## Develop

```bash
pnpm --filter @platform/site dev          # http://localhost:3200
pnpm --filter @platform/site build        # Node server build
pnpm --filter @platform/site start
pnpm --filter @platform/site test:smoke   # static export on port 3210
```

For this isolated review, build with `SITE_EXPORT=1`, then run
`node frontend/site/scripts/preview-static.mjs` from the repository root.
The preview is `http://localhost:3210/en` (and `/bn`). It serves only the local
`out/` directory and has no publishing action. The smoke suite starts this helper
if it is not already running. Existing port 3200 previews remain independent.

## Historical product screens

`public/screens/*.webp` are captures of the real patient app and console on the
seeded demonstration data (`FR-DEM-07`, `FR-SEC-08`), taken from a throwaway
local database so no test data appears. These baseline assets are retained but
are not used in the cinematic presentation. Recapture them
from a freshly seeded database, never from a database tests have written to.

## Publish to Cloudflare Pages

`medlivebd.com`'s DNS is already on Cloudflare, and its mail runs through
Cloudflare Email Routing. Pages is free for a commercial site and, because the
DNS is in the same account, attaching the domain adds only the site's own
records. **The MX and TXT records (Email Routing, SPF, the Brevo code) must
not be touched.**

1. **Build the static site.**

   ```bash
   SITE_EXPORT=1 pnpm --filter @platform/site build   # writes frontend/site/out
   ```

   PowerShell: `$env:SITE_EXPORT='1'; pnpm --filter @platform/site build`.
   `out/` holds `_headers` (the same security headers the Node build sends,
   plus HSTS) and `_redirects` (`/` → `/bn`).

2. **Create the Pages project by direct upload.** Cloudflare dashboard →
   Workers & Pages → Create → Pages → _Upload assets_. Name it `medlivebd`
   and upload the **contents** of `frontend/site/out`. It is served at
   `https://medlivebd.pages.dev` at once — the preview to check before the
   domain is attached.

3. **Attach the domain.** In the project → Custom domains → add
   `medlivebd.com`, then `www.medlivebd.com`. Cloudflare creates the two
   records itself and issues the certificate.

4. **Check.** `https://medlivebd.com` opens the Bangla page; `/en` the English;
   `/sitemap.xml` and `/robots.txt` answer; the response carries
   `x-frame-options: DENY`. Then confirm mail still arrives: the MX records
   still name `route1-3.mx.cloudflare.net`, and a test message to
   `sidrat@medlivebd.com` is delivered.

## Releasing updates with Wrangler

The project stays Direct Upload; Wrangler uploads to it from a commit, so a
release is a recorded act rather than a folder dragged in by hand.

1. **Once:** create a Cloudflare API token limited to _Account · Cloudflare
   Pages · Edit_ on this one account (no DNS, no Email Routing, no Zone
   permissions). Put it, with the account ID, the project's name and its
   production branch (Pages → the project → Settings), in
   `frontend/site/.env.deploy.local`, which git ignores:

   ```
   CLOUDFLARE_API_TOKEN=...
   CLOUDFLARE_ACCOUNT_ID=...
   PAGES_PROJECT=...
   PAGES_PRODUCTION_BRANCH=...
   ```

2. **Preview** (the default; nothing at medlivebd.com changes):
   `pnpm --filter @platform/site deploy:preview` → served at
   `preview.<project>.pages.dev`.

3. **Production**, after the preview is checked:
   `pnpm --filter @platform/site deploy:production -- --confirm=<project>`.

The script refuses uncommitted site changes, builds `out/` fresh with
`SITE_EXPORT=1`, checks it holds the security headers, redirects, both
languages, the privacy notice, sitemap and robots, and that no file carries
the token or a localhost address, then runs `pnpm dlx wrangler@4.140.0 pages
deploy`. Wrangler is pinned and fetched on demand; it is not a repository
dependency. Rolling back is a click on an earlier deployment in the
dashboard.

Manual alternative: To update later: build again and upload a new deployment to the same project.
Connecting the project to the GitHub repository instead (build command as in
step 1, output `frontend/site/out`, `NODE_VERSION=22`) needs the site's commits
on a pushed branch first.

To undo: remove the two custom domains from the project. Nothing else changes.
