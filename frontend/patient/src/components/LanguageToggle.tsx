'use client';

/**
 * `SEG-A00-LANG`: বাংলা | EN, in the header of every screen (FRONTEND.md §0.5).
 *
 * The same switch as `<LanguageSwitch>` in `shared/ui`, in the patient app's
 * compact form: the approved header has room for "EN", not "English". The
 * English button is still named in full to a screen reader, and both carry
 * `lang` so each is announced in its own language. The test ids are the
 * shared switch's, so a test written against either finds the same buttons.
 */

import { LANGUAGE_NAMES, LANGUAGE_SHORT_NAMES, LOCALES, tp } from '@platform/i18n';
import { setLocale, useLocale } from '@platform/ui';

import type { ReactNode } from 'react';

export function LanguageToggle(): ReactNode {
  const locale = useLocale();

  return (
    <div
      role="group"
      aria-label={tp('language', locale)}
      data-testid="language-switch"
      className="inline-flex shrink-0 items-center rounded-pill border border-line-strong bg-surface p-[3px]"
    >
      {LOCALES.map((option) => {
        const selected = option === locale;
        return (
          <button
            key={option}
            type="button"
            lang={option}
            aria-pressed={selected}
            aria-label={LANGUAGE_NAMES[option]}
            data-testid={`language-${option}`}
            onClick={() => {
              setLocale(option);
            }}
            // 36 px inside a 3 px frame and a 1 px border: the group is the
            // 44 px target (`FR-LOC-04`), and each half is half of it.
            className={`inline-flex h-9 min-w-11 items-center justify-center rounded-pill px-3 text-body-sm font-semibold transition-colors duration-instant ease-standard ${
              selected ? 'bg-brand-600 text-white' : 'text-ink-muted hover:bg-sunken'
            }`}
          >
            {LANGUAGE_SHORT_NAMES[option]}
          </button>
        );
      })}
    </div>
  );
}
