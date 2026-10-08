'use client';

/**
 * The frame every patient screen shares (FRONTEND.md §0.5): the header, the
 * demonstration line where the server says it is one, the screen, and the
 * bottom navigation (`NAV-A`).
 *
 * Every screen is drawn inside this, the home screen included (its header is
 * the brand form), so the header, the gutters, the space above the bar and the
 * bar itself cannot differ from one screen to the next.
 */

import { AppHeader, type BackTarget } from '@/components/AppHeader';
import { BottomNav, BottomNavSpacer } from '@/components/BottomNav';
import { DemoBanner } from '@/components/DemoBanner';

import type { ReactNode } from 'react';

export function TabScreen({
  title,
  back,
  children,
  testId,
}: {
  /** The screen's title, or null for the home screen's brand header. */
  readonly title: string | null;
  readonly back?: BackTarget;
  readonly children: ReactNode;
  readonly testId?: string;
}): ReactNode {
  return (
    <>
      <AppHeader title={title} {...(back === undefined ? {} : { back })} />

      <main data-testid={testId} className="mx-auto flex max-w-[480px] flex-col gap-5 px-5 pt-1">
        <DemoBanner />

        {children}

        <BottomNavSpacer />
      </main>

      <BottomNav />
    </>
  );
}
