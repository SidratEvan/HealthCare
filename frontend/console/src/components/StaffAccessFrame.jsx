'use client';

/** Approved staff access presentation (FR-SEC-06/10, GR-06). */
import { CONSOLE, PATIENT, t } from '@platform/i18n';
import {
  BilingualLabel,
  ConsoleHeader,
  ConsoleHelp,
  ConsoleShell,
  ConsoleTheme,
  useLocale,
} from '@platform/ui';
import '@platform/ui/console.css';
import '@platform/ui/console-access.css';

export function StaffAccessFrame({ title, description, children, step }) {
  const locale = useLocale();
  return (
    <ConsoleTheme>
      <ConsoleShell
        navigation={[]}
        header={
          <ConsoleHeader
            identity={PATIENT.appName}
            logo="/brand/medlivebd-logo-light.png"
            actions={
              <ConsoleHelp
                topic={{
                  id: 'staff-access',
                  title: CONSOLE.accessHelpTitle,
                  steps: [
                    CONSOLE.accessHelpCredentials,
                    CONSOLE.accessHelpMfa,
                    CONSOLE.accessHelpShared,
                  ],
                }}
              />
            }
          />
        }
      >
        <div className="cf-access">
          <section className="cf-access-card">
            <div className="cf-access-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <circle cx="8" cy="15" r="4" />
                <path d="m11 12 9-9m-4 4 3 3m-6 0 3 3" />
              </svg>
            </div>
            {step === undefined ? null : (
              <ol className="cf-access-steps" aria-label={t('accessSteps', locale)}>
                {[
                  CONSOLE.accessPasswordStep,
                  CONSOLE.accessMfaStep,
                  CONSOLE.accessWorkspaceStep,
                ].map((label, index) => (
                  <li key={index} aria-current={index + 1 === step ? 'step' : undefined}>
                    {label[locale]}
                  </li>
                ))}
              </ol>
            )}
            <h1>
              <BilingualLabel label={CONSOLE[title]} />
            </h1>
            {description === undefined ? null : (
              <p className="cf-secondary">{t(description, locale)}</p>
            )}
            <div className="cf-stack cf-access-content">{children}</div>
          </section>
        </div>
      </ConsoleShell>
    </ConsoleTheme>
  );
}

export function accessFieldLabel(key, locale) {
  return `${t(key, locale)} · ${t(key, locale === 'bn' ? 'en' : 'bn')}`;
}
