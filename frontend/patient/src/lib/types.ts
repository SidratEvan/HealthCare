/**
 * The shapes discovery returns.
 *
 * Declared here rather than imported from the API package: `frontend/` may not
 * import `backend/` (the layering rule in `shared/config/eslint`), and that
 * boundary is the point — the wire contract is what both sides agree on, and
 * writing it down twice is how a breaking change gets noticed at compile time
 * rather than in a browser.
 */

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
