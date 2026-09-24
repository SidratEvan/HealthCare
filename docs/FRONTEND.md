# Frontend & Design System Document

## National Healthcare Platform — Bangladesh

**Document:** `FRONTEND.md` — 3 of 4 (`PRD.md`, `APP_FLOW.md`, **`FRONTEND.md`**, `BACKEND.md`)
**Version:** 1.0
**Depends on:** `PRD.md` (requirements), `APP_FLOW.md` (screens, controls, wiring)
**Purpose:** how this product looks, feels, and is built on the client — to a standard where nobody can tell it was built fast.

---

## 0. The standard we are building to

### 0.1 What "premium" means here

Premium is not decoration. In this product it means four things:

1. **Restraint.** One accent colour doing real work, not five. One typeface family across both scripts. Fewer, larger elements.
2. **Confidence in typography.** Type carries the hierarchy, not borders and boxes. Bangla set properly is the single biggest quality signal in this market, because almost nobody does it well.
3. **Responsiveness to touch.** Every tap answers in under 100 ms, with motion that matches the physical action. Latency is the most-felt quality metric on a cheap Android phone.
4. **Honesty in state.** Loading, empty, stale, and offline are designed states, not afterthoughts. An app that tells you its data is 12 minutes old feels more trustworthy than one that pretends.

### 0.2 The dead giveaways — banned list

These are the tells that mark an app as quickly generated. None of them appear in this product.

**Colour**
- Indigo/violet primary (`#6366F1`, `#8B5CF6`) — the default accent of every generated app.
- Purple-to-pink or blue-to-cyan gradient hero backgrounds.
- Gradient text headings.
- Rainbow-coded charts with a different hue per series.
- Pure black `#000` or pure white `#FFF` as the page ground.
- Coloured drop shadows.

**Typography**
- Inter, Roboto, Poppins, Montserrat, Open Sans as the brand face.
- System-font-only fallback stacks as the final design.
- Latin numerals inside Bangla sentences.
- Fake italics on Bangla text (the script has no true italic).
- Letter-spacing applied to Bangla.
- Centre-aligned paragraphs of body text.

**Layout & components**
- Card grids where every card is identical and separated only by a thin border.
- Left-border accent strips on cards (`border-l-4 border-indigo-500`).
- Emoji as interface icons (🚑 🏥 ❤️).
- Everything `rounded-full` or everything `rounded-2xl` — one radius applied to all things regardless of size.
- Uniform `shadow-lg` on every surface.
- Glassmorphism panels floating over gradients.
- Stat tiles with a big number, a tiny up-arrow, and a green percentage, everywhere.
- "Hero section → three feature cards → CTA band" page skeleton.
- Untouched default component-library styling.

**Content**
- Placeholder copy shipped as real copy.
- Invented statistics.
- Illustrations of abstract 3D blobs or generic flat-people vector art.
- Icon + heading + one-line-of-filler triplets used as filler.

### 0.3 The positive direction

The visual language is **clinical calm with Bengali warmth**: a warm off-white ground rather than clinical white, a deep botanical green as the single institutional colour, a restrained clay-red reserved exclusively for emergency, type that carries the page, and generous negative space around a small number of large, confident elements.

Reference feel, not reference copying: the quiet authority of a well-made civic institution — signage, forms, and wayfinding done carefully — rather than a startup landing page.

### 0.4 The design reference

There is a design canvas for this product, and it is the visual reference the
client work is built against:

**https://claude.ai/code/artifact/b92af388-582a-4104-acc4-afd0f5557149**
— *Hospital Platform — Patient App (Bangla)*

Ten artboards, covering the whole product:

| Patient, 390×900 | Staff, 1280×860 |
|---|---|
| `Main` — হোম | `Reception` — রিসেপশন কনসোল |
| `Specialty` — বিশেষজ্ঞ → হাসপাতাল | `Doctor` — ডাক্তারের স্ক্রিন |
| `Hospital` — হাসপাতালের ভেতরে | `Beds` — বেড বোর্ড |
| `Serial` — লাইভ সিরিয়াল | `EmergencyConsole` — জরুরি বিভাগ কনসোল |
| `Emergency` — জরুরি | `Admin` — ব্যবস্থাপনা ড্যাশবোর্ড |

**How to use it.** It is a reference, not a specification. This document
remains the authority: where the canvas and §1–§3 disagree, the tokens here
win and the canvas is the thing that gets updated. The canvas is where to look
for *composition* — how a screen is massed, what sits where, how much air a
card gets, how the live serial is staged — which a token table cannot express.

It already agrees with §1.1 exactly: `#F6F4EF` ground, `#14211C` ink, `#0C5C46`
brand, `#7FD6A8` live, `#E8F0EC` tinted surface, `#B3261E` emergency, `#8A5A00`
on `#F7EEDC` for lateness and delay, and the three neutral line weights. It
also already does the things §0.2 bans nothing of and §2 insists on: Bengali
numerals throughout, a freshness line at the foot of the live screen, inline
stroke SVG rather than emoji, real `<button>` elements, 44 px minimum targets.

**One divergence, unresolved.** The canvas sets body copy in **Hind Siliguri**
and display in **Noto Serif Bengali** — a two-face pairing. §2.1 mandates a
single superfamily, **Anek Bangla**, with Hind Siliguri only as a fallback, on
the reasoning that one voice across both scripts is what makes a product look
designed rather than assembled. Both are defensible and the canvas's serif
display has real presence on the hero numeral. §2.1 stands until the owner
rules; recorded in `docs/STATUS.md`.

---

## 1. Brand foundation

### 1.1 Colour tokens

Defined once as CSS custom properties; Tailwind maps to them. Never hard-code a hex in a component.

```css
:root {
  /* Ground — warm, never pure white */
  --bg-canvas:        #F6F4EF;  /* app background */
  --bg-surface:       #FFFFFF;  /* cards, sheets */
  --bg-sunken:        #EFEBE2;  /* wells, table headers, track fills */
  --bg-inverse:       #0E1A16;  /* dark surfaces */

  /* Ink */
  --ink-primary:      #14211C;  /* body and headings */
  --ink-secondary:    #3E4B45;  /* supporting text */
  --ink-muted:        #4F5A54;  /* captions — still AA on canvas */
  --ink-inverse:      #F6F4EF;

  /* Institutional green — the single brand colour */
  --brand-900:        #06291F;
  --brand-700:        #08402F;
  --brand-600:        #0C5C46;  /* primary actions, brand surfaces */
  --brand-300:        #7FD6A8;  /* progress, live indicators on dark */
  --brand-100:        #E8F0EC;  /* tinted surfaces */
  --brand-border:     #C9DDD3;

  /* Emergency — reserved. Never used for ordinary destructive UI */
  --alert-700:        #7A2018;
  --alert-600:        #B3261E;
  --alert-100:        #FBE9E7;

  /* Caution — delays, staleness, late patients */
  --warn-700:         #6B4A10;
  --warn-600:         #8A5A00;
  --warn-100:         #F7EEDC;
  --warn-border:      #E8D6B0;

  /* Neutral lines */
  --line-strong:      #D9D4C8;
  --line-soft:        #E2DED4;
  --line-hairline:    #EFEBE2;
}
```

**Colour law**
- `--alert-*` appears **only** for emergency and for genuine danger. A "cancel booking" button is neutral, not red. If red loses its meaning, the emergency button loses its power.
- `--warn-*` carries exactly three meanings: doctor delay, stale data, late patient.
- Green is institutional, not decorative: primary actions, live/positive state, brand surfaces.
- Charts use a single-hue ramp of green plus neutral grey. Never categorical rainbow.
- Maximum three colour-carrying elements per screen.

### 1.2 Dark mode (console only, v1.1+)

Night-shift reception and ER staff need it. Dark mode inverts ground tokens to `--bg-inverse` family and lifts brand to `--brand-300` for contrast. The patient app ships light-only in v1 — most patients use it outdoors in daylight.

### 1.3 Contrast requirements

| Pair | Ratio | Status |
|---|---|---|
| `--ink-primary` on `--bg-canvas` | 15.11:1 | AAA |
| `--ink-muted` on `--bg-canvas` | 6.54:1 | AA |
| `#FFFFFF` on `--brand-600` | 7.97:1 | AAA |
| `#FFFFFF` on `--alert-600` | 6.54:1 | AA |
| `--warn-700` on `--warn-100` | 6.97:1 | AA |

Ratios are computed from the §1.1 hex values by `contrastRatio()` in
`shared/ui/src/a11y/contrast.ts`, and `contrast.test.ts` asserts every row.
They are therefore descriptive of the palette: change a token and this table
must change with it, or the suite fails.

**`--warn-700` is AA, not AAA.** An earlier version of this table read 7.9:1
AAA. The §1.1 value `#6B4A10` actually yields 6.97:1 — it misses AAA by three
hundredths. `#63420D` produces exactly 7.9:1 and would make both sections true
at once, which suggests that was the intended value; it is a brand-token change
and so is left for the owner. Recorded in `docs/STATUS.md`. Caution text is
legible either way, and the delay chip uses `--warn-600` (5.14:1, AA) in any
case.

Any new pair must be verified before use (`FR-LOC-05`) — call `meets()` rather
than reasoning about it. No white text on `--brand-300` (1.74:1, clears
nothing), no muted ink on tinted surfaces below 4.5:1.

---

## 2. Typography — the part that decides everything

### 2.1 Family selection

Both scripts come from one superfamily so Bangla and English share skeleton, weight axis, and rhythm. This is the single most effective way to look designed rather than assembled.

| Role | Family | Why | Source |
|---|---|---|---|
| **Primary UI + body** | **Anek Bangla** (Ek Type) | Variable weight 100–800, modern low-contrast humanist forms, excellent at small sizes, made for screens, covers Bangla + Latin via the Anek superfamily | Google Fonts / Fontsource, OFL |
| **Display / numerals in hero positions** | **Anek Bangla** at 700–800, tightened tracking | Keeps one voice; weight and size create hierarchy instead of a second face | same |
| **Long-form reading (reports, policy, consent)** | **Tiro Bangla** | A proper text serif for dense reading; used only in document contexts | Google Fonts, OFL |
| **Fallback stack** | `'Anek Bangla', 'Hind Siliguri', 'Noto Sans Bengali', system-ui, sans-serif` | Hind Siliguri is the most commonly installed quality Bangla face in the region | — |

Self-hosted rather than linked from a CDN: no third-party request, no FOUT on poor networks, and it works offline in the PWA shell. Each app loads Anek Bangla and Tiro Bangla through `next/font/google` in `src/app/fonts.ts`, which downloads the faces at build time and serves them from the app's own origin — part of Next, so no extra package. The faces are exposed as `--font-anek` and `--font-tiro`, which `--font-ui` and `--font-reading` read with the family names as fallback. (Until the design pass after step 20 no face was loaded at all, and every screen rendered in whatever Bangla font the device had.)

**Banned:** Inter, Roboto, Poppins, Montserrat as brand faces. Kalpurush/SolaimanLipi as UI faces (they read as legacy desktop documents, not product).

### 2.2 Bangla typesetting rules (non-negotiable)

- `TYP-01` Bengali needs more leading than Latin. Minimum line-height **1.65** for body, **1.35** for display. Cramped Bangla is the most common amateur tell.
- `TYP-02` Never apply `letter-spacing` to Bangla. Never `text-transform: uppercase` (meaningless in the script).
- `TYP-03` No synthetic italics. Emphasis is weight or colour.
- `TYP-04` Use Bengali numerals (০১২৩৪৫৬৭৮৯) on every Bangla surface, patient app and staff consoles alike. The consoles used Latin numerals "for data-entry speed" until the owner's ruling of 2026-09-24: on a screen written in Bangla they put a second script into every sentence, which §0.2 bans. Latin digits remain right for identifiers that are printed that way on the ward itself (bed and room labels, ER case codes), and for the `en` locale.
- `TYP-05` Sentence terminator is দাঁড়ি (।), not a full stop, in Bangla copy.
- `TYP-06` Don't break a Bangla conjunct across lines; set `word-break: keep-all` and avoid hyphenation.
- `TYP-07` Minimum body size 15 px mobile / 14 px console. Bangla matras disappear below that on cheap panels.
- `TYP-08` Mixed-script lines (a Bangla sentence with an English drug name) must not change family mid-line; Anek handles both.

### 2.3 Type scale

| Token | Size / line-height | Weight | Use |
|---|---|---|---|
| `display-xl` | 56 / 1.15 | 700 | Live serial number, emergency headline |
| `display-lg` | 40 / 1.2 | 700 | Screen hero numbers |
| `title-lg` | 24 / 1.35 | 700 | Screen titles |
| `title-md` | 20 / 1.4 | 600 | Section headers, card titles |
| `title-sm` | 17 / 1.45 | 600 | List item titles |
| `body-lg` | 16 / 1.65 | 400 | Primary reading |
| `body-md` | 15 / 1.65 | 400 | Default UI text |
| `body-sm` | 13 / 1.6 | 400 | Supporting detail |
| `caption` | 12 / 1.55 | 500 | Freshness lines, metadata |
| `numeric-tabular` | inherits | 600 | All queue numbers, money, counters — `font-variant-numeric: tabular-nums` |

`numeric-tabular` is mandatory anywhere a number updates in place, so digits don't jitter when the serial advances.

---

## 3. Space, shape, depth, motion

### 3.1 Spacing

4 px base, but the usable set is deliberately small: **4, 8, 12, 16, 20, 24, 32, 40, 56, 72**. Screen gutters: 20 px mobile, 24 px console. Vertical rhythm between sections: 24 px mobile, 20 px console.

### 3.2 Radii — varied by size, never uniform

| Token | Value | Applied to |
|---|---|---|
| `radius-xs` | 8 px | chips, badges, inline tags |
| `radius-sm` | 12 px | inputs, small buttons, table row actions |
| `radius-md` | 16 px | cards, tiles, primary buttons |
| `radius-lg` | 22 px | hero cards, bottom sheets |
| `radius-pill` | 999 px | filter chips and avatars only |

A single radius everywhere is a tell. Radius scales with the element's size.

### 3.3 Elevation

Depth comes from **surface + hairline border**, not from heavy shadows.

| Token | Definition | Use |
|---|---|---|
| `elev-0` | flat on canvas, 1 px `--line-soft` | cards, tiles — the default |
| `elev-1` | `0 1px 2px rgba(20,33,28,.06)` + hairline | raised rows, hovered cards |
| `elev-2` | `0 8px 24px rgba(20,33,28,.10)` | sheets, dropdowns, popovers |
| `elev-3` | `0 16px 48px rgba(20,33,28,.16)` | modals, emergency takeover |

Shadows are neutral-tinted (never coloured), and never applied to more than one layer at a time on screen.

### 3.4 Motion

| Token | Duration | Easing | Use |
|---|---|---|---|
| `motion-instant` | 90 ms | `cubic-bezier(.2,0,0,1)` | button press, checkbox, chip select |
| `motion-quick` | 160 ms | `cubic-bezier(.2,0,0,1)` | row state change, toast in |
| `motion-sheet` | 260 ms | `cubic-bezier(.32,.72,0,1)` | bottom sheet, modal |
| `motion-count` | 400 ms | `cubic-bezier(.4,0,.2,1)` | serial number roll-over |

Rules: no bounce, no spring overshoot, no staggered entrance animations on lists, no page-load fade-ins. Motion exists to explain a change of state, never to entertain. Respect `prefers-reduced-motion` by dropping to opacity-only transitions.

**Signature motion:** when the serving number changes, the digit rolls vertically (`motion-count`) and the user's own row pulses once with a `--brand-100` wash. That single moment is the product's emotional payload — it's the instant a person realises the app is alive. It gets designed carefully and used nowhere else.

### 3.5 Haptics (PWA, where supported)

Light tap on primary action; double pulse when the user is called; nothing else. Never vibrate for ordinary navigation.

---

## 4. Iconography and imagery

- `ICO-01` One custom stroke set: 1.75 px stroke, 24 px grid, round caps, round joins, no fills, no duotone.
- `ICO-02` Icons are drawn inline as SVG so they inherit `currentColor`; no icon fonts, no emoji (`FR-LOC-06`).
- `ICO-03` An icon never appears alone in the patient app without a text label. Older users do not decode pictograms reliably.
- `ICO-04` Medical iconography stays literal and calm: a bed is a bed, a heart is anatomical-neutral, no cartoon ambulances.
- `IMG-01` Photography, when used on the marketing site, is real Bangladeshi clinical environments, shot or licensed, colour-graded to the warm palette. No Western stock hospitals, no smiling-model-with-stethoscope.
- `IMG-02` No abstract 3D blobs, no flat-vector-people illustration sets.
- `IMG-03` Empty states use a restrained line drawing from the same stroke family, or nothing at all — often nothing is better.

---

## 5. Component specifications

Every component is defined by anatomy → variants → sizes → states → rules. Components live in `/components/ui` and are composed, never forked.

### 5.1 Button

**Variants:** `primary` (brand fill), `secondary` (surface + `--line-strong` border), `quiet` (text only), `emergency` (alert fill, reserved), `danger-quiet` (alert text on surface, for destructive confirmations inside modals).

**Sizes:** `sm` 40 px (console table rows only), `md` 48 px (default), `lg` 56 px (primary screen action), `xl` 60+ px (emergency, one per screen).

**States:** rest, hover (console only), active (scale 0.985 + darken 4 %), focus-visible (2 px `--brand-600` ring, 2 px offset), disabled (40 % opacity, `cursor-not-allowed`, tooltip explains why), loading (inline spinner replacing the label, width preserved so layout never jumps).

**Rules**
- One `primary` per screen region. Two primaries side by side is a design failure.
- Labels are verbs in Bangla: "সিরিয়াল নিন", not "জমা".
- Minimum touch target 44 × 44 px including padding (`FR-LOC-04`).
- Never disable a primary silently — always say what's missing.

### 5.2 Input, select, textarea

Anatomy: label (always visible — never placeholder-as-label), field, helper text, error text.
Height 52 px mobile / 44 px console. Radius `radius-sm`. Border `--line-strong`, focus swaps to `--brand-600` at 1.5 px plus ring.
Error state: border `--alert-600`, message below with an inline icon; error text is instructive ("১১ সংখ্যার মোবাইল নম্বর দিন"), never "Invalid input".
Numeric fields (`phone`, `age`, `OTP`) use `inputmode` so the numeric keypad opens.

### 5.3 OTP input

Six separate boxes, 48 × 56 px, `numeric-tabular`, auto-advance, paste-aware, SMS autofill enabled, auto-submit on completion. Failure shakes once (respecting reduced motion) and clears.

### 5.4 Card

Surface + `radius-md` + hairline border + 16 px padding. Content order: title → meta → live data chips → action. Never more than one action per card. No left accent strip.

### 5.5 Chip / status pill

`radius-xs`, 12 px caption, 6/10 px padding. Four semantic families only: neutral (`--bg-sunken`), positive (`--brand-100`/`--brand-700`), caution (`--warn-100`/`--warn-700`), alert (`--alert-100`/`--alert-700`). A chip never carries an action — chips inform; buttons act. Filter chips are the one exception and use `radius-pill` to be visually distinct from status pills.

### 5.6 Bottom sheet and modal

Mobile uses sheets (`radius-lg` top corners, drag handle, backdrop 40 % `--ink-primary`); console uses centred modals. Both trap focus, close on `Esc`, and restore focus on close. Sheets open with `motion-sheet`. Destructive confirmations state the consequence in the body and put the safe option on the left (`GR-01`).

### 5.7 Toast

Bottom-anchored mobile, bottom-right console. Max one at a time; a new toast replaces the old. Undo toasts persist 10 s with a visible progress line (`GR-02`). Toasts never carry critical information alone.

### 5.8 Console data table

Row height 56 px. Header `--bg-sunken`, caption-size, semibold. Zebra striping is banned; separation is hairline rows. Active row gets `--brand-100` fill. Row actions appear as `sm` secondary buttons, always visible (hover-reveal fails on touch monitors and slows staff). Columns have fixed widths so the eye doesn't re-scan after every update. Sticky header, sticky first column on horizontal scroll.

### 5.9 Skeletons and empty states

Skeletons mirror the final layout's shape and are never full-screen spinners (`GR-03`). Empty states carry: a plain Bangla sentence stating the situation, one action, and nothing else.

---

## 6. Signature components (the product's identity)

These are custom, not library components, and they carry the brand.

### 6.1 `<LiveSerialCard>` — `S-A-08`

Anatomy: status line with a pulsing live dot → your number in `display-xl` → now-serving → progress track → ETA with confidence band → freshness line.
On `EVT-PATIENT_CALLED`: number rolls (`motion-count`), progress advances, light haptic.
States: waiting, doctor-not-arrived, delayed (surface shifts to `--warn-*` family), you're-next (brand surface intensifies), called (full-screen takeover), stale (amber freshness, "সংযোগ নেই" line).

### 6.2 `<FreshnessLine>`

A single caption beneath any live figure: "হালনাগাদ ৩ মিনিট আগে". Colour is muted under threshold, `--warn-600` over it. Used everywhere a live number appears — this component is what makes the honesty principle visible (`GR-05`, `FR-OFF-03`).

### 6.3 `<EmergencyEntry>` — home card

Full-width, `radius-lg`, alert fill, 92 px minimum height, one line of Bangla explaining what it does. Preloads emergency data on pointer-down so results feel instant. Never A/B tested for conversions; never moved below the fold.

### 6.4 `<QueueTable>` — console

Virtualised, keyboard-navigable, optimistic. Row state transitions animate with `motion-quick` so staff perceive the change without re-reading the table. Pending-sync rows carry a small clock glyph rather than a colour change.

### 6.5 `<BedTile>` and `<CapacityMirror>`

Tiles carry state by fill colour with a text label inside (never colour alone, for accessibility). `<CapacityMirror>` shows staff exactly what the public sees right now, including freshness — the component that makes data quality self-enforcing (`FR-BED-06`).

### 6.6 `<DelaySheet>`

Received by patients on `EVT-DELAY_DECLARED`. Three actions, no dismiss-by-accident: keep, reschedule, cancel. Written in plain Bangla with the new expected time in `display-lg`.

---

## 7. Layout

### 7.1 Patient app

Baseline 390 × 844, fluid to 430; tablet renders a centred 480 px column rather than stretching. Safe-area insets respected for notches and home indicators. Bottom nav is 4 items, 64 px tall plus safe area, labels always visible. Content max-width in landscape: 560 px.

### 7.2 Console

Baseline 1280 wide, designed up to 1920. Fixed left rail 232 px. Content is a 12-column grid, 24 px gutters. Minimum supported 1024 px (collapses the rail to icons). Below 1024 the console shows a "please use a larger screen" notice rather than degrading — receptionists on phones is a workflow we do not endorse.

### 7.3 Density

Patient app is comfortable density. Console is compact density: 56 px rows, 44 px controls, 12/13 px supporting text. The console has a density toggle (comfortable/compact) stored per user.

---

## 8. Localisation implementation (bn / en only)

- `I18N-01` Two locales: `bn` (default) and `en`. No others planned; do not build a locale-negotiation framework beyond these.
- `I18N-02` `next-intl` with namespaced message files: `messages/bn/{common,booking,queue,emergency,console}.json` and the `en` mirror. Every key exists in both files; CI fails on a missing key.
- `I18N-03` No string literals in components (`FR-LOC-02`). ESLint rule forbids bare text nodes in JSX outside `<Trans>`/`t()`.
- `I18N-04` Numerals: `formatNumber(value, locale)` utility converts to Bengali digits for `bn` surfaces, patient and console (`TYP-04`). Never hand-convert in a component.
- `I18N-05` Dates and times: 12-hour with Bangla period words (সকাল, দুপুর, বিকাল, সন্ধ্যা, রাত), never "AM/PM" in Bangla copy.
- `I18N-06` Currency: `৳ ১,২০০` with Bangla digits, in the patient app and the console alike (`TYP-04`).
- `I18N-07` Copy is written in Bangla first and translated to English, not the reverse. Bangla written as a translation reads translated — the market notices immediately.
- `I18N-08` The language switch is at the top of every screen: a strip above every patient screen (`SEG-A00-LANG`) and the right end of every console's header, the picker included (`SEG-B00-LANG`) — the owner's ruling of 2026-09-24. It is two buttons, বাংলা and English, each named in its own script and marked with its own `lang`; never flags. Switching applies instantly without reload, to every screen at once (`useLocale` in `@platform/ui`), and moves `<html lang>` with it. The choice is stored on the device. The first-run screen and settings (`S-A-01`, `SEG-A19-LANG`) offer the same choice when they are built. Carrying the preference to SMS (`FR-NOT-04`) needs an account to store it on (`FR-PAT-05`), so it arrives with accounts (`CLAUDE.md` §4.1); until then a message goes in Bangla.
- `I18N-10` Names from the database follow the switch: facility, doctor, department and ward names, addresses and lab test names render in the reading language (`localName`), and fall back to Bangla when no English exists. Every read that returns a Bangla name returns its English one beside it, so switching never waits on the network. What a person typed — a patient's or a staff member's name, a diagnosis, advice — is shown as it was written.
- `I18N-09` Pluralisation and gendered forms handled through ICU message syntax, not string concatenation.

---

## 9. Technical stack

| Concern | Choice | Reason |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript** | One codebase for patient PWA, console, and marketing; SSR for the marketing site's SEO; strict types across the event model |
| Styling | **Tailwind CSS mapped to the CSS-variable token layer** | Tokens in `:root`, Tailwind config references them only; a component never sees a hex |
| Primitives | **Radix UI** (headless) restyled from scratch | Accessibility for free; zero inherited visual identity — no default component-library look |
| State (server) | **TanStack Query** | Caching, retries, optimistic mutations, offline-aware |
| State (client) | **Zustand** | Session, active profile, locale, console queue draft state |
| Realtime | WebSocket client with auto-reconnect + heartbeat | Session channel subscription (`FR-QUE-40`) |
| Offline store | **Dexie (IndexedDB)** | Console event queue and cached session state (`FR-OFF-01`) |
| PWA | **Workbox** service worker | App shell precache, runtime caching, install prompt, background sync |
| Forms | **React Hook Form + Zod** | Schema shared with the backend contract |
| Charts | **Recharts**, restyled to the single-hue ramp | Admin dashboard only |
| Dates | **date-fns** + a Bangla locale wrapper | |
| Tests | Vitest + Testing Library + Playwright | Two-device queue flow is an E2E test, not a manual check |

**Rule:** no UI kit that ships a recognisable look (no untouched shadcn defaults, no MUI, no Chakra, no Bootstrap). Radix gives behaviour; the visual layer is entirely ours.

---

## 10. Project structure

```
/apps
  /patient          # PWA — Part A
  /console          # staff web — Part B
  /site             # marketing — Part C
/packages
  /ui               # design system: tokens, primitives, signature components
  /i18n             # messages, formatters, locale utils
  /domain           # shared types: events, queue state machine, DTOs
  /client           # api client, realtime client, offline queue
  /config           # eslint, tsconfig, tailwind preset
```

`shared/ui` is the only place styling decisions exist. If a colour or radius appears in an app package, it is a bug.

---

## 11. Client patterns that matter

### 11.1 Optimistic mutation (the console's core pattern)

Every queue action follows one shape:

1. Append the event to the local Dexie queue with a client timestamp.
2. Apply the reducer to local state immediately — UI updates in under 100 ms (`NFR-02`).
3. Show the undo toast.
4. Sync worker POSTs the event; on success, reconcile with the server's authoritative version.
5. On rejection (e.g. another counter already called that patient), roll the row back with an explanatory toast (`FR-QUE-53`).
6. On network failure, leave state applied and increment the pending counter; retry with backoff.

The queue reducer lives in `shared/domain` and is **the same code** the server uses to derive state, so client and server can never disagree about what an event means.

### 11.2 Realtime subscription hook

`useSessionChannel(sessionId)` subscribes, handles reconnect with exponential backoff, replays missed events by sequence number on reconnect, and exposes `{ state, lastServerTs, isStale }`. `isStale` drives every `<FreshnessLine>`.

### 11.3 Freshness as a first-class value

Any component displaying live data takes `asOf: Date` and renders `<FreshnessLine>`. A component that displays a live number without `asOf` fails code review.

### 11.4 Performance budgets

| Metric | Budget |
|---|---|
| Patient app initial JS (gzipped) | ≤ 180 KB |
| First contentful paint on 3G | ≤ 2.0 s |
| Time to interactive on mid-range Android | ≤ 3.5 s (`NFR-04`) |
| Fonts | 2 woff2 files, subset to Bengali + Latin, ≤ 90 KB total |
| Console route JS | ≤ 320 KB |
| Interaction to next paint | ≤ 100 ms |

Font subsetting is mandatory: full Bengali Anek is large; subset to the ranges actually used and self-host.

---

## 12. Accessibility

- `A11Y-01` Real semantic elements: `<button>`, `<a href>`, `<input>` + `<label>`. Never a clickable `div` (`FR-LOC-06`).
- `A11Y-02` Visible focus ring on every interactive element; never `outline: none` without a replacement.
- `A11Y-03` Colour never carries meaning alone — every state has a text label or icon.
- `A11Y-04` Live regions: serial changes announce via `aria-live="polite"`; the called-takeover uses `aria-live="assertive"`.
- `A11Y-05` Full keyboard operation of the console, including the shortcut set in `APP_FLOW.md` D4.
- `A11Y-06` Supports 200 % OS text scaling without clipping — test every screen at that size.
- `A11Y-07` Minimum 44 px targets, 8 px minimum gap between adjacent targets.

---

## 13. Design QA — merge checklist

A screen cannot merge until every line passes.

**Craft**
- [ ] No banned colour, font, or pattern from §0.2 appears anywhere.
- [ ] One primary action per region; one accent-coloured element cluster per screen.
- [ ] Radii vary appropriately by element size; shadows are neutral and single-layer.
- [ ] Bangla line-height ≥ 1.65 body, no letter-spacing, no fake italics, Bengali numerals in patient surfaces.
- [ ] Numbers that update use tabular figures.

**Truth**
- [ ] Every live figure renders `<FreshnessLine>`.
- [ ] Loading, empty, error, offline, and stale states are all implemented (`GR-03`).
- [ ] No placeholder or invented content remains.

**Behaviour**
- [ ] Primary action responds in < 100 ms (optimistic).
- [ ] Destructive actions confirm and name the consequence; queue actions offer undo.
- [ ] Works at 200 % text scale and with `prefers-reduced-motion`.
- [ ] Keyboard-complete (console) and one-hand-reachable (patient).

**Language**
- [ ] Zero hard-coded strings; both `bn` and `en` keys exist.
- [ ] Bangla copy reads as originally written, not translated.

---

## 14. Handover notes for implementation

1. Build `shared/ui` first: tokens, then Button/Input/Card/Chip/Sheet/Toast, then the signature components in §6. Nothing else starts until these exist, or the design will fragment.
2. Build `S-A-08 LiveSerial` and `S-B-02 Reception` next, together, on two devices. They are the product; everything else is supporting cast.
3. Treat the existing design canvas as the visual reference for layout and tone, not as final markup — it was drawn to communicate, and production components are built to these specs.
4. Every new screen starts by naming its four states before its happy path is coded.

---

*End of `FRONTEND.md`. Final document: `BACKEND.md` — data model, event log, queue engine, APIs, realtime channels, sync protocol, notification workers, security, and deployment.*
