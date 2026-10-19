import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { contrastRatio } from '../../a11y/contrast.js';

const css = readFileSync(new URL('../foundation.css', import.meta.url), 'utf8');
const token = (name) => {
  const value = new RegExp(`--${name}: (#[a-f0-9]{6});`).exec(css)?.[1];
  if (value === undefined) throw new Error(`Missing console colour ${name}`);
  return value;
};
describe('approved console tokens', () => {
  it.each([
    ['ink-primary', 'bg-canvas'],
    ['ink-secondary', 'bg-surface'],
    ['ink-muted', 'bg-canvas'],
    ['positive-700', 'positive-100'],
    ['warn-700', 'warn-100'],
    ['alert-700', 'alert-100'],
    ['cf-info', 'cf-info-bg'],
    ['brand-700', 'brand-100'],
  ])('%s on %s meets AA', (foreground, background) => {
    expect(contrastRatio(token(foreground), token(background))).toBeGreaterThanOrEqual(4.5);
  });
  it('primary action supports white text', () => {
    expect(contrastRatio('#ffffff', token('brand-600'))).toBeGreaterThanOrEqual(4.5);
  });
  it('never changes the existing page roots or imports a global reset', () => {
    expect(css).not.toMatch(/(?:^|\n)\s*(?:html|body|:root)\s*\{/);
    expect(css).not.toContain('@import');
  });
});
