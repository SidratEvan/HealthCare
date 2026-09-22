'use client';

/**
 * `BTN-A12-QR` and `BTN-A12-ACCESS` — letting a doctor look, and seeing who did
 * (`FR-PAT-63`, `FR-PAT-64`, `APP_FLOW.md` A7).
 *
 * ## A code, not yet a QR
 *
 * `FR-PAT-63` says QR. Drawing one needs an encoder and scanning one needs a
 * camera pipeline, and neither dependency has been agreed (`CLAUDE.md` §7), so
 * the sheet shows the signed code itself with a copy button and the doctor's
 * console takes it pasted. The capability is identical — a three-minute string
 * naming one patient — and turning it into a picture later changes this sheet
 * and `BTN-B05-SCAN`, nothing else.
 *
 * ## Who is speaking
 *
 * There are no accounts (`CLAUDE.md` §4.1), so what speaks for a patient on
 * this device is a link to one of their bookings, and the API accepts that only
 * while `DEMO_MODE` is on. Every action opens the link again for a fresh
 * access token rather than holding one: the token lives fifteen minutes, a
 * sheet can sit open longer than that, and a revoke that fails because a
 * credential went stale in the background would look like the product refusing
 * to let go.
 */

import { useCallback, useEffect, useState } from 'react';

import { formatDateTime, formatNumber, tp } from '@platform/i18n';
import { Button, Card, Chip, Sheet } from '@platform/ui';

import { useNow } from '@/hooks/useNow';
import { accessLog, offerConsent, openTrackingLink, revokeConsent } from '@/lib/api';

import type { AccessLog, ConsentGrant, ConsentOffer } from '@/lib/types';
import type { ReactNode } from 'react';

const LOCALE = 'bn' as const;
const NUMERALS = 'bengali' as const;

/** A patient this device can speak for, and the link that lets it. */
export interface Speaker {
  readonly patientId: string;
  readonly patientName: string;
  /** The durable tracking token from the SMS link, not an access token. */
  readonly linkToken: string;
}

/** A fresh access token for this patient's link. */
async function speak(speaker: Speaker): Promise<string> {
  return (await openTrackingLink(speaker.linkToken)).token;
}

export function WalletConsent({
  speaker,
  online,
  showName,
}: {
  readonly speaker: Speaker;
  readonly online: boolean;
  /** Only when this device holds more than one patient's bookings. */
  readonly showName: boolean;
}): ReactNode {
  return (
    <Card>
      <div className="flex flex-col gap-3" data-testid={`wallet-consent-${speaker.patientId}`}>
        <h2 className="text-title-sm">{tp('walletShare', LOCALE)}</h2>

        {showName ? (
          <p className="text-body-sm text-ink-secondary">
            {tp('walletPatient', LOCALE).replace('{name}', speaker.patientName)}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <CodeSheet speaker={speaker} online={online} />
          <AccessSheet speaker={speaker} online={online} />
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// BTN-A12-QR
// ---------------------------------------------------------------------------

type OfferState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'ready'; readonly offer: ConsentOffer; readonly expiresAt: number };

function CodeSheet({
  speaker,
  online,
}: {
  readonly speaker: Speaker;
  readonly online: boolean;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [offer, setOffer] = useState<OfferState>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);

  // Seconds matter here: the code lives three minutes and the patient is
  // holding the phone out while the doctor types.
  const now = useNow(1_000);

  const fetchOffer = useCallback(async () => {
    setOffer({ kind: 'loading' });
    setCopied(false);
    try {
      const minted = await offerConsent({
        patientId: speaker.patientId,
        token: await speak(speaker),
      });
      setOffer({
        kind: 'ready',
        offer: minted,
        expiresAt: Date.now() + minted.expiresInSeconds * 1_000,
      });
    } catch {
      setOffer({ kind: 'failed' });
    }
  }, [speaker]);

  // A new code every time the sheet opens. An old one may already have been
  // shown to somebody, and it expires in minutes anyway.
  useEffect(() => {
    if (open) void fetchOffer();
    else setOffer({ kind: 'idle' });
  }, [open, fetchOffer]);

  const secondsLeft =
    offer.kind === 'ready' ? Math.max(0, Math.ceil((offer.expiresAt - now.getTime()) / 1_000)) : 0;

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={tp('consentCodeTitle', LOCALE)}
      trigger={
        online ? (
          <Button data-testid="show-consent-code">{tp('showCode', LOCALE)}</Button>
        ) : (
          <Button disabled disabledReason={tp('offline', LOCALE)}>
            {tp('showCode', LOCALE)}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {offer.kind === 'ready' ? (
          <>
            {/* Scope and expiry before the code, because they are what the
                patient is agreeing to (`APP_FLOW.md` S-A-12). */}
            <p className="text-body-md text-ink-secondary" data-testid="consent-scope">
              {tp('consentScope', LOCALE).replace(
                '{hours}',
                formatNumber(offer.offer.grantHours, NUMERALS),
              )}
            </p>

            {secondsLeft > 0 ? (
              <>
                <p
                  data-testid="consent-code"
                  className="select-all break-all rounded-md border border-line-strong bg-sunken p-3 text-body-sm"
                >
                  {offer.offer.code}
                </p>

                {/* Not a live region: announcing every second would drown the
                    screen reader. Expiry itself is a state change and is read. */}
                <p className="text-body-sm tabular-nums text-ink-muted">
                  {tp('consentCodeExpiresIn', LOCALE).replace(
                    '{seconds}',
                    formatNumber(secondsLeft, NUMERALS),
                  )}
                </p>

                <Button
                  variant="secondary"
                  fullWidth
                  data-testid="copy-consent-code"
                  onClick={() => {
                    // Absent outside a secure context (a phone opening the demo
                    // over a LAN address), which the DOM types do not admit.
                    const clipboard = globalThis.navigator.clipboard as Clipboard | undefined;

                    void clipboard
                      ?.writeText(offer.offer.code)
                      .then(() => {
                        setCopied(true);
                      })
                      .catch(() => {
                        // The code is selectable on screen; a blocked clipboard
                        // costs a long-press, not the handshake.
                      });
                  }}
                >
                  {copied ? tp('copied', LOCALE) : tp('copyCode', LOCALE)}
                </Button>
              </>
            ) : (
              <>
                <p
                  role="status"
                  className="text-body-md text-warn-700"
                  data-testid="consent-code-expired"
                >
                  {tp('consentCodeExpired', LOCALE)}
                </p>
                <Button fullWidth onClick={() => void fetchOffer()}>
                  {tp('newCode', LOCALE)}
                </Button>
              </>
            )}
          </>
        ) : offer.kind === 'failed' ? (
          <>
            <p className="rounded-sm bg-alert-100 px-3 py-2 text-body-md text-alert-700">
              {tp('listFailed', LOCALE)}
            </p>
            <Button fullWidth onClick={() => void fetchOffer()}>
              {tp('tryAgain', LOCALE)}
            </Button>
          </>
        ) : (
          <div aria-busy="true" className="flex flex-col gap-3">
            <div className="h-5 w-2/3 rounded-sm bg-sunken" />
            <div className="h-16 rounded-md bg-sunken" />
            <span className="sr-only">{tp('loading', LOCALE)}</span>
          </div>
        )}

        <Button
          variant="quiet"
          fullWidth
          onClick={() => {
            setOpen(false);
          }}
        >
          {tp('close', LOCALE)}
        </Button>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// BTN-A12-ACCESS
// ---------------------------------------------------------------------------

type LogState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'ready'; readonly log: AccessLog };

function AccessSheet({
  speaker,
  online,
}: {
  readonly speaker: Speaker;
  readonly online: boolean;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<LogState>({ kind: 'loading' });
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeFailed, setRevokeFailed] = useState(false);
  const now = useNow();

  const load = useCallback(async () => {
    setLog({ kind: 'loading' });
    try {
      setLog({
        kind: 'ready',
        log: await accessLog({ patientId: speaker.patientId, token: await speak(speaker) }),
      });
    } catch {
      setLog({ kind: 'failed' });
    }
  }, [speaker]);

  useEffect(() => {
    if (open) {
      setRevokeFailed(false);
      void load();
    }
  }, [open, load]);

  const revoke = useCallback(
    async (consentId: string) => {
      setRevoking(consentId);
      setRevokeFailed(false);
      try {
        await revokeConsent({
          consentId,
          token: await speak(speaker),
          idempotencyKey: crypto.randomUUID(),
        });
        await load();
      } catch {
        setRevokeFailed(true);
      } finally {
        setRevoking(null);
      }
    },
    [speaker, load],
  );

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={tp('whoLooked', LOCALE)}
      trigger={
        online ? (
          <Button variant="secondary" data-testid="show-access">
            {tp('whoLooked', LOCALE)}
          </Button>
        ) : (
          <Button variant="secondary" disabled disabledReason={tp('offline', LOCALE)}>
            {tp('whoLooked', LOCALE)}
          </Button>
        )
      }
    >
      <div className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto" data-testid="access-log">
        {log.kind === 'loading' ? (
          <div aria-busy="true" className="flex flex-col gap-3">
            <div className="h-12 rounded-md bg-sunken" />
            <div className="h-12 rounded-md bg-sunken" />
            <span className="sr-only">{tp('loading', LOCALE)}</span>
          </div>
        ) : log.kind === 'failed' ? (
          <>
            <p className="rounded-sm bg-alert-100 px-3 py-2 text-body-md text-alert-700">
              {tp('listFailed', LOCALE)}
            </p>
            <Button fullWidth onClick={() => void load()}>
              {tp('tryAgain', LOCALE)}
            </Button>
          </>
        ) : (
          <>
            {revokeFailed ? (
              <p role="alert" className="text-body-sm text-alert-700">
                {tp('revokeFailed', LOCALE)}
              </p>
            ) : null}

            <section className="flex flex-col gap-3">
              <h3 className="text-body-lg font-semibold">{tp('grantsTitle', LOCALE)}</h3>
              {log.log.consents.length === 0 ? (
                <p className="text-body-sm text-ink-muted">{tp('noGrants', LOCALE)}</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {log.log.consents.map((grant) => (
                    <li key={grant.id}>
                      <GrantRow
                        grant={grant}
                        now={now}
                        busy={revoking === grant.id}
                        onRevoke={() => void revoke(grant.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="flex flex-col gap-3">
              <h3 className="text-body-lg font-semibold">{tp('viewsTitle', LOCALE)}</h3>
              {log.log.views.length === 0 ? (
                <p className="text-body-sm text-ink-muted">{tp('noViews', LOCALE)}</p>
              ) : (
                <ul className="flex flex-col gap-2" data-testid="access-views">
                  {log.log.views.map((view, index) => (
                    // Views have no id of their own; the log is append-only and
                    // ordered, so position is stable for one render.
                    <li key={`${view.at}-${String(index)}`} className="flex flex-col">
                      <span className="text-body-md">
                        {view.staffName ?? tp('hospitalStaff', LOCALE)}
                        {view.hospitalNameBn === null ? null : ` · ${view.hospitalNameBn}`}
                      </span>
                      <span className="text-body-sm tabular-nums text-ink-muted">
                        {formatDateTime(view.at, NUMERALS)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        <Button
          variant="quiet"
          fullWidth
          onClick={() => {
            setOpen(false);
          }}
        >
          {tp('close', LOCALE)}
        </Button>
      </div>
    </Sheet>
  );
}

/** One hospital's access, with the control that ends it (`FR-PAT-64`). */
function GrantRow({
  grant,
  now,
  busy,
  onRevoke,
}: {
  readonly grant: ConsentGrant;
  readonly now: Date;
  readonly busy: boolean;
  readonly onRevoke: () => void;
}): ReactNode {
  const expired = grant.expiresAt !== null && new Date(grant.expiresAt) <= now;
  const live = grant.revokedAt === null && !expired;

  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-line p-3"
      data-testid={`grant-${grant.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-body-md font-semibold">{grant.hospitalNameBn}</span>
        {/* A11Y-03: the state is a word, never only a colour. */}
        <Chip tone={live ? 'positive' : 'neutral'}>
          {grant.revokedAt !== null
            ? tp('grantRevoked', LOCALE)
            : expired
              ? tp('grantExpired', LOCALE)
              : grant.expiresAt === null
                ? tp('grantLive', LOCALE)
                : tp('grantLiveUntil', LOCALE).replace(
                    '{time}',
                    formatDateTime(grant.expiresAt, NUMERALS),
                  )}
        </Chip>
      </div>

      {live ? (
        <Button
          variant="danger-quiet"
          size="sm"
          loading={busy}
          data-testid={`revoke-${grant.id}`}
          onClick={onRevoke}
        >
          {tp('revokeGrant', LOCALE)}
        </Button>
      ) : null}
    </div>
  );
}
