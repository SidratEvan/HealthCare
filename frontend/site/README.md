# frontend/site — MedLiveBD company website

The public company site at **medlivebd.com**: what MedLiveBD is, the platform's
workspaces shown as real screens on demonstration data, how a hospital starts,
and a demonstration request by email to `support@medlivebd.com`. Bangla at
`/bn` (the default), English at `/en`, a privacy notice at `/{bn,en}/privacy`.

No patient, hospital-login, inquiry backend or clinical API is connected. There
are no forms, cookies, analytics or trackers; the privacy notice says exactly
that, so adding any of them means changing the notice in the same change.

## Develop

```bash
pnpm --filter @platform/site dev          # http://localhost:3200
pnpm --filter @platform/site build        # Node server build
pnpm --filter @platform/site start
pnpm --filter @platform/site test:smoke   # against the started build
```

## Product screens

`public/screens/*.webp` are captures of the real patient app and console on the
seeded demonstration data (`FR-DEM-07`, `FR-SEC-08`), taken from a throwaway
local database so no test data appears. Every one is described as
demonstration data in its `alt` text and in the hero caption. Recapture them
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

To update later: build again and upload a new deployment to the same project.
Connecting the project to the GitHub repository instead (build command as in
step 1, output `frontend/site/out`, `NODE_VERSION=22`) needs the site's commits
on a pushed branch first.

To undo: remove the two custom domains from the project. Nothing else changes.
