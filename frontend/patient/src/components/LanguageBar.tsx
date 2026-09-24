'use client';

/**
 * `SEG-A00-LANG` — the language switch, at the top of every screen (`GR-06`).
 *
 * Rendered once, by the root layout, above whatever page is open, so there is
 * no screen of this app — the live serial, the booking flow, the emergency
 * search — where somebody who reads English has to go looking for it. Same
 * column as every page beneath it, right-aligned, so it sits over the page's
 * own header rather than competing with it.
 */

import { tp } from '@platform/i18n';
import { LanguageSwitch, useLocale } from '@platform/ui';

import type { ReactNode } from 'react';

export function LanguageBar(): ReactNode {
  const locale = useLocale();

  return (
    <div className="mx-auto flex max-w-[480px] justify-end px-5 pt-3">
      <LanguageSwitch label={tp('language', locale)} />
    </div>
  );
}
