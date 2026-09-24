'use client';

/**
 * The navigation rail every hospital console shares (`APP_FLOW.md` B1.1).
 *
 * The design reference (`FRONTEND.md` §0.4, the `Reception` artboard) sets it
 * in the institution's own green, with the facility named at the top: a
 * counter screen should say whose counter it is before it says anything else.
 * Five consoles used to carry their own copy of a pale rail with no name on
 * it, which is how they came to look like five unrelated pages.
 *
 * Only the console that is open is marked current. The other items are shown,
 * not linked: `S-B-01` is still the one way between consoles in this version
 * (`CLAUDE.md` §4.1), and a link that goes nowhere is worse than a label.
 */

import { localName, t, type ConsoleKey, type Locale } from '@platform/i18n';

import { readDemoSession } from '@/lib/demo';

import type { ReactNode } from 'react';

/** `APP_FLOW.md` B1.1, in its order. */
const NAV_ITEMS = [
  'navQueue',
  'navRegistration',
  'navBeds',
  'navEmergency',
  'navTests',
  'navBilling',
  'navDashboard',
] as const satisfies readonly ConsoleKey[];

export type ConsoleNavKey = (typeof NAV_ITEMS)[number];

export function ConsoleRail({
  current,
  locale,
  children,
}: {
  /** The console this rail sits beside. */
  readonly current: ConsoleNavKey;
  readonly locale: Locale;
  /** The offline block, at the foot of the rail (`FR-OFF-01`). */
  readonly children?: ReactNode;
}): ReactNode {
  const session = readDemoSession();

  return (
    <nav
      aria-label={t(current, locale)}
      className="flex w-56 shrink-0 flex-col gap-6 bg-brand-700 p-4 text-ink-inverse"
      data-testid="console-rail"
    >
      <div className="px-2 pt-2">
        {session?.hospitalNameBn === undefined ? null : (
          <p className="text-title-sm font-bold" data-testid="rail-hospital">
            {localName(locale, session.hospitalNameBn, session.hospitalNameEn)}
          </p>
        )}
        {session === null ? null : (
          <p className="mt-1 text-caption text-brand-100">{session.staffName}</p>
        )}
      </div>

      <ul className="flex flex-col gap-1">
        {NAV_ITEMS.map((key) => (
          <li key={key}>
            <span
              aria-current={key === current ? 'page' : undefined}
              className="flex min-h-touch items-center rounded-sm px-3 text-body-md text-brand-100 aria-[current=page]:bg-white/15 aria-[current=page]:font-semibold aria-[current=page]:text-ink-inverse"
            >
              {t(key, locale)}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-auto flex flex-col gap-3">
        {children}
        <a
          href="/"
          className="flex min-h-touch items-center rounded-sm px-3 text-body-sm text-brand-100 hover:bg-white/10 hover:text-ink-inverse"
        >
          {t('changeConsole', locale)}
        </a>
      </div>
    </nav>
  );
}
