# MedLiveBD company site — the brand story

Updated 12 October 2026. Worktree `D:\Projects\HealthCare-site-mvp`, branch
`feat/site-brand`, cut from `feat/site-premium` (`669aa80`, the approved
product-led version, kept for comparison). Site-only: nothing outside
`frontend/site` and this folder changes.

## Direction (owner, 12 October 2026)

Sell the experience, not the implementation. The public site says who
MedLiveBD is, why connected care matters in Bangladesh, and what hospitals and
patients gain. The software itself is shown in a private demonstration. The
approved look is kept: the headline, the blue/navy/teal identity, typography
and motion. The screenshot tour is gone, and people and place come in.

## The page, in order

| Chapter | What it does |
|---|---|
| Hero | *A Connected Healthcare Ecosystem for a Healthier Bangladesh*. The Padma Bridge (a connection the country recognises) with two abstract glimpses, a hospital and a patient, joined by a live heartbeat. Pausable. |
| Vision | One statement that lights up word by word as you scroll; an ECG trace that writes itself; Dhaka at sunset in a cinematic, parallax band with three pillars. |
| Two experiences | *One connected healthcare ecosystem. Two experiences designed for different needs.* A hospital card (lab bench detail) and a patient card (rice farmer, Chattogram), joined by a "one platform" node; the hovered card opens wider. |
| For hospitals | Nurses in training (curtain reveal), a stethoscope drawn in fine line, an abstract console glimpse, six benefits, *Request a private demo*. |
| For patients | Srimangal tea garden, a phone glimpse, a five-step journey line, and a clear **Coming soon**: the patient app is not yet open to the public. There is no link to the demo app and no form. |
| Connected Bangladesh | The country drawn from official boundary data: the outline draws in, then divisions and districts, then arcs from Dhaka to the eight division headquarters, with a slow camera push-in on scroll. Labelled **Concept illustration**; it shows no hospitals or coverage. |
| Trust | Four factual commitments. No certifications are claimed. |
| Contact | The Buriganga at dusk; *Let's build connected care, together*; support@medlivebd.com. |

Removed from the public page: the screenshot tour of six workspaces, the
"how it works" diagram, the module band, the capability cards, the
before/after table, the getting-started timeline and the FAQ. The product
captures in `public/screens` are no longer referenced.

## Motion

Framer Motion through `LazyMotion`, with features loaded after first paint.
Used where it tells the story:

- word-by-word statement reveal;
- scroll-written ECG traces;
- parallax and zoom on the photographs;
- curtain reveals on the photographs;
- the stethoscope drawing itself;
- the map drawing in, with its camera push-in.

Loops either have a pause control (the hero) or run a few times and stop (the
map pulses and rings). Nothing loops under reduced motion. Without script,
everything is visible.

## Imagery

Seven photographs from Wikimedia Commons under CC BY / CC BY-SA, and the map
from geoBoundaries (CC0, with district lines under CC BY 3.0 IGO). Sources,
licences and crops are in [CREDITS.md](CREDITS.md) and on the site at
`/{bn,en}/credits`. Each photograph carries its credit on the page.

## Checks (12 October)

- Typecheck, eslint on `frontend/site` and `prettier --check frontend/site`:
  all exit 0.
- `pnpm --filter @platform/site build` and the `SITE_EXPORT=1` build: 14
  pages, and no `localhost` outside `_next`.
- `SITE_CAPTURE=1 pnpm --filter @platform/site test:smoke` on the production
  build: **15/15 passed**. Covered: entrance and headers; the story in both
  languages; both audiences' calls to action; the real contact only; no
  forms or external links; every photograph same-origin, described, sized and
  lazily loaded, with its credit; the map named and labelled a concept; the
  hero pause; mobile menu and language switch; 1024 px and 320 px; reduced
  motion; no-script; privacy and credits pages; axe WCAG 2.1 AA on desktop,
  mobile, privacy and credits in both languages.
- First load on the production build: about 750 KB desktop and 680 KB mobile
  (AVIF photographs, 22 KB for the hero image). Largest contentful paint is
  the headline; layout shift is under 0.005.

Captures from that run: [English desktop](en-desktop.png),
[Bangla mobile](bn-mobile.png).

## Before launch

- Confirm the Bangla main line and the Bangla copy.
- Before paid advertising, replace the three photographs with recognisable
  faces with model-released photography (see CREDITS.md).
- Not merged, pushed or deployed. DNS and Cloudflare untouched.
