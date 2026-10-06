/**
 * The order results are shown in, for the need that was asked (`FR-PAT-17`).
 *
 * The repository already orders hospitals by distance when a position is
 * known, then by who is sitting now. That is the right order for a specialty
 * and for a capability. A bed search has a better one: the place with the most
 * free beds of the kind asked for comes first, and a place that has never
 * confirmed that kind comes last, because an unconfirmed count is not a
 * number anybody should drive towards (`PRD.md` §3.2).
 */

import type { SearchNeed } from './needs.js';
import type { PublicCapacity } from '../beds/capacity.js';
import type { BedKind } from '../types/enums.js';

/** One kind's published tally at a hospital, or null if it has none of that kind. */
export function tallyOfKind(
  capacity: PublicCapacity | null,
  kind: BedKind,
): PublicCapacity['byKind'][number] | null {
  return capacity?.byKind.find((entry) => entry.kind === kind) ?? null;
}

/**
 * The same, but only when a ward has confirmed it.
 *
 * A kind nobody has confirmed carries a count that was never checked against
 * the beds themselves, and callers must not show or rank on it as a number.
 */
export function confirmedTallyOfKind(
  capacity: PublicCapacity | null,
  kind: BedKind,
): PublicCapacity['byKind'][number] | null {
  const tally = tallyOfKind(capacity, kind);
  if (tally === null) return null;
  return tally.asOf === null ? null : tally;
}

/**
 * Reorders a result list for a need. Stable: ties keep the order they came in.
 *
 * Generic over the listing so the API and a test can both hand it their own
 * shape; all it reads is the published bed figures.
 */
export function orderForNeed<T extends { readonly beds: PublicCapacity | null }>(
  listings: readonly T[],
  need: SearchNeed | null,
): readonly T[] {
  if (need?.kind !== 'bed') return listings;

  const rank = (listing: T): number => {
    // No such beds here, or never confirmed: after every confirmed count.
    return confirmedTallyOfKind(listing.beds, need.bedKind)?.free ?? -1;
  };

  return listings
    .map((listing, index) => ({ listing, index, free: rank(listing) }))
    .sort((a, b) => b.free - a.free || a.index - b.index)
    .map((entry) => entry.listing);
}
