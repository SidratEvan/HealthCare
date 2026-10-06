/**
 * Where each booking this phone holds stands, asked of the server
 * (`PRD.md` `FR-PAT-39`, `FR-QUE-06`; `APP_FLOW.md` `BTN-A02-ACTIVE`,
 * `S-A-09`).
 *
 * Home's strip and My serials used to decide by the calendar: a booking dated
 * today was live, one dated yesterday was past. That is wrong for a chamber
 * that runs or is paused past midnight — a patient still waiting at 00:01
 * lost their serial from the first screen at exactly the moment they were
 * most anxious about it.
 *
 * So the date decides nothing here. Each booking's tracking link is opened
 * and the answer says where it stands (`bookingStanding`, `shared/domain`):
 *
 * - **current**: unresolved, in a session that has not ended;
 * - **upcoming**: current, in a session on a later day;
 * - **past**: seen, cancelled, the session ended — or the link no longer
 *   opens, which the server says only once the chamber has closed or the
 *   booking has been given up;
 * - **unknown**: the server could not be asked. It is not filed under past
 *   and not shown as fresh: it stays where it was, marked, with the age of
 *   the last answer the phone has.
 *
 * What the phone last learned is kept beside the bookings, so that "unknown"
 * can say how old its knowledge is, and so that a booking known to be past is
 * not asked about again: past does not change.
 */

import { ApiError } from '@platform/client';
import { bookingStanding } from '@platform/domain';

import { openTrackingLink } from '@/lib/api';

import type { DatedBooking } from '@/lib/bookings';

const KEY = 'patient.bookings.standing';

export type Standing = 'current' | 'upcoming' | 'past' | 'unknown';

export interface StoodBooking extends DatedBooking {
  readonly standing: Standing;
  /**
   * When the server last answered for this booking, ISO. Null when it never
   * has. For `unknown` this is the age the screen shows.
   */
  readonly knownAt: string | null;
  /** The serial being seen now, when the answer said. */
  readonly nowServing: number | null;
}

interface Known {
  readonly standing: 'current' | 'past';
  readonly at: string;
}

function readKnown(): Record<string, Known> {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const parsed: unknown = raw === null || raw === undefined ? {} : JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, Known>) : {};
  } catch {
    return {};
  }
}

function writeKnown(known: Record<string, Known>, keep: ReadonlySet<string>): void {
  try {
    // Only for bookings the phone still holds: the list is what bounds this.
    const kept = Object.fromEntries(Object.entries(known).filter(([id]) => keep.has(id)));
    globalThis.localStorage?.setItem(KEY, JSON.stringify(kept));
  } catch {
    // A phone that cannot remember still asks, every time.
  }
}

/**
 * The link no longer opens: the server answered, and its answer is that there
 * is nothing live behind this link any more (`GUEST_LINK_EXPIRED`, 410; a
 * link lasts until its chamber has closed, or until the booking is given up).
 * Anything else — no network, a server error, a limit — is not an answer.
 */
function linkIsOver(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 410 || error.status === 404);
}

/** By the calendar, which is only good enough for a guess while nothing is known. */
function byDate(booking: DatedBooking): Standing {
  if (booking.isToday) return 'current';
  return booking.isPast ? 'unknown' : 'upcoming';
}

/**
 * The first paint, before the server has answered.
 *
 * What the phone already learned is used; a booking it knows to be past is
 * past. One it has never had an answer for is placed by its date, except one
 * from an earlier day, which is not assumed past: it is unknown until asked.
 */
export function standingFromMemory(bookings: readonly DatedBooking[]): StoodBooking[] {
  const known = readKnown();
  return bookings.map((booking) => {
    const last = known[booking.bookingId];
    if (last === undefined) {
      return { ...booking, standing: byDate(booking), knownAt: null, nowServing: null };
    }
    const standing: Standing =
      last.standing === 'past'
        ? 'past'
        : booking.isToday || booking.isPast
          ? 'current'
          : 'upcoming';
    return { ...booking, standing, knownAt: last.at, nowServing: null };
  });
}

/** Asks the server about every booking not already known to be past. */
export async function standingOf(bookings: readonly DatedBooking[]): Promise<StoodBooking[]> {
  const known = readKnown();

  const stood = await Promise.all(
    bookings.map(async (booking): Promise<StoodBooking> => {
      const last = known[booking.bookingId];
      if (last?.standing === 'past') {
        return { ...booking, standing: 'past', knownAt: last.at, nowServing: null };
      }

      try {
        const view = await openTrackingLink(booking.token);
        const mine = view.state.entries.find((entry) => entry.bookingId === booking.bookingId);
        const standing = bookingStanding(view.state.status, mine?.status ?? 'cancelled');
        known[booking.bookingId] = { standing, at: view.serverTs };

        const serving = view.state.entries.find((entry) => entry.status === 'in_chamber');
        return {
          ...booking,
          // Current, on a later day: it is coming, not happening.
          standing:
            standing === 'past'
              ? 'past'
              : booking.isToday || booking.isPast
                ? 'current'
                : 'upcoming',
          knownAt: view.serverTs,
          nowServing: serving?.serial ?? null,
        };
      } catch (error: unknown) {
        if (linkIsOver(error)) {
          const at = new Date().toISOString();
          known[booking.bookingId] = { standing: 'past', at };
          return { ...booking, standing: 'past', knownAt: at, nowServing: null };
        }
        // Could not be asked. A later day's booking is still coming; anything
        // else is unknown, with the age of the last answer, and never past.
        return {
          ...booking,
          standing: booking.isToday || booking.isPast ? 'unknown' : 'upcoming',
          knownAt: last?.at ?? null,
          nowServing: null,
        };
      }
    }),
  );

  writeKnown(known, new Set(bookings.map((booking) => booking.bookingId)));
  return stood;
}
