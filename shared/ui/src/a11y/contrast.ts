/**
 * Contrast, computed rather than asserted (FRONTEND.md §1.3, `FR-LOC-05`).
 *
 * §1.3 lists five colour pairs with their ratios and then says: "Any new pair
 * must be verified before use." A rule like that is only real if something can
 * check it, so this is the something. `contrast.test.ts` runs every documented
 * pair through it, and a token whose value drifts fails the suite instead of
 * shipping grey-on-cream captions nobody can read outdoors.
 *
 * That last point is not hypothetical for this product. The patient app ships
 * light-only in v1 precisely because most patients use it outdoors in daylight
 * (§1.2), which is the condition under which marginal contrast stops being
 * marginal and starts being unusable.
 *
 * WCAG 2.1 relative luminance and contrast ratio, implemented directly from
 * the specification — it is a dozen lines and the alternative is a dependency.
 */

/** Red, green and blue in 0–255. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Parses `#RGB` or `#RRGGBB`. Throws on anything else rather than guessing. */
export function parseHex(hex: string): Rgb {
  const value = hex.trim().replace(/^#/, '');

  const expanded =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value;

  if (!/^[0-9a-f]{6}$/i.test(expanded)) {
    throw new Error(`"${hex}" is not a hex colour.`);
  }

  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

/**
 * Relative luminance, per WCAG 2.1.
 *
 * The channel transform is the sRGB gamma curve: values below the knee are
 * linear, the rest follow a 2.4 power. Averaging the raw bytes instead — which
 * is the common shortcut — overstates the luminance of saturated colours and
 * would pass pairs that fail in a browser.
 */
export function relativeLuminance(colour: Rgb): number {
  const channel = (value: number): number => {
    const normalised = value / 255;
    return normalised <= 0.04045 ? normalised / 12.92 : Math.pow((normalised + 0.055) / 1.055, 2.4);
  };

  return 0.2126 * channel(colour.r) + 0.7152 * channel(colour.g) + 0.0722 * channel(colour.b);
}

/**
 * The contrast ratio between two colours, 1 to 21.
 *
 * Order does not matter: the lighter of the two is always the numerator.
 */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(parseHex(foreground));
  const b = relativeLuminance(parseHex(background));
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG levels, for the sizes this product actually uses. */
export const CONTRAST_MINIMUM = {
  /** Body text and anything below 24 px. */
  AA: 4.5,
  /** Large text — 24 px, or 19 px at 700 weight. */
  AA_LARGE: 3,
  AAA: 7,
} as const;

export type ContrastLevel = keyof typeof CONTRAST_MINIMUM;

/**
 * Whether a pair clears a level.
 *
 * Rounded down to two decimals before comparing, so a pair computing to
 * 4.4999 is not reported as passing 4.5 on a floating-point technicality.
 */
export function meets(
  foreground: string,
  background: string,
  level: ContrastLevel = 'AA',
): boolean {
  const ratio = Math.floor(contrastRatio(foreground, background) * 100) / 100;
  return ratio >= CONTRAST_MINIMUM[level];
}

/**
 * The highest level a pair clears, or `null` if it clears none.
 *
 * Useful in a failure message: "brand-300 on bg-surface is 1.9:1, clears
 * nothing" says more than "expected true".
 */
export function levelOf(foreground: string, background: string): ContrastLevel | null {
  if (meets(foreground, background, 'AAA')) return 'AAA';
  if (meets(foreground, background, 'AA')) return 'AA';
  if (meets(foreground, background, 'AA_LARGE')) return 'AA_LARGE';
  return null;
}
