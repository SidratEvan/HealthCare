'use client';

/**
 * The shell every tab shares: the demonstration line where the server says it
 * is one, a title, the screen, and the bottom navigation (`NAV-A`).
 *
 * It used to carry a second export, a screen that said "not built yet", for
 * the tabs and tiles that led nowhere. Nothing leads nowhere now: what is not
 * in V1 is not offered (`PRD.md` §7.8, owner's direction of 2026-10-05).
 */

import { BottomNav, BottomNavSpacer } from '@/components/BottomNav';
import { DemoBanner } from '@/components/DemoBanner';

import type { ReactNode } from 'react';

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
        <DemoBanner />

        <h1 className="font-reading text-title-lg">{title}</h1>

        {children}

        <BottomNavSpacer />
      </main>

      <BottomNav />
    </>
  );
}
