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
 * ## Every item goes somewhere, or says why it does not
 *
 * It used to be labels styled as a menu, on the reasoning that `S-B-01` was
 * the one way between consoles. People clicked them, nothing happened, and a
 * console that ignores a click reads as a broken one. B1.1 calls this a
 * navigation rail, so each item now opens its console **for the same
 * facility**: a principal for that role is taken the way the picker takes one
 * (`mintDemoToken`, CLAUDE.md §4.1) and the page reloads onto it.
 *
 * An item with no console behind it is shown switched off with the reason
 * under it (`FRONTEND.md` §5.1): রেজিস্ট্রেশন because `S-B-03` is not built,
 * and any console the facility does not run (a clinic has no ward).
 */

import { useState } from 'react';

import { localName, t, type ConsoleKey, type Locale } from '@platform/i18n';

import { mintDemoToken, readDemoSession, writeDemoSession, type DemoSession } from '@/lib/demo';

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

/**
 * Which console each item opens: the role it needs and the `?view=` that
 * `app/page.tsx` routes on. `null` view is a chamber, opened by its session.
 * `null` target is a screen this version does not have.
 */
const TARGET: Readonly<
  Record<ConsoleNavKey, { readonly role: string; readonly view: string | null } | null>
> = {
  navQueue: { role: 'receptionist', view: null },
  // `S-B-03` is not built; reception's walk-in is the registration there is.
  navRegistration: null,
  navBeds: { role: 'ward', view: 'ward' },
  navEmergency: { role: 'emergency', view: 'er' },
  navTests: { role: 'lab', view: 'lab' },
  // `S-B-04` is not built. The pharmacy console has sat under বিল since
  // step 17, so the item opens it rather than going dark.
  navBilling: { role: 'pharmacy', view: 'pharmacy' },
  navDashboard: { role: 'hospital_admin', view: 'admin' },
};

/** Why an item cannot be opened, or null when it can. */
function offReason(key: ConsoleNavKey, session: DemoSession | null): ConsoleKey | null {
  const target = TARGET[key];
  if (target === null) return 'navNotInVersion';
  // No facility — the national console — has none of these.
  const hospitalId = session?.hospitalId ?? null;
  if (session === null || hospitalId === null) return 'navNotHere';
  // A session stored before the rail linked anywhere has no list; let the
  // attempt decide rather than switch off everything.
  if (session.roles !== undefined && !session.roles.includes(target.role)) return 'navNotHere';
  return null;
}

const ITEM =
  'flex min-h-touch w-full flex-col justify-center rounded-sm px-3 text-left text-body-md text-brand-100';

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
  const [opening, setOpening] = useState<ConsoleNavKey | null>(null);
  const [failed, setFailed] = useState<ConsoleNavKey | null>(null);

  async function open(key: ConsoleNavKey): Promise<void> {
    const target = TARGET[key];
    const hospitalId = session?.hospitalId ?? null;
    if (target === null || session === null || hospitalId === null) return;

    // A queue with no chamber remembered has nothing to reopen: the picker is
    // where a chamber is chosen.
    if (target.view === null && session.chamberSessionId === undefined) {
      globalThis.location.assign('/');
      return;
    }

    setOpening(key);
    setFailed(null);
    try {
      const minted = await mintDemoToken(hospitalId, target.role, AbortSignal.timeout(20_000));
      // Everything the picker knew about the facility carries over; only the
      // principal and the role change.
      writeDemoSession({
        ...session,
        token: minted.token,
        staffName: minted.staffName,
        hospitalId: minted.hospitalId,
        role: target.role,
      });

      const url = new URL('/', globalThis.location.href);
      if (target.view === null) {
        url.searchParams.set('session', session.chamberSessionId ?? '');
      } else {
        url.searchParams.set('view', target.view);
      }
      globalThis.location.assign(url.toString());
    } catch {
      setOpening(null);
      setFailed(key);
    }
  }

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
        {NAV_ITEMS.map((key) => {
          if (key === current) {
            return (
              <li key={key}>
                <span
                  aria-current="page"
                  className={`${ITEM} bg-white/15 font-semibold text-ink-inverse`}
                  data-testid={`rail-${key}`}
                >
                  {t(key, locale)}
                </span>
              </li>
            );
          }

          const reason = offReason(key, session);
          if (reason !== null) {
            return (
              <li key={key}>
                <span aria-disabled="true" className={ITEM} data-testid={`rail-${key}`}>
                  <span className="opacity-60">{t(key, locale)}</span>
                  <span className="text-caption">{t(reason, locale)}</span>
                </span>
              </li>
            );
          }

          return (
            <li key={key}>
              <button
                type="button"
                className={`${ITEM} hover:bg-white/10 hover:text-ink-inverse disabled:cursor-wait`}
                disabled={opening !== null}
                aria-busy={opening === key}
                data-testid={`rail-${key}`}
                onClick={() => {
                  void open(key);
                }}
              >
                {t(key, locale)}
                {opening === key ? (
                  <span className="text-caption">{t('navOpening', locale)}</span>
                ) : null}
                {failed === key ? (
                  <span role="alert" className="text-caption">
                    {t('navOpenFailed', locale)}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
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
