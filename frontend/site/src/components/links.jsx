import { contactEmail, copy, demoHref, hospitalsHref, patientAppHref } from '@/content/copy';

import { Icon } from './icons';

/*
 * The site's destinations, each a real link (owner, 12 October 2026): For
 * Hospitals is a page of this site, For Patients opens the patient app in a
 * new tab and always says it is a demonstration, Request a Demo opens the
 * visitor's email. No control here scrolls the page.
 */

export const NEW_TAB = { target: '_blank', rel: 'noopener noreferrer' };

/** Says, to every reader, that the patient app is a demo and leaves this site. */
export function DemoTag({ locale }) {
  return (
    <>
      <span className="demo-tag">{copy[locale].demoTag}</span>
      <span className="sr-only">{copy[locale].newTab}</span>
    </>
  );
}

/** The two audience doors: the hero and the mobile menu share them. */
export function AudienceDoors({ locale, className = '' }) {
  const t = copy[locale].hero;
  return (
    <nav className={`doors ${className}`} aria-label={t.choose}>
      <a href={hospitalsHref(locale)} className="door door-hospitals" data-door="hospitals">
        <span className="door-title">{t.hospitals}</span>
        <span className="door-sub">{t.hospitalsSub}</span>
        <span className="door-arrow" aria-hidden="true">
          <Icon name="arrow" />
        </span>
      </a>
      <a href={patientAppHref} {...NEW_TAB} className="door door-patients" data-door="patients">
        <span className="door-title">{t.patients}</span>
        <span className="door-sub">
          {t.patientsSub}
          <DemoTag locale={locale} />
        </span>
        <span className="door-arrow" aria-hidden="true">
          <Icon name="external" />
        </span>
      </a>
    </nav>
  );
}

export function DemoButton({ locale, variant = 'primary', className = '' }) {
  return (
    <a href={demoHref} className={`button button-${variant} ${className}`}>
      {copy[locale].demo}
      <Icon name="external" className="icon button-icon" />
    </a>
  );
}

export function PatientAppButton({ locale }) {
  return (
    <a href={patientAppHref} {...NEW_TAB} className="button button-light" data-door="patients">
      {copy[locale].forPatients.open}
      <DemoTag locale={locale} />
      <Icon name="external" className="icon button-icon" />
    </a>
  );
}

export function HospitalsButton({ locale }) {
  return (
    <a href={hospitalsHref(locale)} className="button button-primary" data-door="hospitals">
      {copy[locale].forHospitals.explore}
      <Icon name="arrow" className="icon button-icon" />
    </a>
  );
}

export function EmailLink({ className = '' }) {
  return (
    <a href={`mailto:${contactEmail}`} className={`text-link ${className}`}>
      <Icon name="mail" className="icon" />
      {contactEmail}
    </a>
  );
}
