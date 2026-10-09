/**
 * A spreadsheet's sheet, written as the CSV the importer reads (`FR-IMP-22`;
 * plan E1).
 */

import { describe, expect, it } from 'vitest';

import { parseCsv } from '../csv.js';
import { readDate, readTime } from '../sets.js';
import { isLegacyXls, isZip, sheetHasRows, sheetToCsv } from '../spreadsheet.js';

describe('sheetToCsv', () => {
  it('writes dates from the cell, never from how the sheet showed them', () => {
    const csv = sheetToCsv([
      ['name', 'birth', 'start'],
      ['Rahim (Demo)', new Date(Date.UTC(1985, 3, 5)), new Date(Date.UTC(1899, 11, 30, 17, 30))],
    ]);
    expect(csv).toBe('name,birth,start\r\nRahim (Demo),1985-04-05,17:30');
    // And the importer's own readers take what it wrote.
    expect(readDate('1985-04-05')).toBe('1985-04-05');
    expect(readTime('17:30')).toBe('17:30');
  });

  it('keeps every digit of a number, writes words for true and false, and empties nothing', () => {
    expect(
      sheetToCsv([
        ['reg', 'paid', 'note'],
        [20240012345, true, null],
      ]),
    ).toBe('reg,paid,note\r\n20240012345,true,');
  });

  it('quotes what needs quoting, so a comma in a name stays in the name', () => {
    const csv = sheetToCsv([['name'], ['Hossain, Karim (Demo)']]);
    const table = parseCsv(csv);
    expect(typeof table === 'string' ? null : table.rows[0]?.cells[0]).toBe(
      'Hossain, Karim (Demo)',
    );
  });

  it('drops blank rows and trailing empty columns, and makes every row as wide', () => {
    expect(
      sheetToCsv([
        ['a', 'b', null, null],
        [null, null, null],
        ['1', null],
      ]),
    ).toBe('a,b\r\n1,');
  });

  it('writes a date with a time as both, which the checker will name rather than guess', () => {
    expect(sheetToCsv([['when'], [new Date(Date.UTC(2026, 9, 8, 9, 15))]])).toBe(
      'when\r\n2026-10-08 09:15',
    );
  });
});

describe('the file’s kind, by its first bytes', () => {
  it('tells an .xlsx from an old .xls', () => {
    expect(isZip(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0]))).toBe(true);
    expect(isLegacyXls(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe(
      true,
    );
    expect(isZip(Uint8Array.from([0xd0, 0xcf]))).toBe(false);
  });

  it('knows an empty sheet', () => {
    expect(sheetHasRows([[null, ''], []])).toBe(false);
    expect(sheetHasRows([['x']])).toBe(true);
  });
});
