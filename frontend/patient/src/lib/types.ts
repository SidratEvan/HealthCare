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

import type {
  BedKind,
  EmergencyProblem,
  EmergencyState,
  Eta,
  PublicCapacity,
  QueueState,
} from '@platform/domain';

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
  /**
   * The published bed figures (`FR-PAT-14`), from `v_public_hospital_capacity`.
   * Each kind carries its own `asOf`; a hospital with no inpatient beds has
   * `bedTotal` 0 and an empty `byKind`, which is not the same as none free.
   */
  readonly beds: PublicCapacity | null;
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

/**
 * A list that is loading, loaded, or could not be fetched.
 *
 * `GR-03` asks for four states and the third one is the reason this type exists:
 * an empty array and a failed request render the same way unless they are
 * different values, and "no hospital offers this department" is a very different
 * thing to tell somebody than "we could not reach the server".
 */
export type Loadable<T> =
  | { readonly state: 'loading' }
  | { readonly state: 'failed' }
  | ({ readonly state: 'ready' } & StampedList<T>);

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
  /** Whom the booking is for — what a consent offer names (`FR-PAT-63`). */
  readonly patientId: string;
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

/** One consultation, as `S-A-12`'s timeline shows it. */
export interface VisitRecord {
  readonly id: string;
  readonly bookingId: string;
  readonly diagnosisText: string | null;
  readonly adviceTextBn: string | null;
  readonly followUpDate: string | null;
  readonly signedAt: string | null;
  readonly doctorNameBn: string;
  readonly departmentNameBn: string;
  readonly hospitalNameBn: string;
  readonly serial: number;
  readonly visitedAt: string;
}

/** What the tracking link hands back, plus the token it exchanges for. */
export interface TrackingLinkView extends BookingView {
  readonly token: string;
  readonly expiresInSeconds: number;
  /**
   * The signed record for this booking, once the doctor has written one.
   *
   * `FR-GST-08`: records are "downloadable from the tracking link for a limited
   * period". Null before the visit, which is most of the link's life.
   */
  readonly record: VisitRecord | null;
  /**
   * The tests ordered during this booking's consultation (`TAB-A12-REP`).
   *
   * Scoped to the booking, like `record`: a link is what one visit produced,
   * never everything the person has ever been tested for.
   */
  readonly tests: readonly TestOrder[];
}

/** One ordered test, and its report once the lab has delivered one. */
export interface TestOrder {
  readonly id: string;
  readonly testCode: string;
  readonly testName: string;
  readonly state:
    'ordered' | 'sample_collected' | 'processing' | 'report_ready' | 'delivered' | 'cancelled';
  readonly pricePoisha: number;
  readonly orderedAt: string;
  readonly readyAt: string | null;
  readonly deliveredAt: string | null;
  readonly report: {
    readonly id: string;
    readonly fileType: string | null;
    readonly uploadedAt: string;
    readonly deliveredToWalletAt: string | null;
  } | null;
}

/** One pharmacy's answer about one medicine (`FR-PHR-02`). */
export interface PharmacyAnswer {
  readonly hospitalId: string;
  readonly hospitalNameBn: string;
  readonly hospitalNameEn: string;
  /** Kilometres, when the app knew where the person was. */
  readonly distanceKm: number | null;
  /** Never folded together: unknown is its own answer (`PRD.md` §3.2). */
  readonly answer: 'in_stock' | 'out_of_stock' | 'unknown';
  readonly freshness: {
    readonly asOf: string | null;
    readonly ageMinutes: number | null;
    readonly stale: boolean;
  };
}

/** One medicine, and everywhere a patient could look for it. */
export interface MedicineAvailability {
  readonly medicineId: string;
  readonly genericName: string;
  readonly brandName: string | null;
  readonly form: string | null;
  readonly pharmacies: readonly PharmacyAnswer[];
  /** Counts, so the screen never reaches a verdict (`GR-05`). */
  readonly summary: {
    readonly inStock: number;
    readonly outOfStock: number;
    readonly unknown: number;
  };
}

/** `BTN-A12-QR` — what the doctor types in, and how long it lasts. */
export interface ConsentOffer {
  readonly code: string;
  readonly expiresInSeconds: number;
  /** How long the hospital may look once the doctor enters it. */
  readonly grantHours: number;
}

/** One grant a patient has made (`FR-PAT-64`). */
export interface ConsentGrant {
  readonly id: string;
  readonly hospitalId: string;
  readonly hospitalNameBn: string;
  readonly scope: string;
  readonly grantedAt: string;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly grantedVia: string;
}

/** One staff read of the record (`FR-SEC-03`). */
export interface AccessView {
  readonly at: string;
  readonly hospitalNameBn: string | null;
  readonly staffName: string | null;
}

/** `BTN-A12-ACCESS` — the grants, and who looked. */
export interface AccessLog {
  readonly consents: readonly ConsentGrant[];
  readonly views: readonly AccessView[];
}

/**
 * A family's view of their bed request (`S-A-11` request status, `FR-PAT-52`).
 *
 * `state` already accounts for a hold that has run out: the server says
 * `expired` the moment the hold lapses, whether or not the ward has opened its
 * board since.
 */
export interface BedRequestView {
  readonly id: string;
  readonly state: 'requested' | 'held' | 'confirmed' | 'declined' | 'expired';
  readonly bedKind: BedKind;
  readonly hospitalId: string;
  readonly hospitalNameBn: string;
  readonly hospitalNameEn: string;
  readonly hospitalPhone: string | null;
  readonly holdExpiresAt: string | null;
  readonly respondedAt: string | null;
  readonly createdAt: string;
  readonly serverTs: string;
}

// ---------------------------------------------------------------------------
// Emergency (`S-A-10b`, `S-A-10c`; BACKEND.md §7.5)
// ---------------------------------------------------------------------------

/** One result card (`CARD-A10-<hospitalId>`, `FR-PAT-44`). */
export interface EmergencyResult {
  readonly hospitalId: string;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly addressBn: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly emergencyPhone: string | null;
  readonly distanceKm: number | null;
  /** An estimate; null without a position. */
  readonly travelMinutes: number | null;
  /** Null when the problem needs no particular capability. */
  readonly hasCapability: boolean | null;
  readonly erLoad: number;
  /** Free beds of `bedKind`, or of every kind when that is null. */
  readonly freeBeds: number | null;
  readonly bedKind: BedKind | null;
  readonly icuTotal: number | null;
  readonly icuFree: number | null;
  /** The ICU figure's own age: shown, not ranked on. */
  readonly icuAsOf: string | null;
  readonly freshness: {
    readonly asOf: string | null;
    readonly ageMinutes: number | null;
    readonly stale: boolean;
  };
  readonly staleAfterMinutes: number;
}

export interface EmergencySearchResult {
  readonly problem: EmergencyProblem | null;
  readonly requiredCapability: string | null;
  readonly origin: 'position' | 'hospital' | 'none';
  readonly results: readonly EmergencyResult[];
  readonly serverTs: string;
}

/** The family's view of the alert they sent (`S-A-10c`). */
export interface EmergencyCaseStatus {
  readonly id: string;
  readonly state: EmergencyState;
  readonly problem: EmergencyProblem;
  readonly inboundAt: string | null;
  readonly inboundEtaMinutes: number | null;
  readonly acknowledgedAt: string | null;
  readonly arrivedAt: string | null;
  readonly closedAt: string | null;
  readonly declineReason: string | null;
  readonly hospital: {
    readonly id: string;
    readonly nameBn: string;
    readonly nameEn: string;
    readonly addressBn: string | null;
    readonly lat: number | null;
    readonly lng: number | null;
    readonly emergencyPhone: string | null;
  };
  readonly serverTs: string;
}

export interface InboundResult {
  readonly case: EmergencyCaseStatus;
  readonly token: string;
  readonly trackUrl: string;
  readonly duplicate: boolean;
}
