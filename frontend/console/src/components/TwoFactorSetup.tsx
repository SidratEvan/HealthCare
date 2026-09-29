/**
 * `S-B-00d` Turn on two-step verification (pilot step 28, APP_FLOW.md B0,
 * `FR-SEC-10`).
 *
 * An administrator meets this before any console, because the server allows
 * their token nothing else until it is done (`AUTH_2FA_SETUP_REQUIRED`).
 * Anybody else reaches it from the picker (`?view=2fa`) and may leave it.
 *
 * Three steps on one screen: install an authenticator app, scan the QR code
 * (or type the key), type the code it shows. Then the ten recovery codes,
 * shown once, and the console only after the person says they have kept them.
 *
 * The QR code is drawn in the browser from the `otpauth://` link, so the
 * secret goes from the API to this screen and nowhere else — no image service
 * ever sees it.
 *
 * The four states (`GR-03`): preparing the secret is the loading state; a
 * failure to start is the error state, with a retry; offline says so and
 * holds the button; the form itself is the empty state.
 */

'use client';

import QRCode from 'qrcode';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { t, toLatinDigits } from '@platform/i18n';
import { Button, Card, Input, useLocale } from '@platform/ui';

import { ConsoleLanguageSwitch } from '@/components/ConsoleLanguageSwitch';
import {
  enableTwoFactor,
  refreshStaffSession,
  signOut,
  startTwoFactorSetup,
} from '@/lib/staffAuth';

type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly offline: boolean }
  | { readonly kind: 'scan'; readonly secret: string; readonly qr: string | null }
  | { readonly kind: 'codes'; readonly codes: readonly string[] };

/** `ABCD EFGH …`: a key read off a screen and typed into a phone, in fours. */
function grouped(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, '$1 ');
}

export function TwoFactorSetup({
  required,
  onEnabled,
  onDone,
  onCancel,
  onSignedOut,
}: {
  /** An administrator: no way past this but through it. */
  readonly required: boolean;
  /** The second factor is on and the session replaced; the codes are still showing. */
  readonly onEnabled: () => void;
  /** The codes were kept: on to the console. */
  readonly onDone: () => void;
  /** Only when not required. */
  readonly onCancel?: () => void;
  readonly onSignedOut: () => void;
}): ReactNode {
  const locale = useLocale();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [failed, setFailed] = useState(false);
  const [kept, setKept] = useState(false);
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

  const start = useCallback(async () => {
    setPhase({ kind: 'loading' });
    const outcome = await startTwoFactorSetup();
    if (outcome.ok) {
      let qr: string | null = null;
      try {
        qr = await QRCode.toDataURL(outcome.otpauthUri, { errorCorrectionLevel: 'M', margin: 1 });
      } catch {
        // The key below still works; the QR code is the convenience.
      }
      setPhase({ kind: 'scan', secret: outcome.secret, qr });
      return;
    }
    if (outcome.reason === 'on') {
      // Turned on in another tab: this session is behind. Fetching a fresh one
      // either says so or, if that tab ended this session, returns to sign-in.
      await refreshStaffSession();
      onDone();
      return;
    }
    setPhase({ kind: 'failed', offline: outcome.reason === 'offline' });
  }, [onDone]);

  useEffect(() => {
    void start();
  }, [start]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setInvalid(false);
    setFailed(false);
    const outcome = await enableTwoFactor(toLatinDigits(code.trim()));
    setBusy(false);
    if (outcome.ok) {
      setPhase({ kind: 'codes', codes: outcome.recoveryCodes });
      onEnabled();
      return;
    }
    if (outcome.reason === 'invalid') {
      setInvalid(true);
      setCode('');
    } else if (outcome.reason === 'on') {
      onDone();
    } else {
      setFailed(true);
    }
  }

  const codeReady = online && /^\d{6}$/.test(toLatinDigits(code.trim()));

  return (
    <div className="min-h-screen">
      <header className="bg-brand-700 text-ink-inverse">
        <div className="mx-auto flex max-w-[1040px] items-center gap-4 px-8 py-8">
          <h1 className="font-reading text-title-lg">
            {t(phase.kind === 'codes' ? 'tfaRecoveryTitle' : 'tfaSetupTitle', locale)}
          </h1>
          <ConsoleLanguageSwitch />
        </div>
      </header>

      <main
        className="mx-auto flex max-w-[640px] flex-col gap-6 p-8"
        data-testid="two-factor-setup"
      >
        {online ? null : (
          <p
            role="status"
            className="rounded-sm bg-warn-100 px-3 py-2 text-body-sm text-warn-700"
            data-testid="tfa-setup-offline"
          >
            {t('loginOffline', locale)}
          </p>
        )}

        {phase.kind === 'loading' ? (
          <p
            className="text-body-md text-ink-secondary"
            role="status"
            data-testid="tfa-setup-loading"
          >
            {t('tfaSetupLoading', locale)}
          </p>
        ) : null}

        {phase.kind === 'failed' ? (
          <div className="flex flex-col gap-4" data-testid="tfa-setup-failed">
            <p
              role="alert"
              className="rounded-sm bg-alert-100 px-3 py-2 text-body-sm text-alert-700"
            >
              {t(phase.offline ? 'loginOffline' : 'tfaSetupFailed', locale)}
            </p>
            <Button
              onClick={() => {
                void start();
              }}
            >
              {t('retry', locale)}
            </Button>
          </div>
        ) : null}

        {phase.kind === 'scan' ? (
          <>
            <p className="text-body-md text-ink-secondary">
              {t(required ? 'tfaSetupIntroRequired' : 'tfaSetupIntroOptional', locale)}
            </p>
            <Card>
              <div className="flex flex-col gap-4">
                <p className="text-body-md">{t('tfaSetupStep1', locale)}</p>
                <p className="text-body-md">{t('tfaSetupStep2', locale)}</p>
                {phase.qr === null ? null : (
                  // A data: URL drawn here from the otpauth link; `next/image`
                  // would only add a loader for an image that is never fetched.
                  <img
                    src={phase.qr}
                    alt={t('tfaQrAlt', locale)}
                    width={200}
                    height={200}
                    className="self-center rounded-sm bg-surface"
                    data-testid="tfa-qr"
                  />
                )}
                <div>
                  <p className="text-body-sm text-ink-secondary">{t('tfaSetupManual', locale)}</p>
                  <p className="mt-1 break-all font-mono text-title-sm" data-testid="tfa-secret">
                    {grouped(phase.secret)}
                  </p>
                </div>
              </div>
            </Card>

            <form
              className="flex flex-col gap-4"
              noValidate
              onSubmit={(event) => {
                void submit(event);
              }}
            >
              <Input
                label={t('tfaSetupStep3', locale)}
                density="console"
                autoComplete="one-time-code"
                spellCheck={false}
                required
                maxLength={6}
                value={code}
                data-testid="tfa-setup-code"
                {...(invalid ? { error: t('tfaSetupInvalid', locale) } : {})}
                onChange={(event) => {
                  setCode(event.target.value);
                }}
              />
              {failed ? (
                <p
                  role="alert"
                  className="rounded-sm bg-alert-100 px-3 py-2 text-body-sm text-alert-700"
                  data-testid="tfa-setup-error"
                >
                  {t('loginFailed', locale)}
                </p>
              ) : null}
              <Button
                type="submit"
                {...(codeReady
                  ? {}
                  : {
                      disabled: true,
                      disabledReason: t(online ? 'tfaSetupNeeds' : 'loginOffline', locale),
                    })}
                loading={busy}
                data-testid="tfa-setup-submit"
              >
                {t('tfaSetupSubmit', locale)}
              </Button>
            </form>
          </>
        ) : null}

        {phase.kind === 'codes' ? (
          <>
            <p className="text-body-md text-ink-secondary">{t('tfaRecoveryIntro', locale)}</p>
            <Card>
              <ol
                className="grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-body-md"
                data-testid="tfa-recovery-codes"
              >
                {phase.codes.map((recovery) => (
                  <li key={recovery}>{recovery}</li>
                ))}
              </ol>
            </Card>
            <Button
              variant="secondary"
              onClick={() => {
                globalThis.print();
              }}
            >
              {t('tfaRecoveryPrint', locale)}
            </Button>
            <label className="flex min-h-touch items-center gap-3 text-body-md">
              <input
                type="checkbox"
                checked={kept}
                data-testid="tfa-recovery-kept"
                onChange={(event) => {
                  setKept(event.target.checked);
                }}
              />
              {t('tfaRecoverySaved', locale)}
            </label>
            <Button
              {...(kept ? {} : { disabled: true, disabledReason: t('tfaRecoveryNeeds', locale) })}
              onClick={onDone}
              data-testid="tfa-recovery-continue"
            >
              {t('tfaRecoveryContinue', locale)}
            </Button>
          </>
        ) : (
          <div className="flex flex-wrap gap-3">
            {required || onCancel === undefined ? null : (
              <Button variant="secondary" onClick={onCancel} data-testid="tfa-setup-cancel">
                {t('tfaCancel', locale)}
              </Button>
            )}
            <Button
              variant="quiet"
              onClick={() => {
                void signOut().then(onSignedOut);
              }}
            >
              {t('signOut', locale)}
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
