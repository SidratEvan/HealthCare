/**
 * A seeded pseudo-random generator, so a reset produces a *known* state
 * (`FR-DEM-06`) rather than merely a plausible one.
 *
 * `Math.random()` would make every reset a different demo: a different patient
 * on serial 9, a different consultation length behind the ETA, a different
 * no-show rate on the admin dashboard. That is fine for a load test and wrong
 * for a pitch, where the same reset has to produce the same screen twice in a
 * row — and wrong for a test, which would then be asserting on a distribution
 * instead of a value.
 *
 * mulberry32: a 32-bit state, one multiply-xor round. It is not
 * cryptographically anything and must never be used for a token; this file
 * exists to make a demo repeatable.
 */

export interface Rng {
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** An element of a non-empty list. */
  pick<T>(items: readonly T[]): T;
  /** True with probability `p`. */
  chance(p: number): boolean;
  /** A shuffled copy, Fisher-Yates. Does not touch the input. */
  shuffle<T>(items: readonly T[]): T[];
  /** An independent stream, derived from a label. Order-independent by design. */
  stream(label: string): Rng;
}

/**
 * Creates a generator from a numeric seed.
 *
 * Use `stream(label)` rather than sharing one generator across seed modules:
 * a shared generator makes every module's output depend on how many numbers
 * the previous module happened to draw, so adding one patient would change the
 * doctor on the demo session. A labelled stream is stable under that kind of
 * edit.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,

    int(min, max) {
      if (max < min) throw new Error(`int(${String(min)}, ${String(max)}): max is below min.`);
      return min + Math.floor(next() * (max - min + 1));
    },

    pick(items) {
      if (items.length === 0) throw new Error('pick() needs a non-empty list.');
      const chosen = items[Math.floor(next() * items.length)];
      if (chosen === undefined) throw new Error('pick() drew past the end of the list.');
      return chosen;
    },

    chance(p) {
      return next() < p;
    },

    shuffle(items) {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const a = copy[i];
        const b = copy[j];
        if (a === undefined || b === undefined) continue;
        copy[i] = b;
        copy[j] = a;
      }
      return copy;
    },

    stream(label) {
      return createRng(hash(label) ^ seed);
    },
  };

  return rng;
}

/** FNV-1a, so a label maps to a stable 32-bit seed across runs and platforms. */
function hash(label: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < label.length; i += 1) {
    value ^= label.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/**
 * The seed behind every demo number in this repository.
 *
 * Changing it changes the whole demo — which patient is on serial 9, what the
 * admin dashboard's no-show figure is, which consultation lengths the ETA is
 * built from. Tests assert on values this produces, so treat it as a constant
 * of the demo rather than a knob.
 */
export const DEMO_SEED = 20260101;
