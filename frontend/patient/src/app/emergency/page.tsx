'use client';

/**
 * `S-A-10` Emergency triage, as much of it as this version honestly has.
 *
 * Triage itself is build step 15: the capability ranking, the freshness
 * de-ranking (`FR-PAT-45`) and the "I'm on my way" alert to an ER console all
 * need the emergency work that has not been done. So this screen does not
 * pretend to rank hospitals.
 *
 * What it does carry is `BTN-A10-999`, which `APP_FLOW.md` A6 puts at the top
 * of this screen and describes as "`tel:999` immediately; always visible at
 * top". That control needs nothing this version lacks, and the home screen's
 * red card — full-width, above the fold, the first thing on `S-A-02` — leads
 * here. Leading it to a "coming soon" and nothing else would mean the most
 * prominent control in the patient app does nothing in the one situation it
 * exists for.
 *
 * So: the call goes first, the conditions that mean *call first* are named
 * (`APP_FLOW.md` A6, "critical warning text"), and then the screen says
 * plainly what is not built yet.
 */

import { tp } from '@platform/i18n';

import { EmergencyIcon } from '@/components/icons';
import { TabScreen } from '@/components/TabScreen';

import type { ReactNode } from 'react';

const LOCALE = 'bn' as const;

export default function EmergencyPage(): ReactNode {
  return (
    <TabScreen title={tp('emergency', LOCALE)}>
      {/*
        A real `tel:` link, not a button with a handler: it works with the
        keyboard, it works from a screen reader's links list, and long-press
        offers to copy the number.
      */}
      <a
        href="tel:999"
        data-testid="call-999"
        className="flex min-h-[92px] items-center gap-4 rounded-lg bg-alert-600 p-5 text-white"
      >
        <span className="flex size-12 shrink-0 items-center justify-center rounded-pill bg-white/20">
          <EmergencyIcon size={26} />
        </span>
        <span className="min-w-0">
          <span className="block font-reading text-title-md font-bold">
            {tp('call999', LOCALE)}
          </span>
          <span className="block text-body-sm opacity-90">{tp('call999Line', LOCALE)}</span>
        </span>
      </a>

      {/* GR-03: what is missing, said plainly rather than implied by a blank. */}
      <div
        data-testid="not-built"
        className="flex flex-col gap-3 rounded-md border border-line bg-surface p-5"
      >
        <p className="text-body-md text-ink-secondary">{tp('emergencyComing', LOCALE)}</p>
        <p className="text-caption text-ink-muted">{tp('comingSoon', LOCALE)}</p>
      </div>
    </TabScreen>
  );
}
