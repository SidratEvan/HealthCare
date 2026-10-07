'use client';

/**
 * `S-A-09` My serials (`APP_FLOW.md` A5).
 *
 * "Today section — active bookings, each → `S-A-08`. Upcoming section. Past
 * section."
 *
 * ## Whose serials these are
 *
 * **Signed in: the account's** (plan F1). `GET /me/bookings` lists the
 * serials of every profile the account owns, wherever they were booked, so
 * the list is the same on every phone. Opening one takes a tracking link;
 * this phone uses the one it holds, and `S-A-08` asks for one when it holds
 * none.
 *
 * **Not signed in: this device's.** A guest's identity, as far as the server
 * is concerned, is one tracking link per booking, and `APP_FLOW.md` A1.5
 * accepts the consequence: for a guest, multi-device access is "only via the
 * SMS link". So the screen shows what this phone booked and **says so on the
 * screen**, rather than implying it holds somebody's history and quietly
 * losing half of it when they pick up a different phone. A signed-in patient
 * whose server cannot be reached is shown the same, with the same sentence.
 */

import { useEffect, useState } from 'react';

import {
  formatAge,
  formatDateTime,
  formatSerial,
  tp,
  numeralsFor,
  localName,
} from '@platform/i18n';
import { Card, useLocale } from '@platform/ui';

import { ChevronIcon } from '@/components/icons';
import { TabScreen } from '@/components/TabScreen';
import { useDeployment } from '@/hooks/useDeployment';
import { scopedHospitalId } from '@/lib/scope';
import { serialsFor, type StoodBooking } from '@/lib/standing';

import type { ReactNode } from 'react';

export default function SerialsPage(): ReactNode {
  const locale = useLocale();
  const [bookings, setBookings] = useState<readonly StoodBooking[] | null>(null);
  // Whether the list is the account's, from the server, or this phone's own.
  const [fromAccount, setFromAccount] = useState(false);

  // Read after mount: `localStorage` does not exist on the server, and reading
  // it during render makes the first client render disagree with it.
  // An app open for one hospital lists that hospital's serials (`FR-BRD-02`).
  const inHospital = scopedHospitalId(useDeployment());
  useEffect(() => {
    let stale = false;

    // Where each one stands is the server's to say, not the calendar's
    // (`FR-PAT-39`): the shape of the answer is shown until it has. A
    // signed-in patient's list is the server's too (plan F1).
    setBookings(null);
    void serialsFor(inHospital).then((serials) => {
      if (stale) return;
      setBookings(serials.bookings);
      setFromAccount(serials.fromAccount);
    });
    return () => {
      stale = true;
    };
  }, [inHospital]);

  // Current, whatever the date; and one that could not be checked stays here,
  // marked, rather than being filed under past.
  const today =
    bookings?.filter((entry) => entry.standing === 'current' || entry.standing === 'unknown') ?? [];
  const upcoming = bookings?.filter((entry) => entry.standing === 'upcoming') ?? [];
  const past = bookings?.filter((entry) => entry.standing === 'past') ?? [];

  return (
    <TabScreen title={tp('mySerials', locale)}>
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
          <p className="text-body-md text-ink-secondary">{tp('noSerials', locale)}</p>
          <a
            href="/"
            className="flex min-h-touch items-center justify-center rounded-md bg-brand-600 px-5 text-body-lg font-semibold text-white"
          >
            {tp('seeADoctor', locale)}
          </a>
        </div>
      ) : (
        <>
          <Section title={tp('serialsToday', locale)} bookings={today} live name="current" />
          <Section title={tp('serialsUpcoming', locale)} bookings={upcoming} name="upcoming" />
          <Section title={tp('serialsPast', locale)} bookings={past} name="past" />

          {/* Whose list this is, on the screen rather than in a comment: the
              account's, the same on every phone, or only what this phone
              booked. */}
          <p
            className="text-caption text-ink-muted"
            data-testid="serials-source"
            data-source={fromAccount ? 'account' : 'device'}
          >
            {tp(fromAccount ? 'serialsFromAccount' : 'serialsOnThisDevice', locale)}
          </p>
        </>
      )}
    </TabScreen>
  );
}

function Section({
  title,
  bookings,
  name,
  live = false,
}: {
  readonly title: string;
  readonly bookings: readonly StoodBooking[];
  readonly name: 'current' | 'upcoming' | 'past';
  readonly live?: boolean;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  if (bookings.length === 0) return null;

  return (
    <section className="flex flex-col gap-3" data-testid={`serials-${name}`}>
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
                    {formatSerial(booking.serial, numerals)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-lg font-semibold">
                      {localName(locale, booking.doctorNameBn, booking.doctorNameEn)}
                    </p>
                    <p className="truncate text-body-sm text-ink-muted">
                      {localName(locale, booking.hospitalNameBn, booking.hospitalNameEn)}
                    </p>
                    <p className="text-body-sm tabular-nums text-ink-secondary">
                      {formatDateTime(booking.plannedStart, numerals)}
                    </p>
                    {booking.standing !== 'unknown' ? null : (
                      <p
                        className="text-caption text-ink-muted"
                        data-testid={`serial-unknown-${booking.bookingId}`}
                      >
                        {booking.knownAt === null
                          ? tp('serialStatusUnknown', locale)
                          : tp('serialStatusUnknownSince', locale).replace(
                              '{age}',
                              formatAge(
                                Math.max(
                                  0,
                                  Math.round((Date.now() - Date.parse(booking.knownAt)) / 60_000),
                                ),
                                locale,
                                numerals,
                              ),
                            )}
                      </p>
                    )}
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
