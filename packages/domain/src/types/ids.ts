/**
 * Branded identifiers.
 *
 * Every id in this system is a UUID, which means every id is assignable to
 * every other id as far as the compiler is concerned. That is a real hazard
 * here: `appendEvent` takes a session id and a booking id side by side, and
 * `offerFreedSlot` takes a session id and a freed booking id. Swapping two
 * arguments of the same type is the kind of mistake that produces a plausible
 * query returning nothing, not a crash.
 *
 * Branding costs nothing at runtime — the brand exists only in the type — and
 * turns those swaps into compile errors.
 */

declare const brand: unique symbol;

/** A primitive tagged with a nominal type. */
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type HospitalId = Brand<string, 'HospitalId'>;
export type DepartmentId = Brand<string, 'DepartmentId'>;
export type DoctorId = Brand<string, 'DoctorId'>;
export type DoctorHospitalId = Brand<string, 'DoctorHospitalId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type SessionTemplateId = Brand<string, 'SessionTemplateId'>;
export type BookingId = Brand<string, 'BookingId'>;
export type PatientId = Brand<string, 'PatientId'>;
export type UserId = Brand<string, 'UserId'>;
export type GuestId = Brand<string, 'GuestId'>;
export type StaffUserId = Brand<string, 'StaffUserId'>;
export type QueueEventId = Brand<string, 'QueueEventId'>;
export type SlotOfferId = Brand<string, 'SlotOfferId'>;
export type ClientEventId = Brand<string, 'ClientEventId'>;

/**
 * An ISO-8601 instant in UTC (DB-P4).
 *
 * Carried as a string rather than a `Date` because these values cross the wire
 * in realtime payloads and offline batches, and a `Date` that has survived
 * `JSON.parse` is a string wearing a costume. Conversion happens at the edges,
 * through the helpers in `util/time.ts`.
 */
export type Timestamp = Brand<string, 'Timestamp'>;

/** A local calendar date in Asia/Dhaka, `YYYY-MM-DD` (see `util/time.ts`). */
export type DhakaDate = Brand<string, 'DhakaDate'>;

/** Money as an integer count of poisha. 1 BDT = 100 poisha (DB-P5). */
export type Poisha = Brand<number, 'Poisha'>;

/**
 * Per-session position number — the one identifier in this product a person
 * reads aloud in a corridor.
 */
export type Serial = Brand<number, 'Serial'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` is shaped like a UUID. Does not check the version. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * Tags a string as an id of a particular kind.
 *
 * Deliberately unchecked and deliberately verbose to type. It marks the
 * boundary where a plain string from a request, a row or a test becomes a
 * domain id, and those boundaries should be few and obvious. Inside the domain
 * an id is already branded and this is never needed.
 */
export function id<T extends string>(value: string): T {
  return value as T;
}

/** Tags a number as a serial. */
export function serial(value: number): Serial {
  return value as Serial;
}

/** Tags an ISO-8601 UTC string as a Timestamp. */
export function timestamp(value: string): Timestamp {
  return value as Timestamp;
}
