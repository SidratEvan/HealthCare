'use client';

/**
 * `MOD-B02-CHECKIN` — the patient is at the counter (`FR-REC-18`,
 * `BTN-B02-CHECKIN`).
 *
 * One question: how long should they expect to wait? The figure starts at the
 * queue's own estimate (`suggestedQuote`, the same function the patient's phone
 * counts down from) and reception moves it in fives, the way a restaurant
 * confirms an order with "about twenty minutes". Whatever is confirmed here is
 * what the patient's screen shows as the counter's word (`FR-PAT-38`).
 *
 * Queued like every other reception action (`FR-QUE-50`): a check-in is a
 * fact about who is standing here, true whether or not the network is.
 */

import { useEffect, useState } from 'react';

import { MAX_QUOTED_WAIT_MINUTES, QUOTE_STEP_MINUTES } from '@platform/domain';
import { format, formatNumber, formatSerial, t, type Locale, numeralsFor } from '@platform/i18n';
import { Button, Sheet, SheetActions } from '@platform/ui';

import type { ReactNode } from 'react';

/** What to start from when the queue has no estimate for this patient. */
const FALLBACK_QUOTE_MINUTES = 30;

export function CheckInSheet({
  serial,
  suggested,
  locale,
  onConfirm,
  onClose,
}: {
  /** The serial being checked in, or null when the sheet is closed. */
  readonly serial: number | null;
  /** The queue's estimate for them, in minutes, if it has one. */
  readonly suggested: number | null;
  readonly locale: Locale;
  readonly onConfirm: (quotedWaitMinutes: number) => void;
  readonly onClose: () => void;
}): ReactNode {
  const numerals = numeralsFor(locale);
  const [minutes, setMinutes] = useState(suggested ?? FALLBACK_QUOTE_MINUTES);

  // A new patient starts from their own estimate, not the last one's figure.
  useEffect(() => {
    setMinutes(suggested ?? FALLBACK_QUOTE_MINUTES);
  }, [serial, suggested]);

  const step = (delta: number): void => {
    setMinutes((current) => Math.min(MAX_QUOTED_WAIT_MINUTES, Math.max(0, current + delta)));
  };

  return (
    <Sheet
      open={serial !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      variant="modal"
      title={format('checkInTitle', locale, {
        serial: serial === null ? '' : formatSerial(serial, numerals),
      })}
      description={t('checkInDescription', locale)}
    >
      <div className="flex flex-col gap-4" data-testid="check-in-sheet">
        <p className="text-caption text-ink-muted">
          {suggested === null ? t('checkInNoEstimate', locale) : t('checkInFromQueue', locale)}
        </p>

        <div className="flex items-center justify-center gap-4">
          <Button
            variant="secondary"
            onClick={() => {
              step(-QUOTE_STEP_MINUTES);
            }}
            aria-label={t('checkInLess', locale)}
            data-testid="check-in-less"
          >
            <StepIcon plus={false} />
          </Button>
          <p
            className="min-w-32 text-center text-title-lg tabular-nums"
            data-testid="check-in-minutes"
          >
            {format('checkInMinutes', locale, { minutes: formatNumber(minutes, numerals) })}
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              step(QUOTE_STEP_MINUTES);
            }}
            aria-label={t('checkInMore', locale)}
            data-testid="check-in-more"
          >
            <StepIcon plus />
          </Button>
        </div>

        <SheetActions>
          <Button variant="secondary" onClick={onClose}>
            {t('checkInCancel', locale)}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onConfirm(minutes);
            }}
            data-testid="check-in-confirm"
          >
            {t('checkInConfirm', locale)}
          </Button>
        </SheetActions>
      </div>
    </Sheet>
  );
}

/** A stroke icon inheriting `currentColor` (`ICO-02`); the button carries the label. */
function StepIcon({ plus }: { readonly plus: boolean }): ReactNode {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      {plus ? <path d="M12 5v14" /> : null}
    </svg>
  );
}
