/**
 * `S-B-00` Staff login (pilot step 21, APP_FLOW.md B0).
 *
 * What the console shows whenever the deployment is not a demonstration, and
 * on a demo when somebody chooses to sign in with an account. Email and
 * password; the hospital code only appears when the server asks for it
 * (`AUTH_HOSPITAL_REQUIRED`). A wrong email and a wrong password get one
 * message, because saying which would tell a stranger who has an account.
 *
 * A right password for an account with a second factor on is answered with a
 * challenge, and the screen becomes `S-B-00b` (`TwoFactorCode`, pilot step 28)
 * in place — the email stays filled if the person goes back.
 *
 * The four states (`GR-03`): the form is the empty state; submitting is the
 * loading state (the button says so and the fields stay filled); a refusal is
 * the error state, beside the field it concerns; offline says so before
 * anything is sent.
 */

'use client';

import { useEffect, useState } from 'react';

import { CONSOLE, format, formatClock, numeralsFor, t } from '@platform/i18n';
import { ConsoleAction, ConsoleInput as Input, useLocale } from '@platform/ui';

import { StaffAccessFrame, accessFieldLabel } from '@/components/StaffAccessFrame';
import { TwoFactorCode } from '@/components/TwoFactorCode';
import { adoptStaffSession, signIn } from '@/lib/staffAuth';

export function StaffLogin({ demo, ended = false, onSignedIn }) {
  const locale = useLocale();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [hospitalCode, setHospitalCode] = useState('');
  const [askCode, setAskCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const [online, setOnline] = useState(true);
  const [challenge, setChallenge] = useState(null);

  useEffect(() => {
    const update = () => {
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

  async function submit(event) {
    event.preventDefault();
    if (busy || !online) return;
    setBusy(true);
    setFailure(null);
    const outcome = await signIn({ email, password, ...(askCode ? { hospitalCode } : {}) });
    setBusy(false);
    if (outcome.ok) {
      if ('challenge' in outcome) {
        setPassword('');
        setShowPassword(false);
        setChallenge(outcome.challenge);
        return;
      }
      setPassword('');
      setShowPassword(false);
      adoptStaffSession(outcome.session);
      onSignedIn();
      return;
    }
    if (outcome.reason === 'hospital_required') setAskCode(true);
    setFailure(outcome);
  }

  function message(failed) {
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
      case 'rate_limited':
        return t('accessRateLimited', locale);
    }
  }

  const ready =
    online && email.trim() !== '' && password !== '' && (!askCode || hospitalCode.trim() !== '');

  return (
    <StaffAccessFrame
      title={challenge === null ? 'loginTitle' : 'tfaCodeTitle'}
      description={challenge === null ? 'loginIntro' : 'tfaCodeIntro'}
    >
      {challenge === null ? null : (
        <TwoFactorCode
          challenge={challenge}
          onSignedIn={onSignedIn}
          onBack={() => setChallenge(null)}
        />
      )}
      <div className={challenge === null ? 'cf-stack' : 'hidden'} data-testid="staff-login">
        {ended ? (
          <p role="status" className="cf-feedback cf-tone-caution" data-testid="login-ended">
            {t('sessionExpired', locale)}
          </p>
        ) : null}
        {online ? null : (
          <p role="status" className="cf-feedback cf-tone-caution" data-testid="login-offline">
            {t('loginOffline', locale)}
          </p>
        )}
        <form
          className="cf-stack"
          noValidate
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <Input
            label={accessFieldLabel('loginEmail', locale)}
            kind="email"
            density="console"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            disabled={busy}
            value={email}
            data-testid="login-email"
            onChange={(event) => setEmail(event.target.value)}
          />
          <div className="cf-password-row">
            <Input
              label={accessFieldLabel('loginPassword', locale)}
              kind={showPassword ? 'text' : 'password'}
              density="console"
              autoComplete="current-password"
              required
              disabled={busy}
              value={password}
              data-testid="login-password"
              onChange={(event) => setPassword(event.target.value)}
            />
            <ConsoleAction
              label={showPassword ? CONSOLE.accessHidePassword : CONSOLE.accessShowPassword}
              variant="secondary"
              aria-pressed={showPassword}
              data-testid="login-show-password"
              onClick={() => setShowPassword((value) => !value)}
            />
          </div>
          {askCode ? (
            <Input
              label={accessFieldLabel('loginHospitalCode', locale)}
              density="console"
              autoCapitalize="characters"
              spellCheck={false}
              required
              disabled={busy}
              value={hospitalCode}
              helper={t('loginHospitalCodeHint', locale)}
              data-testid="login-hospital-code"
              onChange={(event) => setHospitalCode(event.target.value)}
            />
          ) : null}
          {failure === null || failure.reason === 'hospital_required' ? null : (
            <p role="alert" className="cf-feedback cf-tone-alert" data-testid="login-error">
              {message(failure)}
            </p>
          )}
          <ConsoleAction
            type="submit"
            label={CONSOLE.loginSubmit}
            fullWidth
            loading={busy}
            data-testid="login-submit"
            {...(ready
              ? {}
              : {
                  disabled: true,
                  disabledReason: t(online ? 'loginNeedsFields' : 'loginOffline', locale),
                })}
          />
        </form>
        <div className="cf-access-footer">
          <p>{t('loginForgot', locale)}</p>
          <p>{t('accessSharedComputer', locale)}</p>
          <p>
            {t('applyFromLogin', locale)}{' '}
            <a href="/?apply=1" data-testid="login-apply-link">
              {t('applyLink', locale)}
            </a>
          </p>
          {demo ? (
            <p className="cf-feedback cf-tone-caution" data-testid="login-demo-note">
              {t('loginDemoNote', locale)}
            </p>
          ) : null}
        </div>
      </div>
    </StaffAccessFrame>
  );
}
