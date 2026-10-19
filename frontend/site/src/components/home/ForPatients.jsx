import { copy } from '@/content/copy';

import { fmt } from '../format';
import { PatientAppButton } from '../links';
import { Reveal } from '../motion';
import { DriftImage } from '../scroll';

/**
 * Built for patients (S-C-04): warmer and lighter in tone, the photograph on
 * the other side. Three steps of the journey, then the patient app itself —
 * always named a demonstration (FR-SEC-08).
 */
export function ForPatients({ locale }) {
  const c = copy[locale];
  const t = c.forPatients;
  return (
    <section id="patients" className="spread spread-patients" aria-labelledby="patients-title">
      <div className="spread-copy">
        <Reveal>
          <p className="eyebrow eyebrow-teal">{t.label}</p>
          <h2 id="patients-title" className="display-l">
            {t.title}
          </h2>
          <p className="lead">{t.body}</p>
        </Reveal>
        <ol className="journey">
          {t.steps.map(([title, body], index) => (
            <li key={title}>
              <span className="journey-step" aria-hidden="true">
                {fmt(index + 1, locale)}
              </span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
        <div className="actions">
          <PatientAppButton locale={locale} />
        </div>
        <p className="fine-print">{c.demoNotice}</p>
      </div>
      <DriftImage
        name="patient"
        alt={t.alt}
        sizes="(max-width: 1023px) 100vw, 52vw"
        className="spread-photo"
      />
    </section>
  );
}
