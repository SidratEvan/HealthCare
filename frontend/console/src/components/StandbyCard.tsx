'use client';

/**
 * The waitlist recovery card — `BTN-B02-OFFER` (`APP_FLOW.md` B1.5,
 * `FR-REC-30`, `FR-QUE-30`).
 *
 * "Appears when a slot frees → standby patients receive a timed offer;
 * acceptance appears here."
 *
 * ## Where each fact comes from
 *
 * Which chairs are free and which offers are outstanding come from the queue
 * state the session channel already delivers — the same reduced log every
 * other part of the console reads, so the card and the table can never
 * disagree about whether serial 14 is empty. How many people are waiting and
 * what an accepted offer recovered are not in that state (a standby patient
 * has no booking, and money is not a queue event), so those come from
 * `GET /sessions/:id/standby`, re-read whenever the log moves.
 *
 * ## Acceptance is recorded here, by reception
 *
 * The offer SMS says "tell the counter by {time}" (`queue.slot_offered`): a
 * standby patient has no booking and so no tracking link to accept from. When
 * they ring or walk up, the receptionist taps গ্রহণ করেছেন, which is what
 * `POST /offers/:id/accept` is — and that tap is the figure the admin
 * dashboard's recovery tile moves by (`FR-ADM-03`, `FR-QUE-31`).
 *
 * ## Online-only, and says so
 *
 * See `lib/standby.ts` for why an offer cannot be queued. With the connection
 * gone the buttons stay visible and carry the reason (`FRONTEND.md` §5.1),
 * rather than disappearing or failing on a tap.
 *
 * The same holds while the outbox still has actions to send. A no-show is
 * applied on this screen the instant it is tapped, and the chair looks free
 * here before the server has heard — an offer sent in that gap is refused as
 * `SLOT_NOT_FREE`, because on the server's side the patient is still waiting.
 * So the offer waits until the console and the server agree.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError } from '@platform/client';
import { canOfferFreedSlot, type QueueState } from '@platform/domain';
import {
  format,
  formatClock,
  formatNumber,
  formatSerial,
  formatTaka,
  t,
  type Locale,
} from '@platform/i18n';
import { Card, useToast } from '@platform/ui';

import { ActionButton } from '@/components/ActionButton';
import { standbyApi, type StandbyPanel } from '@/lib/standby';

import type { ReactNode } from 'react';

/** Console surfaces use Latin numerals for figures and times (`TYP-04`). */
const NUMERALS = 'latin' as const;

/**
 * How often the panel is re-read while an offer is outstanding.
 *
 * The read is what records a lapsed offer (nothing sweeps on a timer), so
 * without it an offer whose window closed would sit on this card as
 * "awaiting an answer" until something else moved the queue — and a patient
 * who said yes or no on their phone (`FR-PAT-27`) would not show here until
 * then either.
 */
const OUTSTANDING_POLL_MS = 15_000;

/**
 * How often it is re-read otherwise. A patient joining the list from the app
 * (`FR-PAT-25`) is not a queue event, so nothing on the session channel says
 * they arrived.
 */
const IDLE_POLL_MS = 30_000;

export function StandbyCard({
  sessionId,
  state,
  connected,
  pendingCount,
  locale,
  apiBaseUrl,
  getToken,
}: {
  readonly sessionId: string;
  readonly state: QueueState;
  readonly connected: boolean;
  /** Queue actions applied here and not yet acknowledged by the server. */
  readonly pendingCount: number;
  readonly locale: Locale;
  readonly apiBaseUrl: string;
  readonly getToken: () => string | null;
}): ReactNode {
  const { show } = useToast();
  const api = useMemo(() => standbyApi(apiBaseUrl, getToken), [apiBaseUrl, getToken]);

  const [panel, setPanel] = useState<StandbyPanel | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPanel(await api.panel(sessionId));
    } catch {
      // The card keeps what it last had. The count is a convenience beside the
      // queue, not a figure anybody acts on without the queue in front of them.
    }
  }, [api, sessionId]);

  // Re-read whenever the log moves: an offer, an acceptance or a lapse all
  // arrive as events, and each changes what the panel says.
  useEffect(() => {
    void refresh();
  }, [refresh, state.lastSeq]);

  const outstanding = state.offers.filter((offer) => offer.outcome === 'pending');

  useEffect(() => {
    const timer = setInterval(
      () => void refresh(),
      outstanding.length === 0 ? IDLE_POLL_MS : OUTSTANDING_POLL_MS,
    );
    return () => {
      clearInterval(timer);
    };
  }, [outstanding.length, refresh]);

  // A chair is on offer when the domain would allow offering it — the same
  // guard the server applies, so the card never shows a button the API refuses.
  const freed = state.entries.filter(
    (entry) =>
      canOfferFreedSlot(state, entry.bookingId).ok &&
      !state.offers.some(
        (offer) => offer.freedBookingId === entry.bookingId && offer.outcome === 'accepted',
      ),
  );
  const accepted = state.offers.filter((offer) => offer.outcome === 'accepted');
  // Null until the panel has been read once: "nobody is waiting" is a claim,
  // and the card does not make it before it knows.
  const waiting = panel === null ? null : panel.waiting.length;
  const prepaidCount = panel === null ? 0 : panel.waiting.filter((row) => row.prepaid).length;

  // "Appears when a slot frees." Nothing free, nothing offered and nobody
  // waiting is a card with nothing to say, so there is no card.
  if (
    freed.length === 0 &&
    outstanding.length === 0 &&
    accepted.length === 0 &&
    (waiting ?? 0) === 0
  ) {
    return null;
  }

  const serialOf = (bookingId: string | null): string => {
    const entry = state.entries.find((candidate) => candidate.bookingId === bookingId);
    return entry === undefined ? '—' : formatSerial(entry.serial, 'bengali');
  };

  const recoveredOf = (offerId: string): number | null =>
    panel?.offers.find((offer) => offer.id === offerId)?.recoveredValuePoisha ?? null;

  const offlineReason = connected ? null : t('standbyOfflineReason', locale);
  const syncingReason = pendingCount > 0 ? t('standbySyncing', locale) : null;

  const offer = async (bookingId: string): Promise<void> => {
    setBusy(bookingId);
    try {
      await api.offer(bookingId);
      show({ title: t('standbyOffered', locale), tone: 'positive' });
      await refresh();
    } catch (error: unknown) {
      const guard = error instanceof ApiError ? error.details?.['guard'] : undefined;
      show({
        title: guard === 'NO_STANDBY' ? t('standbyNoOne', locale) : t('standbyOfferFailed', locale),
        tone: 'caution',
      });
    } finally {
      setBusy(null);
    }
  };

  const accept = async (offerId: string): Promise<void> => {
    setBusy(offerId);
    try {
      await api.accept(offerId);
      show({ title: t('standbyAccepted', locale), tone: 'positive' });
      await refresh();
    } catch (error: unknown) {
      const guard = error instanceof ApiError ? error.details?.['guard'] : undefined;
      show({
        title:
          guard === 'OFFER_EXPIRED'
            ? t('standbyExpired', locale)
            : t('standbyAcceptFailed', locale),
        tone: 'caution',
      });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card data-testid="standby-card">
      <p className="text-caption text-ink-muted">{t('standbyTitle', locale)}</p>
      <p className="mt-1 text-title-sm tabular-nums" data-testid="standby-waiting">
        {format('standbyCount', locale, {
          count: waiting === null ? '—' : formatNumber(waiting, NUMERALS),
        })}
      </p>
      {/* `FR-PAT-26`: offering a chair to somebody who paid seats them without
          asking, and the receptionist should know that before tapping. */}
      {prepaidCount === 0 ? null : (
        <p className="text-caption text-brand-700" data-testid="standby-prepaid-count">
          {format('standbyPrepaidCount', locale, {
            count: formatNumber(prepaidCount, NUMERALS),
          })}
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-3">
        {freed.map((entry) => (
          <li key={entry.bookingId} className="flex flex-col gap-2" data-testid="standby-freed">
            <p className="text-body-sm">
              {format('standbyFreedSerial', locale, {
                serial: formatSerial(entry.serial, 'bengali'),
              })}
            </p>
            {/* Nobody to give it to is a sentence, not a button that cannot be
                pressed: the receptionist needs to know the chair stays empty. */}
            {waiting === 0 ? (
              <p className="text-caption text-ink-muted" data-testid="standby-no-one">
                {t('standbyNoOne', locale)}
              </p>
            ) : (
              <ActionButton
                variant="primary"
                size="sm"
                reason={
                  offlineReason ??
                  syncingReason ??
                  (waiting === null ? t('loading', locale) : null) ??
                  (busy === null ? null : t('standbyWorking', locale))
                }
                onClick={() => void offer(entry.bookingId)}
                testId={`standby-offer-${String(entry.serial)}`}
              >
                {t('standbyOffer', locale)}
              </ActionButton>
            )}
          </li>
        ))}

        {outstanding.map((pending) => (
          <li key={pending.offerId} className="flex flex-col gap-2" data-testid="standby-pending">
            <p className="text-body-sm">
              {format('standbyFreedSerial', locale, { serial: serialOf(pending.freedBookingId) })}
              {' · '}
              {t('standbyWaitingFor', locale)}{' '}
              <span className="tabular-nums">
                {format('standbyAnswerBy', locale, {
                  time: formatClock(pending.expiresAt, NUMERALS),
                })}
              </span>
            </p>
            <ActionButton
              variant="secondary"
              size="sm"
              reason={offlineReason ?? (busy === null ? null : t('standbyWorking', locale))}
              onClick={() => void accept(pending.offerId)}
              testId={`standby-accept-${pending.offerId}`}
            >
              {t('standbyAccept', locale)}
            </ActionButton>
          </li>
        ))}

        {accepted.map((taken) => {
          const recovered = recoveredOf(taken.offerId);
          return (
            <li
              key={taken.offerId}
              className="text-body-sm text-brand-600"
              data-testid="standby-accepted"
            >
              {format('standbyFreedSerial', locale, { serial: serialOf(taken.freedBookingId) })}
              {' · '}
              {t('standbyAccepted', locale)}
              {recovered === null ? null : (
                <span className="tabular-nums">
                  {' · '}
                  {format('standbyRecoveredAmount', locale, {
                    amount: formatTaka(recovered, NUMERALS),
                  })}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {/* `GR-03`'s empty state with its "কী করবেন": people are waiting and no
          chair is free, so the card says where the offer will come from. */}
      {freed.length === 0 && outstanding.length === 0 ? (
        <p className="mt-2 text-caption text-ink-muted">{t('standbyNothingFree', locale)}</p>
      ) : null}
    </Card>
  );
}
