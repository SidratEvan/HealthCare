'use client';

/**
 * `S-A-10c` On the way (`APP_FLOW.md` A6, `FR-PAT-46`).
 *
 * "অপেক্ষায় → হাসপাতাল প্রস্তুত (live via channel)", with navigation, a call
 * to the ER and a cancel that tells the ER the family is not coming.
 *
 * Opened from "I'm on my way", and from the SMS that answers it when a number
 * was left (`emergency.acknowledged`, `emergency.declined`). The token in the
 * URL is the credential, as the serial tracking link's is (`FR-GST-05`).
 *
 * ## "Live" is a five-second look, not a socket
 *
 * This version has no socket a stranger can join (`docs/STATUS.md`, decision
 * 35), so the screen asks every five seconds while it is visible and the
 * answer can still change. An ER acknowledges in seconds; five is the delay
 * between the coordinator's tap and the family seeing "ready", and the
 * freshness line says how old the last answer is. Once the case is settled —
 * received, declined, called off — it stops asking.
 *
 * ## A decline is said plainly, with somewhere to go
 *
 * `FR-EMG-02`: the ER declines with a reason. The family sees that the
 * hospital cannot take them, why, and a button back to the list for the same
 * problem — never a spinner that would keep them driving to a door that has
 * said no.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { ApiError } from '@platform/client';
import { formatNumber, problemName, tp } from '@platform/i18n';
import { Button, FreshnessLine, Sheet, SheetActions } from '@platform/ui';

import { TabScreen } from '@/components/TabScreen';
import { useNow } from '@/hooks/useNow';
import { cancelEmergency, trackEmergency } from '@/lib/api';
import { directionsUrl } from '@/lib/emergency';

import type { EmergencyCaseStatus } from '@/lib/types';

const LOCALE = 'bn' as const;
const NUMERALS = 'bengali' as const;
const REFRESH_MS = 5_000;

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'invalid' }
  | { readonly state: 'failed' }
  | { readonly state: 'ready'; readonly status: EmergencyCaseStatus };

export default function Page(): ReactNode {
  const now = useNow(1_000);
  const [token, setToken] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(globalThis.location.search).get('t'));
  }, []);

  const load = useCallback(async (value: string) => {
    try {
      setLoaded({ state: 'ready', status: await trackEmergency(value) });
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
    loaded.state === 'ready' &&
    loaded.status.state !== 'inbound' &&
    loaded.status.state !== 'acknowledged';

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
    <TabScreen title={tp('onWayScreenTitle', LOCALE)}>
      <Body
        loaded={loaded}
        now={now}
        onRetry={() => {
          if (token !== null) void load(token);
        }}
        onCancel={() => setConfirmCancel(true)}
      />

      {/* GR-01: the consequence named, the safe option on the left. */}
      <Sheet
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        dismissible={!cancelling}
        title={tp('onWayCancel', LOCALE)}
        description={tp('onWayCancelConfirm', LOCALE)}
      >
        <SheetActions destructive>
          <Button
            variant="danger-quiet"
            loading={cancelling}
            data-testid="onway-cancel-confirm"
            onClick={() => {
              if (token === null) return;
              setCancelling(true);
              void cancelEmergency(token)
                .then((status) => {
                  setLoaded({ state: 'ready', status });
                  setConfirmCancel(false);
                })
                .catch(() => {
                  setConfirmCancel(false);
                  void load(token);
                })
                .finally(() => {
                  setCancelling(false);
                });
            }}
          >
            {tp('onWayCancel', LOCALE)}
          </Button>
          <Button variant="secondary" onClick={() => setConfirmCancel(false)}>
            {tp('onWayKeep', LOCALE)}
          </Button>
        </SheetActions>
      </Sheet>
    </TabScreen>
  );
}

function Body({
  loaded,
  now,
  onRetry,
  onCancel,
}: {
  readonly loaded: Loaded;
  readonly now: Date;
  readonly onRetry: () => void;
  readonly onCancel: () => void;
}): ReactNode {
  if (loaded.state === 'loading') {
    return (
      <div className="h-48 rounded-lg bg-sunken" aria-busy="true" data-testid="onway-loading" />
    );
  }

  if (loaded.state === 'invalid') {
    return (
      <div className="flex flex-col gap-3" data-testid="onway-invalid">
        <p className="text-body-md text-ink-secondary">{tp('onWayLinkExpired', LOCALE)}</p>
        <a href="/emergency" className="text-body-md text-brand-600">
          {tp('emergencyTitle', LOCALE)}
        </a>
      </div>
    );
  }

  if (loaded.state === 'failed') {
    return (
      <div className="flex flex-col gap-3" role="alert" data-testid="onway-failed">
        <p className="text-body-md text-ink-secondary">{tp('listFailed', LOCALE)}</p>
        <a
          href="tel:999"
          className="flex min-h-touch items-center justify-center rounded-md bg-alert-600 px-5 text-body-lg font-semibold text-white"
        >
          {tp('call999', LOCALE)}
        </a>
        <div>
          <Button variant="secondary" onClick={onRetry}>
            {tp('tryAgain', LOCALE)}
          </Button>
        </div>
      </div>
    );
  }

  const { status } = loaded;
  const { hospital } = status;
  const n = (value: number): string => formatNumber(value, NUMERALS);

  // How long until the ER expects them, counted down on screen.
  const etaLeft =
    status.inboundAt === null || status.inboundEtaMinutes === null
      ? null
      : Math.max(
          0,
          Math.ceil(
            (Date.parse(status.inboundAt) + status.inboundEtaMinutes * 60_000 - now.getTime()) /
              60_000,
          ),
        );

  const open = status.state === 'inbound' || status.state === 'acknowledged';

  const headline =
    status.state === 'acknowledged'
      ? tp('onWayReady', LOCALE)
      : status.state === 'inbound'
        ? tp('onWayWaiting', LOCALE)
        : status.state === 'declined'
          ? tp('onWayDeclined', LOCALE)
          : status.state === 'cancelled'
            ? tp('onWayCancelled', LOCALE)
            : tp('onWayArrived', LOCALE);

  const tone =
    status.state === 'acknowledged'
      ? 'border-brand-border bg-brand-100 text-brand-700'
      : status.state === 'declined'
        ? 'border-alert-600 bg-alert-100 text-alert-700'
        : 'border-line bg-surface text-ink';

  return (
    <div
      className="flex flex-col gap-4"
      data-testid="onway-status"
      data-state={status.state}
      data-case-id={status.id}
    >
      <section className={`flex flex-col gap-2 rounded-lg border p-5 ${tone}`} aria-live="polite">
        <p className="text-body-sm">
          {hospital.nameBn} · {problemName(status.problem, LOCALE)}
        </p>
        <p className="font-reading text-title-lg" data-testid="onway-headline">
          {headline}
        </p>
        {status.state === 'acknowledged' ? (
          <p className="text-body-md">
            {tp('onWayReadyLine', LOCALE).replace('{hospital}', hospital.nameBn)}
          </p>
        ) : null}
        {status.state === 'declined' && status.declineReason !== null ? (
          <p className="text-body-md" data-testid="onway-reason">
            {tp('onWayDeclinedReason', LOCALE).replace('{reason}', status.declineReason)}
          </p>
        ) : null}
        {open && etaLeft !== null ? (
          <p className="text-body-md tabular-nums" data-testid="onway-eta">
            {tp('onWayEta', LOCALE).replace('{minutes}', n(etaLeft))}
          </p>
        ) : null}
      </section>

      {/* A live status says how old it is (`FR-OFF-03`). */}
      <FreshnessLine
        asOf={new Date(status.serverTs)}
        now={now}
        labels={{
          justNow: tp('updatedJustNow', LOCALE),
          ago: tp('updatedAgo', LOCALE),
          never: tp('updatedNever', LOCALE),
          stale: tp('staleWarning', LOCALE),
        }}
        formatMinutes={(minutes) => `${n(minutes)} ${tp('minutesShort', LOCALE)}`}
      />

      <div className="flex flex-col gap-3">
        {status.state === 'declined' ? (
          <a
            href={`/emergency/results?problem=${status.problem}`}
            data-testid="onway-find-another"
            className="flex min-h-touch items-center justify-center rounded-md bg-alert-600 px-5 text-body-lg font-semibold text-white"
          >
            {tp('onWayFindAnother', LOCALE)}
          </a>
        ) : null}

        {open && hospital.lat !== null && hospital.lng !== null ? (
          <a
            href={directionsUrl(hospital.lat, hospital.lng)}
            target="_blank"
            rel="noreferrer"
            data-testid="onway-navigate"
            className="flex min-h-touch items-center justify-center rounded-md bg-brand-600 px-5 text-body-lg font-semibold text-white"
          >
            {tp('onWayNavigate', LOCALE)}
          </a>
        ) : null}

        {hospital.emergencyPhone === null ? null : (
          <a
            href={`tel:${hospital.emergencyPhone}`}
            data-testid="onway-call"
            className="flex min-h-touch items-center justify-center rounded-md border border-line-strong px-5 text-body-lg text-ink"
          >
            {tp('onWayCallEr', LOCALE)}
          </a>
        )}

        {open ? (
          <Button variant="quiet" data-testid="onway-cancel" onClick={onCancel}>
            {tp('onWayCancel', LOCALE)}
          </Button>
        ) : null}

        <a
          href="tel:999"
          className="flex min-h-touch items-center justify-center rounded-md border border-alert-600 px-5 text-body-md text-alert-700"
        >
          {tp('call999', LOCALE)}
        </a>
      </div>
    </div>
  );
}
