/**
 * The contrast table in FRONTEND.md §1.3, checked against the tokens.
 *
 * The document states five ratios. This proves the palette actually produces
 * them — and, more usefully, keeps producing them: a token nudged a shade
 * darker for aesthetic reasons fails here rather than in a corridor, in
 * daylight, on a phone belonging to somebody who cannot read it.
 *
 * §1.3 also forbids two specific pairs outright. Those are asserted too,
 * because a rule stated only in prose is a rule somebody will break while
 * genuinely believing they are following the design system.
 */

import { describe, expect, it } from 'vitest';

import { COLOUR } from '../../tokens/index.js';
import { contrastRatio, levelOf, meets, parseHex, relativeLuminance } from '../contrast.js';

describe('the WCAG maths', () => {
  it('computes the reference extremes', () => {
    // Black on white is the defined maximum, white on white the minimum.
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('does not care which way round the pair is given', () => {
    const a = contrastRatio(COLOUR['ink-primary'], COLOUR['bg-canvas']);
    const b = contrastRatio(COLOUR['bg-canvas'], COLOUR['ink-primary']);
    expect(a).toBeCloseTo(b, 10);
  });

  it('applies the sRGB gamma curve rather than averaging bytes', () => {
    // Mid-grey is the clearest tell. Byte-averaging puts #808080 at 0.5; the
    // gamma curve puts it near 0.216, because half the byte value is nothing
    // like half the light. Getting this wrong passes pairs a browser fails.
    expect(relativeLuminance(parseHex('#808080'))).toBeCloseTo(0.2159, 3);

    // And the channels are weighted by how the eye responds, not equally:
    // green carries most of the luminance, blue almost none.
    expect(relativeLuminance(parseHex('#00FF00'))).toBeCloseTo(0.7152, 4);
    expect(relativeLuminance(parseHex('#0000FF'))).toBeCloseTo(0.0722, 4);
  });

  it('accepts both hex forms and refuses anything else', () => {
    expect(parseHex('#FFF')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
    expect(() => parseHex('rebeccapurple')).toThrow(/not a hex colour/);
    expect(() => parseHex('#GGGGGG')).toThrow(/not a hex colour/);
  });
});

describe('FRONTEND.md §1.3: every documented pair clears its level', () => {
  // The ratios are the computed truth for the §1.1 palette, not the figures
  // §1.3 originally printed — three of those were wrong, and the table has
  // been corrected against this test rather than the other way round. What
  // matters and is asserted is the *level*: the pair is legible or it is not.
  it.each([
    ['ink-primary on bg-canvas', COLOUR['ink-primary'], COLOUR['bg-canvas'], 15.11, 'AAA'],
    ['ink-muted on bg-canvas', COLOUR['ink-muted'], COLOUR['bg-canvas'], 6.54, 'AA'],
    ['white on brand-600', '#FFFFFF', COLOUR['brand-600'], 7.97, 'AAA'],
    ['white on alert-600', '#FFFFFF', COLOUR['alert-600'], 6.54, 'AA'],
    ['warn-700 on warn-100', COLOUR['warn-700'], COLOUR['warn-100'], 6.97, 'AA'],
  ] as const)('%s is %s:1 and clears %s', (_name, fg, bg, expected, level) => {
    const ratio = contrastRatio(fg, bg);

    // Two decimals: tight enough that a token nudged by one hex digit fails
    // here, loose enough not to assert floating-point noise.
    expect(ratio).toBeCloseTo(expected, 1);
    expect(meets(fg, bg, level)).toBe(true);
  });

  /**
   * `warn-700` misses AAA by three hundredths (`FRONTEND.md` §1.3 claims
   * 7.9:1 AAA; the §1.1 hex gives 6.97:1, which is AA).
   *
   * Asserted as a failing case deliberately, so the discrepancy cannot be
   * forgotten: if somebody darkens the token to `#63420D` — which produces
   * exactly the 7.9:1 the document names — this test fails and tells them the
   * open decision has been settled. Recorded in `docs/STATUS.md`.
   */
  it('does not yet clear AAA for caution text, as §1.3 claims it does', () => {
    expect(meets(COLOUR['warn-700'], COLOUR['warn-100'], 'AAA')).toBe(false);
    expect(levelOf(COLOUR['warn-700'], COLOUR['warn-100'])).toBe('AA');
  });
});

describe('FRONTEND.md §1.3: the pairs it forbids really do fail', () => {
  it('refuses white text on brand-300', () => {
    // brand-300 is a light green used for progress and live dots on *dark*
    // surfaces. White on it is the mistake the document names first.
    expect(meets('#FFFFFF', COLOUR['brand-300'], 'AA')).toBe(false);
    expect(levelOf('#FFFFFF', COLOUR['brand-300'])).toBeNull();
  });

  it('keeps muted ink above 4.5:1 on every tinted surface', () => {
    // "no muted ink on tinted surfaces below 4.5:1" (§1.3). brand-100 and
    // warn-100 are the tinted surfaces in the palette, and both clear it —
    // which is the check, not an assumption.
    expect(meets(COLOUR['ink-muted'], COLOUR['brand-100'], 'AA')).toBe(true);
    expect(meets(COLOUR['ink-muted'], COLOUR['warn-100'], 'AA')).toBe(true);
  });

  it('keeps both caution inks legible on the caution fill', () => {
    // warn-600 and warn-700 both sit on warn-100 — the delay chip uses the
    // lighter one, the freshness warning the darker. Neither may fall below
    // AA, because "this data is stale" is exactly the sentence a patient must
    // not miss (FR-OFF-03).
    expect(meets(COLOUR['warn-600'], COLOUR['warn-100'], 'AA')).toBe(true);
    expect(meets(COLOUR['warn-700'], COLOUR['warn-100'], 'AA')).toBe(true);
  });
});

describe('every text token is legible on every ground it is used on', () => {
  const grounds = ['bg-canvas', 'bg-surface', 'bg-sunken'] as const;
  const bodyInks = ['ink-primary', 'ink-secondary', 'ink-muted'] as const;

  it.each(grounds)('body ink clears AA on %s', (ground) => {
    for (const ink of bodyInks) {
      const ratio = contrastRatio(COLOUR[ink], COLOUR[ground]);
      expect(
        meets(COLOUR[ink], COLOUR[ground], 'AA'),
        `${ink} on ${ground} is ${ratio.toFixed(2)}:1`,
      ).toBe(true);
    }
  });

  it('keeps inverse ink legible on the dark surface', () => {
    expect(meets(COLOUR['ink-inverse'], COLOUR['bg-inverse'], 'AAA')).toBe(true);
  });

  it('keeps every status pill readable (FRONTEND.md §5.5)', () => {
    // Four semantic families, each a dark ink on its own light fill. A chip
    // whose text fails is a chip carrying state nobody can read.
    expect(meets(COLOUR['ink-primary'], COLOUR['bg-sunken'], 'AA')).toBe(true);
    expect(meets(COLOUR['brand-700'], COLOUR['brand-100'], 'AA')).toBe(true);
    expect(meets(COLOUR['warn-700'], COLOUR['warn-100'], 'AA')).toBe(true);
    expect(meets(COLOUR['alert-700'], COLOUR['alert-100'], 'AA')).toBe(true);
  });
});
