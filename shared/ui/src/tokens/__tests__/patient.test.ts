/**
 * The patient app's palette, Visual Direction 2 (FRONTEND.md §0.5, §1.3b).
 *
 * Two promises, kept the way `tokens.test.ts` keeps §1.1's: the CSS the app
 * loads and the TypeScript a component or a test reads hold the same values,
 * and every pair the document prints is as legible as it says.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { contrastRatio, meets } from '../../a11y/contrast.js';
import { COLOUR, PATIENT_COLOUR } from '../index.js';

const css = readFileSync(resolve(import.meta.dirname, '../patient.css'), 'utf8');

function declared(name: string): string | null {
  const match = new RegExp(String.raw`--${name}:\s*([^;]+);`).exec(css);
  return match?.[1]?.trim() ?? null;
}

describe('patient.css and PATIENT_COLOUR agree', () => {
  it.each(Object.entries(PATIENT_COLOUR))('%s', (name, hex) => {
    expect(declared(name), `--${name} is missing from patient.css`).not.toBeNull();
    expect(declared(name)?.toLowerCase()).toBe(hex.toLowerCase());
  });

  it('declares no colour TypeScript does not know about', () => {
    const names = [...css.matchAll(/--([a-z]+-[a-z0-9-]+):\s*#/g)].map((match) => match[1]);
    for (const name of names) {
      expect(Object.keys(PATIENT_COLOUR), `--${String(name)} is not in PATIENT_COLOUR`).toContain(
        name,
      );
    }
  });

  it('replaces only tokens the shared layer defines', () => {
    for (const name of Object.keys(PATIENT_COLOUR)) {
      expect(Object.keys(COLOUR)).toContain(name);
    }
  });

  it('never grounds the page in pure white, and keeps shadows neutral (§3.3)', () => {
    expect(PATIENT_COLOUR['bg-canvas'].toLowerCase()).not.toBe('#ffffff');
    expect(declared('elev-1')).toContain('rgb(11 26 51');
  });
});

describe('FRONTEND.md §1.3b: every patient pair clears its level', () => {
  const P = PATIENT_COLOUR;

  it.each([
    ['ink on ground', P['ink-primary'], P['bg-canvas'], 16.43, 'AAA'],
    ['ink-secondary on white', P['ink-secondary'], P['bg-surface'], 9.95, 'AAA'],
    ['ink-muted on ground', P['ink-muted'], P['bg-canvas'], 5.66, 'AA'],
    ['ink-muted on sunken', P['ink-muted'], P['bg-sunken'], 5.36, 'AA'],
    ['white on brand-600', '#FFFFFF', P['brand-600'], 5.32, 'AA'],
    ['brand-700 on brand-100', P['brand-700'], P['brand-100'], 6.55, 'AA'],
    ['brand-600 on brand-100', P['brand-600'], P['brand-100'], 4.76, 'AA'],
    ['positive-700 on positive-100', P['positive-700'], P['positive-100'], 6.74, 'AA'],
    ['white on alert-600', '#FFFFFF', COLOUR['alert-600'], 6.54, 'AA'],
  ] as const)('%s', (_name, foreground, background, ratio, level) => {
    expect(contrastRatio(foreground, background)).toBeCloseTo(ratio, 1);
    expect(meets(foreground, background, level)).toBe(true);
  });

  it('the teal accent is never text: it clears nothing on white', () => {
    expect(contrastRatio(P['accent-500'], '#FFFFFF')).toBeCloseTo(2.0, 1);
    expect(meets(P['accent-500'], '#FFFFFF', 'AA')).toBe(false);
  });
});
