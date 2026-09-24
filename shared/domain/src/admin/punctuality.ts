/**
 * Whether chambers start when they said they would (`FR-ADM-05`).
 *
 * "Doctor punctuality: planned versus actual start, average consultation
 * duration." This file is the arithmetic; `admin.repo` supplies one row per
 * session and `S-B-10`'s Staff section ranks them.
 *
 * No I/O.
 *
 * ## Median, not mean
 *
 * A consultant who is five minutes late forty times and four hours late once
 * has a mean lateness of fifteen minutes and a median of five. The median is
 * the truthful answer to "when does this doctor actually start", and the mean
 * is the answer to a question nobody asked. The outlier is not noise either —
 * it is a day something went wrong — so it is reported separately as the worst
 * case rather than blended away.
 *
 * ## A session that never started is not punctual and not late
 *
 * `actual_start` is null until `DOCTOR_ARRIVED` is appended. A scheduled
 * session that has not begun, or one the doctor never attended, contributes to
 * neither figure — it is counted as `neverStarted` instead. Treating a missing
 * start as zero lateness would flatter an absent doctor; treating it as
 * infinite lateness would make one cancelled clinic swamp a month of data.
 * Counting it separately is the only reading that says what happened.
 *
 * ## Early is not punctual
 *
 * A doctor who starts twenty minutes early has also broken the promise the
 * patient was given — people told to arrive at four are not there at twenty to.
 * So lateness is signed, `onTime` is a band around zero rather than "not late",
 * and `SESSION_ON_TIME_MINUTES` is what that band is.
 */

/** The tolerance either side of the planned start that still counts as on time. */
export const SESSION_ON_TIME_MINUTES = 10;

/** One session, as the repository reports it. */
export interface SessionTiming {
  readonly doctorId: string;
  readonly doctorNameBn: string;
  readonly doctorNameEn: string;
  readonly departmentNameBn: string;
  readonly departmentNameEn: string;
  /** Minutes between planned and actual start; negative is early. Null if never started. */
  readonly startDeltaMinutes: number | null;
  /** Mean seconds per consultation in that session, or null if nobody was seen. */
  readonly avgConsultSeconds: number | null;
  /** How many patients were seen, which weights the consultation average. */
  readonly seen: number;
}

/** One doctor's record over the window (`FR-ADM-05`). */
export interface DoctorPunctuality {
  readonly doctorId: string;
  readonly doctorNameBn: string;
  readonly doctorNameEn: string;
  readonly departmentNameBn: string;
  readonly departmentNameEn: string;
  readonly sessions: number;
  /** Sessions with no `DOCTOR_ARRIVED` — neither punctual nor late. */
  readonly neverStarted: number;
  /** Sessions inside the on-time band. */
  readonly onTime: number;
  /** Median signed minutes late, or null when no session ever started. */
  readonly medianDeltaMinutes: number | null;
  /** The single worst start in the window, kept out of the median. */
  readonly worstDeltaMinutes: number | null;
  /**
   * Mean seconds per consultation across the window, weighted by patients seen
   * so a session with forty patients counts forty times as much as one with
   * one. Null when nobody was seen at all.
   */
  readonly avgConsultSeconds: number | null;
  /** Share of started sessions inside the band, 0–1, or null if none started. */
  readonly onTimeRate: number | null;
  readonly seen: number;
}

/**
 * Groups sessions by doctor and reduces each group.
 *
 * Ordered worst-median-first, so the Staff section opens on the doctor an
 * administrator most needs to talk to. Doctors who never started a session sort
 * last rather than first: "no data" is not the same as "worst", and a list that
 * led with them would bury the finding.
 */
export function punctualityByDoctor(
  timings: readonly SessionTiming[],
): readonly DoctorPunctuality[] {
  const groups = new Map<string, SessionTiming[]>();
  for (const timing of timings) {
    const existing = groups.get(timing.doctorId);
    if (existing === undefined) groups.set(timing.doctorId, [timing]);
    else existing.push(timing);
  }

  const rows = [...groups.values()].map((group) => reduceDoctor(group));

  return rows.sort((a, b) => {
    if (a.medianDeltaMinutes === null && b.medianDeltaMinutes === null) {
      return a.doctorNameEn.localeCompare(b.doctorNameEn);
    }
    if (a.medianDeltaMinutes === null) return 1;
    if (b.medianDeltaMinutes === null) return -1;
    if (a.medianDeltaMinutes !== b.medianDeltaMinutes) {
      return b.medianDeltaMinutes - a.medianDeltaMinutes;
    }
    return a.doctorNameEn.localeCompare(b.doctorNameEn);
  });
}

function reduceDoctor(group: readonly SessionTiming[]): DoctorPunctuality {
  const first = group[0];
  /* c8 ignore next -- a group only exists because a row created it */
  if (first === undefined) throw new RangeError('A doctor group is never empty.');

  const deltas = group
    .map((timing) => timing.startDeltaMinutes)
    .filter((delta): delta is number => delta !== null);

  const seen = group.reduce((total, timing) => total + timing.seen, 0);

  // Weighted by patients seen, not a mean of means. A session where one patient
  // took forty minutes and one where thirty took eight each say something very
  // different about the doctor's pace, and averaging the two averages gives the
  // quiet session equal say.
  const consultSeconds = group.reduce(
    (total, timing) =>
      timing.avgConsultSeconds === null ? total : total + timing.avgConsultSeconds * timing.seen,
    0,
  );

  const onTime = deltas.filter((delta) => Math.abs(delta) <= SESSION_ON_TIME_MINUTES).length;

  return {
    doctorId: first.doctorId,
    doctorNameBn: first.doctorNameBn,
    doctorNameEn: first.doctorNameEn,
    departmentNameBn: first.departmentNameBn,
    departmentNameEn: first.departmentNameEn,
    sessions: group.length,
    neverStarted: group.length - deltas.length,
    onTime,
    medianDeltaMinutes: median(deltas),
    worstDeltaMinutes: deltas.length === 0 ? null : Math.max(...deltas),
    avgConsultSeconds: seen === 0 ? null : Math.round(consultSeconds / seen),
    onTimeRate: deltas.length === 0 ? null : onTime / deltas.length,
    seen,
  };
}

/**
 * The middle value, averaging the two middles on an even count.
 *
 * Rounded, because a median lateness of 7.5 minutes is reported to a person who
 * thinks in whole minutes, and the half is below the precision of the
 * measurement anyway — `DOCTOR_ARRIVED` is stamped when somebody taps a button.
 */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) return sorted[middle] ?? null;

  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  /* c8 ignore next -- both indices are in range for an even, non-empty array */
  if (lower === undefined || upper === undefined) return null;
  return Math.round((lower + upper) / 2);
}
