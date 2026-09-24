/**
 * `SEG-A00-LANG` / `SEG-B00-LANG` — the language switch (`GR-06`, `I18N-08`).
 *
 * Two buttons, বাংলা and English, at the top of every patient screen and in
 * the header of every console. Pressing one changes every screen of the app
 * at once and is remembered on this device (`store.ts`).
 *
 * Each button is named in its own language and marked with its own `lang`, so
 * a screen reader pronounces "বাংলা" as Bangla on the English screen too. The
 * pair is a group of toggles rather than a single button that flips, because
 * a button reading "English" is ambiguous — is that the language now, or the
 * one it will change to?
 */

'use client';

import { LANGUAGE_NAMES, LOCALES } from '@platform/i18n';

import { cx } from '../components/cx.js';

import { setLocale, useLocale } from './store.js';

import type { ReactNode } from 'react';

export interface LanguageSwitchProps {
  /** The group's accessible name, in the current language ("ভাষা"). */
  readonly label: string;
  readonly className?: string;
}

export function LanguageSwitch({ label, className }: LanguageSwitchProps): ReactNode {
  const locale = useLocale();

  return (
    <div
      role="group"
      aria-label={label}
      data-testid="language-switch"
      className={cx(
        'inline-flex shrink-0 gap-1 rounded-md border border-line-strong bg-surface p-1',
        className,
      )}
    >
      {LOCALES.map((option) => {
        const selected = option === locale;
        return (
          <button
            key={option}
            type="button"
            lang={option}
            aria-pressed={selected}
            data-testid={`language-${option}`}
            onClick={() => {
              setLocale(option);
            }}
            className={cx(
              'inline-flex min-h-touch items-center rounded-sm px-3 font-ui text-body-sm font-semibold',
              'transition-colors duration-instant ease-standard',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2',
              selected ? 'bg-brand-600 text-white' : 'text-ink-secondary hover:bg-sunken',
            )}
          >
            {LANGUAGE_NAMES[option]}
          </button>
        );
      })}
    </div>
  );
}
