'use client';

/**
 * `NAV-A` — the bottom navigation (`APP_FLOW.md` S-A-02, FRONTEND.md §7.1).
 *
 * "Bottom nav is 4 items, 64 px tall plus safe area, labels always visible."
 *
 * This is the single thing that most makes a web page read as an app, and it
 * was missing: the patient app had three screens reachable only by tapping
 * through from one another, which is a website with no way back.
 *
 * ## Labels are always visible, deliberately
 *
 * §7.1 says so, and `ICO-03` says why: an icon on its own is not reliably
 * decoded by older users, who are a large part of who this product is for. The
 * icon makes a tab findable at a glance; the word is what makes it
 * understandable.
 *
 * ## The safe area
 *
 * `env(safe-area-inset-bottom)` keeps the tabs above the home indicator on a
 * notched phone. Without it the last 34 px of the bar sit under the system
 * gesture area, and every tap on it either does nothing or goes home.
 */

import { usePathname } from 'next/navigation';

import { tp, type PatientKey } from '@platform/i18n';
import { useLocale } from '@platform/ui';

import { HomeIcon, ProfileIcon, RecordsIcon, SerialIcon } from '@/components/icons';

import type { ReactNode } from 'react';

interface Tab {
  readonly href: string;
  readonly label: PatientKey;
  readonly Icon: (props: { readonly size?: number }) => ReactNode;
  /** Other paths that belong to this tab, so the right one stays lit. */
  readonly owns?: readonly string[];
}

/** হোম / সিরিয়াল / রেকর্ড / প্রোফাইল — `APP_FLOW.md` S-A-02. */
const TABS: readonly Tab[] = [
  { href: '/', label: 'navHome', Icon: HomeIcon, owns: ['/book'] },
  { href: '/serials', label: 'navSerials', Icon: SerialIcon, owns: ['/s'] },
  { href: '/records', label: 'navRecords', Icon: RecordsIcon },
  { href: '/profile', label: 'navProfile', Icon: ProfileIcon },
];

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
      <ul className="mx-auto grid max-w-[480px] grid-cols-4">
        {TABS.map((tab) => {
          const active =
            pathname === tab.href ||
            (tab.owns ?? []).some((owned) => pathname.startsWith(owned)) ||
            (tab.href !== '/' && pathname.startsWith(tab.href));

          return (
            <li key={tab.href}>
              <a
                href={tab.href}
                // A11Y: the current tab is announced, not merely coloured
                // (`A11Y-03` — colour never carries meaning alone).
                aria-current={active ? 'page' : undefined}
                data-testid={`nav-${tab.href === '/' ? 'home' : tab.href.slice(1)}`}
                className={`flex min-h-[64px] flex-col items-center justify-center gap-1 ${
                  active ? 'text-brand-600' : 'text-ink-muted'
                }`}
              >
                <tab.Icon size={22} />
                <span className={`text-caption ${active ? 'font-semibold' : ''}`}>
                  {tp(tab.label, locale)}
                </span>
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
  return <div aria-hidden="true" className="h-[calc(64px+env(safe-area-inset-bottom))]" />;
}
