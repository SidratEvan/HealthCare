'use client';

/**
 * The hospital's logo and name, with Powered by MedLiveBD beneath, at the head
 * of a console that has no rail: the administrator's dashboard, settings and
 * the doctor's console (plan K4; `PRD.md` `FR-BRD-12`). The rail draws the
 * same three things itself.
 */

import { localName, t, type Locale } from '@platform/i18n';

import { useWorkspaceBrand } from '@/hooks/useWorkspaceBrand';
import { readDemoSession } from '@/lib/demo';

import type { ReactNode } from 'react';

export function WorkspaceBrandMark({ locale }: { readonly locale: Locale }): ReactNode {
  const { brand, logo, hospitalId } = useWorkspaceBrand();
  const session = readDemoSession();
  if (hospitalId === null) return null;

  const name =
    brand !== null
      ? localName(locale, brand.nameBn, brand.nameEn)
      : session?.hospitalNameBn === undefined
        ? null
        : localName(locale, session.hospitalNameBn, session.hospitalNameEn);

  return (
    <div
      className="flex items-center gap-3"
      data-testid="brand-mark"
      data-brand={brand?.theme == null ? 'platform' : 'hospital'}
    >
      {logo === null ? null : (
        <img src={logo} alt="" className="max-h-10 max-w-24 rounded-sm" data-testid="brand-logo" />
      )}
      <div className="min-w-0">
        {name === null ? null : (
          <p className="text-title-sm font-bold text-brand-700" data-testid="brand-name">
            {name}
          </p>
        )}
        <p className="text-caption text-ink-muted" data-testid="brand-powered-by">
          {t('consolePoweredBy', locale)}
        </p>
      </div>
    </div>
  );
}
