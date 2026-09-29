/**
 * `S-B-00c` Set your own password (pilot step 21, APP_FLOW.md B0).
 *
 * Shown before any console to somebody whose password an administrator set
 * (`must_change_password`, 0027). The server enforces it too: until this
 * succeeds, the token opens nothing else (`AUTH_PASSWORD_CHANGE_REQUIRED`).
 * The current password is asked for again, and the new one twice.
 */

'use client';

import { useState, type FormEvent, type ReactNode } from 'react';

import { t, type ConsoleKey } from '@platform/i18n';
import { Button, Input, useLocale } from '@platform/ui';

import { ConsoleLanguageSwitch } from '@/components/ConsoleLanguageSwitch';
import { changePassword, signOut, type PasswordOutcome } from '@/lib/staffAuth';

const MIN_LENGTH = 10;

const REASON: Record<Extract<PasswordOutcome, { ok: false }>['reason'], ConsoleKey> = {
  wrong: 'passwordWrong',
  short: 'passwordShort',
  unchanged: 'passwordUnchanged',
  locked: 'loginInvalid',
  offline: 'loginOffline',
  failed: 'loginFailed',
};

export function ChangePassword({
  onChanged,
  onSignedOut,
}: {
  readonly onChanged: () => void;
  readonly onSignedOut: () => void;
}): ReactNode {
  const locale = useLocale();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ConsoleKey | null>(null);

  const tooShort = next !== '' && [...next].length < MIN_LENGTH;
  const mismatch = repeat !== '' && repeat !== next;
  const ready = current !== '' && next !== '' && !tooShort && repeat === next;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const outcome = await changePassword(current, next);
    setBusy(false);
    if (outcome.ok) {
      onChanged();
      return;
    }
    setError(REASON[outcome.reason]);
  }

  return (
    <div className="min-h-screen">
      <header className="bg-brand-700 text-ink-inverse">
        <div className="mx-auto flex max-w-[1040px] items-center gap-4 px-8 py-8">
          <h1 className="font-reading text-title-lg">{t('passwordTitle', locale)}</h1>
          <ConsoleLanguageSwitch />
        </div>
      </header>

      <main className="mx-auto flex max-w-[520px] flex-col gap-6 p-8" data-testid="change-password">
        <p className="text-body-md text-ink-secondary">{t('passwordIntro', locale)}</p>

        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <Input
            label={t('passwordCurrent', locale)}
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
            label={t('passwordNew', locale)}
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
            label={t('passwordRepeat', locale)}
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

          <Button
            type="submit"
            {...(ready ? {} : { disabled: true, disabledReason: t('passwordNeedsFields', locale) })}
            loading={busy}
            data-testid="password-submit"
          >
            {t('passwordSubmit', locale)}
          </Button>
        </form>

        <Button
          variant="secondary"
          onClick={() => {
            void signOut().then(onSignedOut);
          }}
        >
          {t('signOut', locale)}
        </Button>
      </main>
    </div>
  );
}
