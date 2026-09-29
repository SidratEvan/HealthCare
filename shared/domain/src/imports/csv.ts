/**
 * Reading a CSV file as a hospital's spreadsheet saves it (pilot step 24,
 * `FR-IMP-09`).
 *
 * RFC 4180, with the things Excel and LibreOffice actually write: a UTF-8 byte
 * order mark at the start, CRLF or LF line ends, fields in double quotes with
 * `""` for a quote inside, commas and line breaks inside quoted fields, and a
 * blank last line. No dependency: this is fifty lines, and a parser is exactly
 * the kind of thing whose every behaviour a test here should pin.
 *
 * Pure. The header row is returned as it was written; matching it to a
 * template is `readRows`' job.
 */

export interface CsvTable {
  readonly header: readonly string[];
  /** Data rows, each with the file's row number (the header is row 1). */
  readonly rows: readonly { readonly rowNumber: number; readonly cells: readonly string[] }[];
}

export type CsvProblem = 'empty' | 'unterminated_quote';

export function parseCsv(text: string): CsvTable | CsvProblem {
  const source = text.startsWith('﻿') ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;

  while (index < source.length) {
    const char = source[index] ?? '';
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"' && field === '') {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      record.push(field);
      field = '';
      index += 1;
      continue;
    }
    if (char === '\r' || char === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      index += char === '\r' && source[index + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += char;
    index += 1;
  }
  if (quoted) return 'unterminated_quote';
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  // A line with nothing on it is not a row a person meant (a trailing blank
  // line, a spacer between blocks).
  const meaningful = records
    .map((cells, position) => ({ rowNumber: position + 1, cells }))
    .filter((entry) => entry.cells.some((cell) => cell.trim() !== ''));

  const [first, ...rest] = meaningful;
  if (first === undefined) return 'empty';
  return {
    header: first.cells.map((cell) => cell.trim()),
    rows: rest.map((entry) => ({ rowNumber: entry.rowNumber, cells: entry.cells })),
  };
}

/** One CSV field, quoted when it has to be. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** A CSV line from fields. */
export function csvLine(values: readonly string[]): string {
  return values.map(csvField).join(',');
}
