/**
 * `S-A-02` Home (`APP_FLOW.md` A2).
 *
 * The emergency card is first and full-width and stays above the fold
 * (`FRONTEND.md` §6.3): "never A/B tested for conversions; never moved below
 * the fold". Somebody opening this app in an emergency has seconds and no
 * patience for a menu.
 *
 * A server component. Nothing here is live, so nothing here needs a client
 * bundle — which is most of how the patient app stays inside its 180 KB budget
 * (FRONTEND.md §11.4) on a 3G connection.
 */

import { SPECIALTIES } from '@platform/domain';
import { tp } from '@platform/i18n';
import { Card } from '@platform/ui';

import type { ReactNode } from 'react';

const LOCALE = 'bn' as const;

export default function Home(): ReactNode {
  return (
    <main className="mx-auto flex max-w-[480px] flex-col gap-6 p-5">
      <p className="rounded-sm bg-warn-100 px-3 py-2 text-caption text-warn-700">
        {tp('demoBanner', LOCALE)}
      </p>

      <header>
        <h1 className="font-reading text-title-lg">{tp('appName', LOCALE)}</h1>
      </header>

      {/*
        <EmergencyEntry> in spirit: full width, alert fill, one line of Bangla
        saying what it does. The component itself lands with step 15, where
        the screen behind it exists.
      */}
      <a
        href="/emergency"
        className="flex min-h-[92px] flex-col justify-center rounded-lg bg-alert-600 p-5 text-white"
      >
        <span className="text-title-md font-semibold">{tp('emergency', LOCALE)}</span>
        <span className="mt-1 text-body-sm opacity-90">{tp('emergencyLine', LOCALE)}</span>
      </a>

      <section className="flex flex-col gap-3">
        <h2 className="text-title-sm">{tp('chooseSpecialty', LOCALE)}</h2>

        <ul className="grid grid-cols-2 gap-3">
          {SPECIALTIES.map((specialty) => (
            <li key={specialty.code}>
              <a href={`/book?specialty=${specialty.code}`} className="block">
                <Card>
                  {/*
                    ICO-03: an icon never appears alone in the patient app.
                    Older users do not decode pictograms reliably, so the name
                    carries the meaning and nothing else has to.
                  */}
                  <span className="text-body-lg">{specialty.nameBn}</span>
                </Card>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
