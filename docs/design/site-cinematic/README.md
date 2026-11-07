# Cinematic company site — Codex's design, finished (12 October 2026)

Branch `feat/site-codex-final`, started from Codex's exact work (`8c563ec`,
also `backup/codex-cinematic-8c563ec` and now `feat/site-cinematic-connected-care`).
An earlier Claude refinement that moved scenes onto light backgrounds was
rejected by the owner; it is kept, unused, as `backup/claude-refine-f0d9b80`.
Local only: not pushed, merged or deployed. Live medlivebd.com is unchanged.

## What was kept

Codex's design is the source of truth: the photographic hero, the dark navy
and teal atmosphere, the side-by-side hospital and patient panorama with its
overlaid titles, buttons and focus controls, the Bangladesh scene, the trust
section and the evening closing. All copy is Codex's except the feature points
below. The four campaign originals and their 24 renditions are byte-identical
(SHA-256 of all 28 files checked).

## What changed, and only this

| Change | Why |
| --- | --- |
| The light hospital and patient sections after the panorama are gone; their points sit on navy under each photograph | They repeated the team and patient photos. Each photo now appears once, in Codex's panorama |
| Feature points made concrete (live queue and serials; beds and emergency; every role — find care; book a serial; follow it live) | Owner: "only important point-to-point features" |
| Three rotating ovals → a MedLiveBD node with a bridge into both photos | The ovals meant nothing; the node says "one platform, both audiences" |
| Hero curve removed; thread starts at the hero's foot | It stretched with the window (`preserveAspectRatio="none"`), began on a stethoscope and drifted as the photo moved |
| Map strokes `vector-effect: non-scaling-stroke`; one labelled spoke per division headquarters | They were in viewBox units: ~0.7 px spokes, ~0.3 px divisions at 0.2 opacity |
| Closing gradient line removed; "Meet the founders" link | Decorative, ended nowhere |
| No sticky stage | It left ~1,000 px of empty navy on desktop |
| No springs on scroll | The photograph trailed the hand |
| Larger logo, compact on scroll without moving content | Owner: the tagline under the logo must be readable |
| Founders page `/{bn,en}/founders`, in the same night palette | Owner's founders text |

## Evidence (`restored/`)

`00` Codex's original as left, `01` hero, `02` hospitals and patients, `03`
their points, `04` Bangladesh, `05` closing, `06` English desktop full page,
`07` Bangla mobile full page, `08` Bangla mobile scenes, `09` frames scrolling
forward then back. Full pages are captured with reduced motion so every line
shows its final state.

Checks: `tsc`, ESLint, Prettier, static export, 31/31 Playwright on the export.

## Note for whoever previews

A dev server left running on port 3200 had its build folder overwritten by a
production build and served a blank white error page. Preview the export with
`node scripts/preview-static.mjs` (port 3210) after a fresh `SITE_EXPORT=1` build.

## Waiting on the owner

Bangla copy for the new points and the founders page; Bangla spellings সিদরাত
and মায়েশা; Mayesha's address is `mayesha@medlivebd.com` (the supplied link
pointed to `sidrat@`).

## Audience gateway (12 October 2026, `feat/site-audience-gateway`)

Owner accepted the restored design and asked only that hospitals and patients
read as two unmistakable experiences. Nothing else changed.

- Hero: two doors, **For hospitals** (brand blue) and **For patients** (glass,
  teal), replace Request a Demo and Explore. Request a Demo stays in the header.
- Panorama: "See both" toggles removed. Larger headings, a colour of its own
  per experience (blue / teal top edge, label and list markers), one action
  each: Request a Demo (email) and Explore the patient experience (the patient
  information under its scene, with the coming-soon note — never the demo).
- The MedLiveBD bridge now lives in the gap between the photographs and stops
  at their edges; it no longer crosses a face or text.
- Three short benefits per experience; lines tightened.
- Phone: both doors on the first screen; over the stacked scenes a pinned
  Hospitals | Patients selector shows where you are and jumps either way.
- Arriving at an experience from the navigation or a door gives it a brief
  glow (not under reduced motion).

Evidence in `gateway/`: before/after on desktop and Bangla mobile, real
clicks and taps. Smoke 35/35 on the static export.

## Real destinations (12 October 2026, owner)

For Hospitals and For Patients are links, never anchors. Hero buttons, header
(desktop and mobile), footer and the two-photo scene all use the same pair:

- For Hospitals → `mailto:support@medlivebd.com` (demonstration request); no
  secure hospital entrance exists yet and the password-less console is never
  linked.
- For Patients → `https://healthcare-patient-zeta.vercel.app` (new tab), always
  tagged Demo, with a notice not to enter real personal information. The app
  shows its own demo banner. This overrides the earlier no-demo-link rule
  (`docs/STATUS.md`, FR-SEC-08) on the owner's instruction; that note needs
  updating when the site is released.

The mobile Hospitals | Patients selector was removed (it only scrolled).
Evidence in `navigation/`.
