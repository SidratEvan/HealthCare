/**
 * The CSS and TypeScript token layers say the same thing.
 *
 * `tokens.css` is what the browser reads; `index.ts` is the same values as
 * data, because Tailwind's preset needs the names and the contrast checks need
 * the hexes. Two files holding one set of values will drift — so this reads
 * both and asserts they agree, and a value changed in one and not the other
 * fails here rather than shipping a design system that disagrees with itself.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BANNED_FONT_FAMILIES,
  COLOUR,
  ELEVATION,
  MIN_TOUCH_TARGET_PX,
  MOTION,
  RADIUS,
  SPACE,
  TYPE_SCALE,
  cssVar,
} from '../index.js';

const css = readFileSync(resolve(import.meta.dirname, '../tokens.css'), 'utf8');

/** Reads `--name: value;` out of the stylesheet. */
function declared(name: string): string | null {
  // `String.raw`, so `\s` reaches the RegExp intact. In an ordinary template
  // literal it would collapse to a bare `s` and the pattern would still match
  // — by accident, because `s*` accepts zero of them — which is the kind of
  // bug a passing test hides.
  const match = new RegExp(String.raw`--${name}:\s*([^;]+);`).exec(css);
  return match?.[1]?.trim() ?? null;
}

describe('every colour token exists in both layers, with the same value', () => {
  it.each(Object.entries(COLOUR))('%s', (name, hex) => {
    const inCss = declared(name);
    expect(inCss, `--${name} is missing from tokens.css`).not.toBeNull();
    expect(inCss?.toLowerCase()).toBe(hex.toLowerCase());
  });

  it('defines nothing in CSS that TypeScript does not know about', () => {
    // The other direction: a colour added to the stylesheet alone would be
    // invisible to the contrast checks, which is how an unverified pair ships.
    const names = [...css.matchAll(/--((?:bg|ink|brand|alert|warn|line)-[a-z0-9-]+):/g)]
      .map((match) => match[1])
      .filter((name): name is string => name !== undefined);

    for (const name of names) {
      expect(Object.keys(COLOUR), `--${name} is in tokens.css but not in COLOUR`).toContain(name);
    }
  });
});

describe('the other scales agree', () => {
  it.each(Object.entries(RADIUS))('radius-%s', (name, value) => {
    expect(declared(`radius-${name}`)).toBe(value);
  });

  it.each(Object.entries(SPACE))('space-%s', (name, value) => {
    expect(declared(`space-${name}`)).toBe(value);
  });

  it.each(Object.entries(MOTION))('motion-%s', (name, motion) => {
    expect(declared(`motion-${name}`)).toBe(motion.duration);
  });

  it('keeps the three elevations in step', () => {
    for (const level of [1, 2, 3] as const) {
      expect(declared(`elev-${String(level)}`)).toBe(ELEVATION[level]);
    }
  });
});

describe('the rules that are easy to break quietly', () => {
  it('names no banned typeface anywhere in the token layer', () => {
    // FRONTEND.md §0.2: Inter, Roboto, Poppins and Montserrat are the faces
    // that mark an interface as generated. Kalpurush and SolaimanLipi read as
    // legacy desktop documents rather than as a product (§2.1).
    for (const family of BANNED_FONT_FAMILIES) {
      expect(css, `${family} appears in tokens.css`).not.toContain(family);
    }
  });

  it('never grounds the page in pure black or pure white', () => {
    // §0.2 bans both as the page ground. Warm off-white is the whole reason
    // the palette reads as an institution rather than a dashboard.
    expect(COLOUR['bg-canvas'].toLowerCase()).not.toBe('#ffffff');
    expect(COLOUR['bg-inverse'].toLowerCase()).not.toBe('#000000');
  });

  it('keeps Bangla leading at or above 1.65 for body text (TYP-01)', () => {
    expect(Number(declared('leading-body'))).toBeGreaterThanOrEqual(1.65);
    expect(Number(declared('leading-display'))).toBeGreaterThanOrEqual(1.35);

    // And every body-sized step in the scale honours it. Display sizes are
    // allowed to be tighter; body is not.
    for (const name of ['body-lg', 'body-md'] as const) {
      expect(TYPE_SCALE[name].lineHeight, `${name} is too tight for Bangla`).toBeGreaterThanOrEqual(
        1.65,
      );
    }
  });

  it('applies no letter-spacing to Bangla and never uppercases it (TYP-02)', () => {
    expect(css).toContain('letter-spacing: normal');
    expect(css).toContain('text-transform: none');
  });

  it('drops motion to nothing under prefers-reduced-motion (§3.4)', () => {
    expect(css).toContain('prefers-reduced-motion: reduce');
  });

  it('keeps the touch-target floor at 44px (FR-LOC-04)', () => {
    expect(MIN_TOUCH_TARGET_PX).toBe(44);
  });

  it('uses only neutral-tinted shadows (§3.3)', () => {
    // "Shadows are neutral-tinted (never coloured)". Every elevation is built
    // from the same ink, so a coloured shadow cannot creep in unnoticed.
    for (const level of [1, 2, 3] as const) {
      expect(ELEVATION[level]).toContain('rgb(20 33 28');
    }
  });
});

describe('cssVar', () => {
  it('builds the custom-property reference a component uses', () => {
    expect(cssVar('brand-600')).toBe('var(--brand-600)');
  });
});
