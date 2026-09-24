'use client';

/**
 * `SEG-B00-LANG` — the language switch in every console's header (`GR-06`).
 *
 * At the right end of the header row, on the picker and on each of the eight
 * consoles, so it is in the same place whichever console a desk has open.
 * `ml-auto` pushes it there in a header that is a plain flex row; a header
 * that already spaces its ends can pass nothing.
 */

import { t } from '@platform/i18n';
import { LanguageSwitch, useLocale } from '@platform/ui';

import type { ReactNode } from 'react';

export function ConsoleLanguageSwitch({
  className = 'ml-auto',
}: {
  readonly className?: string;
}): ReactNode {
  const locale = useLocale();
  return <LanguageSwitch label={t('language', locale)} className={className} />;
}
