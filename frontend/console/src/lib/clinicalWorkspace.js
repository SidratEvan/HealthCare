/** Presentation selectors reuse server/domain rules (FR-LAB-04, FR-PHR-02). */
import { stockAnswerFor } from '@platform/domain';
export function currentStockRows(rows, now) {
  return rows.map((row) => ({
    ...row,
    publishedAs: stockAnswerFor(
      { inStock: row.inStock, updatedAt: row.updatedAt },
      now.toISOString(),
    ).answer,
  }));
}
export function matchingStockRows(rows, search, filter) {
  const query = search.trim().toLocaleLowerCase();
  const rank = { unknown: 0, out_of_stock: 1, in_stock: 2 };
  return rows
    .filter(
      (row) =>
        (filter === 'all' || row.publishedAs === filter) &&
        [row.genericName, row.brandName ?? '', row.form ?? '', ...row.strengths]
          .join(' ')
          .toLocaleLowerCase()
          .includes(query),
    )
    .sort(
      (a, b) => rank[a.publishedAs] - rank[b.publishedAs] || a.updatedAt.localeCompare(b.updatedAt),
    );
}
export function matchingLabOrders(rows, search, stage) {
  const query = search.trim().toLocaleLowerCase();
  return rows.filter(
    (row) =>
      (stage === 'all' || row.state === stage) &&
      `${row.testName} ${row.testCode} ${row.id}`.toLocaleLowerCase().includes(query),
  );
}
