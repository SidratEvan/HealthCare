/**
 * A hospital's own colours for the patient app (`FR-BRD-03`).
 *
 * The patient app is drawn from tokens and nothing else (`FRONTEND.md` §1–3),
 * and the brand is six of them. A hospital-branded app is therefore the same
 * app with those six values replaced, read from the server at start; this file
 * is the shape of that replacement and the rules it has to pass.
 *
 * ## Why a theme is checked and not trusted
 *
 * A hospital will send its logo's colour, and a logo's colour is chosen to
 * look right on a letterhead. As `brand-600` it has to carry white text on
 * every primary button a patient presses, and as `brand-700` it is the colour
 * of a heading on the app's own ground. A pale brand that fails either turns
 * the booking button into something an older patient cannot read
 * (`FR-LOC-05`, WCAG AA). So a theme that fails is not applied at all: the
 * app keeps its own colours, which pass, rather than half of somebody
 * else's.
 *
 * Only the brand ramp can be replaced. The alert, caution and neutral tokens
 * mean the same thing in every hospital's app — red is an emergency
 * everywhere — and are not configurable.
 */

import { z } from 'zod';

/** The tokens a hospital may replace, as `tokens.css` names them. */
export const BRAND_TOKENS = [
  'brand-900',
  'brand-700',
  'brand-600',
  'brand-300',
  'brand-100',
  'brand-border',
] as const;
export type BrandToken = (typeof BRAND_TOKENS)[number];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** `hospital_settings.brand` (0036). */
export const brandTheme = z.strictObject({
  colors: z.strictObject({
    'brand-900': hex,
    'brand-700': hex,
    'brand-600': hex,
    'brand-300': hex,
    'brand-100': hex,
    'brand-border': hex,
  }),
});
export type BrandTheme = z.infer<typeof brandTheme>;

/** The app's own ground and its text on a primary button (`tokens.css`). */
const CANVAS = '#f6f4ef';
const ON_BRAND = '#ffffff';

/** WCAG AA for body text (`FR-LOC-05`). */
export const MIN_TEXT_CONTRAST = 4.5;

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.039_28 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function luminance(colour: string): number {
  const red = Number.parseInt(colour.slice(1, 3), 16);
  const green = Number.parseInt(colour.slice(3, 5), 16);
  const blue = Number.parseInt(colour.slice(5, 7), 16);
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

/** The WCAG contrast ratio between two `#rrggbb` colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

export type BrandProblem =
  'button_text_unreadable' | 'heading_unreadable' | 'accent_unreadable_on_tint';

/**
 * What stops a theme being used, if anything.
 *
 * The three places the brand carries text: white on `brand-600` (every
 * primary button), `brand-700` on the canvas (the app's name, links), and
 * `brand-600` on `brand-100` (the live strip and tinted cards).
 */
export function brandProblems(theme: BrandTheme): readonly BrandProblem[] {
  const problems: BrandProblem[] = [];
  const { colors } = theme;

  if (contrastRatio(ON_BRAND, colors['brand-600']) < MIN_TEXT_CONTRAST) {
    problems.push('button_text_unreadable');
  }
  if (contrastRatio(colors['brand-700'], CANVAS) < MIN_TEXT_CONTRAST) {
    problems.push('heading_unreadable');
  }
  if (contrastRatio(colors['brand-600'], colors['brand-100']) < MIN_TEXT_CONTRAST) {
    problems.push('accent_unreadable_on_tint');
  }
  return problems;
}

/**
 * Reads a stored theme. Null when there is none, when it is not the shape, or
 * when it would be unreadable: the caller then keeps the platform's colours.
 */
export function readBrandTheme(value: unknown): BrandTheme | null {
  if (value === null || value === undefined) return null;
  const parsed = brandTheme.safeParse(value);
  if (!parsed.success) return null;
  return brandProblems(parsed.data).length === 0 ? parsed.data : null;
}
