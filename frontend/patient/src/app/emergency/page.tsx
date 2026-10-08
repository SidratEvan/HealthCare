/**
 * `S-A-10` Emergency triage (`APP_FLOW.md` A6, `FR-PAT-40..42`, `FR-PAT-47`).
 *
 * No login, no phone number, no onboarding (`GR-08`, principle 7). The order
 * is the order of what saves a life, in Visual Direction 2's form
 * (FRONTEND.md §0.5, 2026-10-07):
 *
 *   1. **`BTN-A10-999`** — "`tel:999` immediately; always visible at top",
 *      with the conditions that mean *call first* named above it.
 *   2. **`BTN-A10-CRITICAL`** "জীবন ঝুঁকিতে" (`FR-PAT-41`, the owner's ruling
 *      of 2026-09-21) goes straight to the best ER now — no browsing.
 *   3. **`BTN-A10-URGENT`** is the "কী হয়েছে?" heading over **`CHIP-A10-<type>`**,
 *      `FR-PAT-42`'s eight problems, shown at once rather than behind a tap,
 *      each to a ranked list of hospitals that can treat it.
 *
 * Written for P6: panicked, one-handed, possibly in a moving car. Nothing
 * needs typing, and red is spent on this screen only on the call and the
 * life-in-danger route, so it still means something here.
 *
 * Every control here is a link, so the screen works the instant it is painted,
 * before hydration, and on a phone where the script has not arrived. It is a
 * client component only so that it can read the language switch
 * (`SEG-A00-LANG`): the server still renders it whole, in Bangla, and
 * hydrating changes nothing but the language a phone chose.
 */

'use client';

import { EMERGENCY_PROBLEMS, type EmergencyProblem } from '@platform/domain';
import { problemName, tp } from '@platform/i18n';
import { useLocale } from '@platform/ui';

import {
  BandageIcon,
  BrainIcon,
  BreathIcon,
  ChevronIcon,
  ChildIcon,
  DotsIcon,
  EmergencyIcon,
  FlameIcon,
  GyneIcon,
  HeartIcon,
  PhoneIcon,
  type IconProps,
} from '@/components/icons';
import { TabScreen } from '@/components/TabScreen';

import type { ReactNode } from 'react';

/** Each problem's icon: literal and calm (`ICO-04`), beside its name. */
const PROBLEM_ICON: Record<EmergencyProblem, (props: IconProps) => ReactNode> = {
  burn: FlameIcon,
  accident: BandageIcon,
  cardiac: HeartIcon,
  stroke: BrainIcon,
  breathing: BreathIcon,
  child: ChildIcon,
  obstetric: GyneIcon,
  other: DotsIcon,
};

export default function EmergencyPage(): ReactNode {
  const locale = useLocale();
  return (
    <TabScreen title={tp('emergencyHelpTitle', locale)} back={{ fallback: '/' }}>
      <section className="flex flex-col gap-3 rounded-lg border border-alert-100 bg-alert-100 p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-pill bg-alert-600 text-white">
            <EmergencyIcon size={24} />
          </span>
          <p className="text-body-md font-semibold text-alert-700">{tp('call999Line', locale)}</p>
        </div>

        {/*
          A real `tel:` link, not a button with a handler: it works with the
          keyboard, from a screen reader's links list, and long-press offers to
          copy the number.
        */}
        <a
          href="tel:999"
          data-testid="call-999"
          className="flex min-h-[56px] items-center justify-center gap-2 rounded-md bg-alert-600 px-5 text-title-sm font-bold text-white"
        >
          <PhoneIcon size={22} />
          {tp('call999', locale)}
        </a>

        {/* FR-PAT-41: life in danger goes straight to one answer. */}
        <a
          href="/emergency/results?mode=critical"
          data-testid="emergency-critical"
          className="flex min-h-[56px] items-center gap-3 rounded-md border border-alert-600 bg-surface px-4 py-2 text-alert-700"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-body-md font-bold">{tp('emergencyCritical', locale)}</span>
            <span className="block text-body-sm">{tp('emergencyCriticalLine', locale)}</span>
          </span>
          <ChevronIcon size={18} />
        </a>
      </section>

      {/* CHIP-A10-<type>: one tap to a ranked list for that problem. */}
      <section id="problems" aria-labelledby="problems-title" className="flex flex-col gap-3">
        <div>
          <h2 id="problems-title" className="text-title-sm font-bold text-ink">
            {/* BTN-A10-URGENT: the urgent route is this list. A link to it,
                not a toggle, so a tap never hides what it should show. */}
            <a href="#problems" data-testid="emergency-urgent">
              {tp('emergencyWhatHappened', locale)}
            </a>
          </h2>
          <p className="text-body-sm text-ink-secondary">{tp('emergencyUrgentLine', locale)}</p>
        </div>

        <ul className="grid grid-cols-4 gap-2">
          {EMERGENCY_PROBLEMS.map((problem) => {
            const Icon = PROBLEM_ICON[problem];
            return (
              <li key={problem}>
                <a
                  href={`/emergency/results?problem=${problem}`}
                  data-testid={`problem-${problem}`}
                  className="flex min-h-[84px] flex-col items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-1 py-2 text-center shadow-1"
                >
                  <span className="text-alert-600">
                    <Icon size={24} />
                  </span>
                  <span className="text-body-sm leading-[1.35] font-semibold text-ink">
                    {problemName(problem, locale)}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      {/* No BTN-A10-AMB: requesting an ambulance is outside V1 (PRD.md §7.8),
          and a control that led to "not built yet" has no place on the one
          screen somebody opens in an emergency. 999 above is the ambulance. */}
    </TabScreen>
  );
}
