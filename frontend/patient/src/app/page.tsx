'use client';

/**
 * `S-A-02` Home (`APP_FLOW.md` A2).
 *
 * Rebuilt on 2026-10-05 around the product's direction of that day
 * (`CLAUDE.md` §1.2): this is a network of hospitals, and the first thing the
 * app does is ask what a person needs. Top to bottom:
 *
 *   1. the header: the app's name, the area, the profile;
 *   2. the live strip, only while this phone holds a serial today — if you are
 *      waiting to be called, that is what you opened the app for;
 *   3. **search**: one field for a doctor, a hospital, a specialty, an ICU, a
 *      burn unit, with the needs asked for most as one-tap chips beneath it
 *      (`FR-PAT-16`);
 *   4. the emergency card. It moved down one place and is still on the first
 *      screenful, above everything that is browsing (`FRONTEND.md` §6.3:
 *      "never moved below the fold");
 *   5. specialties, for somebody who would rather browse than type;
 *   6. beds, reports and medicines.
 *
 * ## Why this is a client component
 *
 * The active serial strip is live: `BTN-A02-ACTIVE` "shows live position". A
 * home screen that shows a stale serial is worse than one that shows none, so
 * the strip reads the booking this device made and refreshes it.
 */

import { useEffect, useState } from 'react';

import { SPECIALTIES, needKey, type SearchNeed } from '@platform/domain';
import {
  bedKindName,
  capabilityName,
  formatAge,
  formatNumber,
  formatSerial,
  tp,
  numeralsFor,
  districtName,
  localName,
  type Locale,
} from '@platform/i18n';
import { useLocale } from '@platform/ui';

import { BottomNav, BottomNavSpacer } from '@/components/BottomNav';
import { DemoBanner } from '@/components/DemoBanner';
import { HospitalMark } from '@/components/HospitalMark';
import {
  BedIcon,
  ChevronIcon,
  EmergencyIcon,
  ProfileIcon,
  ReportIcon,
  SearchIcon,
  SPECIALTY_ICON,
  StethoscopeIcon,
} from '@/components/icons';
import { useDeployment } from '@/hooks/useDeployment';
import { bookingsInScope, recentBookings } from '@/lib/bookings';
import { scopedHospitalId } from '@/lib/scope';
import { standingFromMemory, standingOf, type StoodBooking } from '@/lib/standing';

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

/**
 * The needs offered under the search field: one of each kind the network
 * answers, chosen because they are the ones a family rings round hospitals
 * for. Every one is a real search; the full list is on `S-A-07s`.
 */
const QUICK_NEEDS: readonly SearchNeed[] = [
  { kind: 'bed', bedKind: 'icu' },
  { kind: 'bed', bedKind: 'nicu' },
  { kind: 'capability', capability: 'burn_unit' },
  { kind: 'capability', capability: 'dialysis' },
  { kind: 'bed', bedKind: 'cabin' },
];

export default function Home(): ReactNode {
  return (
    <>
      <main className="mx-auto flex max-w-[480px] flex-col gap-5 px-5 pt-4">
        <DemoBanner />

        <Header />
        <ActiveSerial />
        <SearchEntry />
        <EmergencyCard />
        <Specialties />
        <QuickTiles />

        <BottomNavSpacer />
      </main>

      <BottomNav />
    </>
  );
}

/**
 * App name, area, and the profile control (`BTN-A02-PROFILE`).
 *
 * The name is the hospital's when the app is open for one (`FR-PAT-19`: it
 * "says whose app it is"), and the platform's otherwise. It is the platform's
 * until the answer arrives: a name that changes once is better than a blank.
 */
function Header(): ReactNode {
  const locale = useLocale();
  const scope = useDeployment()?.scope ?? null;
  return (
    <header className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {/* A hospital's own app carries its logo, when it has one (`FR-BRD-06`). */}
        {scope?.logoVersion == null ? null : (
          <HospitalMark
            hospitalId={scope.hospitalId}
            logoVersion={scope.logoVersion}
            size="header"
          />
        )}
        <div className="min-w-0">
          <h1 className="font-reading text-title-lg text-brand-700" data-testid="app-name">
            {scope === null ? tp('appName', locale) : localName(locale, scope.nameBn, scope.nameEn)}
          </h1>
          <p className="text-body-sm text-ink-secondary">{districtName(AREA, locale)}</p>
        </div>
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
 * `BTN-A02-SEARCH` and `CHIP-A02-NEED-<key>` — the way into `S-A-07s`.
 *
 * A link drawn as a field, not a field: the typing happens on the search
 * screen, where the results are. A real input here would be a second place to
 * type that shows nothing, and a link works before the page has hydrated,
 * which on a slow phone is when the first tap lands.
 */
function SearchEntry(): ReactNode {
  const locale = useLocale();
  const scope = useDeployment()?.scope ?? null;

  const nameOf = (need: SearchNeed): string =>
    need.kind === 'bed'
      ? bedKindName(need.bedKind, locale)
      : need.kind === 'capability'
        ? capabilityName(need.capability, locale)
        : need.code;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="home-search-title">
      <div>
        <h2 id="home-search-title" className="font-reading text-title-md">
          {tp('searchPrompt', locale)}
        </h2>
        <p className="text-body-sm text-ink-secondary">
          {scope === null
            ? tp('homeSearchLine', locale)
            : tp('scopedIntro', locale).replace(
                '{hospital}',
                localName(locale, scope.nameBn, scope.nameEn),
              )}
        </p>
      </div>

      <a
        href="/search"
        data-testid="home-search"
        className="flex min-h-[56px] items-center gap-3 rounded-md border border-line-strong bg-surface px-4 text-body-lg text-ink-secondary"
      >
        <span className="text-brand-600">
          <SearchIcon size={22} />
        </span>
        {tp(scope === null ? 'homeSearch' : 'scopedSearch', locale)}
      </a>

      <div className="flex flex-col gap-2">
        <p className="text-caption text-ink-muted">{tp('homeNeeds', locale)}</p>
        <ul className="flex flex-wrap gap-2">
          {QUICK_NEEDS.map((need) => (
            <li key={needKey(need)}>
              <a
                href={`/search?need=${encodeURIComponent(needKey(need))}`}
                data-testid={`home-need-${needKey(need)}`}
                className="flex min-h-touch items-center rounded-pill border border-line-strong bg-surface px-4 text-body-md text-ink"
              >
                {nameOf(need)}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
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
        <h2 className="font-reading text-title-sm">{tp('browseBySpecialty', locale)}</h2>
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
 * The convenience tiles.
 *
 * Beds and reports, and medicines beneath them. Ambulance and blood were here
 * as tiles that led to a sentence saying they were not built; they are
 * outside V1 (`PRD.md` §7.8, owner's direction of 2026-10-05), and a first
 * screen on which everything shown works is the requirement.
 */
function QuickTiles(): ReactNode {
  const locale = useLocale();
  const tiles = [
    { href: '/beds', label: 'quickBed', Icon: BedIcon },
    { href: '/records', label: 'quickReport', Icon: ReportIcon },
  ] as const;

  return (
    <div className="flex flex-col gap-2.5">
      <ul className="grid grid-cols-2 gap-2.5">
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

        A wide row rather than a third tile: it carries a line saying what
        it answers, which a tile has no room for.
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
  const [booking, setBooking] = useState<StoodBooking | null>(null);
  // An app open for one hospital shows that hospital's serial only, and
  // nothing until it knows which hospital that is (`FR-BRD-02`).
  const inHospital = scopedHospitalId(useDeployment());

  useEffect(() => {
    let stale = false;
    const mine = bookingsInScope(recentBookings(), inHospital);

    // At once, from what this phone already knows; then from the server,
    // which is the only thing that can say a serial is still current: not the
    // date, which a chamber running past midnight outlives (`FR-PAT-39`).
    // One read, not a socket. Home is a screen somebody passes through; the
    // live channel belongs to `S-A-08`, which is where they go to watch.
    setBooking(standingFromMemory(mine).find((entry) => entry.standing === 'current') ?? null);
    void standingOf(mine).then((stood) => {
      if (stale) return;
      // A status that could not be checked is not a reason to hide the
      // booking they have: the strip stays, and says so.
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

  if (booking === null) return null;

  const nowServing = booking.nowServing;
  const doctor = localName(locale, booking.doctorNameBn, booking.doctorNameEn);

  return (
    <a
      href={booking.url}
      data-testid="active-serial"
      data-standing={booking.standing}
      className="flex items-center gap-3 rounded-md border border-brand-border bg-brand-100 p-4"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-pill bg-brand-600 text-title-sm font-bold text-white tabular-nums">
        {formatSerial(booking.serial, numerals)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-body-md font-semibold">{tp('activeSerialTitle', locale)}</span>
        <span className="block truncate text-body-sm text-ink-secondary">
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
        <ChevronIcon size={18} />
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
