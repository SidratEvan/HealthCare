'use client';

/**
 * `NAV-A`: the bottom navigation (`APP_FLOW.md` S-A-02, FRONTEND.md §0.5, §7.1).
 *
 * Five tabs, one component, identical on every screen: হোম · খুঁজুন · সিরিয়াল ·
 * রেকর্ড · আরও. The owner's instruction with Visual Direction 2 was that it
 * never differs between screens, so no screen draws its own; each renders this.
 *
 * ## Labels are always visible, deliberately
 *
 * `ICO-03`: an icon on its own is not reliably decoded by older users, who are
 * a large part of who this product is for. The icon makes a tab findable at a
 * glance; the word is what makes it understandable.
 *
 * ## Which tab a screen belongs to
 *
 * By whole path segments, never by prefix: `/search` begins with `/s` and is
 * not the live serial screen. A screen reached from home (emergency, beds,
 * medicines) keeps home lit; the booking flow belongs to search, where it
 * starts; the live serial and standby belong to the serials tab.
 *
 * ## The safe area
 *
 * `env(safe-area-inset-bottom)` keeps the tabs above the home indicator on a
 * notched phone. Without it the bottom of the bar sits under the system
 * gesture area, and a tap there either does nothing or goes home.
 */

import { usePathname } from 'next/navigation';

import { tp, type PatientKey } from '@platform/i18n';
import { useLocale } from '@platform/ui';

import {
  HomeIcon,
  MoreIcon,
  RecordsIcon,
  SearchIcon,
  SerialIcon,
  type IconProps,
} from '@/components/icons';

import type { ReactNode } from 'react';

interface Tab {
  readonly href: string;
  /** The test id's suffix; `profile` keeps the address it has always had. */
  readonly id: string;
  readonly label: PatientKey;
  readonly Icon: (props: IconProps) => ReactNode;
  /** Other paths that belong to this tab, so the right one stays lit. */
  readonly owns: readonly string[];
}

const TABS: readonly Tab[] = [
  {
    href: '/',
    id: 'home',
    label: 'navHome',
    Icon: HomeIcon,
    owns: ['/emergency', '/beds', '/medicines'],
  },
  { href: '/search', id: 'search', label: 'navSearch', Icon: SearchIcon, owns: ['/book'] },
  {
    href: '/serials',
    id: 'serials',
    label: 'navSerials',
    Icon: SerialIcon,
    owns: ['/s', '/standby'],
  },
  { href: '/records', id: 'records', label: 'navRecords', Icon: RecordsIcon, owns: [] },
  { href: '/profile', id: 'profile', label: 'navMore', Icon: MoreIcon, owns: [] },
];

function within(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function BottomNav(): ReactNode {
  const locale = useLocale();
  const pathname = usePathname();

  return (
    <nav
      // A11Y-01: a real <nav> with real links. A row of divs with onClick is
      // invisible to Tab and to a screen reader.
      aria-label={tp('navHome', locale)}
      data-testid="bottom-nav"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid max-w-[480px] grid-cols-5 px-1 pt-2 pb-2">
        {TABS.map((tab) => {
          const active =
            pathname === tab.href ||
            tab.owns.some((owned) => within(pathname, owned)) ||
            (tab.href !== '/' && within(pathname, tab.href));

          return (
            <li key={tab.href}>
              <a
                href={tab.href}
                // A11Y-03: the current tab is announced, not merely coloured.
                aria-current={active ? 'page' : undefined}
                data-testid={`nav-${tab.id}`}
                className={`flex min-h-[56px] flex-col items-center justify-center gap-1 text-caption ${
                  active ? 'font-bold text-brand-600' : 'font-medium text-ink-muted'
                }`}
              >
                <span
                  className={`flex h-[30px] w-[54px] items-center justify-center rounded-pill transition-colors duration-quick ease-standard ${
                    active ? 'bg-brand-100' : ''
                  }`}
                >
                  <tab.Icon size={22} />
                </span>
                <span>{tp(tab.label, locale)}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The space a fixed bottom bar takes out of a scrolling page.
 *
 * Rendered at the foot of every screen that shows the nav. Without it the last
 * card on a list sits permanently under the bar, and on a booking screen that
 * card is the confirm button.
 */
export function BottomNavSpacer(): ReactNode {
  return <div aria-hidden="true" className="h-[calc(96px+env(safe-area-inset-bottom))] shrink-0" />;
}
