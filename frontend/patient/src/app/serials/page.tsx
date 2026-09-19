'use client';

/**
 * `S-A-09` My serials (`APP_FLOW.md` A5).
 *
 * "Today section — active bookings, each → `S-A-08`. Upcoming section. Past
 * section."
 *
 * ## Whose serials these are
 *
 * This device's. `GET /me/bookings` is the endpoint that would answer the
 * question properly, and it answers it for an *account* — of which there are
 * none, because authentication is deferred to Supabase Auth (`CLAUDE.md`
 * §4.1). A guest's identity, as far as the server is concerned, is one
 * tracking link per booking.
 *
 * `APP_FLOW.md` A1.5 already states the consequence and accepts it: for a
 * guest, multi-device access is "only via the SMS link". So the screen shows
 * what this phone booked and **says so on the screen**, rather than implying
 * it holds somebody's history and quietly losing half of it when they pick up
 * a different phone.
 */

import { useEffect, useState } from 'react';

import { formatDateTime, formatSerial, tp } from '@platform/i18n';
import { Card } from '@platform/ui';

import { ChevronIcon } from '@/components/icons';
import { TabScreen } from '@/components/TabScreen';
import { recentBookings, type DatedBooking } from '@/lib/bookings';

import type { ReactNode } from 'react';

const LOCALE = 'bn' as const;
const NUMERALS = 'bengali' as const;

export default function SerialsPage(): ReactNode {
  const [bookings, setBookings] = useState<readonly DatedBooking[] | null>(null);

  // Read after mount: `localStorage` does not exist on the server, and reading
  // it during render makes the first client render disagree with it.
  useEffect(() => {
    setBookings(recentBookings());
  }, []);

  const today = bookings?.filter((entry) => entry.isToday) ?? [];
  const upcoming = bookings?.filter((entry) => !entry.isToday && !entry.isPast) ?? [];
  const past = bookings?.filter((entry) => entry.isPast) ?? [];

  return (
    <TabScreen title={tp('mySerials', LOCALE)}>
      {bookings === null ? (
        // GR-03 loading: the shape of the answer, never a spinner.
        <div className="flex flex-col gap-3" aria-busy="true">
          <div className="h-24 rounded-md bg-sunken" />
          <div className="h-24 rounded-md bg-sunken" />
        </div>
      ) : bookings.length === 0 ? (
        <div
          data-testid="serials-empty"
          className="flex flex-col gap-3 rounded-md border border-line bg-surface p-5"
        >
          <p className="text-body-md text-ink-secondary">{tp('noSerials', LOCALE)}</p>
          <a
            href="/"
            className="flex min-h-touch items-center justify-center rounded-md bg-brand-600 px-5 text-body-lg font-semibold text-white"
          >
            {tp('seeADoctor', LOCALE)}
          </a>
        </div>
      ) : (
        <>
          <Section title={tp('serialsToday', LOCALE)} bookings={today} live />
          <Section title={tp('serialsUpcoming', LOCALE)} bookings={upcoming} />
          <Section title={tp('serialsPast', LOCALE)} bookings={past} />

          {/* The honest caveat, on the screen rather than in a comment. */}
          <p className="text-caption text-ink-muted">{tp('serialsOnThisDevice', LOCALE)}</p>
        </>
      )}
    </TabScreen>
  );
}

function Section({
  title,
  bookings,
  live = false,
}: {
  readonly title: string;
  readonly bookings: readonly DatedBooking[];
  readonly live?: boolean;
}): ReactNode {
  if (bookings.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-title-sm">{title}</h2>

      <ul className="flex flex-col gap-3">
        {bookings.map((booking) => (
          <li key={booking.bookingId}>
            <a href={booking.url} data-testid={`serial-${booking.bookingId}`}>
              <Card tone={live ? 'brand' : 'default'}>
                <div className="flex items-center gap-3">
                  <span
                    className={`flex size-11 shrink-0 items-center justify-center rounded-pill text-title-sm font-bold tabular-nums ${
                      live ? 'bg-brand-600 text-white' : 'bg-sunken text-ink'
                    }`}
                  >
                    {formatSerial(booking.serial, NUMERALS)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-lg font-semibold">{booking.doctorNameBn}</p>
                    <p className="truncate text-body-sm text-ink-muted">{booking.hospitalNameBn}</p>
                    <p className="text-body-sm tabular-nums text-ink-secondary">
                      {formatDateTime(booking.plannedStart, NUMERALS)}
                    </p>
                  </div>

                  <span className="text-brand-600">
                    <ChevronIcon size={18} />
                  </span>
                </div>
              </Card>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
