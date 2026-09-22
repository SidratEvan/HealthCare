/**
 * `S-A-10` Emergency triage (`APP_FLOW.md` A6, `FR-PAT-40..42`, `FR-PAT-47`).
 *
 * No login, no phone number, no onboarding (`GR-08`, principle 7). The order
 * is the order of what saves a life:
 *
 *   1. **`BTN-A10-999`** — "`tel:999` immediately; always visible at top",
 *      with the conditions that mean *call first* named beside it.
 *   2. **The split** (`FR-PAT-41`, the owner's ruling of 2026-09-21): two
 *      controls. `BTN-A10-CRITICAL` "জীবন ঝুঁকিতে" goes straight to the best
 *      ER now — no browsing. `BTN-A10-URGENT` "জরুরি" opens the problem
 *      chips for a ranked list of hospitals that can treat it.
 *   3. **`CHIP-A10-<type>`** — `FR-PAT-42`'s eight problems.
 *   4. **`BTN-A10-AMB`** — the ambulance (`FR-PAT-47`), which is build step
 *      17; it leads to the screen that says so.
 *
 * Written for P6: panicked, one-handed, possibly in a moving car. The two
 * controls are the largest things below the call, and nothing needs typing.
 *
 * No client JavaScript at all: every control here is a link or a native
 * disclosure, so the screen works the instant it is painted, before
 * hydration, and on a phone where the script has not arrived.
 */

import { EMERGENCY_PROBLEMS } from '@platform/domain';
import { problemName, tp } from '@platform/i18n';

import { AmbulanceIcon, EmergencyIcon } from '@/components/icons';
import { TabScreen } from '@/components/TabScreen';

import type { ReactNode } from 'react';

const LOCALE = 'bn' as const;

export default function EmergencyPage(): ReactNode {
  return (
    <TabScreen title={tp('emergencyTitle', LOCALE)}>
      {/*
        A real `tel:` link, not a button with a handler: it works with the
        keyboard, from a screen reader's links list, and long-press offers to
        copy the number.
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

      {/* FR-PAT-41: critical and urgent, split at the entry. */}
      <div className="grid grid-cols-1 gap-3">
        <a
          href="/emergency/results?mode=critical"
          data-testid="emergency-critical"
          className="flex min-h-[76px] flex-col justify-center rounded-lg border-2 border-alert-600 bg-alert-100 px-5 py-3 text-alert-700"
        >
          <span className="font-reading text-title-md font-bold">
            {tp('emergencyCritical', LOCALE)}
          </span>
          <span className="text-body-sm">{tp('emergencyCriticalLine', LOCALE)}</span>
        </a>

        {/*
          A native disclosure, not a React toggle. The first tap on a cheap
          phone can land before the page has hydrated, and a button whose
          handler is not attached yet does nothing — in an emergency, on the
          one control that leads to help. `<details>` opens with or without
          JavaScript; CHIP-A10-<type> are plain links inside it.
        */}
        <details className="group rounded-lg border border-line-strong bg-surface">
          <summary
            data-testid="emergency-urgent"
            className="flex min-h-[76px] cursor-pointer list-none flex-col justify-center px-5 py-3 text-ink [&::-webkit-details-marker]:hidden"
          >
            <span className="font-reading text-title-md font-bold">
              {tp('emergencyUrgent', LOCALE)}
            </span>
            <span className="text-body-sm text-ink-secondary">
              {tp('emergencyUrgentLine', LOCALE)}
            </span>
          </summary>

          {/* CHIP-A10-<type>: one tap to a ranked list for that problem. */}
          <section
            aria-labelledby="problems-title"
            className="flex flex-col gap-3 border-t border-line px-5 pb-5 pt-4"
          >
            <h2 id="problems-title" className="text-title-sm text-ink">
              {tp('emergencyWhatHappened', LOCALE)}
            </h2>
            <ul className="grid grid-cols-2 gap-3">
              {EMERGENCY_PROBLEMS.map((problem) => (
                <li key={problem}>
                  <a
                    href={`/emergency/results?problem=${problem}`}
                    data-testid={`problem-${problem}`}
                    className="flex min-h-touch items-center justify-center rounded-md border border-line-strong bg-surface px-4 py-3 text-body-lg text-ink"
                  >
                    {problemName(problem, LOCALE)}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </details>
      </div>

      {/* BTN-A10-AMB (FR-PAT-47). The ambulance flow is build step 17. */}
      <a
        href="/ambulance"
        data-testid="emergency-ambulance"
        className="flex min-h-touch items-center gap-3 rounded-md border border-line bg-surface px-4 py-3 text-body-md text-ink"
      >
        <AmbulanceIcon size={22} />
        {tp('emergencyAmbulance', LOCALE)}
      </a>
    </TabScreen>
  );
}
