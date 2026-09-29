/**
 * `S-B-00b` The second factor at sign-in (pilot step 28, APP_FLOW.md B0,
 * `FR-SEC-10`).
 *
 * Shown by `S-B-00` when the password was right and the account has a second
 * factor on: the six-digit code from the authenticator app, or — for a lost
 * phone — one of the recovery codes, in the same field; the server tells them
 * apart by shape. Digits typed in Bangla are read as the same digits.
 *
 * The four states (`GR-03`): the field is the empty state; checking is the
 * loading state; a wrong code, a lock or a challenge that ran out is the error
 * state, beside the field; offline says so before anything is sent. A
 * challenge that ran out goes back to the password, because only the password
 * can make a new one.
 */

'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { format, formatClock, numeralsFor, t, toLatinDigits } from '@platform/i18n';
import { Button, Input, useLocale } from '@platform/ui';

import {
  adoptStaffSession,
  verifySecondFactor,
  type Challenge,
  type CodeOutcome,
} from '@/lib/staffAuth';

type Failure = Extract<CodeOutcome, { ok: false }>;

export function TwoFactorCode({
  challenge,
  onSignedIn,
  onBack,
}: {
  readonly challenge: Challenge;
  readonly onSignedIn: () => void;
  /** Back to the password — the challenge ran out, or the person chose to. */
  readonly onBack: () => void;
}): ReactNode {
  const locale = useLocale();
  const [code, setCode] = useState('');
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
    const outcome = await verifySecondFactor(challenge.token, toLatinDigits(code));
    setBusy(false);
    if (outcome.ok) {
      adoptStaffSession(outcome.session);
      onSignedIn();
      return;
    }
    setFailure(outcome);
    if (outcome.reason === 'invalid') setCode('');
  }

  function message(failed: Failure): string {
    switch (failed.reason) {
      case 'invalid':
        return t('tfaCodeInvalid', locale);
      case 'locked':
        return format('loginLocked', locale, {
          time: failed.until === undefined ? '' : formatClock(failed.until, numeralsFor(locale)),
        });
      case 'expired':
        return t('tfaCodeExpired', locale);
      case 'offline':
        return t('loginOffline', locale);
      case 'failed':
        return t('loginFailed', locale);
    }
  }

  const ready = online && code.trim().length >= 6;

  return (
    <div className="flex flex-col gap-6" data-testid="two-factor-code">
      <div className="flex flex-col gap-2">
        <h2 className="text-title-md">{t('tfaCodeTitle', locale)}</h2>
        <p className="text-body-md text-ink-secondary">{t('tfaCodeIntro', locale)}</p>
      </div>

      {online ? null : (
        <p
          role="status"
          className="rounded-sm bg-warn-100 px-3 py-2 text-body-sm text-warn-700"
          data-testid="tfa-offline"
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
          label={t('tfaCodeLabel', locale)}
          density="console"
          autoComplete="one-time-code"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={24}
          value={code}
          helper={t('tfaCodeHint', locale)}
          data-testid="tfa-code"
          onChange={(event) => {
            setCode(event.target.value);
          }}
        />

        {failure === null ? null : (
          <p
            role="alert"
            className="rounded-sm bg-alert-100 px-3 py-2 text-body-sm text-alert-700"
            data-testid="tfa-error"
          >
            {message(failure)}
          </p>
        )}

        {failure?.reason === 'expired' ? (
          <Button type="button" onClick={onBack} data-testid="tfa-back">
            {t('tfaBack', locale)}
          </Button>
        ) : (
          <Button
            type="submit"
            {...(ready
              ? {}
              : {
                  disabled: true,
                  disabledReason: t(online ? 'tfaCodeNeeds' : 'loginOffline', locale),
                })}
            loading={busy}
            data-testid="tfa-submit"
          >
            {busy ? t('loginSubmitting', locale) : t('tfaCodeSubmit', locale)}
          </Button>
        )}
      </form>

      {failure?.reason === 'expired' ? null : (
        <Button variant="secondary" onClick={onBack} data-testid="tfa-start-again">
          {t('tfaBack', locale)}
        </Button>
      )}
    </div>
  );
}
