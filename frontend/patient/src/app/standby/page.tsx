'use client';

/**
 * `S-A-08s` — a place on a standby list (`FR-PAT-25`, `FR-PAT-26`,
 * `FR-PAT-27`).
 *
 * Opened from the join, or from the SMS an offer or a seat sends. The status
 * token in the URL is the place: there are no accounts in this version, so the
 * link is the credential, as a tracking link is.
 *
 * ## What it shows, in the order it can happen
 *
 * Waiting: how many are ahead, and — the owner's ruling on decision 62 —
 * whether they are seated on sight (paid) or asked here (not). Offered: the
 * chair, the minutes left to say yes, and how they will pay, as the booking
 * flow asks. Seated: the serial, and the way to the live screen. Left: that
 * they left, and that a prepayment comes back.
 *
 * ## Polled, not a socket
 *
 * Every five seconds while anything can change, as `S-A-10c` is (decision
 * 35): the session channel is staff-scoped and a standby patient holds no
 * booking to scope one to. Five rather than twenty, because an offer is a
 * ten-minute window and the first thirty seconds of it matter.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { ApiError } from '@platform/client';
import { formatDateTime, formatNumber, formatSerial, formatTaka, tp } from '@platform/i18n';
import { Button, Card, FreshnessLine } from '@platform/ui';

import { TabScreen } from '@/components/TabScreen';
import { useNow } from '@/hooks/useNow';
import { useOnline } from '@/hooks/useOnline';
import { acceptStandby, declineStandby, leaveStandby, standbyStatus } from '@/lib/api';
import { recentBookings, rememberBooking } from '@/lib/bookings';

import type { StandbyStatusView } from '@/lib/types';

const LOCALE = 'bn' as const;
const NUMERALS = 'bengali' as const;
const REFRESH_MS = 5_000;

type Method = 'bkash' | 'nagad' | 'card' | 'at_hospital';

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'invalid' }
  | { readonly state: 'failed' }
  | { readonly state: 'ready'; readonly view: StandbyStatusView };

export default function Page(): ReactNode {
  const now = useNow(1_000);
  const online = useOnline();
  const [token, setToken] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  /** The live link, kept once given — the server gives it only once. */
  const [liveUrl, setLiveUrl] = useState<string | null>(null);

  useEffect(() => {
    setToken(new URLSearchParams(globalThis.location.search).get('t'));
  }, []);

  const load = useCallback(async (value: string) => {
    try {
      const view = await standbyStatus(value);
      setLoaded({ state: 'ready', view });
      if (view.seated !== null) setLiveUrl(liveLinkFor(view));
    } catch (error: unknown) {
      const status = error instanceof ApiError ? error.status : null;
      setLoaded((current) =>
        status === 401 || status === 410 || status === 400 || status === 404
          ? { state: 'invalid' }
          : current.state === 'ready'
            ? current
            : { state: 'failed' },
      );
    }
  }, []);

  useEffect(() => {
    if (token === null) return;
    if (token === '') {
      setLoaded({ state: 'invalid' });
      return;
    }
    void load(token);
  }, [token, load]);

  const settled =
    loaded.state === 'ready' && (loaded.view.state === 'seated' || loaded.view.state === 'left');

  useEffect(() => {
    if (token === null || token === '' || settled) return undefined;
    const timer = setInterval(() => {
      if (globalThis.document?.visibilityState === 'visible') void load(token);
    }, REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [token, settled, load]);

  return (
    <TabScreen title={tp('standbyStatusTitle', LOCALE)}>
      {online ? null : (
        <p
          role="status"
          data-testid="standby-offline"
          className="rounded-sm bg-alert-100 px-3 py-2 text-body-md text-alert-700"
        >
          {tp('offline', LOCALE)}
        </p>
      )}

      <Body
        loaded={loaded}
        token={token ?? ''}
        now={now}
        online={online}
        liveUrl={liveUrl}
        onChanged={() => {
          if (token !== null) void load(token);
        }}
        onSeated={(url) => {
          setLiveUrl(url);
          if (token !== null) void load(token);
        }}
      />
    </TabScreen>
  );
}

function Body({
  loaded,
  token,
  now,
  online,
  liveUrl,
  onChanged,
  onSeated,
}: {
  readonly loaded: Loaded;
  readonly token: string;
  readonly now: Date;
  readonly online: boolean;
  readonly liveUrl: string | null;
  readonly onChanged: () => void;
  readonly onSeated: (url: string | null) => void;
}): ReactNode {
  if (loaded.state === 'loading') {
    return (
      <div className="h-48 rounded-md bg-sunken" aria-busy="true" data-testid="standby-loading" />
    );
  }

  if (loaded.state === 'invalid') {
    return (
      <p className="text-body-md text-ink-secondary" data-testid="standby-invalid">
        {tp('standbyLinkBad', LOCALE)}
      </p>
    );
  }

  if (loaded.state === 'failed') {
    return (
      <div className="flex flex-col gap-3" role="alert" data-testid="standby-failed">
        <p className="text-body-md text-ink-secondary">{tp('standbyLoadFailed', LOCALE)}</p>
        <Button variant="secondary" onClick={onChanged}>
          {tp('tryAgain', LOCALE)}
        </Button>
      </div>
    );
  }

  const { view } = loaded;

  return (
    <div className="flex flex-col gap-4" data-testid="standby-status" data-state={view.state}>
      <Card>
        <p className="text-body-md">{view.doctorNameBn}</p>
        <p className="text-body-sm text-ink-muted">{view.hospitalNameBn}</p>
        {view.plannedStart === null ? null : (
          <p className="text-body-sm text-ink-muted tabular-nums">
            {formatDateTime(view.plannedStart, NUMERALS)}
          </p>
        )}
      </Card>

      {view.state === 'waiting' ? <Waiting view={view} /> : null}
      {view.state === 'offered' && view.offer !== null ? (
        <Offer
          view={view}
          offer={view.offer}
          token={token}
          now={now}
          online={online}
          onDeclined={onChanged}
          onSeated={onSeated}
        />
      ) : null}
      {view.state === 'seated' && view.seated !== null ? (
        <Seated serial={view.seated.serial} liveUrl={liveUrl} />
      ) : null}
      {view.state === 'left' ? (
        <Card data-testid="standby-left">
          <p className="text-body-md">{tp('standbyLeft', LOCALE)}</p>
        </Card>
      ) : null}

      {/* CLAUDE.md §5.8: the place on the list is a live figure. */}
      <FreshnessLine
        asOf={new Date(view.serverTs)}
        now={now}
        labels={{
          justNow: tp('updatedJustNow', LOCALE),
          ago: tp('updatedAgo', LOCALE),
          never: tp('updatedNever', LOCALE),
          stale: tp('staleWarning', LOCALE),
        }}
        formatMinutes={(minutes) =>
          `${formatNumber(minutes, NUMERALS)} ${tp('minutesShort', LOCALE)}`
        }
      />

      {view.state === 'waiting' || view.state === 'offered' ? (
        <Leave token={token} prepaid={view.prepaid} online={online} onLeft={onChanged} />
      ) : null}
    </div>
  );
}

function Waiting({ view }: { readonly view: StandbyStatusView }): ReactNode {
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-5"
      aria-live="polite"
    >
      <p className="text-title-lg" data-testid="standby-ahead">
        {view.ahead === 0
          ? tp('standbyFirst', LOCALE)
          : tp('standbyPlace', LOCALE).replace('{count}', formatNumber(view.ahead, NUMERALS))}
      </p>
      <p
        className={`rounded-sm px-3 py-2 text-body-sm ${view.prepaid ? 'bg-brand-100 text-brand-700' : 'bg-sunken text-ink-secondary'}`}
        data-testid={view.prepaid ? 'standby-prepaid' : 'standby-ask'}
      >
        {view.prepaid ? tp('standbyPrepaidBadge', LOCALE) : tp('standbyAskBadge', LOCALE)}
      </p>
    </section>
  );
}

function Offer({
  view,
  offer,
  token,
  now,
  online,
  onDeclined,
  onSeated,
}: {
  readonly view: StandbyStatusView;
  readonly offer: { readonly id: string; readonly expiresAt: string };
  readonly token: string;
  readonly now: Date;
  readonly online: boolean;
  readonly onDeclined: () => void;
  readonly onSeated: (url: string | null) => void;
}): ReactNode {
  const [method, setMethod] = useState<Method>('bkash');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const left = Math.max(0, Math.ceil((Date.parse(offer.expiresAt) - now.getTime()) / 60_000));

  const accept = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      const accepted = await acceptStandby({ token, method, idempotencyKey });
      const url = accepted.trackingUrl === null ? null : relative(accepted.trackingUrl);
      if (url !== null) remember(view, accepted.bookingId, accepted.serial, url);
      onSeated(url);
    } catch {
      setFailure(tp('standbyAcceptFailed', LOCALE));
      onDeclined();
    } finally {
      setBusy(false);
    }
  };

  const decline = async (): Promise<void> => {
    setBusy(true);
    try {
      await declineStandby(token);
    } finally {
      setBusy(false);
      onDeclined();
    }
  };

  const offline = online ? null : tp('offline', LOCALE);

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-brand-600 bg-brand-100 p-5"
      aria-live="assertive"
      data-testid="standby-offer"
    >
      <p className="text-title-lg text-brand-900">{tp('standbyOfferTitle', LOCALE)}</p>
      <p className="text-display-lg tabular-nums text-brand-900" data-testid="standby-offer-left">
        {tp('standbyOfferLeft', LOCALE).replace('{minutes}', formatNumber(left, NUMERALS))}
      </p>

      <fieldset className="flex flex-col gap-2 border-0 p-0">
        <legend className="font-ui text-body-sm font-semibold text-ink">
          {tp('payWith', LOCALE)} · {formatTaka(view.feePoisha, NUMERALS)}
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['bkash', 'payBkash'],
              ['nagad', 'payNagad'],
              ['card', 'payCard'],
              ['at_hospital', 'payAtHospital'],
            ] as const
          ).map(([value, key]) => (
            <button
              key={value}
              type="button"
              aria-pressed={method === value}
              onClick={() => {
                setMethod(value);
              }}
              className="min-h-touch rounded-sm border border-line-strong bg-surface px-3 text-body-md aria-pressed:border-brand-600 aria-pressed:bg-surface aria-pressed:font-semibold"
            >
              {tp(key, LOCALE)}
            </button>
          ))}
        </div>
      </fieldset>

      {failure === null ? null : (
        <p role="alert" className="rounded-sm bg-alert-100 p-3 text-body-md text-alert-700">
          {failure}
        </p>
      )}

      <Button
        size="lg"
        fullWidth
        loading={busy}
        data-testid="standby-accept"
        onClick={() => {
          void accept();
        }}
        {...(offline === null ? {} : { disabled: true as const, disabledReason: offline })}
      >
        {tp('standbyOfferAccept', LOCALE)}
      </Button>
      <Button
        variant="secondary"
        fullWidth
        data-testid="standby-decline"
        onClick={() => {
          void decline();
        }}
        {...(offline === null ? {} : { disabled: true as const, disabledReason: offline })}
      >
        {tp('standbyOfferDecline', LOCALE)}
      </Button>
    </section>
  );
}

function Seated({
  serial,
  liveUrl,
}: {
  readonly serial: number;
  readonly liveUrl: string | null;
}): ReactNode {
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-brand-600 bg-brand-100 p-5"
      data-testid="standby-seated"
    >
      <p className="font-reading text-display-lg text-brand-900">
        {tp('standbySeatedTitle', LOCALE).replace('{serial}', formatSerial(serial, NUMERALS))}
      </p>
      {liveUrl === null ? (
        <p className="text-body-md text-ink-secondary">{tp('standbySeatedSms', LOCALE)}</p>
      ) : (
        <a
          href={liveUrl}
          data-testid="standby-live-link"
          className="flex min-h-touch items-center justify-center rounded-md bg-brand-600 px-4 text-body-lg font-semibold text-white"
        >
          {tp('standbySeatedLink', LOCALE)}
        </a>
      )}
    </section>
  );
}

function Leave({
  token,
  prepaid,
  online,
  onLeft,
}: {
  readonly token: string;
  readonly prepaid: boolean;
  readonly online: boolean;
  readonly onLeft: () => void;
}): ReactNode {
  const [asking, setAsking] = useState(false);
  const offline = online ? null : tp('offline', LOCALE);

  if (!asking) {
    return (
      <Button
        variant="secondary"
        onClick={() => {
          setAsking(true);
        }}
        data-testid="standby-leave"
        {...(offline === null ? {} : { disabled: true as const, disabledReason: offline })}
      >
        {tp('standbyLeave', LOCALE)}
      </Button>
    );
  }

  // `GR-01`: leaving is confirmed, and a prepayment's fate is said first.
  return (
    <Card>
      {prepaid ? (
        <p className="text-body-md" data-testid="standby-leave-refund">
          {tp('standbyLeaveRefund', LOCALE)}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            setAsking(false);
          }}
        >
          {tp('standbyLeaveStay', LOCALE)}
        </Button>
        <Button
          variant="primary"
          data-testid="standby-leave-confirm"
          onClick={() => {
            void leaveStandby(token).finally(onLeft);
          }}
        >
          {tp('standbyLeaveConfirm', LOCALE)}
        </Button>
      </div>
    </Card>
  );
}

/**
 * Where the live screen is for a seated place.
 *
 * Given by the server once, the first time the seat is read. After that the
 * device's own record of it is the only copy; a phone that never saw it is
 * told the link went by SMS.
 */
function liveLinkFor(view: StandbyStatusView): string | null {
  if (view.seated === null) return null;

  if (view.seated.trackingUrl !== null) {
    const url = relative(view.seated.trackingUrl);
    remember(view, view.seated.bookingId, view.seated.serial, url);
    return url;
  }

  const saved = recentBookings().find((entry) => entry.bookingId === view.seated?.bookingId);
  return saved?.url ?? null;
}

/** `S-A-09` and the home strip read what this device holds (`lib/bookings.ts`). */
function remember(view: StandbyStatusView, bookingId: string, serial: number, url: string): void {
  const token = new URL(url, 'https://local.invalid').searchParams.get('t');
  if (token === null) return;
  rememberBooking({
    bookingId,
    serial,
    sessionId: view.sessionId,
    doctorNameBn: view.doctorNameBn ?? '',
    hospitalNameBn: view.hospitalNameBn ?? '',
    plannedStart: view.plannedStart ?? new Date().toISOString(),
    url,
    token,
    savedAt: new Date().toISOString(),
  });
}

/** The API names the web origin it was told; the app opens the path on its own. */
function relative(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}
