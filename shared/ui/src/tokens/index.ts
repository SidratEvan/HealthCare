/**
 * The token layer, as TypeScript (FRONTEND.md §1–§3).
 *
 * `tokens.css` is what the browser reads; this is the same values as data, for
 * the two things CSS cannot do:
 *
 *   - Tailwind's preset needs the names to generate utilities from.
 *   - The contrast checks in `../a11y` need the hex values to compute with.
 *     `FRONTEND.md` §1.3 requires any new colour pair to be verified before
 *     use (`FR-LOC-05`), and a requirement nothing can check is a wish.
 *
 * Duplication between the two files is real and deliberate — the alternative
 * is parsing CSS at build time — so `tokens.test.ts` asserts they agree. A
 * value changed in one and not the other fails the suite rather than shipping
 * a design system that disagrees with itself.
 */

/** Every colour in the product, by token name (FRONTEND.md §1.1). */
export const COLOUR = {
  // Ground — warm, never pure white.
  'bg-canvas': '#F6F4EF',
  'bg-surface': '#FFFFFF',
  'bg-sunken': '#EFEBE2',
  'bg-inverse': '#0E1A16',

  // Ink.
  'ink-primary': '#14211C',
  'ink-secondary': '#3E4B45',
  'ink-muted': '#4F5A54',
  'ink-inverse': '#F6F4EF',

  // Institutional green — the single brand colour.
  'brand-900': '#06291F',
  'brand-700': '#08402F',
  'brand-600': '#0C5C46',
  'brand-300': '#7FD6A8',
  'brand-100': '#E8F0EC',
  'brand-border': '#C9DDD3',

  // Emergency — reserved (§1.1 colour law).
  'alert-700': '#7A2018',
  'alert-600': '#B3261E',
  'alert-100': '#FBE9E7',

  // Caution — delays, staleness, late patients. Exactly three meanings.
  'warn-700': '#6B4A10',
  'warn-600': '#8A5A00',
  'warn-100': '#F7EEDC',
  'warn-border': '#E8D6B0',

  // Neutral lines.
  'line-strong': '#D9D4C8',
  'line-soft': '#E2DED4',
  'line-hairline': '#EFEBE2',
} as const;

export type ColourToken = keyof typeof COLOUR;

/**
 * Radii (§3.2).
 *
 * "A single radius everywhere is a tell. Radius scales with the element's
 * size." The set is small so that scaling is a choice between five things
 * rather than a free number.
 */
export const RADIUS = {
  xs: '8px', // chips, badges, inline tags
  sm: '12px', // inputs, small buttons, table row actions
  md: '16px', // cards, tiles, primary buttons
  lg: '22px', // hero cards, bottom sheets
  pill: '999px', // filter chips and avatars only
} as const;

/**
 * Spacing (§3.1) — 4 px base, deliberately small usable set.
 *
 * Keys are the multiple of the base, so `space[6]` is 24 px. The gaps in the
 * sequence (no 7, no 9) are the point: a value that is not here is a value
 * somebody invented.
 */
export const SPACE = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  14: '56px',
  18: '72px',
} as const;

/** Depth comes from surface plus a hairline, not from heavy shadow (§3.3). */
export const ELEVATION = {
  0: 'none', // flat on canvas with a 1px line-soft border — the default
  1: '0 1px 2px rgb(20 33 28 / 6%)', // raised rows, hovered cards
  2: '0 8px 24px rgb(20 33 28 / 10%)', // sheets, dropdowns, popovers
  3: '0 16px 48px rgb(20 33 28 / 16%)', // modals, emergency takeover
} as const;

/** Motion (§3.4). No bounce, no spring, no staggered list entrances. */
export const MOTION = {
  instant: { duration: '90ms', easing: 'cubic-bezier(0.2, 0, 0, 1)' },
  quick: { duration: '160ms', easing: 'cubic-bezier(0.2, 0, 0, 1)' },
  sheet: { duration: '260ms', easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
  /** The serial roll-over — the product's one signature movement. */
  count: { duration: '400ms', easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
} as const;

/**
 * The type scale (§2.3).
 *
 * `lineHeight` is unitless so it scales with the size. Bengali needs more
 * leading than Latin: 1.65 for body and 1.35 for display are floors, not
 * suggestions (`TYP-01`).
 */
export const TYPE_SCALE = {
  'display-xl': { size: '56px', lineHeight: 1.15, weight: 700 },
  'display-lg': { size: '40px', lineHeight: 1.2, weight: 700 },
  'title-lg': { size: '24px', lineHeight: 1.35, weight: 700 },
  'title-md': { size: '20px', lineHeight: 1.4, weight: 600 },
  'title-sm': { size: '17px', lineHeight: 1.45, weight: 600 },
  'body-lg': { size: '16px', lineHeight: 1.65, weight: 400 },
  'body-md': { size: '15px', lineHeight: 1.65, weight: 400 },
  'body-sm': { size: '13px', lineHeight: 1.6, weight: 400 },
  caption: { size: '12px', lineHeight: 1.55, weight: 500 },
} as const;

export type TypeToken = keyof typeof TYPE_SCALE;

/**
 * Smallest body size, in pixels (`TYP-07`).
 *
 * Bangla matras disappear below this on the cheap panels most of this
 * country's patients own, which makes it a legibility floor rather than a
 * preference.
 */
export const MIN_BODY_SIZE_PX = { mobile: 15, console: 14 } as const;

/** Minimum touch target, in pixels (`FR-LOC-04`, FRONTEND.md §5.1). */
export const MIN_TOUCH_TARGET_PX = 44;

/** Font stacks (§2.1). One superfamily across both scripts. */
export const FONT = {
  ui: "'Anek Bangla', 'Hind Siliguri', 'Noto Sans Bengali', system-ui, sans-serif",
  reading: "'Tiro Bangla', 'Noto Serif Bengali', Georgia, serif",
} as const;

/**
 * Families a brand face may never be (FRONTEND.md §0.2, §2.1).
 *
 * Exported so the check is executable rather than a line in a document. These
 * are the faces that mark an interface as generated, and Kalpurush and
 * SolaimanLipi read as legacy desktop documents rather than as a product.
 */
export const BANNED_FONT_FAMILIES = [
  'Inter',
  'Roboto',
  'Poppins',
  'Montserrat',
  'Open Sans',
  'Kalpurush',
  'SolaimanLipi',
] as const;

/** The CSS custom-property name a token maps to, e.g. `var(--brand-600)`. */
export function cssVar(token: string): string {
  return `var(--${token})`;
}
