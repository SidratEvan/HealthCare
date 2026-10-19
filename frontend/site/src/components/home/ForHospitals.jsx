import { copy } from '@/content/copy';

import { ordinal } from '../format';
import { DemoButton, HospitalsButton } from '../links';
import { Reveal } from '../motion';
import { DriftImage } from '../scroll';

/**
 * Built for hospitals (S-C-02): the case first, then the team photograph as a
 * full-width cinematic band — wide enough to keep all three doctors in frame —
 * then four capabilities in a row. No screenshots, no workflows; the next step
 * is the hospital page or a demonstration.
 */
export function ForHospitals({ locale }) {
  const t = copy[locale].forHospitals;
  return (
    <section id="hospitals" className="hospitals" aria-labelledby="hospitals-title">
      <div className="shell section-head">
        <Reveal>
          <p className="eyebrow eyebrow-blue">{t.label}</p>
          <h2 id="hospitals-title" className="display-l">
            {t.title}
          </h2>
        </Reveal>
        <Reveal className="section-head-side" delay={0.1}>
          <p className="lead">{t.body}</p>
          <div className="actions">
            <HospitalsButton locale={locale} />
            <DemoButton locale={locale} variant="quiet" />
          </div>
        </Reveal>
      </div>
      <DriftImage name="team" alt={t.alt} sizes="100vw" className="band-photo" />
      <div className="shell">
        <ol className="capabilities-row">
          {t.points.map(([title, body], index) => (
            <li key={title}>
              <span className="capability-index" aria-hidden="true">
                {ordinal(index + 1, locale)}
              </span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
