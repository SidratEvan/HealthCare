/** UTF-8 limits shared by all three import paths (FR-IMP-09/22). */
import { describe, expect, it } from 'vitest';

import {
  importAnalyseBody,
  importMappedBody,
  importUploadBody,
  importUtf8Bytes,
  MAX_IMPORT_BYTES,
} from '../../schemas/import.schema.js';

describe('actual UTF-8 CSV size', () => {
  it.each([
    ['plain', 5],
    ['বাংলা', 15],
    ['😀', 4],
    ['\ud800', 3],
    ['a\n"\\', 4],
  ] as const)('counts UTF-8 bytes for %s', (value, bytes) => {
    expect(importUtf8Bytes(value)).toBe(bytes);
  });
  it('allows the ASCII boundary and rejects multibyte text under the character boundary', () => {
    const exact = 'a'.repeat(MAX_IMPORT_BYTES);
    const tooBig = 'ক'.repeat(Math.floor(MAX_IMPORT_BYTES / 3) + 1);
    for (const csv of [exact, tooBig]) {
      const expected = csv === exact;
      expect(
        importUploadBody.safeParse({ set: 'patients', fileName: 'demo.csv', csv }).success,
      ).toBe(expected);
      expect(importAnalyseBody.safeParse({ set: 'patients', csv }).success).toBe(expected);
      expect(
        importMappedBody.safeParse({
          set: 'patients',
          fileName: 'demo.csv',
          csv,
          mapping: { rowType: null, fields: {} },
        }).success,
      ).toBe(expected);
    }
  });
});
