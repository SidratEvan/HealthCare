import { aboutHref, copy } from '@/content/copy';
import { founders } from '@/content/founders';

import { Icon } from '../icons';
import { Reveal } from '../motion';

import type { Locale } from '@/content/copy';
import type { ReactNode } from 'react';

/**
 * The people behind MedLiveBD (S-C-01): names, roles and focus, set as type —
 * no invented faces, no invented credentials. The whole story is on /about.
 */
export function People({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale].people;
  return (
    <section id="people" className="people" aria-labelledby="people-title">
      <div className="shell people-layout">
        <Reveal className="people-intro">
          <p className="eyebrow">{t.label}</p>
          <h2 id="people-title" className="display-m">
            {t.title}
          </h2>
          <a className="text-link" href={aboutHref(locale)}>
            {t.more}
            <Icon name="arrow" className="icon" />
          </a>
        </Reveal>
        <ul className="people-list">
          {founders[locale].founders.map((person) => (
            <li key={person.key} className="person">
              <h3>{person.name}</h3>
              <p className="person-role">{person.short}</p>
              <p className="person-focus">{person.focus}</p>
              {person.email === undefined ? null : (
                <a className="person-mail" href={`mailto:${person.email}`}>
                  {person.email}
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
