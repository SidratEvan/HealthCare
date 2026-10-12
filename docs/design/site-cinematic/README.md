# Cinematic company site — refinement record (12 October 2026)

Codex built the cinematic homepage (`feat/site-cinematic-connected-care`, base
`940858d`) and ran out of time before finishing it. Its work was committed
unchanged as `8c563ec` on `feat/site-cinematic-refine`, and refined there. Local
only: not pushed, merged or deployed. Live medlivebd.com is unchanged.

## Photographs: preserved, each shown once

The four campaign originals in `originals/` and their 24 web renditions in
`frontend/site/public/campaign/` are byte-identical to Codex's (SHA-256 of all
28 files checked before and after). Only placement changed.

| Image | Before | Now |
| --- | --- | --- |
| `hero` | hero | hero (unchanged) |
| `team` | two-card stage **and** the hospital story | the hospital card only |
| `patient` | two-card stage **and** the patient story | the patient card only |
| `atmosphere` | closing | closing (unchanged) |

The separate hospital and patient story sections were the repetition. They were
merged into the two-card scene: each card keeps its photograph and gains three
concrete points beneath it (live queue and serials; beds and emergency; every
role — and for patients: find care; book a serial; follow it live). Two whole
sections and about 1,600 px of scroll went away; nothing was left empty.

Derived file: `public/brand/medlivebd-logo-480.webp`, a 480 px rendition of
`docs/design/brand/medlivebd-logo-light.png` so the larger header logo stays
sharp. The logo artwork is unchanged.

## Connecting lines: what was wrong, what happened to each

| Line | Cause of the problem | Decision |
| --- | --- | --- |
| Hero curve over the doctors | `preserveAspectRatio="none"` stretched it with the window; it began on a stethoscope; the photograph moved under it with parallax; its track was 0.25 opacity over a mid-tone photo | Removed. The thread now starts at the hero's "Scroll" cue |
| Three rotating ovals between the cards | Represented nothing a visitor could name | Removed. Replaced by a labelled **MedLiveBD** node that branches to both cards |
| Vertical hairline in the light sections | 1 px cyan at 0.16 opacity, purely decorative | Removed with those sections |
| Offset frames on the story photographs | Read as misregistration, overlapping the photo | Removed with those sections |
| Map spokes, divisions and outline | Strokes were in viewBox units: a 1,000-unit map drawn ~420 px wide turned 1.6 into ~0.7 px and division lines into ~0.3 px at 0.2 opacity | Kept and fixed: `vector-effect: non-scaling-stroke`, 2 px spokes, 1.5 px outline, 1 px divisions at 0.32 |
| Map connections | Faded in as one blob, ending at unnamed points | One spoke per division headquarters from Dhaka, drawn clockwise, each ending at a labelled city with a halo for legibility. Still labelled a vision, not coverage |
| Closing gradient line | Decorative, ended nowhere | Removed |

One stroke system now: 2 px (`--thread-width`), teal on night, brand blue on
paper, a faint track that shows the route before it is drawn.

## Motion

- Framer Motion 12 only (already installed). No GSAP, no smooth-scroll library,
  no new dependency.
- Each animated element has one owner: its own section's `useScroll` progress,
  mapped directly to transform, opacity or SVG path length. No springs on
  scroll: the earlier springs made the photograph trail the hand.
- Nothing is pinned. Codex's sticky two-card stage left a ~1,000 px stretch of
  empty navy on desktop; it is gone.
- Text and actions never depend on scroll position to be visible.
- Two gates: lines draw on every screen unless reduced motion is asked for;
  photographs drift only on large screens. Without script or with reduced
  motion, every line is fully drawn and every photograph is still.
- One section transition: each scene rises over the last as a rounded sheet.
- The header is fixed; it shrinks with a transform, so content never moves.

## Measurements (production export, headless Chromium, this machine)

Wheel-scrolled down the whole page and back up. Frame interval median / p95:

| Run | Hero | Hospitals and patients | Map | Long tasks during scroll | CLS |
| --- | --- | --- | --- | --- | --- |
| Desktop 1440 | 16.7 / 16.7 ms | 16.7 / 16.7 | 16.7 / 16.7 | none | 0.0008 |
| Phone 390 | 16.7 / 16.7 | 16.7 / 16.8 | 16.7 / 16.7 | none | 0.0002 |
| Phone 390, CPU ×4 | 16.7 / 33.4 | 16.7 / 33.3 | 16.7 / 16.8 | none (two at start-up, hydration) | 0.0021 |

Not measured: real devices, GPU-bound low-end Android. Headless numbers are an
indication, not a field result.

## Evidence

`refined/`: 01–04 heroes (en/bn, desktop/mobile), 05 hospitals and patients,
06 map, 07 closing, 08–09 full page (desktop/mobile, reduced motion, which
shows every final state), 10 founders, and two frame sheets scrolling forward
then back through the map and the fork. Codex's own screenshots in this folder
are the baseline.

Checks: `tsc`, ESLint, Prettier, static export, 30/30 Playwright (routes and
headers, axe on every page, menu and keyboard, anchors and language switch, 8
widths × 2 languages, unique photographs, visible strokes, reversible drawing,
header behaviour, reduced motion, no-JavaScript).

## Waiting on the owner

- Bangla copy, including the new feature points and the founders page.
- Founders' names in Bangla sentences are transliterated as সিদরাত and মায়েশা;
  headings keep the Latin names.
- Mayesha's email: the supplied text linked `mayesha@` to `sidrat@`; the page
  uses `mayesha@medlivebd.com`.
