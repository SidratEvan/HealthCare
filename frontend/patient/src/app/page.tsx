'use client';

/**
 * `S-A-02` Home (`APP_FLOW.md` A2), composed against the design canvas in
 * `FRONTEND.md` §0.4 — the `Main` artboard, 390×900.
 *
 * "Layout order is fixed and deliberate: emergency first, then care, then
 * convenience." Top to bottom: app header with area and profile, the emergency
 * card, the specialty grid, the four quick tiles, the live serial strip, and
 * the bottom navigation.
 *
 * ## Why this is a client component now
 *
 * It was a server component, and that was right while nothing on it was live.
 * The active serial strip changes it: `BTN-A02-ACTIVE` "shows live position,
 * updates via the session channel while Home is open". A home screen that
 * shows a stale serial is worse than one that shows none, so the strip reads
 * the booking this device made and refreshes it.
 */

import { useEffect, useState } from 'react';

import { SPECIALTIES } from '@platform/domain';
import {
  formatNumber,
  formatSerial,
  tp,
  numeralsFor,
  districtName,
  localName,
} from '@platform/i18n';
import { useLocale } from '@platform/ui';

import { BottomNav, BottomNavSpacer } from '@/components/BottomNav';
import {
  AmbulanceIcon,
  BedIcon,
  BloodIcon,
  ChevronIcon,
  EmergencyIcon,
  ProfileIcon,
  ReportIcon,
  SPECIALTY_ICON,
  StethoscopeIcon,
} from '@/components/icons';
import { openTrackingLink } from '@/lib/api';
import { recentBookings, type SavedBooking } from '@/lib/bookings';

import type { ReactNode } from 'react';

/**
 * The area this app is showing.
 *
 * Hard-coded for the demo: `MOD-A02-AREA` is the area picker and there is no
 * location permission flow yet (`S-A-01`). The canvas shows a real area under
 * the app name, and a blank there makes the header look unfinished — so it
 * says the area the demo's facilities are in, which is true. A district key,
 * so it reads ঢাকা or Dhaka with the language switch.
 */
const AREA = 'Dhaka';

export default function Home(): ReactNode {
  const locale = useLocale();
  return (
    <>
      <main className="mx-auto flex max-w-[480px] flex-col gap-5 px-5 pt-4">
        <p className="rounded-sm bg-warn-100 px-3 py-2 text-caption text-warn-700">
          {tp('demoBanner', locale)}
        </p>

        <Header />
        <EmergencyCard />
        <Specialties />
        <QuickTiles />
        <ActiveSerial />

        <BottomNavSpacer />
      </main>

      <BottomNav />
    </>
  );
}

/** App name, area, and the profile control (`BTN-A02-PROFILE`). */
function Header(): ReactNode {
  const locale = useLocale();
  return (
    <header className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-reading text-title-lg text-brand-700">{tp('appName', locale)}</h1>
        <p className="text-body-sm text-ink-secondary">{districtName(AREA, locale)}</p>
      </div>

      <a
        href="/profile"
        aria-label={tp('navProfile', locale)}
        className="flex size-11 shrink-0 items-center justify-center rounded-pill border border-line bg-surface text-ink"
      >
        <ProfileIcon size={20} />
      </a>
    </header>
  );
}

/**
 * `BTN-A02-EMERGENCY` — `<EmergencyEntry>` (FRONTEND.md §6.3).
 *
 * "Full-width, `radius-lg`, alert fill, 92 px minimum height, one line of
 * Bangla explaining what it does. Never A/B tested for conversions; never
 * moved below the fold."
 */
function EmergencyCard(): ReactNode {
  const locale = useLocale();
  return (
    <a
      href="/emergency"
      data-testid="emergency-card"
      className="flex min-h-[92px] items-center gap-4 rounded-lg bg-alert-600 p-5 text-white"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-pill bg-white/20">
        <EmergencyIcon size={26} />
      </span>
      <span className="min-w-0">
        <span className="block font-reading text-title-md font-bold">
          {tp('emergency', locale)}
        </span>
        <span className="block text-body-sm opacity-90">{tp('emergencyLine', locale)}</span>
      </span>
    </a>
  );
}

/**
 * The specialty grid (`BTN-A02-SPEC-<code>`).
 *
 * Two columns, an icon and a name per card. Each opens `S-A-07` — **hospitals**
 * offering that specialty, not doctors. That order is what the document
 * specifies and what a person actually decides in: a patient picks somewhere
 * they can reach before they pick who they see.
 */
function Specialties(): ReactNode {
  const locale = useLocale();
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-reading text-title-sm">{tp('seeADoctor', locale)}</h2>
        <p className="text-body-sm text-ink-secondary">{tp('seeADoctorSub', locale)}</p>
      </div>

      <ul className="grid grid-cols-2 gap-3">
        {SPECIALTIES.map((specialty) => {
          const Icon = SPECIALTY_ICON[specialty.code] ?? StethoscopeIcon;

          return (
            <li key={specialty.code}>
              <a
                href={`/book?specialty=${specialty.code}`}
                data-testid={`specialty-${specialty.code}`}
                className="flex min-h-[96px] flex-col justify-between rounded-md border border-line bg-surface p-4"
              >
                <span className="text-brand-600">
                  <Icon size={24} />
                </span>
                {/* ICO-03: the name carries the meaning; the icon makes it
                    findable. Never the icon alone on a patient surface. */}
                <span className="text-body-lg font-semibold">
                  {localName(locale, specialty.nameBn, specialty.nameEn)}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The four convenience tiles.
 *
 * Beds, ambulance, blood and reports are build steps 14, 17 and 13. They are
 * on screen because the canvas has them and because a home screen missing a
 * quarter of itself looks broken — and each one lands on an honest "not built
 * yet" rather than a dead link.
 */
function QuickTiles(): ReactNode {
  const locale = useLocale();
  const tiles = [
    { href: '/beds', label: 'quickBed', Icon: BedIcon },
    { href: '/ambulance', label: 'quickAmbulance', Icon: AmbulanceIcon },
    { href: '/blood', label: 'quickBlood', Icon: BloodIcon },
    { href: '/records', label: 'quickReport', Icon: ReportIcon },
  ] as const;

  return (
    <div className="flex flex-col gap-2.5">
      <ul className="grid grid-cols-4 gap-2.5">
        {tiles.map((tile) => (
          <li key={tile.href}>
            <a
              href={tile.href}
              className="flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-sm border border-line bg-surface px-1.5 py-3 text-center"
            >
              <span className="text-brand-600">
                <tile.Icon size={22} />
              </span>
              <span className="text-caption">{tp(tile.label, locale)}</span>
            </a>
          </li>
        ))}
      </ul>

      {/*
        Medicine availability (`FR-PHR-02`, step 17).

        A wide row rather than a fifth tile: five tiles across a 360px screen
        leaves each about sixty pixels, which is under the touch target
        `MIN_TOUCH_TARGET_PX` sets and too narrow for a Bangla label. The four
        the canvas declares keep their grid.
      */}
      <a
        href="/medicines"
        data-testid="quick-medicines"
        className="flex min-h-touch items-center justify-between rounded-sm border border-line bg-surface px-4 py-3"
      >
        <span className="text-body-md">{tp('medicinesTitle', locale)}</span>
        <span className="text-body-sm text-ink-muted">{tp('medicinesIntro', locale)}</span>
      </a>
    </div>
  );
}

/**
 * `BTN-A02-ACTIVE` — the live strip.
 *
 * "Appears only if an active booking exists today. Shows live position."
 *
 * The serial comes from this device's own record of what it booked, and the
 * *now-serving* number is fetched from the tracking link — so the number on
 * the home screen is the same number the live screen would show, rather than
 * a remembered one. Absent when there is nothing today, exactly as specified:
 * a strip saying "no serial" is a row of furniture.
 */
function ActiveSerial(): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const [booking, setBooking] = useState<SavedBooking | null>(null);
  const [nowServing, setNowServing] = useState<number | null>(null);

  useEffect(() => {
    const today = recentBookings().find((saved) => saved.isToday);
    if (today === undefined) return;

    setBooking(today);

    // One read, not a socket. Home is a screen somebody passes through; the
    // live channel belongs to `S-A-08`, which is where they go to watch.
    void openTrackingLink(today.token)
      .then((view) => {
        const serving = view.state.entries.find((entry) => entry.status === 'in_chamber');
        setNowServing(serving?.serial ?? null);
      })
      .catch(() => {
        // The strip still shows their own serial. A failed lookup is not a
        // reason to hide the booking they have.
      });
  }, []);

  if (booking === null) return null;

  return (
    <a
      href={booking.url}
      data-testid="active-serial"
      className="flex items-center gap-3 rounded-md border border-brand-border bg-brand-100 p-4"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-pill bg-brand-600 text-title-sm font-bold text-white tabular-nums">
        {formatSerial(booking.serial, numerals)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-body-md font-semibold">{tp('activeSerialTitle', locale)}</span>
        <span className="block truncate text-body-sm text-ink-secondary">
          {nowServing === null
            ? localName(locale, booking.doctorNameBn, booking.doctorNameEn)
            : tp('activeSerialMeta', locale)
                .replace('{doctor}', localName(locale, booking.doctorNameBn, booking.doctorNameEn))
                .replace('{serving}', formatNumber(nowServing, numerals))}
        </span>
      </span>

      <span className="text-brand-600">
        <ChevronIcon size={18} />
      </span>
    </a>
  );
}
