/** Parses `#RGB` or `#RRGGBB`. Throws on anything else rather than guessing. */
export function parseHex(hex) {
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
export function relativeLuminance(colour) {
  const channel = (value) => {
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
export function contrastRatio(foreground, background) {
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
};

/**
 * Whether a pair clears a level.
 *
 * Rounded down to two decimals before comparing, so a pair computing to
 * 4.4999 is not reported as passing 4.5 on a floating-point technicality.
 */
export function meets(foreground, background, level = 'AA') {
  const ratio = Math.floor(contrastRatio(foreground, background) * 100) / 100;
  return ratio >= CONTRAST_MINIMUM[level];
}

/**
 * The highest level a pair clears, or `null` if it clears none.
 *
 * Useful in a failure message: "brand-300 on bg-surface is 1.9:1, clears
 * nothing" says more than "expected true".
 */
export function levelOf(foreground, background) {
  if (meets(foreground, background, 'AAA')) return 'AAA';
  if (meets(foreground, background, 'AA')) return 'AA';
  if (meets(foreground, background, 'AA_LARGE')) return 'AA_LARGE';
  return null;
}
