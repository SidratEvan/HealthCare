import { describe, expect, it } from 'vitest';

import { csvLine, parseCsv } from '../csv.js';

describe('parseCsv (FR-IMP-09)', () => {
  it('reads what a spreadsheet saves: BOM, CRLF, quotes, and a blank last line', () => {
    const table = parseCsv('﻿ref,name\r\nP-1,"Begum, Rahima"\r\nP-2,"She said ""yes"""\r\n\r\n');
    expect(table).toEqual({
      header: ['ref', 'name'],
      rows: [
        { rowNumber: 2, cells: ['P-1', 'Begum, Rahima'] },
        { rowNumber: 3, cells: ['P-2', 'She said "yes"'] },
      ],
    });
  });

  it('keeps a line break inside a quoted field, and counts it as one row', () => {
    const table = parseCsv('ref,note\nP-1,"two\nlines"\nP-2,x');
    expect(table).not.toBe('empty');
    if (typeof table === 'string') return;
    expect(table.rows.map((row) => row.cells)).toEqual([
      ['P-1', 'two\nlines'],
      ['P-2', 'x'],
    ]);
    expect(table.rows.map((row) => row.rowNumber)).toEqual([2, 3]);
  });

  it('keeps Bangla as written', () => {
    const table = parseCsv('name_bn\nরহিমা খাতুন');
    expect(typeof table === 'string' ? table : table.rows[0]?.cells).toEqual(['রহিমা খাতুন']);
  });

  it('skips blank rows but keeps the file’s row numbers', () => {
    const table = parseCsv('ref\nA\n\n,\nB\n');
    if (typeof table === 'string') throw new Error(table);
    expect(table.rows).toEqual([
      { rowNumber: 2, cells: ['A'] },
      { rowNumber: 5, cells: ['B'] },
    ]);
  });

  it('says so when a file is empty or a quote never closes', () => {
    expect(parseCsv('')).toBe('empty');
    expect(parseCsv('\n\n')).toBe('empty');
    expect(parseCsv('ref\n"open')).toBe('unterminated_quote');
  });

  it('writes a line that reads back the same', () => {
    const line = csvLine(['P-1', 'Begum, Rahima', 'said "hi"', 'plain']);
    expect(line).toBe('P-1,"Begum, Rahima","said ""hi""",plain');
    const table = parseCsv(`a,b,c,d\n${line}`);
    if (typeof table === 'string') throw new Error(table);
    expect(table.rows[0]?.cells).toEqual(['P-1', 'Begum, Rahima', 'said "hi"', 'plain']);
  });
});
