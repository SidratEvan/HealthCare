'use client';

/**
 * The line across the top of a console that says the data under it is for
 * display only (`FR-DEM-07`) — drawn on a demonstration, and nowhere else.
 *
 * One component, so that no screen can carry its own copy and say it over a
 * real hospital's patients (`lib/deployment.ts` says why that matters and why
 * it stays off until the server has answered).
 */

import { t } from '@platform/i18n';
import { cx, useLocale } from '@platform/ui';

import { useIsDemonstration } from '@/lib/deployment';

import type { ReactNode } from 'react';

export function DemoBanner({ className }: { readonly className?: string }): ReactNode {
  const locale = useLocale();
  const demonstration = useIsDemonstration();

  if (!demonstration) return null;

  return (
    <p
      data-testid="demo-banner"
      className={cx('bg-warn-100 px-6 py-2 text-caption text-warn-700', className)}
    >
      {t('demoBanner', locale)}
    </p>
  );
}
