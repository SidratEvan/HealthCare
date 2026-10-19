/** Derived presentation only; domain rules still own transitions (FR-BED-01..07). */
import { canApply, effectiveState } from '@platform/domain';

export const WARD_STATES = ['free', 'occupied', 'reserved', 'cleaning', 'out_of_service'];

/** GR-01: a review cannot confirm a bed changed by another desk. Server guards remain authoritative. */
export function canConfirmAdmission(bed, reviewedVersion, at) {
  return bed.version === reviewedVersion && canApply(bed, 'admit', at, { bedRequestId: null }).ok;
}

export function wardStateCounts(beds, at) {
  const counts = {
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
export function wardAttention(beds, at) {
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
