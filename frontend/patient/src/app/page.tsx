'use client';

/**
 * `S-A-02` Home (`APP_FLOW.md` A2), Visual Direction 2 (FRONTEND.md §0.5).
 *
 * Rebuilt on 2026-10-07 to the board the owner approved. Top to bottom:
 *
 *   1. the header: the official logo (a hospital's mark and name in its own
 *      app), the language switch, the profile;
 *   2. what the person came for: the live serial card while this phone holds
 *      a current serial, otherwise the welcome card with the family;
 *   3. one way to ask: the search field;
 *   4. three main actions: a doctor, my live serial, emergency help, the last
 *      the only red on the screen (§6.3 as amended);
 *   5. three services: beds, medicines, records.
 *
 * The quick-need chips and the specialty grid that were here moved to the
 * search screen, which shows every need on arrival; home keeps one way to ask.
 *
 * ## Why this is a client component
 *
 * The live serial card is live: `BTN-A02-ACTIVE` "shows live position". A home
 * screen that shows a stale serial is worse than one that shows none, so the
 * card reads the booking this device made and asks the server where it stands.
 */

import { useEffect, useState } from 'react';

import {
  formatAge,
  formatNumber,
  formatSerial,
  localName,
  numeralsFor,
  tp,
  type Locale,
} from '@platform/i18n';
import { useLocale } from '@platform/ui';

import {
  BedIcon,
  ChevronIcon,
  EmergencyIcon,
  LiveIcon,
  PillIcon,
  RecordsIcon,
  SearchIcon,
  StethoscopeIcon,
} from '@/components/icons';
import { TabScreen } from '@/components/TabScreen';
import { MainTile, ServiceTile } from '@/components/Tiles';
import { useDeployment } from '@/hooks/useDeployment';
import { bookingsInScope, recentBookings } from '@/lib/bookings';
import { doctorName } from '@/lib/doctor';
import { scopedHospitalId } from '@/lib/scope';
import { serialsFor, standingFromMemory, type StoodBooking } from '@/lib/standing';

import type { ReactNode } from 'react';

export default function Home(): ReactNode {
  const locale = useLocale();
  const serial = useCurrentSerial();

  // The English name under the Bangla one, as on the approved board; not in
  // English, where it would only say the label twice.
  const helper = (key: Parameters<typeof tp>[0]): string | null =>
    locale === 'bn' ? tp(key, 'en') : null;

  return (
    <TabScreen title={null}>
      {serial === null ? <WelcomeCard /> : <LiveSerialCard booking={serial} />}

      <SearchField />

      <section aria-label={tp('homeFindDoctor', locale)} className="grid grid-cols-3 gap-2.5">
        <MainTile
          href="/search"
          testId="home-find-doctor"
          icon={<StethoscopeIcon size={26} />}
          label={tp('homeFindDoctor', locale)}
          helper={helper('homeFindDoctor')}
        />
        <MainTile
          href={serial?.url ?? '/serials'}
          testId="home-my-serial"
          icon={<LiveIcon size={26} />}
          label={tp('homeMySerial', locale)}
          helper={helper('homeMySerial')}
        />
        {/* BTN-A02-EMERGENCY: no sign-in in front of it, and always on the
            first screen (`FRONTEND.md` §6.3). */}
        <MainTile
          href="/emergency"
          testId="emergency-card"
          tone="alert"
          icon={<EmergencyIcon size={26} />}
          label={tp('homeEmergency', locale)}
          helper={helper('homeEmergency')}
        />
      </section>

      <Services />
    </TabScreen>
  );
}

/**
 * The welcome card: a two-line headline, one line, and the family
 * (FRONTEND.md §0.5). The illustration is decorative, so it says nothing to a
 * screen reader; it multiplies onto the tint because its ground is white, and
 * fades in from the text's side so the two never collide on a narrow phone.
 */
function WelcomeCard(): ReactNode {
  const locale = useLocale();
  const scope = useDeployment()?.scope ?? null;

  return (
    <section
      data-testid="home-welcome"
      className="relative h-[180px] overflow-hidden rounded-lg bg-brand-100"
    >
      <div className="relative z-10 flex h-full w-[46%] min-w-[156px] flex-col justify-center gap-1.5 py-4 pl-[18px]">
        <h2 className="text-title-md leading-[1.36] font-bold text-brand-900">
          <span className="block">{tp('homeHeroLine1', locale)}</span>
          <span className="block">{tp('homeHeroLine2', locale)}</span>
        </h2>
        <p className="text-body-sm text-ink-secondary">
          {scope === null
            ? tp('homeHeroBody', locale)
            : tp('scopedIntro', locale).replace(
                '{hospital}',
                localName(locale, scope.nameBn, scope.nameEn),
              )}
        </p>
      </div>
      {/* The approved crop: the box shows the family from the father's
          shoulder to the mother's, 186 px wide, cut by the card's edge below. */}
      <div className="absolute right-0 bottom-0 h-[176px] w-[54%] max-w-[190px] overflow-hidden mix-blend-multiply [-webkit-mask-image:linear-gradient(90deg,transparent_0,black_16%)] [mask-image:linear-gradient(90deg,transparent_0,black_16%)]">
        <img
          src="/illustrations/family.webp"
          alt=""
          width={720}
          height={598}
          decoding="async"
          fetchPriority="high"
          className="absolute right-[-6px] bottom-0 h-[176px] w-auto max-w-none"
        />
      </div>
    </section>
  );
}

/**
 * `BTN-A02-SEARCH`: the way into `S-A-07s`.
 *
 * A link drawn as a field, not a field: the typing happens on the search
 * screen, where the results are, and a link works before the page has
 * hydrated, which on a slow phone is when the first tap lands.
 */
function SearchField(): ReactNode {
  const locale = useLocale();
  const scope = useDeployment()?.scope ?? null;
  return (
    <a
      href="/search"
      data-testid="home-search"
      className="flex min-h-[56px] items-center gap-3 rounded-md border border-line bg-surface px-4 text-body-md text-ink-muted shadow-1"
    >
      <span className="text-brand-600">
        <SearchIcon size={22} />
      </span>
      {tp(scope === null ? 'homeSearchField' : 'scopedSearch', locale)}
    </a>
  );
}

/**
 * The three services. Inside a hospital's own app a service it does not run
 * is not offered: no ward, no beds tile; no pharmacy, or a shelf it keeps to
 * itself, no medicines tile (`FR-BRD-09`). The records tile is always there:
 * the wallet is the patient's own, wherever a visit was made (`FR-BRD-10`).
 */
function Services(): ReactNode {
  const locale = useLocale();
  const scope = useDeployment()?.scope ?? null;
  const off = scope?.modulesOff ?? [];
  const beds = !off.includes('beds');
  const medicines = !off.includes('pharmacy') && scope?.notShared?.includes('stock') !== true;

  return (
    <section className="flex flex-col gap-2.5" aria-labelledby="home-services">
      <h2 id="home-services" className="text-title-sm font-bold">
        {tp('homeOtherServices', locale)}
      </h2>
      <div className="grid auto-cols-fr grid-flow-col gap-2.5">
        {beds ? (
          <ServiceTile
            href="/beds"
            testId="quick-beds"
            icon={<BedIcon size={24} />}
            label={tp('homeBeds', locale)}
          />
        ) : null}
        {medicines ? (
          <ServiceTile
            href="/medicines"
            testId="quick-medicines"
            icon={<PillIcon size={24} />}
            label={tp('homeMedicines', locale)}
          />
        ) : null}
        <ServiceTile
          href="/records"
          testId="quick-records"
          icon={<RecordsIcon size={24} />}
          label={tp('homeRecords', locale)}
        />
      </div>
    </section>
  );
}

/**
 * The serial this phone, or this account, holds right now (`FR-PAT-39`).
 *
 * At once from what this phone already knows; then from the server, which is
 * the only thing that can say a serial is still current: not the date, which a
 * chamber running past midnight outlives. One read, not a socket. Home is a
 * screen somebody passes through; the live channel belongs to `S-A-08`.
 *
 * An app open for one hospital shows that hospital's serial only, and nothing
 * until it knows which hospital that is (`FR-BRD-02`).
 */
function useCurrentSerial(): StoodBooking | null {
  const [booking, setBooking] = useState<StoodBooking | null>(null);
  const inHospital = scopedHospitalId(useDeployment());

  useEffect(() => {
    let stale = false;
    const mine = bookingsInScope(recentBookings(), inHospital);

    setBooking(standingFromMemory(mine).find((entry) => entry.standing === 'current') ?? null);
    // Signed in, the account's serials, booked on any phone (plan F1); else
    // this phone's own.
    void serialsFor(inHospital).then(({ bookings: stood }) => {
      if (stale) return;
      // A status that could not be checked is not a reason to hide the
      // booking they have: the card stays, and says so.
      setBooking(
        stood.find((entry) => entry.standing === 'current') ??
          stood.find((entry) => entry.standing === 'unknown') ??
          null,
      );
    });

    return () => {
      stale = true;
    };
  }, [inHospital]);

  return booking;
}

/**
 * `BTN-A02-ACTIVE`: the live serial card, in the welcome card's place.
 *
 * The serial comes from this device's own record of what it booked, and the
 * *now-serving* number from the tracking link, so the number on the home
 * screen is the number the live screen would show, not a remembered one.
 */
function LiveSerialCard({ booking }: { readonly booking: StoodBooking }): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const nowServing = booking.nowServing;
  const doctor = doctorName(locale, booking.doctorNameBn, booking.doctorNameEn);

  return (
    <a
      href={booking.url}
      data-testid="active-serial"
      data-standing={booking.standing}
      className="flex items-center gap-4 rounded-lg border border-brand-border bg-brand-100 p-5"
    >
      <span className="flex size-16 shrink-0 items-center justify-center rounded-pill bg-brand-600 text-title-lg font-extrabold text-white tabular-nums">
        {formatSerial(booking.serial, numerals)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-body-md font-bold text-brand-900">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-pill bg-accent-500 motion-safe:animate-[live-pulse_2s_ease-in-out_infinite]"
          />
          {tp('activeSerialTitle', locale)}
        </span>
        <span className="block text-body-sm text-ink-secondary">
          {nowServing === null
            ? doctor
            : tp('activeSerialMeta', locale)
                .replace('{doctor}', doctor)
                .replace('{serving}', formatNumber(nowServing, numerals))}
        </span>
        {booking.standing !== 'unknown' ? null : (
          <span className="block text-caption text-ink-muted" data-testid="active-serial-unknown">
            {unknownLine(booking.knownAt, locale)}
          </span>
        )}
      </span>

      <span className="text-brand-600">
        <ChevronIcon size={20} />
      </span>
    </a>
  );
}

/** "Could not be checked", with the age of the last answer when there was one (`FR-PAT-39`). */
function unknownLine(knownAt: string | null, locale: Locale): string {
  if (knownAt === null) return tp('serialStatusUnknown', locale);
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(knownAt)) / 60_000));
  return tp('serialStatusUnknownSince', locale).replace(
    '{age}',
    formatAge(minutes, locale, numeralsFor(locale)),
  );
}
