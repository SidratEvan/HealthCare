/**
 * Keeps the document itself in the chosen language.
 *
 * `<html lang>` is load-bearing: `tokens.css` keys the Bangla typesetting
 * rules off it — the 1.65 line-height floor, no letter-spacing, no conjunct
 * breaking (`TYP-01`, `TYP-02`, `TYP-06`) — and a screen reader picks its
 * voice from it. Left at `bn` under English copy, English would be read aloud
 * in a Bangla voice and set with Bangla's line-height.
 *
 * The root layouts are server components and render `lang="bn"`, the default;
 * this corrects it once the stored choice is known, and on every switch after.
 * The tab title follows for the same reason: it is the one piece of copy
 * that lives in the layout's metadata rather than in a component.
 */

'use client';

import { useEffect } from 'react';

import type { Locale } from '@platform/i18n';

import { useLocale } from './store.js';

export interface LocaleDocumentProps {
  /** The tab title in each language, as the layout's metadata gives it in `bn`. */
  readonly title: Readonly<Record<Locale, string>>;
}

export function LocaleDocument({ title }: LocaleDocumentProps): null {
  const locale = useLocale();
  const heading = title[locale];

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = heading;
  }, [locale, heading]);

  return null;
}
