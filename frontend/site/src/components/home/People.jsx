import { aboutHref } from '@/content/copy';
import { founders } from '@/content/founders';

import { Icon } from '../icons';
import { Reveal } from '../motion';

/** The founders (S-C-01): name, title, email — no story, no invented faces. */
export function People({ locale }) {
  const t = founders[locale];
  return (
    <section id="people" className="people" aria-labelledby="people-title">
      <div className="shell people-layout">
        <Reveal className="people-intro">
          <p className="eyebrow">{t.label}</p>
          <h2 id="people-title" className="display-m">
            {t.heading}
          </h2>
          <a className="text-link" href={aboutHref(locale)}>
            {t.label}
            <Icon name="arrow" className="icon" />
          </a>
        </Reveal>
        <ul className="people-list">
          {t.founders.map((person) => (
            <li key={person.key} className="person">
              <h3>{person.name}</h3>
              <p className="person-role">{person.title}</p>
              <a className="person-mail" href={`mailto:${person.email}`}>
                {person.email}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
