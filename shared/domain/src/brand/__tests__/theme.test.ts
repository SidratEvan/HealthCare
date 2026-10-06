/**
 * A hospital's colours are checked before they are used (`FR-BRD-03`,
 * `FR-LOC-05`).
 */

import { describe, expect, it } from 'vitest';

import {
  BRAND_TOKENS,
  MIN_TEXT_CONTRAST,
  brandProblems,
  contrastRatio,
  readBrandTheme,
  type BrandTheme,
} from '../theme.js';

/** The platform's own ramp, from `tokens.css`. It has to pass its own rules. */
const PLATFORM: BrandTheme = {
  colors: {
    'brand-900': '#06291f',
    'brand-700': '#08402f',
    'brand-600': '#0c5c46',
    'brand-300': '#7fd6a8',
    'brand-100': '#e8f0ec',
    'brand-border': '#c9ddd3',
  },
};

/** A navy ramp, as a hospital might send. */
const NAVY: BrandTheme = {
  colors: {
    'brand-900': '#0b2239',
    'brand-700': '#123a5e',
    'brand-600': '#17507f',
    'brand-300': '#8fc1ea',
    'brand-100': '#e7eff6',
    'brand-border': '#c5d6e6',
  },
};

describe('contrast', () => {
  it('is 21 between black and white, and 1 between a colour and itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#0c5c46', '#0c5c46')).toBeCloseTo(1, 5);
  });

  it('does not depend on the order of the two colours', () => {
    expect(contrastRatio('#0c5c46', '#ffffff')).toBe(contrastRatio('#ffffff', '#0c5c46'));
  });
});

describe('a theme that may be used', () => {
  it('names every brand token and nothing else', () => {
    expect(Object.keys(PLATFORM.colors).sort()).toEqual([...BRAND_TOKENS].sort());
  });

  it("passes the platform's own colours", () => {
    expect(brandProblems(PLATFORM)).toEqual([]);
    expect(contrastRatio('#ffffff', PLATFORM.colors['brand-600'])).toBeGreaterThan(
      MIN_TEXT_CONTRAST,
    );
  });

  it('passes a dark ramp in another hue', () => {
    expect(brandProblems(NAVY)).toEqual([]);
    expect(readBrandTheme(NAVY)).toEqual(NAVY);
  });
});

describe('a theme that is refused', () => {
  it('refuses a brand too pale to carry a button', () => {
    const pale: BrandTheme = { colors: { ...NAVY.colors, 'brand-600': '#9fd0f5' } };

    expect(brandProblems(pale)).toContain('button_text_unreadable');
    // Not applied in part: the app keeps its own colours.
    expect(readBrandTheme(pale)).toBeNull();
  });

  it('refuses a heading colour that cannot be read on the app’s ground', () => {
    const faint: BrandTheme = { colors: { ...NAVY.colors, 'brand-700': '#c9d8e6' } };
    expect(brandProblems(faint)).toEqual(['heading_unreadable']);
  });

  it('refuses a tint the accent disappears into', () => {
    const muddy: BrandTheme = { colors: { ...NAVY.colors, 'brand-100': '#2a5f8f' } };
    expect(brandProblems(muddy)).toEqual(['accent_unreadable_on_tint']);
  });

  it('reads nothing, a wrong shape, an extra key and a non-hex value as no theme', () => {
    expect(readBrandTheme(null)).toBeNull();
    expect(readBrandTheme(undefined)).toBeNull();
    expect(readBrandTheme({})).toBeNull();
    expect(readBrandTheme({ colors: { 'brand-600': '#17507f' } })).toBeNull();
    expect(readBrandTheme({ colors: { ...NAVY.colors, 'alert-600': '#000000' } })).toBeNull();
    expect(readBrandTheme({ colors: { ...NAVY.colors, 'brand-600': 'navy' } })).toBeNull();
    expect(
      readBrandTheme({ colors: { ...NAVY.colors, 'brand-600': 'url(https://example.org)' } }),
    ).toBeNull();
  });
});
