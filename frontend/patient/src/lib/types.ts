/**
 * The shapes discovery and the live serial screen return.
 *
 * Declared here rather than imported from the API package: `frontend/` may not
 * import `backend/` (the layering rule in `shared/config/eslint`), and that
 * boundary is the point — the wire contract is what both sides agree on, and
 * writing it down twice is how a breaking change gets noticed at compile time
 * rather than in a browser.
 *
 * `QueueState` and `Eta` are the exception, and deliberately so: they come from
 * `shared/domain`, which is neither frontend nor backend — it is the one
 * definition of the queue that both sides run (`FR-QUE-05`). Re-declaring
 * those here would be re-implementing the queue.
 */

import type { Eta, QueueState } from '@platform/domain';

export interface HospitalCard {
  readonly id: string;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly kind: string;
  readonly district: string;
  readonly thana: string | null;
  readonly distanceKm: number | null;
  readonly capabilities: readonly string[];
  readonly capabilityAsOf: string | null;
  /** Doctors here in the specialty asked for; null when none was (`S-A-07`). */
  readonly doctorCount: number | null;
  readonly sittingNow: number;
  readonly openSerialsToday: number;
}

/**
 * A list of live cards and when the server read them.
 *
 * `FR-PAT-14`: a live figure never appears without its age. Both `S-A-07` and
 * `S-A-05h` carry counts that change through the day, so both lists are
 * stamped and both render a `<FreshnessLine>`.
 */
export interface StampedList<T> {
  readonly items: readonly T[];
  readonly asOf: string;
}

/** A doctor on `S-A-05h`'s ডাক্তার tab. */
export interface HospitalDoctorCard {
  readonly id: string;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly degrees: string | null;
  readonly departmentCode: string;
  readonly departmentNameBn: string;
  readonly feePoisha: number;
  readonly room: string | null;
  readonly bmdcVerifiedAt: string | null;
  readonly sittingNow: boolean;
  readonly nextSessionAt: string | null;
  readonly openSerials: number | null;
}

export interface DoctorChamber {
  readonly hospitalId: string;
  readonly hospitalNameBn: string;
  readonly hospitalNameEn: string;
  readonly departmentCode: string;
  readonly feePoisha: number;
  readonly room: string | null;
}

export interface DoctorCard {
  readonly id: string;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly degrees: string | null;
  readonly specialties: readonly string[];
  readonly bmdcVerifiedAt: string | null;
  readonly consultMinutes: number;
  readonly chambers: readonly DoctorChamber[];
}

export interface SessionCard {
  readonly id: string;
  readonly hospitalId: string;
  readonly hospitalNameBn: string;
  readonly doctorId: string;
  readonly doctorNameBn: string;
  readonly departmentCode: string;
  readonly sessionDate: string;
  readonly plannedStart: string;
  readonly plannedEnd: string;
  readonly status: string;
  readonly room: string | null;
  readonly feePoisha: number;
  readonly capacity: number | null;
  readonly taken: number;
}

export interface Availability {
  readonly sessionId: string;
  readonly capacity: number | null;
  readonly taken: number;
  readonly remaining: number | null;
  readonly full: boolean;
  readonly nextSerial: number;
  /** Null means unknown, which is not the same as zero (`FR-PAT-13`). */
  readonly expectedWaitMinutes: number | null;
  readonly asOf: string;
}

// ---------------------------------------------------------------------------
// The live serial screen (`S-A-08`)
// ---------------------------------------------------------------------------

/** The booking behind the screen, with the chamber it belongs to. */
export interface BookingDetail {
  readonly id: string;
  readonly sessionId: string;
  readonly serial: number;
  readonly status: string;
  readonly patientName: string;
  readonly feePoisha: number;
  readonly hospitalId: string;
  readonly hospitalNameBn: string;
  readonly hospitalNameEn: string;
  readonly doctorNameBn: string;
  readonly doctorNameEn: string;
  readonly departmentCode: string;
  readonly room: string | null;
  readonly sessionDate: string;
  readonly plannedStart: string;
  readonly plannedEnd: string;
  /** `hospital_settings.stale_threshold_minutes` (`FR-OFF-04`). */
  readonly staleThresholdMinutes: number;
  /**
   * The hospital's recorded refund rule, shown before a cancellation
   * (`FR-PAY-03`).
   *
   * An empty object means none is on file — which the cancel sheet says
   * plainly rather than inventing one (`PRD.md` §3.2). The shape inside is the
   * hospital's own and no document defines it yet.
   */
  readonly refundPolicy: Record<string, unknown>;
}

/** `GET /guest/link/:token` and `GET /bookings/:id`. */
export interface BookingView {
  readonly booking: BookingDetail;
  readonly state: QueueState;
  readonly etas: readonly Eta[];
  /** The age of the figures, for `<FreshnessLine>` (`FR-PAT-35`). */
  readonly freshAt: string;
  readonly serverTs: string;
}

/** What the tracking link hands back, plus the token it exchanges for. */
export interface TrackingLinkView extends BookingView {
  readonly token: string;
  readonly expiresInSeconds: number;
}
