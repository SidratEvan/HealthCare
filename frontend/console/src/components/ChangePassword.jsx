/**
 * `S-B-00c` Set your own password (pilot step 21, APP_FLOW.md B0).
 *
 * Shown before any console to somebody whose password an administrator set
 * (`must_change_password`, 0027). The server enforces it too: until this
 * succeeds, the token opens nothing else (`AUTH_PASSWORD_CHANGE_REQUIRED`).
 * The current password is asked for again, and the new one twice.
 */

'use client';

import { useState } from 'react';

import { CONSOLE, t } from '@platform/i18n';
import { ConsoleAction, ConsoleInput as Input, useLocale } from '@platform/ui';

import { StaffAccessFrame, accessFieldLabel } from '@/components/StaffAccessFrame';
import { changePassword, signOut } from '@/lib/staffAuth';

const MIN_LENGTH = 10;

const REASON = {
  wrong: 'passwordWrong',
  short: 'passwordShort',
  unchanged: 'passwordUnchanged',
  locked: 'loginInvalid',
  offline: 'loginOffline',
  failed: 'loginFailed',
};

export function ChangePassword({ onChanged, onSignedOut }) {
  const locale = useLocale();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const tooShort = next !== '' && [...next].length < MIN_LENGTH;
  const mismatch = repeat !== '' && repeat !== next;
  const ready = current !== '' && next !== '' && !tooShort && repeat === next;

  async function submit(event) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const outcome = await changePassword(current, next);
    setBusy(false);
    if (outcome.ok) {
      setCurrent('');
      setNext('');
      setRepeat('');
      onChanged();
      return;
    }
    setError(REASON[outcome.reason]);
  }

  return (
    <StaffAccessFrame title="passwordTitle" description="passwordIntro" step={1}>
      <div className="cf-stack" data-testid="change-password">
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <Input
            label={accessFieldLabel('passwordCurrent', locale)}
            kind="password"
            density="console"
            autoComplete="current-password"
            required
            value={current}
            data-testid="password-current"
            onChange={(event) => {
              setCurrent(event.target.value);
            }}
          />
          <Input
            label={accessFieldLabel('passwordNew', locale)}
            kind="password"
            density="console"
            autoComplete="new-password"
            required
            value={next}
            data-testid="password-new"
            {...(tooShort ? { error: t('passwordShort', locale) } : {})}
            onChange={(event) => {
              setNext(event.target.value);
            }}
          />
          <Input
            label={accessFieldLabel('passwordRepeat', locale)}
            kind="password"
            density="console"
            autoComplete="new-password"
            required
            value={repeat}
            data-testid="password-repeat"
            {...(mismatch ? { error: t('passwordMismatch', locale) } : {})}
            onChange={(event) => {
              setRepeat(event.target.value);
            }}
          />

          {error === null ? null : (
            <p
              role="alert"
              className="rounded-sm bg-alert-100 px-3 py-2 text-body-sm text-alert-700"
              data-testid="password-error"
            >
              {t(error, locale)}
            </p>
          )}

          <ConsoleAction
            label={CONSOLE.passwordSubmit}
            type="submit"
            {...(ready ? {} : { disabled: true, disabledReason: t('passwordNeedsFields', locale) })}
            loading={busy}
            data-testid="password-submit"
          />
        </form>

        <ConsoleAction
          label={CONSOLE.signOut}
          variant="secondary"
          onClick={() => {
            void signOut().then(onSignedOut);
          }}
        />
      </div>
    </StaffAccessFrame>
  );
}
