import { copy } from '@/content/copy';

import { DemoButton, EmailLink } from '../links';
import { Reveal } from '../motion';
import { DriftImage } from '../scroll';

/** The invitation (S-C-05): Dhaka at blue hour, one line, one action, one address. */
export function Closing({ locale }) {
  const c = copy[locale];
  const t = c.closing;
  return (
    <section id="contact" className="closing" aria-labelledby="contact-title">
      <DriftImage name="atmosphere" alt={t.alt} sizes="100vw" className="closing-photo" />
      <div className="closing-shade" aria-hidden="true" />
      <Reveal className="shell closing-inner">
        <h2 id="contact-title" className="display-l closing-title">
          {t.title}
        </h2>
        <p className="lead">{t.body}</p>
        <div className="actions">
          <DemoButton locale={locale} />
          <EmailLink className="on-photo" />
        </div>
        <p className="fine-print">{c.emailHint}</p>
      </Reveal>
    </section>
  );
}
