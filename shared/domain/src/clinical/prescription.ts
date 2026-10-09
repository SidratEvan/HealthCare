/**
 * A prescription's medicine rows (`PRD.md` `FR-DOC-04`, `FR-DOC-07`; plan R2).
 *
 * The schedule is written the way every prescription in Bangladesh already
 * writes it: three doses joined by `+`, morning, midday and night (`1+0+1`).
 * A dose is a whole number from 0 to 9, or a half (`½`, or `1/2` as typed on a
 * keyboard without it). Nothing here interprets a dose clinically: the rules
 * are about the notation, so a schedule that cannot be read back the same way
 * on the printed sheet is refused rather than guessed at.
 *
 * Pure.
 */

/** The most rows one visit carries. A prescription longer than this is a list, not a visit. */
export const MAX_PRESCRIPTION_ROWS = 20;

/** How many days a medicine may be given for (`prescription_items_duration_positive`). */
export const MAX_DURATION_DAYS = 365;

/** One dose in the notation: a digit, or a half. */
export type Dose = number;

/** Morning, midday, night. */
export interface ReadSchedule {
  readonly morning: Dose;
  readonly midday: Dose;
  readonly night: Dose;
}

const DOSE = /^(?:[0-9]|½|1\/2)$/;

function readDose(raw: string): Dose | null {
  const text = raw.trim();
  if (!DOSE.test(text)) return null;
  return text === '½' || text === '1/2' ? 0.5 : Number(text);
}

/**
 * A schedule as the doctor typed it, read into its three doses, or null when
 * it is not the notation. Bengali digits are read as their numbers, and spaces
 * around the `+` are forgiven.
 */
export function readSchedule(raw: string): ReadSchedule | null {
  const latin = raw.replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6));
  const parts = latin.split('+');
  if (parts.length !== 3) return null;
  const doses = parts.map(readDose);
  const morning = doses[0] ?? null;
  const midday = doses[1] ?? null;
  const night = doses[2] ?? null;
  if (morning === null || midday === null || night === null) return null;
  if (morning + midday + night === 0) return null;
  return { morning, midday, night };
}

/** The schedule written back in its one canonical form: `1+0+1`, `½+0+½`. */
export function scheduleText(schedule: ReadSchedule): string {
  const dose = (value: Dose): string => (value === 0.5 ? '½' : String(value));
  return `${dose(schedule.morning)}+${dose(schedule.midday)}+${dose(schedule.night)}`;
}

/**
 * One row of `TBL-B05-RX` as the doctor is typing it. Every field is text,
 * because that is what an input holds; `readMedicineRows` reads the rows into
 * what `POST /visits` takes, and says which are not right yet.
 */
export interface MedicineRow {
  /** Stable while rows are added and removed. */
  readonly key: string;
  /** Set when the name was picked from the formulary (`FR-DOC-05`). */
  readonly medicineId: string | null;
  readonly name: string;
  readonly strength: string;
  readonly schedule: string;
  readonly days: string;
  readonly instructionBn: string;
}

/** A medicine as `POST /visits` takes it. */
export interface MedicineBody {
  readonly medicineId?: string;
  readonly name: string;
  readonly strength?: string;
  readonly schedule?: string;
  readonly durationDays?: number;
  readonly instructionBn?: string;
}

/** What one row lacks before it can be saved. */
export interface MedicineRowProblems {
  readonly schedule: boolean;
  readonly days: boolean;
}

/**
 * The rows as `POST /visits` takes them, and which are not right yet.
 *
 * A row with no name is not a medicine and is left out, so an empty row the
 * doctor added and did not use never holds a signature. A schedule or a
 * number of days the server would refuse is reported against its row, and the
 * screen holds the save until it is corrected: the doctor sees why, rather
 * than a refusal after the tap.
 */
export function readMedicineRows(rows: readonly MedicineRow[]): {
  readonly body: readonly MedicineBody[];
  readonly problems: ReadonlyMap<string, MedicineRowProblems>;
} {
  const body: MedicineBody[] = [];
  const problems = new Map<string, MedicineRowProblems>();
  for (const row of rows) {
    const name = row.name.trim();
    if (name === '') continue;
    const schedule = row.schedule.trim();
    const read = schedule === '' ? null : readSchedule(schedule);
    const daysText = row.days
      .trim()
      .replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6));
    const days = daysText === '' ? null : Number(daysText);
    const daysWrong =
      days !== null && (!Number.isInteger(days) || days < 1 || days > MAX_DURATION_DAYS);
    const scheduleWrong = schedule !== '' && read === null;
    if (scheduleWrong || daysWrong) {
      problems.set(row.key, { schedule: scheduleWrong, days: daysWrong });
      continue;
    }
    body.push({
      name,
      ...(row.medicineId === null ? {} : { medicineId: row.medicineId }),
      ...(row.strength.trim() === '' ? {} : { strength: row.strength.trim() }),
      ...(read === null ? {} : { schedule: scheduleText(read) }),
      ...(days === null ? {} : { durationDays: days }),
      ...(row.instructionBn.trim() === '' ? {} : { instructionBn: row.instructionBn.trim() }),
    });
  }
  return { body, problems };
}
