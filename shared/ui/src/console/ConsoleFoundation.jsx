'use client';

/** Opt-in console presentation (GR-03, GR-06, FR-BRD-12, A11Y-03/07).
 * Callers supply authorised navigation and real identity. Nothing here routes,
 * authenticates, writes records or owns a clinical/offline state machine.
 */
import * as Dialog from '@radix-ui/react-dialog';
import { createContext, useContext, useId, useState } from 'react';

import { CONSOLE, t } from '@platform/i18n';

import { contrastRatio } from '../a11y/contrast.js';
import { Button } from '../components/Button.jsx';
import { Card } from '../components/Card.jsx';
import { Input } from '../components/Input.jsx';
import { LanguageSwitch } from '../locale/LanguageSwitch.jsx';
import { useLocale } from '../locale/store.js';
const BRAND_KEYS = [
  'brand-900',
  'brand-700',
  'brand-600',
  'brand-300',
  'brand-100',
  'brand-border',
];
const BrandContext = createContext({});
/** Existing dialog portals can opt into their caller's console branding. */
export function useConsoleBrandStyle() {
  return useContext(BrandContext);
}

/** Only the existing six permitted brand colours enter the scoped theme.
 * The CSS token file owns the default and all immutable status colours.
 */
export function consoleBrandStyle(colors) {
  if (colors == null || BRAND_KEYS.some((key) => !/^#[\da-f]{6}$/i.test(colors[key]))) return {};
  if (
    contrastRatio(colors['brand-600'], '#ffffff') < 4.5 ||
    contrastRatio(colors['brand-700'], '#f2f5f9') < 4.5
  )
    return {};
  return Object.fromEntries(BRAND_KEYS.map((key) => [`--${key}`, colors[key]]));
}

export function ConsoleTheme({ brand, children }) {
  const style = consoleBrandStyle(brand);
  return (
    <BrandContext.Provider value={style}>
      <div className="console-foundation" style={style}>
        {children}
      </div>
    </BrandContext.Provider>
  );
}

export function BilingualLabel({ label }) {
  const locale = useLocale();
  const alternate = locale === 'bn' ? 'en' : 'bn';
  return (
    <span className="cf-bilingual">
      <span lang={locale}>{label[locale]}</span>
      {label[alternate] === label[locale] ? null : (
        <small lang={alternate}>{label[alternate]}</small>
      )}
    </span>
  );
}

export function ConsoleAction({ label, onClick, loading = false, ...rest }) {
  const locale = useLocale();
  const reasonId = useId();
  return (
    <span className="cf-action">
      <Button
        {...rest}
        loading={loading}
        aria-label={rest['aria-label'] ?? label[locale]}
        aria-describedby={
          rest.disabled
            ? [rest['aria-describedby'], reasonId].filter(Boolean).join(' ')
            : rest['aria-describedby']
        }
        onClick={(event) => {
          if (loading === true) {
            event.preventDefault();
            return;
          }
          onClick?.(event);
        }}
      >
        <BilingualLabel label={label} />
      </Button>
      {rest.disabled ? (
        <small id={reasonId} className="cf-action-reason">
          {rest.disabledReason}
        </small>
      ) : null}
    </span>
  );
}

/** Existing labelled/validated field behaviour, with scoped visual styling. */
export const ConsoleInput = Input;

export function ConsoleHeader({ identity, logo, workspace, role, actions }) {
  const locale = useLocale();
  const [failedLogo, setFailedLogo] = useState(null);
  return (
    <header className="cf-header">
      <div className="cf-identity">
        <div className="cf-logo" aria-hidden="true">
          {logo != null && logo !== failedLogo ? (
            <img src={logo} alt="" onError={() => setFailedLogo(logo)} />
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M5 21V5h14v16M3 21h18M9 21v-5h6v5M9 10h6M12 7v6" />
            </svg>
          )}
        </div>
        <div className="cf-identity-copy">
          <strong title={identity[locale]}>{identity[locale]}</strong>
          <span>{t('consolePoweredBy', locale)}</span>
        </div>
      </div>
      {workspace === undefined ? null : (
        <div className="cf-workspace">
          <BilingualLabel label={workspace} />
        </div>
      )}
      <div className="cf-header-actions">
        {role === undefined ? null : <span className="cf-role">{role[locale]}</span>}
        {actions}
        <LanguageSwitch label={t('language', locale)} />
      </div>
    </header>
  );
}

/** Presentation filter only. Server authorisation remains authoritative. */
export function consoleNavigationFor(choices, roles, restricted = false) {
  return restricted
    ? []
    : choices.filter(
        (choice) => choice.enabled && choice.roles.some((role) => roles.includes(role)),
      );
}

export function ConsoleShell({ header, navigation, children }) {
  const locale = useLocale();
  const mainId = useId();
  return (
    <div className="cf-shell">
      <a className="cf-skip" href={`#${mainId}`}>
        {t('foundationSkip', locale)}
      </a>
      {header}
      <div className="cf-body">
        {navigation.length === 0 ? null : (
          <nav className="cf-nav" aria-label={t('foundationNavigation', locale)}>
            {navigation.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={item.current === true ? 'page' : undefined}
                onClick={item.onSelect}
              >
                {item.icon === undefined ? (
                  <span className="cf-nav-mark" aria-hidden="true" />
                ) : (
                  <span aria-hidden="true">{item.icon}</span>
                )}
                <BilingualLabel label={item.label} />
              </button>
            ))}
          </nav>
        )}
        <main id={mainId} tabIndex={-1} className="cf-main">
          {children}
        </main>
      </div>
    </div>
  );
}

export function ConsolePageHeader({ title, description, actions }) {
  const locale = useLocale();
  return (
    <div className="cf-page-heading">
      <div>
        <h1>{title[locale]}</h1>
        {description === undefined ? null : <p>{description[locale]}</p>}
      </div>
      {actions}
    </div>
  );
}

export function ConsolePanel({ title, description, children }) {
  const locale = useLocale();
  return (
    <section className="cf-panel">
      <Card>
        <h2>{title[locale]}</h2>
        {description === undefined ? null : <p className="cf-secondary">{description[locale]}</p>}
        <div className="cf-panel-content">{children}</div>
      </Card>
    </section>
  );
}
export function ConsoleStatus({ tone = 'neutral', label }) {
  const locale = useLocale();
  return (
    <span className={`cf-status cf-tone-${tone}`}>
      <span aria-hidden="true" />
      {label[locale]}
    </span>
  );
}

export function ConsoleFeedback({ tone, title, description }) {
  const locale = useLocale();
  return (
    <div className={`cf-feedback cf-tone-${tone}`} role={tone === 'alert' ? 'alert' : 'status'}>
      <strong>{title[locale]}</strong>
      {description === undefined ? null : <p>{description[locale]}</p>}
    </div>
  );
}

export function ConsoleState({ kind, description, onRetry }) {
  const locale = useLocale();
  const title = {
    loading: CONSOLE.loading,
    offline: CONSOLE.offline,
    error: CONSOLE.loadFailed,
    empty: CONSOLE.foundationEmpty,
  }[kind];
  return (
    <div
      className={`cf-state cf-state-${kind}`}
      role={kind === 'error' ? 'alert' : 'status'}
      aria-busy={kind === 'loading' || undefined}
    >
      <strong>{title[locale]}</strong>
      <p>{description[locale]}</p>
      {kind === 'loading' ? <div className="cf-skeleton" aria-hidden="true" /> : null}
      {onRetry === undefined ? null : (
        <ConsoleAction label={CONSOLE.retry} variant="secondary" onClick={onRetry} />
      )}
    </div>
  );
}

/** Scoped Radix portals keep the theme without touching document/body tokens. */
function ConsoleDialog({
  title,
  description,
  trigger,
  children,
  open,
  onOpenChange,
  dismissible = true,
  help = false,
}) {
  const locale = useLocale();
  const style = useContext(BrandContext);
  return (
    <Dialog.Root
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
    >
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="console-foundation cf-overlay" style={style} />
        <Dialog.Content
          className={`console-foundation cf-dialog${help ? ' cf-help' : ''}`}
          style={style}
          // Keep dialog keys from reaching a workspace's window shortcuts.
          // Native editing and Radix Tab/Escape handling still work normally.
          onKeyDown={(event) => event.stopPropagation()}
          onPointerDownOutside={(event) => {
            if (!dismissible) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (!dismissible) event.preventDefault();
          }}
        >
          <div className="cf-dialog-heading">
            <Dialog.Title asChild>
              <h2>
                <BilingualLabel label={title} />
              </h2>
            </Dialog.Title>
            {dismissible ? (
              <Dialog.Close asChild>
                <button
                  className="cf-close"
                  type="button"
                  aria-label={t('foundationClose', locale)}
                >
                  ×
                </button>
              </Dialog.Close>
            ) : null}
          </div>
          <Dialog.Description className="cf-secondary">{description[locale]}</Dialog.Description>
          <div className="cf-dialog-content">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function ConsoleHelp({ topic }) {
  return (
    <ConsoleDialog
      title={topic.title}
      description={CONSOLE.foundationHelpKeepsWork}
      help
      trigger={
        <button className="cf-help-button" type="button">
          <span className="cf-help-symbol" aria-hidden="true">
            ?
          </span>
          <BilingualLabel label={CONSOLE.foundationHelp} />
        </button>
      }
    >
      <ol className="cf-help-steps" data-help-topic={topic.id}>
        {topic.steps.map((step, index) => (
          <li key={index}>
            <BilingualLabel label={step} />
          </li>
        ))}
      </ol>
    </ConsoleDialog>
  );
}

export function ConsoleConfirmation({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending = false,
}) {
  const locale = useLocale();
  return (
    <ConsoleDialog
      open={open}
      onOpenChange={onOpenChange}
      trigger={trigger}
      title={title}
      description={description}
      dismissible={false}
    >
      <div className="cf-confirm-actions">
        <ConsoleAction
          label={CONSOLE.foundationGoBack}
          variant="secondary"
          {...(pending ? { disabled: true, disabledReason: t('foundationWait', locale) } : {})}
          onClick={() => onOpenChange(false)}
        />
        <ConsoleAction
          label={confirmLabel}
          variant="danger-quiet"
          loading={pending}
          onClick={onConfirm}
        />
      </div>
    </ConsoleDialog>
  );
}
