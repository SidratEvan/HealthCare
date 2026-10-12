# The pulse of connected care — 12 October 2026

Baseline: `940858d`, `feat/site-brand`, preserved in `HealthCare-site-mvp`.
New work: `feat/site-cinematic-connected-care`, separate worktree. User's
local-only brief overrides CLAUDE.md's older merge workflow and ten-file gate.
Only site code, site assets, site verification and handoff documentation change.

## Research before implementation

Reviewed the current pages and engineering references below. Their composition
and sequencing inform this work; no reference graphics, code or copy is reused.

Five techniques to adapt:

1. A single clear promise and generous human image before product detail —
   [Neko](https://www.nekohealth.com/), [Abridge](https://www.abridge.com/).
2. Distinct audience actions with warm human context —
   [Maven](https://www.mavenclinic.com/), [Spring](https://www.springhealth.com/).
3. Human-first technology identity with concise purpose —
   [Ada](https://about.ada.com/about-us/about-ada/).
4. One reversible sequence whose layers separate and reconnect, inspired by
   [Codrops highlights](https://tympanus.net/codrops/hub/2025-demo-highlights/),
   [scroll collection](https://tympanus.net/codrops/hub/tag/scroll/),
   [SVG masks](https://tympanus.net/codrops/2026/03/11/svg-mask-transitions-on-scroll-with-gsap-and-scrolltrigger/)
   and [SVG maps](https://tympanus.net/codrops/2026/05/21/creating-scroll-driven-svg-map-animations-with-gsap/).
5. Clearly labelled actions, normal scrolling, static fallbacks and one priority
   image: [NN/g](https://www.nngroup.com/articles/ten-usability-heuristics/),
   [fetch priority](https://web.dev/articles/fetch-priority).

Five mistakes to avoid: unrelated stock photos; equally dramatic sections;
long pin tunnels; scroll-up revealing blank text; coverage or clinical claims
implied by decorative data. The baseline screenshot also exposes excessive
white intervals, dashboard overlays and ECG imagery that weaken the narrative.

## Engineering choice

The installed Framer Motion 12 supports the required
[scroll motion values](https://motion.dev/docs/react-scroll-animations) and
[reduced-motion policy](https://motion.dev/docs/react-accessibility).
Use native CSS sticky for one compact desktop stage, Motion transforms for its
layers, and SVG path progress for the signal and accurate existing map. Reviewed
[ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/); its extra runtime
is unnecessary for this sequence. No new dependency, smooth-scroll library,
WebGL, external visitor asset request, medical API call or tracker.

## Storyboard

A. Full-bleed hospital scene, large headline left, clinicians right. The signal
starts beside the team and curves down to the centre. Photograph and signal
move at separate restrained rates. Text and CTAs remain available immediately.

B. The same central signal passes through three translucent open loops. As the
short desktop sticky stage progresses, the loops separate and resolve into a
bridge between hospital and patient environments. Both audience messages stay
readable; explicit keyboard controls focus either. On mobile the scenes stack
in document flow with a vertical connection. No pinning or scroll trap.

C. The signal arrives in a midnight geographic scene. The existing licensed
geoBoundaries country path is traced and gently settles in scale. Connections
are explicitly a vision, not live coverage; there are no hospital markers.
It leaves as a simple closing line over a Dhaka-inspired evening atmosphere.

Palette: midnight navy, cool ivory, brand blue and restrained cyan. Geist and
Anek Bangla retained, self-hosted through the build. Human campaign assets use
consistent daylight, blue shadows and natural skin. User's subsequent direction:
male-led imagery; female doctors wear hijab. Synthetic people are disclosed as
illustrations, never presented as customers or staff.

Geography provenance checked against geoBoundaries BGD ADM0/ADM1 API: release
9469f09, CC0, matching the existing projected geometry. No guessed outline.
