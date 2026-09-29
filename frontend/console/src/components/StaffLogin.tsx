/**
 * `S-B-00` Staff login (pilot step 21, APP_FLOW.md B0).
 *
 * What the console shows whenever the deployment is not a demonstration, and
 * on a demo when somebody chooses to sign in with an account. Email and
 * password; the hospital code only appears when the server asks for it
 * (`AUTH_HOSPITAL_REQUIRED`). A wrong email and a wrong password get one
 * message, because saying which would tell a stranger who has an account.
 *
 * The four states (`GR-03`): the form is the empty state; submitting is the
 * loading state (the button says so and the fields stay filled); a refusal is
 * the error state, beside the field it concerns; offline says so before
 * anything is sent.
 */

'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { format, formatClock, numeralsFor, t } from '@platform/i18n';
import { Button, Input, useLocale } from '@platform/ui';

import { ConsoleLanguageSwitch } from '@/components/ConsoleLanguageSwitch';
import { adoptStaffSession, signIn, type SignInOutcome } from '@/lib/staffAuth';

type Failure = Extract<SignInOutcome, { ok: false }>;

export function StaffLogin({
  demo,
  ended = false,
  onSignedIn,
}: {
  /** True on a demonstration deployment: the screen shows the demo password. */
  readonly demo: boolean;
  /** Arrived here because a session ran out, not by choice. */
  readonly ended?: boolean;
  readonly onSignedIn: () => void;
}): ReactNode {
  const locale = useLocale();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [hospitalCode, setHospitalCode] = useState('');
  const [askCode, setAskCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = (): void => {
      setOnline(globalThis.navigator?.onLine !== false);
    };
    update();
    globalThis.addEventListener('online', update);
    globalThis.addEventListener('offline', update);
    return () => {
      globalThis.removeEventListener('online', update);
      globalThis.removeEventListener('offline', update);
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const outcome = await signIn({ email, password, ...(askCode ? { hospitalCode } : {}) });
    setBusy(false);
    if (outcome.ok) {
      adoptStaffSession(outcome.session);
      onSignedIn();
      return;
    }
    if (outcome.reason === 'hospital_required') setAskCode(true);
    setFailure(outcome);
  }

  function message(failed: Failure): string {
    switch (failed.reason) {
      case 'invalid':
        return t('loginInvalid', locale);
      case 'locked':
        return format('loginLocked', locale, {
          time: failed.until === undefined ? '' : formatClock(failed.until, numeralsFor(locale)),
        });
      case 'hospital_required':
        return t('loginHospitalCodeHint', locale);
      case 'no_roles':
        return t('loginNoRoles', locale);
      case 'offline':
        return t('loginOffline', locale);
      case 'failed':
        return t('loginFailed', locale);
    }
  }

  const ready =
    online && email.trim() !== '' && password !== '' && (!askCode || hospitalCode.trim() !== '');

  return (
    <div className="min-h-screen">
      <header className="bg-brand-700 text-ink-inverse">
        <div className="mx-auto flex max-w-[1040px] items-center gap-4 px-8 py-8">
          <h1 className="font-reading text-title-lg">{t('loginTitle', locale)}</h1>
          <ConsoleLanguageSwitch />
        </div>
      </header>

      <main className="mx-auto flex max-w-[520px] flex-col gap-6 p-8" data-testid="staff-login">
        <p className="text-body-md text-ink-secondary">{t('loginIntro', locale)}</p>

        {ended ? (
          <p
            role="status"
            className="rounded-sm bg-warn-100 px-3 py-2 text-body-sm text-warn-700"
            data-testid="login-ended"
          >
            {t('sessionExpired', locale)}
          </p>
        ) : null}

        {online ? null : (
          <p
            role="status"
            className="rounded-sm bg-warn-100 px-3 py-2 text-body-sm text-warn-700"
            data-testid="login-offline"
          >
            {t('loginOffline', locale)}
          </p>
        )}

        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <Input
            label={t('loginEmail', locale)}
            kind="email"
            density="console"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            data-testid="login-email"
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
          <Input
            label={t('loginPassword', locale)}
            kind="password"
            density="console"
            autoComplete="current-password"
            required
            value={password}
            data-testid="login-password"
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
          {askCode ? (
            <Input
              label={t('loginHospitalCode', locale)}
              density="console"
              autoCapitalize="characters"
              spellCheck={false}
              required
              value={hospitalCode}
              helper={t('loginHospitalCodeHint', locale)}
              data-testid="login-hospital-code"
              onChange={(event) => {
                setHospitalCode(event.target.value);
              }}
            />
          ) : null}

          {failure === null || failure.reason === 'hospital_required' ? null : (
            <p
              role="alert"
              className="rounded-sm bg-alert-100 px-3 py-2 text-body-sm text-alert-700"
              data-testid="login-error"
            >
              {message(failure)}
            </p>
          )}

          <Button
            type="submit"
            {...(ready
              ? {}
              : {
                  disabled: true,
                  disabledReason: t(online ? 'loginNeedsFields' : 'loginOffline', locale),
                })}
            loading={busy}
            data-testid="login-submit"
          >
            {busy ? t('loginSubmitting', locale) : t('loginSubmit', locale)}
          </Button>
        </form>

        <p className="text-body-sm text-ink-muted">{t('loginForgot', locale)}</p>
        {demo ? (
          <p
            className="rounded-sm bg-warn-100 px-3 py-2 text-caption text-warn-700"
            data-testid="login-demo-note"
          >
            {t('loginDemoNote', locale)}
          </p>
        ) : null}
      </main>
    </div>
  );
}
