/**
 * The rolling consultation rate (FR-QUE-10, FR-QUE-12).
 *
 * Tested for the two behaviours the requirement cares about — that it tracks a
 * doctor's real pace, and that one outlier does not throw every downstream
 * estimate — rather than for a particular arithmetic result.
 */

import { describe, expect, it } from 'vitest';

import {
  clampConsultSeconds,
  currentRateSeconds,
  isMeasured,
  observeConsult,
  rateSpreadSeconds,
  seedRate,
  MAX_CONSULT_SECONDS,
  MIN_CONSULT_SECONDS,
  RATE_WINDOW,
} from '../rate.js';

/** Folds a series of observations into a fresh rate. */
function observe(
  seedSeconds: number,
  observations: readonly number[],
): ReturnType<typeof seedRate> {
  return observations.reduce(
    (rate, seconds) => observeConsult(rate, seconds),
    seedRate(seedSeconds),
  );
}

describe('seeding (FR-QUE-10)', () => {
  it("starts from the doctor's configured default", () => {
    const rate = seedRate(600);

    expect(currentRateSeconds(rate)).toBe(600);
    expect(rate.samples).toEqual([]);
    expect(isMeasured(rate)).toBe(false);
  });

  it('brings an implausible default into range rather than trusting it', () => {
    expect(currentRateSeconds(seedRate(0))).toBe(MIN_CONSULT_SECONDS);
    expect(currentRateSeconds(seedRate(99_999))).toBe(MAX_CONSULT_SECONDS);
  });
});

describe('the first measurement', () => {
  it('replaces the default outright, because a guess is worth less than a measurement', () => {
    const rate = observe(720, [300]);

    expect(currentRateSeconds(rate)).toBe(300);
    expect(isMeasured(rate)).toBe(true);
  });
});

describe('tracking a doctor who is faster than their average (FR-QUE-12)', () => {
  it('converges on the observed pace within a few patients', () => {
    // Configured at twelve minutes, actually running at five.
    const rate = observe(720, [300, 300, 300, 300]);

    expect(currentRateSeconds(rate)).toBe(300);
  });

  it('weights recent consultations more heavily than old ones', () => {
    // Three identical observations to get past the warm-up, then one that
    // differs: the chamber that has just sped up reads faster.
    const endingFast = observe(480, [600, 600, 600, 300]);
    const endingSlow = observe(480, [600, 600, 600, 900]);

    expect(currentRateSeconds(endingFast)).toBeLessThan(currentRateSeconds(endingSlow));
  });

  it('averages the first few observations, so early order does not matter', () => {
    // During the warm-up the weight is 1/n, which is a running mean. Two early
    // consultations of five and fifteen minutes read as ten either way round —
    // the estimate has no business preferring one of two equally old
    // measurements.
    expect(currentRateSeconds(observe(480, [300, 900]))).toBe(
      currentRateSeconds(observe(480, [900, 300])),
    );
  });

  it('does not let the first patient of the day set the pace on its own', () => {
    // A two-minute follow-up opening a twelve-minute cardiology chamber. One
    // atypical case must not tell forty waiting people the queue is quick.
    const afterOutlierFirst = observe(720, [120, 720, 720]);

    expect(currentRateSeconds(afterOutlierFirst)).toBeGreaterThan(400);
  });
});

describe('resisting one outlier', () => {
  it('does not let a single long consultation dominate the estimate', () => {
    const steady = observe(480, [300, 300, 300, 300, 300]);
    const withOutlier = observeConsult(steady, 3000);

    const movement = currentRateSeconds(withOutlier) - currentRateSeconds(steady);

    // A ten-fold outlier moves the estimate, but nowhere near ten-fold: a
    // waiting family must not see the time jump by half an hour because one
    // consultation ran long.
    expect(movement).toBeGreaterThan(0);
    expect(currentRateSeconds(withOutlier)).toBeLessThan(1200);
  });

  it('clamps a forgotten "done" tap rather than believing a two-hour consultation', () => {
    expect(clampConsultSeconds(7200)).toBe(MAX_CONSULT_SECONDS);
    expect(clampConsultSeconds(2)).toBe(MIN_CONSULT_SECONDS);
    expect(clampConsultSeconds(Number.NaN)).toBe(MIN_CONSULT_SECONDS);
  });

  it('keeps the estimate inside the believable range whatever it is fed', () => {
    const rate = observe(480, [7200, 7200, 7200, 1, 1, 1]);

    expect(currentRateSeconds(rate)).toBeGreaterThanOrEqual(MIN_CONSULT_SECONDS);
    expect(currentRateSeconds(rate)).toBeLessThanOrEqual(MAX_CONSULT_SECONDS);
  });
});

describe('the observation window', () => {
  it('keeps only the most recent observations', () => {
    const observations = Array.from({ length: RATE_WINDOW + 8 }, (_, index) => 300 + index);
    const rate = observe(480, observations);

    expect(rate.samples).toHaveLength(RATE_WINDOW);
    expect(rate.samples.at(-1)).toBe(observations.at(-1));
  });
});

describe('spread, which decides how wide the confidence band is (FR-QUE-13)', () => {
  it('assumes a wide spread before anything has been measured', () => {
    const rate = seedRate(600);

    expect(rateSpreadSeconds(rate)).toBeGreaterThan(0);
    // An honest "we do not know yet" rather than implied precision.
    expect(rateSpreadSeconds(rate)).toBe(240);
  });

  it('reports a tighter spread for a chamber running to a rhythm', () => {
    const steady = observe(480, [300, 305, 295, 300, 302, 298]);
    const erratic = observe(480, [120, 900, 200, 1500, 240, 1100]);

    expect(rateSpreadSeconds(steady)).toBeLessThan(rateSpreadSeconds(erratic));
  });

  it('never claims a tighter spread than a doctor can really hold', () => {
    const identical = observe(480, [300, 300, 300, 300, 300, 300]);

    // Six identical consultations have zero measured variance, which would
    // imply a band of nothing. Nobody runs a chamber that precisely.
    expect(rateSpreadSeconds(identical)).toBeGreaterThan(0);
  });
});

describe('determinism', () => {
  it('gives the same number for the same observations in the same order', () => {
    const observations = [420, 300, 615, 180, 900, 240];

    expect(observe(480, observations)).toEqual(observe(480, observations));
  });

  it('is what lets a replay reproduce avg_consult_seconds exactly', () => {
    // The database maintains this incrementally on PATIENT_DONE
    // (DATABASE.md §6); a replay folds the same observations in the same order
    // and must land on the same value.
    const incremental = [300, 420, 360].reduce(
      (rate, seconds) => observeConsult(rate, seconds),
      seedRate(480),
    );
    const replayed = observe(480, [300, 420, 360]);

    expect(currentRateSeconds(incremental)).toBe(currentRateSeconds(replayed));
  });
});
