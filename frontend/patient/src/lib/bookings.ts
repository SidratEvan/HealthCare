'use client';

/**
 * The serials this device has booked.
 *
 * ## Why this exists at all
 *
 * `S-A-09` My serials lists a person's bookings, and `GET /me/bookings` is the
 * endpoint that would answer it — for an account. There are no accounts:
 * authentication is deferred to Supabase Auth (`CLAUDE.md` §4.1), so a guest
 * has no identity the server can list against beyond the single booking each
 * tracking link names.
 *
 * `APP_FLOW.md` A1.5 already describes the consequence and accepts it:
 * multi-device access for a guest is "only via the SMS link". So the honest
 * implementation of a serials tab in this version is *this device's* bookings,
 * and the screen says so in as many words rather than implying it has
 * somebody's whole history.
 *
 * ## Why the token is stored and why that is acceptable
 *
 * The tracking token is a credential (`FR-GST-05`). It is already in an SMS on
 * the same phone, and it is scoped to one booking, revocable, and expiring —
 * holding it in this origin's `localStorage` puts it nowhere it was not
 * already. What it buys is a serials tab that works, and a home screen that
 * can show a live position without asking the person to find a text message.
 *
 * When Supabase Auth lands, this file is replaced by a call to
 * `GET /me/bookings` and the storage is cleared.
 */

const KEY = 'patient.bookings';

/** Bookings older than this are dropped on write, with their tokens. */
const KEEP_DAYS = 30;

export interface SavedBooking {
  readonly bookingId: string;
  readonly serial: number;
  readonly sessionId: string;
  readonly doctorNameBn: string;
  readonly hospitalNameBn: string;
  /**
   * English names, for the language switch (`SEG-A00-LANG`). Optional because
   * a record saved on this phone before they existed does not have them, and
   * `localName` falls back to the Bangla.
   */
  readonly doctorNameEn?: string;
  readonly hospitalNameEn?: string;
  /**
   * Which hospital the chamber is at. Optional because a record saved before
   * this existed does not have it. It is what lets an app open for one
   * hospital show that hospital's serials only (`FR-BRD-02`).
   */
  readonly hospitalId?: string;
  /** The session's planned start, ISO. */
  readonly plannedStart: string;
  /** `/s?b=…&t=…` — where the live screen opens. */
  readonly url: string;
  /** The opaque tracking token, for reading this booking's live state. */
  readonly token: string;
  readonly savedAt: string;
}

/** A saved booking with the one question every screen asks of it. */
export interface DatedBooking extends SavedBooking {
  readonly isToday: boolean;
  readonly isPast: boolean;
}

/**
 * Everything this device has booked, newest first.
 *
 * Every read is wrapped: `localStorage` throws in a private window and in a
 * browser with site data blocked, and a serials tab that crashes is worse than
 * one that is empty.
 */
export function recentBookings(): readonly DatedBooking[] {
  let saved: SavedBooking[];

  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    saved = raw === null || raw === undefined ? [] : (JSON.parse(raw) as SavedBooking[]);
  } catch {
    return [];
  }

  if (!Array.isArray(saved)) return [];

  const today = dhakaDate(new Date());

  return saved
    .filter((entry) => typeof entry?.bookingId === 'string')
    .map((entry) => {
      const day = dhakaDate(new Date(entry.plannedStart));
      return { ...entry, isToday: day === today, isPast: day < today };
    })
    .sort((a, b) => b.plannedStart.localeCompare(a.plannedStart));
}

/**
 * The bookings an app should show for its scope (`FR-BRD-02`, `FR-PAT-19`).
 *
 * The network's own app shows everything this phone booked. An app open for
 * one hospital shows that hospital's only — a hospital's app listing a serial
 * at another hospital is the one thing a branded app must not do. A booking
 * saved before `hospitalId` existed cannot be placed, so it is left out of a
 * scoped app rather than guessed into it.
 *
 * `scopedHospitalId`: null for the network's app; undefined while the app is
 * scoped but does not yet know to which hospital (the answer is on its way),
 * in which case nothing is shown rather than everything.
 */
export function bookingsInScope<T extends SavedBooking>(
  bookings: readonly T[],
  scopedHospitalId: string | null | undefined,
): readonly T[] {
  if (scopedHospitalId === null) return bookings;
  if (scopedHospitalId === undefined) return [];
  return bookings.filter((booking) => booking.hospitalId === scopedHospitalId);
}

/** Records a booking this device just made. */
export function rememberBooking(booking: SavedBooking): void {
  try {
    const cutoff = Date.now() - KEEP_DAYS * 86_400_000;

    const kept = recentBookings()
      .filter((entry) => Date.parse(entry.savedAt) > cutoff)
      .filter((entry) => entry.bookingId !== booking.bookingId)
      .map(({ isToday, isPast, ...rest }) => {
        void isToday;
        void isPast;
        return rest;
      });

    globalThis.localStorage?.setItem(KEY, JSON.stringify([booking, ...kept]));
  } catch {
    // A phone that cannot remember still books. The tracking link in the SMS
    // is the durable copy, and always was (`FR-GST-05`).
  }
}

/**
 * Whether a chamber's planned start is today or on an earlier day, in Dhaka.
 * The one question `DatedBooking` answers, for a booking that did not come
 * from this phone's own list (an account's, from the server; plan F1).
 */
export function dayOf(plannedStart: string): {
  readonly isToday: boolean;
  readonly isPast: boolean;
} {
  const today = dhakaDate(new Date());
  const day = dhakaDate(new Date(plannedStart));
  return { isToday: day === today, isPast: day < today };
}

// ---------------------------------------------------------------------------
// Links this phone holds for an account's bookings (plan F1)
// ---------------------------------------------------------------------------
//
// A signed-in patient's serials are listed by the server, on any phone. Opening
// one's live screen takes a tracking link, and a link is given once: only its
// hash is kept (`FR-GST-05`). So a phone that asked for one keeps it, beside
// the bookings it made itself, and does not ask again. What is kept is what an
// SMS on the same phone already holds, for one booking, until it runs out.

const LINKS_KEY = 'patient.bookings.links';

/** As many as My serials lists; the oldest goes first. */
const LINKS_KEPT = 100;

function readLinks(): Record<string, string> {
  try {
    const raw = globalThis.localStorage?.getItem(LINKS_KEY);
    const parsed: unknown = raw === null || raw === undefined ? {} : JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** The link token this phone holds for a booking, from either list; null for none. */
export function linkHeldFor(bookingId: string): string | null {
  const own = recentBookings().find((entry) => entry.bookingId === bookingId);
  if (own !== undefined && own.token !== '') return own.token;
  const held = readLinks()[bookingId];
  return typeof held === 'string' && held !== '' ? held : null;
}

/** Keeps a link this phone was given for one of the account's bookings. */
export function rememberLink(bookingId: string, token: string): void {
  try {
    const links = Object.entries({ ...readLinks(), [bookingId]: token });
    globalThis.localStorage?.setItem(
      LINKS_KEY,
      JSON.stringify(Object.fromEntries(links.slice(-LINKS_KEPT))),
    );
  } catch {
    // A phone that cannot remember asks again next time.
  }
}

/** Forgets every kept link: at sign-out, they were that account's. */
export function forgetLinks(): void {
  try {
    globalThis.localStorage?.removeItem(LINKS_KEY);
  } catch {
    // Nothing was kept that could be forgotten.
  }
}

/** Where a booking's live screen opens: with the link this phone holds, or asking for one. */
export function liveUrlFor(bookingId: string): string {
  const token = linkHeldFor(bookingId);
  return token === null ? `/s?b=${bookingId}` : `/s?b=${bookingId}&t=${encodeURIComponent(token)}`;
}

/** The calendar day of an instant in Dhaka, `YYYY-MM-DD`. */
function dhakaDate(at: Date): string {
  if (Number.isNaN(at.getTime())) return '';

  // `en-CA` formats as YYYY-MM-DD, which sorts and compares as a string.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
