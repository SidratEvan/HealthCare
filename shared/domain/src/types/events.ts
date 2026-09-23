/**
 * The queue event log's shape — a discriminated union over every event type,
 * with the payload contracts from DATABASE.md §3.
 *
 * These types are shared verbatim by the API and the console. That is the
 * mechanism behind FR-QUE-05: if the two sides cannot disagree about what an
 * event *is*, and they run the same reducer, they cannot disagree about what
 * the queue looks like.
 */

import type { QueueEventType, StaffRole } from './enums.js';
import type {
  BookingId,
  ClientEventId,
  PatientId,
  QueueEventId,
  Serial,
  SessionId,
  SlotOfferId,
  StaffUserId,
  Timestamp,
  UserId,
} from './ids.js';

/**
 * Who caused an event (FR-QUE-04).
 *
 * Three kinds, and the distinction carries weight: a staff action is
 * attributable to a person at a counter, a patient action is one a patient
 * took on their own booking, and a system action is a worker doing what it was
 * scheduled to do. An unattributable queue action is what the audit log exists
 * to prevent, so there is no fourth, vaguer option.
 */
export type QueueActor =
  | { readonly kind: 'staff'; readonly staffUserId: StaffUserId; readonly role: StaffRole }
  | { readonly kind: 'patient'; readonly userId: UserId }
  | { readonly kind: 'guest'; readonly bookingId: BookingId }
  | { readonly kind: 'system'; readonly job: string };

/** Fields every event carries, whatever its type. */
interface QueueEventBase {
  readonly id: QueueEventId;
  readonly sessionId: SessionId;
  /** Authoritative ordering within the session (SY-01). */
  readonly seq: number;
  /** Server clock. Decides order, always. */
  readonly serverTs: Timestamp;
  /**
   * Console clock. May be hours stale after an offline shift, and orders a
   * replayed batch within itself only (FR-QUE-51).
   */
  readonly clientTs: Timestamp | null;
  /** Idempotency key for offline replay (SY-02). Absent for system events. */
  readonly clientEventId: ClientEventId | null;
  readonly actor: QueueActor;
}

// ---------------------------------------------------------------------------
// Payloads — DATABASE.md §3
// ---------------------------------------------------------------------------

export interface SessionOpenedEvent extends QueueEventBase {
  readonly type: 'SESSION_OPENED';
  readonly payload: Record<string, never>;
}

export interface DoctorArrivedEvent extends QueueEventBase {
  readonly type: 'DOCTOR_ARRIVED';
  readonly payload: {
    readonly arrivedAt: Timestamp;
    /** Against the planned start. Negative when the doctor is early. */
    readonly minutesLate: number;
  };
}

export interface DelayDeclaredEvent extends QueueEventBase {
  readonly type: 'DELAY_DECLARED';
  readonly payload: {
    readonly minutes: number;
    readonly reason: string | null;
    readonly declaredBy: 'doctor' | 'reception';
  };
}

export interface SessionPausedEvent extends QueueEventBase {
  readonly type: 'SESSION_PAUSED';
  readonly payload: { readonly reason: string | null };
}

export interface SessionResumedEvent extends QueueEventBase {
  readonly type: 'SESSION_RESUMED';
  readonly payload: Record<string, never>;
}

export interface PatientCalledEvent extends QueueEventBase {
  readonly type: 'PATIENT_CALLED';
  readonly payload: { readonly bookingId: BookingId; readonly serial: Serial };
}

export interface PatientDoneEvent extends QueueEventBase {
  readonly type: 'PATIENT_DONE';
  readonly payload: {
    readonly bookingId: BookingId;
    /** Measured, never typed (FR-REC-11). Feeds the rolling rate. */
    readonly consultSeconds: number;
  };
}

export interface PatientLateEvent extends QueueEventBase {
  readonly type: 'PATIENT_LATE';
  readonly payload: {
    readonly bookingId: BookingId;
    readonly expectedMinutes: number;
    /** k from FR-QUE-21: re-inserted after this many patients, never dropped. */
    readonly reinsertAfter: number;
  };
}

export interface PatientNoShowEvent extends QueueEventBase {
  readonly type: 'PATIENT_NO_SHOW';
  readonly payload: { readonly bookingId: BookingId; readonly graceUsedMinutes: number };
}

export interface PatientReinsertedEvent extends QueueEventBase {
  readonly type: 'PATIENT_REINSERTED';
  readonly payload: { readonly bookingId: BookingId; readonly newPosition: number };
}

/**
 * Reception has seen the patient at the counter (`FR-REC-18`).
 *
 * The arrival time is the event's own `serverTs`, not a payload field: a
 * console queued offline for an hour would otherwise record the moment the
 * receptionist *remembered*, and `FR-ADM-01`'s wait would be measured from it.
 */
export interface PatientArrivedEvent extends QueueEventBase {
  readonly type: 'PATIENT_ARRIVED';
  readonly payload: {
    readonly bookingId: BookingId;
    /**
     * The wait reception told the patient, in minutes (`FR-PAT-38`). Pre-filled
     * from the queue's estimate and adjustable at the counter.
     */
    readonly quotedWaitMinutes: number;
  };
}

export interface WalkinAddedEvent extends QueueEventBase {
  readonly type: 'WALKIN_ADDED';
  readonly payload: {
    readonly bookingId: BookingId;
    readonly position: 'end' | 'index';
    readonly index: number | null;
    /** Required when `position` is `index` (FR-REC-14). */
    readonly reason: string | null;
  };
}

export interface BookingCancelledEvent extends QueueEventBase {
  readonly type: 'BOOKING_CANCELLED';
  readonly payload: { readonly bookingId: BookingId; readonly reason: string | null };
}

export interface SlotOfferedEvent extends QueueEventBase {
  readonly type: 'SLOT_OFFERED';
  readonly payload: {
    readonly offerId: SlotOfferId;
    readonly freedBookingId: BookingId;
    readonly offeredTo: readonly PatientId[];
    readonly expiresAt: Timestamp;
  };
}

export interface SlotAcceptedEvent extends QueueEventBase {
  readonly type: 'SLOT_ACCEPTED';
  readonly payload: { readonly offerId: SlotOfferId; readonly newBookingId: BookingId };
}

export interface SlotExpiredEvent extends QueueEventBase {
  readonly type: 'SLOT_EXPIRED';
  readonly payload: { readonly offerId: SlotOfferId };
}

export interface PriorityReorderedEvent extends QueueEventBase {
  readonly type: 'PRIORITY_REORDERED';
  readonly payload: {
    readonly bookingId: BookingId;
    readonly fromIndex: number;
    readonly toIndex: number;
    /** Mandatory, and recorded in the audit log (FR-REC-15). */
    readonly reason: string;
  };
}

export interface SessionEndedEvent extends QueueEventBase {
  readonly type: 'SESSION_ENDED';
  readonly payload: { readonly reason: string | null };
}

export interface ActionUndoneEvent extends QueueEventBase {
  readonly type: 'ACTION_UNDONE';
  readonly payload: { readonly undoneEventId: QueueEventId };
}

/**
 * Every fact that can be recorded about a session.
 *
 * Exhaustiveness over this union is lint-enforced, so adding a member forces
 * every consumer to decide what it means rather than silently ignoring it.
 */
export type QueueEvent =
  | SessionOpenedEvent
  | DoctorArrivedEvent
  | DelayDeclaredEvent
  | SessionPausedEvent
  | SessionResumedEvent
  | PatientCalledEvent
  | PatientDoneEvent
  | PatientLateEvent
  | PatientNoShowEvent
  | PatientReinsertedEvent
  | PatientArrivedEvent
  | WalkinAddedEvent
  | BookingCancelledEvent
  | SlotOfferedEvent
  | SlotAcceptedEvent
  | SlotExpiredEvent
  | PriorityReorderedEvent
  | SessionEndedEvent
  | ActionUndoneEvent;

/** Narrows a `QueueEvent` to one type. */
export type QueueEventOf<T extends QueueEventType> = Extract<QueueEvent, { type: T }>;

/**
 * Event types that name a single booking, which the database also enforces
 * (`queue_events_patient_events_have_booking`).
 */
export const BOOKING_SCOPED_EVENT_TYPES = [
  'PATIENT_CALLED',
  'PATIENT_DONE',
  'PATIENT_LATE',
  'PATIENT_NO_SHOW',
  'PATIENT_REINSERTED',
  'PATIENT_ARRIVED',
  'WALKIN_ADDED',
  'BOOKING_CANCELLED',
  'PRIORITY_REORDERED',
] as const satisfies readonly QueueEventType[];

/** The booking an event is about, or null for session-wide events. */
export function bookingIdOf(event: QueueEvent): BookingId | null {
  switch (event.type) {
    case 'PATIENT_CALLED':
    case 'PATIENT_DONE':
    case 'PATIENT_LATE':
    case 'PATIENT_NO_SHOW':
    case 'PATIENT_REINSERTED':
    case 'PATIENT_ARRIVED':
    case 'WALKIN_ADDED':
    case 'BOOKING_CANCELLED':
    case 'PRIORITY_REORDERED':
      return event.payload.bookingId;
    case 'SLOT_OFFERED':
      return event.payload.freedBookingId;
    case 'SLOT_ACCEPTED':
      return event.payload.newBookingId;
    case 'SESSION_OPENED':
    case 'DOCTOR_ARRIVED':
    case 'DELAY_DECLARED':
    case 'SESSION_PAUSED':
    case 'SESSION_RESUMED':
    case 'SLOT_EXPIRED':
    case 'SESSION_ENDED':
    case 'ACTION_UNDONE':
      return null;
  }
}

/**
 * Material events — the ones a waiting patient is told about even when their
 * app is closed (FR-QUE-42, FR-NOT-03). SMS costs money, so this list is short
 * on purpose.
 */
export const MATERIAL_EVENT_TYPES = [
  'DOCTOR_ARRIVED',
  'DELAY_DECLARED',
  'PATIENT_CALLED',
  'PATIENT_NO_SHOW',
  'SLOT_OFFERED',
  'BOOKING_CANCELLED',
  'SESSION_ENDED',
] as const satisfies readonly QueueEventType[];

export function isMaterialEvent(type: QueueEventType): boolean {
  return (MATERIAL_EVENT_TYPES as readonly QueueEventType[]).includes(type);
}
