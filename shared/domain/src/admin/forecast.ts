/**
 * How many patients to expect, so a hospital can roster staff (`FR-ADM-09`).
 *
 * "Volume forecast by day and session for staffing." This file is the
 * arithmetic; `admin.repo` supplies the historical counts and `S-B-10` renders
 * the next fortnight.
 *
 * No I/O.
 *
 * ## This is an average, and it says so
 *
 * There is no model here and there should not be. A forecast is the mean of
 * the same weekday over the trailing weeks — Tuesdays predict Tuesdays —
 * because attendance at a chamber is driven overwhelmingly by which day it is
 * and which doctor sits. Anything cleverer would need more history than a
 * pitch database has and would be indistinguishable from a guess dressed up.
 *
 * What makes it honest is that every point carries `observations`. A Tuesday
 * built from six Tuesdays and a Friday built from one are not the same claim,
 * and the screen shows the difference rather than drawing both in the same
 * confident line.
 *
 * ## Below the floor, the answer is "we do not know"
 *
 * A weekday with fewer than `MIN_OBSERVATIONS` past samples returns a null
 * expectation, not a number. `PRD.md` §3.2 forbids fabricating availability
 * when data is missing, and a staffing figure invented from a single Friday is
 * exactly that — a hospital could roster against it. Two is the floor because
 * one observation has no notion of spread at all: it cannot distinguish a
 * typical day from the one day the clinic was empty.
 *
 * ## The spread is reported, not smoothed
 *
 * Staffing is a decision about the *bad* day, not the average one. A Tuesday
 * averaging thirty patients that ranges from twelve to fifty-one needs a
 * different rota from one that never leaves twenty-eight to thirty-two, and a
 * single mean cannot tell them apart. So `low` and `high` are the observed
 * range, not a confidence interval: with five samples an interval would be
 * arithmetic theatre, while "in the last five Tuesdays it was never below
 * twelve or above fifty-one" is a fact somebody can roster against.
 */

/** Fewest past samples a weekday needs before a figure is offered at all. */
export const MIN_OBSERVATIONS = 2;

/** One past session's attendance, as the repository counts it. */
export interface HistoricalVolume {
  /** `sessions.session_date`, the Dhaka calendar date. */
  readonly date: string;
  /** 0 = Sunday … 6 = Saturday, matching `Date.getUTCDay`. */
  readonly weekday: number;
  /** Which chamber of the day, so a morning is not averaged with an evening. */
  readonly slot: ForecastSlot;
  /** Patients who actually attended: `done` plus those still in the chamber. */
  readonly seen: number;
}

/**
 * Which part of the day a session sits in.
 *
 * Three bands rather than the session's own start time, because a doctor whose
 * clinic moved from 17:00 to 17:30 last month has not changed what a rota needs
 * to cover. The boundaries are Dhaka clock hours and are computed by the
 * repository, which is the only place that knows the timezone.
 */
export type ForecastSlot = 'morning' | 'afternoon' | 'evening';

/** One predicted day-and-slot (`FR-ADM-09`). */
export interface ForecastPoint {
  readonly weekday: number;
  readonly slot: ForecastSlot;
  /** Mean attendance, rounded, or null when there is too little history. */
  readonly expected: number | null;
  /** Lowest attendance observed, or null below the floor. */
  readonly low: number | null;
  /** Highest attendance observed, or null below the floor. */
  readonly high: number | null;
  /** How many past sessions this rests on. Rendered, never hidden. */
  readonly observations: number;
}

/**
 * Reduces history into one point per weekday-and-slot that has any.
 *
 * A combination with no history at all is absent from the result rather than
 * present with nulls: the hospital does not run a Friday morning clinic, and a
 * forecast row for one would invite somebody to staff it.
 *
 * Ordered by weekday then by slot through the day, which is how a rota is read.
 */
export function forecastVolume(history: readonly HistoricalVolume[]): readonly ForecastPoint[] {
  const groups = new Map<string, number[]>();

  for (const row of history) {
    const key = `${String(row.weekday)}:${row.slot}`;
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, [row.seen]);
    else existing.push(row.seen);
  }

  const points: ForecastPoint[] = [];

  for (const [key, counts] of groups) {
    const [weekdayText, slotText] = key.split(':');
    /* c8 ignore next -- the key is built two lines above from both halves */
    if (weekdayText === undefined || slotText === undefined) continue;

    const enough = counts.length >= MIN_OBSERVATIONS;
    const total = counts.reduce((sum, count) => sum + count, 0);

    points.push({
      weekday: Number(weekdayText),
      slot: slotText as ForecastSlot,
      expected: enough ? Math.round(total / counts.length) : null,
      low: enough ? Math.min(...counts) : null,
      high: enough ? Math.max(...counts) : null,
      observations: counts.length,
    });
  }

  const order: Readonly<Record<ForecastSlot, number>> = {
    morning: 0,
    afternoon: 1,
    evening: 2,
  };

  return points.sort((a, b) =>
    a.weekday !== b.weekday ? a.weekday - b.weekday : order[a.slot] - order[b.slot],
  );
}
