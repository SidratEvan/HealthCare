# MedLiveBD company presentation — local checkpoint

Updated 11 October 2026. Worktree `D:\Projects\HealthCare-company-site`, branch
`feat/medlivebd-company-site`, base `9b2337e`.

The original accelerated brief authorizes this independent company site and
confirms `sidrat@medlivebd.com`. Existing page/copy/assets are retained. No
clinical app, API, database, deployment or provider configuration is changed.
The logo is byte-identical to the approved patient logo.

Implemented: server-rendered document language through locale root layouts,
Bangla display leading/word breaks, responsive menu closure and truthful scoped
README. Added six isolated browser cases covering languages/metadata, complete
page content, real email contact, workflows, keyboard/mobile/tablet behavior,
security headers, axe, reduced motion and 320-pixel overflow.

Complete locally. Current focused results, all exit 0:

- `pnpm --filter @platform/site typecheck`
- `pnpm exec eslint frontend/site/src frontend/site/tests frontend/site/next.config.mjs --max-warnings 0`
- `pnpm exec prettier --check frontend/site`
- `pnpm --filter @platform/site build` — static `/`, `/bn` and `/en` built.
- `$env:SITE_CAPTURE='1'; pnpm --filter @platform/site test:smoke` — **6/6 passed,
  1.0 minute**, one worker, zero retries. Axe WCAG 2 A/AA and 2.1 AA passed in
  both languages at desktop and mobile. No browser page errors were observed.
- `git diff --check`

Initial test TypeScript failures were corrected. A typecheck started during
the build encountered stale prior-session Next dev declarations; the build
regenerated production declarations and the final package typecheck passed.
No previous session result or failed run is counted as passing evidence.

Scope: premium bilingual company presentation, platform workflows, hospital
onboarding explanation and email demonstration/contact links. No invented
customers, statistics, testimonials, clinical content or availability. Figures
are illustrative and marked accordingly. Historical Part C's application
entrances, lead pipeline, brochure and policy pages are not part of this brief.

Representative captures, inspected after the passing run:

- [English desktop, 1440 pixels](en-desktop.png)
- [Bangla mobile, 375 pixels](bn-mobile.png)

No further screen inventory or repeated suites were generated. Browser checks
also cover 1024-pixel tablet and 320-pixel small-phone layouts.

Built local preview: **http://localhost:3200/bn** and
**http://localhost:3200/en**, HTTP 200 verified. Hidden owned Node process
**22268** remains running for the owner; its PID is also in ignored
`preview-pid.local`. To stop this specific preview after review, run
`Stop-Process -Id 22268` while that PID still belongs to this site's Next server.
Restart from this checkout with `pnpm --filter @platform/site start`.

All dependencies reuse existing monorepo versions; the lockfile diff contains
only the new site importer entries. No packages were downloaded/installed.

The original approved brief is
`C:\Users\sidra\.codex\attachments\989e288f-30a1-47c9-b2ac-13432dadb846\Pasted text.txt`.
The user's accelerated local-only policy overrides the historical Part C scope
and CLAUDE.md's intermediate reviews/release workflow for this task.

Verification limits: this is the isolated public company site, not clinical
certification, email-delivery verification or a hosted release. Email CTAs open
the visitor's mail client; no inquiry is stored and no message was sent.
Historical Part C policy/application routes remain outside the approved brief.
There is no unresolved local site blocker from the performed checks.

No push, merge, deployment, external connector, real data or clinical API/database
operation was performed. The site remains separately reviewable on its feature
branch; the console integration is owned by the root workstream.
