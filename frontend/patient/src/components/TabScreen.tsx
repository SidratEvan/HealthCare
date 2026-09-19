'use client';

/**
 * The shell every tab shares, and the honest state for the ones not built.
 *
 * ## Why a tab that leads nowhere is still a tab
 *
 * `NAV-A` has four items and `APP_FLOW.md` S-A-02 names all four. Records is
 * `S-A-12`, the health wallet, which is build step 13; profiles are `S-A-19`
 * and need the accounts that `CLAUDE.md` §4.1 defers to Supabase Auth. Both
 * are months of the plan away.
 *
 * Hiding them would make the bar move as the product grows, which teaches
 * people the wrong muscle memory, and a three-item bar is not the navigation
 * the design was composed around. Greying them out would say "broken". So each
 * says plainly what will be there and why it is not yet — which is the same
 * honesty `FR-DEM-07` applies to the data and `GR-03` applies to an empty
 * list.
 */

import { tp, type PatientKey } from '@platform/i18n';

import { BottomNav, BottomNavSpacer } from '@/components/BottomNav';

import type { ReactNode } from 'react';

const LOCALE = 'bn' as const;

export function TabScreen({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <>
      <main className="mx-auto flex max-w-[480px] flex-col gap-5 px-5 pt-4">
        <p className="rounded-sm bg-warn-100 px-3 py-2 text-caption text-warn-700">
          {tp('demoBanner', LOCALE)}
        </p>

        <h1 className="font-reading text-title-lg">{title}</h1>

        {children}

        <BottomNavSpacer />
      </main>

      <BottomNav />
    </>
  );
}

/**
 * A screen this version does not have, saying so.
 *
 * Not a spinner and not a blank: `GR-03` calls empty a designed state, and the
 * design of this one is a sentence naming what belongs here.
 */
export function NotBuiltYet({
  title,
  explanation,
}: {
  readonly title: string;
  readonly explanation: PatientKey;
}): ReactNode {
  return (
    <TabScreen title={title}>
      <div
        data-testid="not-built"
        className="flex flex-col gap-3 rounded-md border border-line bg-surface p-5"
      >
        <p className="text-body-md text-ink-secondary">{tp(explanation, LOCALE)}</p>
        <p className="text-caption text-ink-muted">{tp('comingSoon', LOCALE)}</p>
      </div>

      <a
        href="/"
        className="flex min-h-touch items-center justify-center rounded-md bg-brand-600 px-5 text-body-lg font-semibold text-white"
      >
        {tp('backHome', LOCALE)}
      </a>
    </TabScreen>
  );
}
