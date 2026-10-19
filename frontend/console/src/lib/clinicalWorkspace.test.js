/** FR-PHR-02: age is public truth; confirmation must use the source shelf. */
import { describe, expect, it } from 'vitest';

import { currentStockRows, matchingStockRows } from './clinicalWorkspace';

const row = {
  medicineId: 'synthetic',
  genericName: 'Paracetamol',
  brandName: 'Napa',
  form: 'tablet',
  strengths: ['500 mg'],
  inStock: true,
  updatedAt: '2026-10-10T00:00:00.123456Z',
  publishedAs: 'in_stock',
};
describe('current shelf answers', () => {
  it('ages an unchanged in-stock row at the exact 720 whole-minute boundary', () => {
    expect(currentStockRows([row], new Date('2026-10-10T11:59:59.123Z'))[0]?.publishedAs).toBe(
      'in_stock',
    );
    expect(currentStockRows([row], new Date('2026-10-10T12:00:00.123Z'))[0]?.publishedAs).toBe(
      'unknown',
    );
    expect(
      currentStockRows([{ ...row, inStock: false }], new Date('2026-10-20T12:00:00Z'))[0]
        ?.publishedAs,
    ).toBe('out_of_stock');
  });
  it('keeps the original exact version while filtering search and prioritizing unknown stock', () => {
    const rows = currentStockRows(
      [row, { ...row, medicineId: 'fresh', updatedAt: '2026-10-10T12:00:00.987654Z' }],
      new Date('2026-10-10T12:00:01Z'),
    );
    expect(matchingStockRows(rows, 'Napa  ', 'unknown')).toHaveLength(1);
    expect(matchingStockRows(rows, '500', 'all')[0]?.medicineId).toBe('synthetic');
    expect(rows[0]?.updatedAt).toBe(row.updatedAt);
    expect(rows).toHaveLength(2);
    expect(matchingStockRows(rows, 'missing', 'all')).toHaveLength(0);
  });
});
