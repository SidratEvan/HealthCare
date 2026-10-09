/**
 * A spreadsheet's sheet, written as the CSV the importer already reads
 * (`PRD.md` `FR-IMP-22`; plan E1; the owner's answer to question 19).
 *
 * The console reads an `.xlsx` file with `read-excel-file` and hands its rows
 * here; what comes out goes to the same analyse, mapping, check, preview,
 * approval, audit and undo as a CSV file. Nothing after this step knows the
 * file was a spreadsheet.
 *
 * Cells are written so the existing readers take them without guessing:
 *
 *   - a date is `YYYY-MM-DD`, read from the cell's date and never from how
 *     the sheet displayed it (a sheet that shows `05/04/2025` is ambiguous;
 *     the cell is not);
 *   - a time on its own is `HH:MM`, and a date with a time is both, with a
 *     space between, which the checker will say it cannot read as a date;
 *   - a number is written as it is held, so a long registration number keeps
 *     every digit;
 *   - `true` and `false` are written as words the checker knows;
 *   - an empty cell is empty.
 *
 * Pure. The library hands dates as `Date` objects at UTC.
 */

import { csvLine } from './csv.js';

export type SpreadsheetCell = string | number | boolean | Date | null | undefined;

/** Excel's day zero; a cell holding only a time is a date on it. */
const TIME_ONLY_DAYS = new Set(['1899-12-30', '1899-12-31', '1900-01-00', '1904-01-01']);

const two = (value: number): string => String(value).padStart(2, '0');

function cellText(cell: SpreadsheetCell): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'string') return cell;
  if (typeof cell === 'boolean') return cell ? 'true' : 'false';
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : '';
  if (Number.isNaN(cell.getTime())) return '';
  const date = `${String(cell.getUTCFullYear())}-${two(cell.getUTCMonth() + 1)}-${two(cell.getUTCDate())}`;
  const time = `${two(cell.getUTCHours())}:${two(cell.getUTCMinutes())}`;
  if (TIME_ONLY_DAYS.has(date)) return time;
  return time === '00:00' ? date : `${date} ${time}`;
}

/** Whether a row holds anything at all: a blank line is not a row a person meant. */
function hasContent(row: readonly SpreadsheetCell[]): boolean {
  return row.some((cell) => cellText(cell).trim() !== '');
}

/**
 * The sheet as CSV text, trailing blank rows and trailing empty columns
 * dropped, every row as wide as the widest.
 */
export function sheetToCsv(rows: readonly (readonly SpreadsheetCell[])[]): string {
  const meaningful = rows.filter(hasContent);
  const width = meaningful.reduce((widest, row) => {
    let last = row.length;
    while (last > 0 && cellText(row[last - 1]).trim() === '') last -= 1;
    return Math.max(widest, last);
  }, 0);
  return meaningful
    .map((row) => csvLine(Array.from({ length: width }, (_, index) => cellText(row[index]))))
    .join('\r\n');
}

/** Whether a sheet holds any row worth reading. */
export function sheetHasRows(rows: readonly (readonly SpreadsheetCell[])[]): boolean {
  return rows.some(hasContent);
}

/**
 * The old Excel format (`.xls`), by its first bytes: an OLE compound file.
 * Not read here (the owner's answer to question 19); the screen says to save
 * it as `.xlsx` or CSV.
 */
export function isLegacyXls(bytes: Uint8Array): boolean {
  return [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every(
    (value, index) => bytes[index] === value,
  );
}

/** An `.xlsx` file, by its first bytes: a zip archive. */
export function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}
