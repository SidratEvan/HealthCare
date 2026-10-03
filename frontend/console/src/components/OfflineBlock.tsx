'use client';

/**
 * The offline status block (`APP_FLOW.md` B1.5, `FR-OFF-01`).
 *
 * "Status + pending-event count + last sync time; clicking shows the pending
 * list."
 *
 * This small panel is what makes offline-first believable to the person using
 * it. A receptionist who cannot see whether her last twenty taps have reached
 * the server will either stop trusting the console or stop working when the
 * wifi drops — and the second is the failure this whole design exists to
 * prevent.
 *
 * So it says plainly whether there is a connection, how much is waiting to go,
 * and when the server was last heard from. Never a spinner, and never an empty
 * state that could be read as "all sent" (`FR-OFF-05`).
 *
 * Two further things it says only when they are true. That the server could
 * not take some actions: they are set aside so they stop blocking the rest,
 * and the operator sends them again or discards them — never the system, on
 * its own. And that this browser will not keep the outbox across a reload,
 * because a safety that is not there must not be implied (PRD.md §3.2).
 */

import { useState } from 'react';

import { format, formatNumber, numeralsFor, t, type Locale } from '@platform/i18n';
import { Button, Chip } from '@platform/ui';

import type { ReactNode } from 'react';

export interface OfflineBlockProps {
  readonly connected: boolean;
  readonly pendingCount: number;
  /** Null when this console has never reached the server. */
  readonly lastServerTs: string | null;
  /** Actions the server answered and could not take. */
  readonly stuckCount: number;
  readonly onRetryStuck?: () => void;
  readonly onDiscardStuck?: () => void;
  /** False when what is queued lives in this tab only. Absent means it is kept. */
  readonly durable?: boolean;
  readonly locale: Locale;
  readonly now: Date;
}

export function OfflineBlock({
  connected,
  pendingCount,
  lastServerTs,
  stuckCount,
  onRetryStuck,
  onDiscardStuck,
  durable = true,
  locale,
  now,
}: OfflineBlockProps): ReactNode {
  const numerals = numeralsFor(locale);
  /** `GR-01`: discarding names its consequence and is asked for twice. */
  const [confirming, setConfirming] = useState(false);

  return (
    <section
      className="rounded-md border border-line bg-surface p-4"
      data-testid="offline-block"
      data-connected={connected ? 'true' : 'false'}
      // A11Y-04: connection state changes without the operator doing anything,
      // so it is announced rather than silently swapped.
      aria-live="polite"
    >
      <div className="flex items-center justify-between">
        {/*
          A11Y-03: the state is a word, not a colour. A green dot alone is
          unreadable to a colour-blind operator and invisible in a screenshot.
        */}
        <Chip tone={connected ? 'positive' : 'caution'}>
          {connected ? t('online', locale) : t('offline', locale)}
        </Chip>

        {pendingCount > 0 ? (
          <span
            className="text-body-sm tabular-nums text-ink-secondary"
            data-testid="pending-count"
          >
            {t('pendingToSync', locale)}: {formatNumber(pendingCount, numerals)}
          </span>
        ) : null}
      </div>

      <p className="mt-3 text-caption text-ink-muted" data-testid="last-synced">
        {lastServerTs === null
          ? t('neverSynced', locale)
          : `${t('lastSynced', locale)}: ${formatNumber(minutesSince(lastServerTs, now), numerals)} ${t('minutesShort', locale)}`}
      </p>

      {!connected ? (
        // Said once, plainly, so nobody has to be told in training that the
        // console keeps working (FR-OFF-01).
        <p className="mt-2 text-caption text-ink-secondary">{t('offlineExplainer', locale)}</p>
      ) : null}

      {stuckCount > 0 ? (
        <div className="mt-3" role="alert" data-testid="sync-stuck">
          <p className="text-caption text-warn-600">
            {format('syncStuck', locale, { count: formatNumber(stuckCount, numerals) })}
          </p>

          {confirming ? (
            <>
              <p className="mt-2 text-caption text-ink-secondary">
                {t('syncStuckConfirm', locale)}
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid="sync-stuck-discard-confirm"
                  onClick={() => {
                    setConfirming(false);
                    onDiscardStuck?.();
                  }}
                >
                  {t('syncStuckDiscard', locale)}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setConfirming(false);
                  }}
                >
                  {t('syncStuckKeep', locale)}
                </Button>
              </div>
            </>
          ) : (
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                data-testid="sync-stuck-retry"
                onClick={() => {
                  onRetryStuck?.();
                }}
              >
                {t('syncStuckRetry', locale)}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                data-testid="sync-stuck-discard"
                onClick={() => {
                  setConfirming(true);
                }}
              >
                {t('syncStuckDiscard', locale)}
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {!durable ? (
        <p className="mt-2 text-caption text-warn-600" role="alert" data-testid="not-durable">
          {t('queueNotDurable', locale)}
        </p>
      ) : null}
    </section>
  );
}

function minutesSince(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
}
