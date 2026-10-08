'use client';

/**
 * The line that says what is on the screen is for display only (`FR-DEM-07`)
 * — drawn on a demonstration, and nowhere else.
 *
 * Four screens each printed it whatever they were running against. On a
 * hospital's own server it is false, and a patient reading "this is a
 * demonstration" above their own serial has been told it is not real. So it
 * follows what the server says (`GET /config`), and stays off until the
 * server has said: a demonstration without its label for a moment has lost
 * nothing, and the other mistake is the one that matters.
 */

import { tp } from '@platform/i18n';
import { useLocale } from '@platform/ui';

import { useDeployment } from '@/hooks/useDeployment';

import type { ReactNode } from 'react';

export function DemoBanner(): ReactNode {
  const locale = useLocale();
  const deployment = useDeployment();

  if (deployment?.demo !== true) return null;

  return (
    <p
      data-testid="demo-banner"
      className="flex items-start gap-2 self-start rounded-xs bg-warn-100 px-3 py-1 text-caption text-warn-700"
    >
      <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-pill bg-warn-600" />
      <span>{tp('demoBanner', locale)}</span>
    </p>
  );
}
