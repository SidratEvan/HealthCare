/** Derived presentation only; domain rules still own transitions (FR-BED-01..07). */
import {
  canApply,
  effectiveState,
  type BedState,
  type BedView,
  type Timestamp,
} from '@platform/domain';

export const WARD_STATES = ['free', 'occupied', 'reserved', 'cleaning', 'out_of_service'] as const;

/** GR-01: a review cannot confirm a bed changed by another desk. Server guards remain authoritative. */
export function canConfirmAdmission(
  bed: BedView,
  reviewedVersion: number | null,
  at: Timestamp,
): boolean {
  return bed.version === reviewedVersion && canApply(bed, 'admit', at, { bedRequestId: null }).ok;
}

export function wardStateCounts(beds: readonly BedView[], at: Timestamp): Record<BedState, number> {
  const counts: Record<BedState, number> = {
    free: 0,
    occupied: 0,
    reserved: 0,
    cleaning: 0,
    out_of_service: 0,
  };
  for (const bed of beds) counts[effectiveState(bed, at)] += 1;
  return counts;
}

/** A reminder is never an automatic cleaning completion or a new hold. */
export function wardAttention(beds: readonly BedView[], at: Timestamp): readonly BedView[] {
  const now = Date.parse(at);
  return beds.filter((bed) => {
    const state = effectiveState(bed, at);
    return (
      (state === 'cleaning' && now - Date.parse(bed.stateChangedAt) >= 30 * 60_000) ||
      (state === 'reserved' &&
        bed.reservedUntil !== null &&
        Date.parse(bed.reservedUntil) - now <= 30 * 60_000)
    );
  });
}
