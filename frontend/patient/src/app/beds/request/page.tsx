'use client';

/**
 * `S-A-11` request status — "অনুরোধ পাঠানো → গৃহীত (hold expiry countdown) →
 * নিশ্চিত / বাতিল" (`APP_FLOW.md` A7, `FR-PAT-52`).
 *
 * Opened from the link the API returned when the request was sent, which this
 * phone kept, and from the SMS that answers it (`bed.request_held`,
 * `bed.request_declined`). The token in the URL is the credential, as the
 * serial tracking link's is (`FR-GST-05`).
 *
 * ## The countdown is the point
 *
 * A held bed is held for minutes. The screen shows how many are left, in
 * Bengali numerals, and when they run out it says the hold has ended — the
 * server reports `expired` the moment the deadline passes, whether or not the
 * ward has opened its board since, so the family is never shown a hold that
 * no longer exists.
 *
 * It re-reads every twenty seconds while the answer is still coming. Once the
 * request is confirmed, declined or expired it stops: nothing more will
 * change, and a screen that keeps polling a settled request is spending the
 * family's data for nothing.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { ApiError } from '@platform/client';
import {
  bedKindName,
  formatClock,
  formatNumber,
  tp,
  type PatientKey,
  formatAge,
} from '@platform/i18n';
import { FreshnessLine } from '@platform/ui';

import { TabScreen } from '@/components/TabScreen';
import { useNow } from '@/hooks/useNow';
import { trackBedRequest } from '@/lib/api';

import type { BedRequestView } from '@/lib/types';

const LOCALE = 'bn' as const;
const NUMERALS = 'bengali' as const;
const REFRESH_MS = 20_000;

const STATE_KEY: Record<BedRequestView['state'], PatientKey> = {
  requested: 'requestStateRequested',
  held: 'requestStateHeld',
  confirmed: 'requestStateConfirmed',
  declined: 'requestStateDeclined',
  expired: 'requestStateExpired',
};

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'invalid' }
  | { readonly state: 'failed' }
  | { readonly state: 'ready'; readonly request: BedRequestView };

export default function Page(): ReactNode {
  const now = useNow(1_000);
  const [token, setToken] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });

  useEffect(() => {
    setToken(new URLSearchParams(globalThis.location.search).get('t'));
  }, []);

  const load = useCallback(async (value: string) => {
    try {
      setLoaded({ state: 'ready', request: await trackBedRequest(value) });
    } catch (error: unknown) {
      const status = error instanceof ApiError ? error.status : null;
      setLoaded((current) =>
        // A request already on screen stays there; a link that is not one says so.
        status === 401 || status === 410 || status === 400
          ? { state: 'invalid' }
          : current.state === 'ready'
            ? current
            : { state: 'failed' },
      );
    }
  }, []);

  useEffect(() => {
    if (token === null) return undefined;
    if (token === '') {
      setLoaded({ state: 'invalid' });
      return undefined;
    }
    void load(token);
    return undefined;
  }, [token, load]);

  const settled =
    loaded.state === 'ready' &&
    (loaded.request.state === 'confirmed' ||
      loaded.request.state === 'declined' ||
      loaded.request.state === 'expired');

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
    <TabScreen title={tp('requestStatus', LOCALE)}>
      <Status
        loaded={loaded}
        now={now}
        onRetry={() => {
          if (token !== null) void load(token);
        }}
      />
    </TabScreen>
  );
}

function Status({
  loaded,
  now,
  onRetry,
}: {
  readonly loaded: Loaded;
  readonly now: Date;
  readonly onRetry: () => void;
}): ReactNode {
  if (loaded.state === 'loading') {
    return (
      <div className="h-40 rounded-md bg-sunken" aria-busy="true" data-testid="request-loading" />
    );
  }

  if (loaded.state === 'invalid') {
    return (
      <div className="flex flex-col gap-3" data-testid="request-invalid">
        <p className="text-body-md text-ink-secondary">{tp('requestLinkInvalid', LOCALE)}</p>
        <a href="/beds" className="text-body-md text-brand-600">
          {tp('requestSeeOthers', LOCALE)}
        </a>
      </div>
    );
  }

  if (loaded.state === 'failed') {
    return (
      <div className="flex flex-col gap-3" role="alert" data-testid="request-failed">
        <p className="text-body-md text-ink-secondary">{tp('listFailed', LOCALE)}</p>
        <button
          type="button"
          onClick={onRetry}
          className="min-h-touch rounded-md border border-line-strong px-4 text-body-md"
        >
          {tp('tryAgain', LOCALE)}
        </button>
      </div>
    );
  }

  const { request } = loaded;
  const leftMinutes =
    request.state === 'held' && request.holdExpiresAt !== null
      ? Math.max(0, Math.ceil((Date.parse(request.holdExpiresAt) - now.getTime()) / 60_000))
      : null;

  // The countdown reaching zero is the hold ending, said at once rather than
  // at the next poll.
  const shownState = leftMinutes === 0 ? 'expired' : request.state;
  const tone =
    shownState === 'held' || shownState === 'confirmed'
      ? 'border-brand-border bg-brand-100 text-brand-700'
      : 'border-line bg-surface text-ink';

  return (
    <div className="flex flex-col gap-4" data-testid="request-status" data-state={shownState}>
      <section className={`flex flex-col gap-2 rounded-lg border p-5 ${tone}`} aria-live="polite">
        <p className="text-body-sm">
          {request.hospitalNameBn} · {bedKindName(request.bedKind, LOCALE)}
        </p>
        <p className="text-title-lg">{tp(STATE_KEY[shownState], LOCALE)}</p>

        {shownState === 'held' && request.holdExpiresAt !== null && leftMinutes !== null ? (
          <>
            <p className="text-display-lg tabular-nums" data-testid="hold-left">
              {tp('requestHoldLeft', LOCALE).replace(
                '{minutes}',
                formatNumber(leftMinutes, NUMERALS),
              )}
            </p>
            <p className="text-body-md">
              {tp('requestHeldUntil', LOCALE).replace(
                '{time}',
                formatClock(request.holdExpiresAt, NUMERALS),
              )}
            </p>
          </>
        ) : null}

        {shownState === 'requested' ? (
          <p className="text-body-md">{tp('requestWaitingExplainer', LOCALE)}</p>
        ) : null}
      </section>

      {/* A live status says how old it is (`FR-OFF-03`). */}
      <FreshnessLine
        asOf={new Date(request.serverTs)}
        now={now}
        labels={{
          justNow: tp('updatedJustNow', LOCALE),
          ago: tp('updatedAgo', LOCALE),
          never: tp('updatedNever', LOCALE),
          stale: tp('staleWarning', LOCALE),
        }}
        formatMinutes={(value) => formatAge(value, LOCALE, NUMERALS)}
      />

      <div className="flex flex-col gap-3">
        {request.hospitalPhone === null ? null : (
          <a
            href={`tel:${request.hospitalPhone}`}
            data-testid="call-hospital"
            className="flex min-h-touch items-center justify-center rounded-md bg-brand-600 px-5 text-body-lg font-semibold text-white"
          >
            {tp('requestCallHospital', LOCALE)}
          </a>
        )}
        {shownState === 'declined' || shownState === 'expired' ? (
          <a
            href={`/beds?kind=${request.bedKind}`}
            data-testid="see-others"
            className="flex min-h-touch items-center justify-center rounded-md border border-line-strong px-5 text-body-lg"
          >
            {tp('requestSeeOthers', LOCALE)}
          </a>
        ) : null}
      </div>
    </div>
  );
}
