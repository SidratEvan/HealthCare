# MedLiveBD company site — premium redesign

Updated 12 October 2026. Worktree `D:\Projects\HealthCare-site-mvp`, branch
`feat/site-premium`, cut from `feat/company-site`. Site-only: nothing outside
`frontend/site`, `pnpm-lock.yaml` and this folder changes.

## What the page argues, in order

| Section | Job |
|---|---|
| Hero | Main line (owner, 12 October): *A Connected Healthcare Ecosystem for a Healthier Bangladesh* / *সুস্থ বাংলাদেশের জন্য একটি সংযুক্ত স্বাস্থ্যসেবা ইকোসিস্টেম*. Beside it, the product's promise **drawn in code**: reception presses *Call next*, the patient's phone moves (6 → 9, then "your turn"). It plays by itself, can be paused, and the visitor can press the button. |
| Modules band | Breadth: every workspace by name. |
| Why live matters | Without / with, five rows. |
| How it works (dark) | Four steps, one diagram: reception → live queue → phones, doctor, administration; the last step shows the honest-degradation rule (offline, figure age). |
| Product | The six **real captured screens** (`public/screens`, demonstration data) behind an accessible tab list. Console screens are cropped past the repeated side rail. |
| For hospital teams | Seven cards, each with a small CSS-driven picture: reception, beds, emergency, lab, doctor, offline, branding. |
| For patients | The real patient screen and five things a patient can do. |
| Network | Hospital A/B/C (never a real or seeded name) — what is shared, what stays inside. |
| Trust (dark) | Six rules the platform enforces. |
| Getting started | Configure → import → rehearse → go live. |
| Questions | Six, answered as the platform stands today (including "not in this version"). |
| Contact (dark) | `support@medlivebd.com`, copy button, the synthetic-data note. |

Nothing invented: no customers, partners, figures, testimonials or
certifications. Illustrations say they are illustrations; every screen says it
is demonstration data.

## Design system

Tokens are all in `src/app/site.css` `:root`: logo blue for action, navy for
words, teal only as the live signal. Type: Geist (English), Geist Mono (small
live labels), Anek Bangla (Bangla; never tracked, headings ≥ 1.36 leading,
body 1.72, Bengali numerals throughout). The logo master has a white ground,
so it only ever sits on light surfaces; dark sections are inset panels.

## Motion

Framer Motion `12.43.0` (owner's request), loaded through `LazyMotion` with
its features fetched after first paint; the hero text animates in CSS so the
first paint never waits for it. Loops run only on screen and in a visible tab,
stop when paused (WCAG 2.2.2), and do not run under reduced motion. Without
script, every section is visible (`<noscript>` style in the layout).

## Checks (12 October)

- `pnpm --filter @platform/site typecheck`, eslint on `frontend/site`,
  `prettier --check frontend/site` — exit 0.
- `pnpm --filter @platform/site build` and `SITE_EXPORT=1` build — both clean;
  no `localhost` address outside `_next` (a share-image link on the privacy
  pages used to resolve to localhost; fixed in the locale layout).
- `SITE_CAPTURE=1 pnpm --filter @platform/site test:smoke` against the
  production build — **12/12 passed**: headers and entrance, every section
  in both languages, the real contact only, keyboard (skip link, tab list
  arrows/Home, steps, questions), the illustration's button and pause, mobile
  menu and language switch keeping the reader's place, 1024 px and 320 px
  without overflow, reduced motion, no-script, privacy notice, screens with
  demonstration-data alt text, and axe WCAG 2.1 AA on desktop and mobile in
  both languages.

Captures from that run: [English desktop](en-desktop.png),
[Bangla mobile](bn-mobile.png).

## Not done here

- The product screens are the 11 October captures (pre-console-redesign).
  Recapturing from the redesigned consoles needs the local capture database
  (`scripts/capture-screens.mjs`, Docker Postgres); Docker was stopped.
- Not merged, pushed or deployed. DNS and Cloudflare untouched.
