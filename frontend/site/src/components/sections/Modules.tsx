import { copy } from '@/content/copy';

import { Icon } from '../icons';

import type { IconName } from '../icons';
import type { Locale } from '@/content/copy';
import type { ReactNode } from 'react';

const ICONS: readonly IconName[] = [
  'phone',
  'desk',
  'ticket',
  'doctor',
  'bed',
  'siren',
  'flask',
  'pill',
  'chart',
  'rocket',
  'upload',
  'map',
];

/** The breadth of the platform in one band; a slow drift, still under reduced motion. */
export function Modules({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  const row = (hidden: boolean): ReactNode => (
    <ul className="modules-row" aria-hidden={hidden ? 'true' : undefined}>
      {t.modules.map((name, index) => (
        <li key={name}>
          <Icon name={ICONS[index] ?? 'sparkle'} />
          {name}
        </li>
      ))}
    </ul>
  );
  return (
    <section className="modules" aria-label={t.modulesLabel}>
      <p className="modules-label">{t.modulesLabel}</p>
      <div className="modules-track">
        {row(false)}
        {row(true)}
      </div>
    </section>
  );
}
