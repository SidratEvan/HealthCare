/**
 * A hospital's colours are checked before they are used (`FR-BRD-03`,
 * `FR-LOC-05`).
 */

import { describe, expect, it } from 'vitest';

import {
  BRAND_TOKENS,
  LOGO_MAX_BYTES,
  MIN_TEXT_CONTRAST,
  brandBody,
  brandProblems,
  contrastRatio,
  logoBody,
  logoBytesMatch,
  readBrandTheme,
  themeFromColour,
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

describe('six colours from the one a hospital chose (FR-BRD-06)', () => {
  /** A logo's colours: some carry white text as they are, most do not. */
  const CHOSEN = [
    '#17507f', // navy
    '#0c5c46', // the platform's own green
    '#c8102e', // a red
    '#ffd400', // a logo's yellow
    '#8fd3f4', // a pale blue
    '#ffffff',
    '#000000',
    '#808080',
    '#7b2d8e', // purple
    '#ff7a00', // orange
  ] as const;

  it.each(CHOSEN)('%s gives a set that passes every rule', (colour) => {
    const theme = themeFromColour(colour);
    expect(brandProblems(theme)).toEqual([]);
    expect(readBrandTheme(theme)).toEqual(theme);
    for (const token of BRAND_TOKENS) expect(theme.colors[token]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('keeps the chosen colour as it is when it can carry white text', () => {
    expect(themeFromColour('#17507F').colors['brand-600']).toBe('#17507f');
    expect(themeFromColour('#0c5c46').colors['brand-600']).toBe('#0c5c46');
  });

  it('darkens one that cannot, on its own hue, and no further than it must', () => {
    const { colors } = themeFromColour('#ffd400');
    expect(colors['brand-600']).not.toBe('#ffd400');
    expect(contrastRatio('#ffffff', colors['brand-600'])).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    // Still a yellow-brown, not a grey: red above green above blue.
    const [red, green, blue] = [1, 3, 5].map((at) =>
      Number.parseInt(colors['brand-600'].slice(at, at + 2), 16),
    ) as [number, number, number];
    expect(red).toBeGreaterThan(green);
    expect(green).toBeGreaterThan(blue);
    // It stopped where it had to: the tighter of the two places it carries
    // text, white on it and it on its own tint, is only just met.
    const tightest = Math.min(
      contrastRatio('#ffffff', colors['brand-600']),
      contrastRatio(colors['brand-600'], colors['brand-100']),
    );
    expect(tightest).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(tightest).toBeLessThan(MIN_TEXT_CONTRAST + 0.4);
  });

  it('the shades run from darkest to lightest', () => {
    const { colors } = themeFromColour('#c8102e');
    const light = (token: (typeof BRAND_TOKENS)[number]): number =>
      contrastRatio(colors[token], '#000000');
    expect(light('brand-900')).toBeLessThan(light('brand-700'));
    expect(light('brand-700')).toBeLessThan(light('brand-600'));
    expect(light('brand-600')).toBeLessThan(light('brand-300'));
    expect(light('brand-300')).toBeLessThan(light('brand-100'));
  });

  it('a body carries a theme or null, and nothing else', () => {
    expect(brandBody.safeParse({ theme: null }).success).toBe(true);
    expect(brandBody.safeParse({ theme: themeFromColour('#17507f') }).success).toBe(true);
    expect(brandBody.safeParse({}).success).toBe(false);
    expect(brandBody.safeParse({ theme: { colors: {} } }).success).toBe(false);
  });
});

describe('a logo is the image it says it is (FR-BRD-06)', () => {
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
  const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]);

  it('by how the file begins', () => {
    expect(logoBytesMatch('image/png', PNG)).toBe(true);
    expect(logoBytesMatch('image/jpeg', JPEG)).toBe(true);
    expect(logoBytesMatch('image/webp', WEBP)).toBe(true);
  });

  it('and not by what it is called', () => {
    expect(logoBytesMatch('image/png', PDF)).toBe(false);
    expect(logoBytesMatch('image/png', JPEG)).toBe(false);
    expect(logoBytesMatch('image/jpeg', PNG)).toBe(false);
    expect(logoBytesMatch('image/webp', PNG)).toBe(false);
    expect(logoBytesMatch('image/png', new Uint8Array())).toBe(false);
  });

  it('no SVG, and nothing larger than the ceiling', () => {
    expect(logoBody.safeParse({ fileType: 'image/svg+xml', content: 'PHN2Zz4=' }).success).toBe(
      false,
    );
    const tooLarge = 'A'.repeat(Math.ceil(LOGO_MAX_BYTES / 3) * 4 + 8);
    expect(logoBody.safeParse({ fileType: 'image/png', content: tooLarge }).success).toBe(false);
    expect(logoBody.safeParse({ fileType: 'image/png', content: 'iVBORw0KGgo=' }).success).toBe(
      true,
    );
  });
});
