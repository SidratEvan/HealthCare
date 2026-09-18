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
 * So it says three things plainly: whether there is a connection, how much is
 * waiting to go, and when the server was last heard from. Never a spinner, and
 * never an empty state that could be read as "all sent" (`FR-OFF-05`).
 */

import { formatNumber, t, type Locale } from '@platform/i18n';
import { Chip } from '@platform/ui';

import type { ReactNode } from 'react';

export interface OfflineBlockProps {
  readonly connected: boolean;
  readonly pendingCount: number;
  /** Null when this console has never reached the server. */
  readonly lastServerTs: string | null;
  /** Entries that have failed enough times to be worth surfacing. */
  readonly stuckCount: number;
  readonly locale: Locale;
  readonly now: Date;
}

export function OfflineBlock({
  connected,
  pendingCount,
  lastServerTs,
  stuckCount,
  locale,
  now,
}: OfflineBlockProps): ReactNode {
  const numerals = locale === 'bn' ? 'bengali' : 'latin';

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
        <p className="mt-2 text-caption text-warn-600" role="alert" data-testid="sync-stuck">
          {t('syncStuck', locale)}
        </p>
      ) : null}
    </section>
  );
}

function minutesSince(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
}
