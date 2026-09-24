'use client';

/**
 * The queue table (`APP_FLOW.md` B1.4, FRONTEND.md §5.8, §6.4).
 *
 * "Row height 56 px. Header `--bg-sunken`, caption-size, semibold. Zebra
 * striping is banned; separation is hairline rows. Active row gets
 * `--brand-100` fill. Row actions appear as `sm` secondary buttons, always
 * visible (hover-reveal fails on touch monitors and slows staff). Columns have
 * fixed widths so the eye doesn't re-scan after every update."
 *
 * That last point is the one that looks like a detail and is not. This table
 * redraws every time any counter in the hospital touches the queue. Columns
 * that resize to their content would shift under a receptionist's eye mid-read,
 * several times a minute, all day.
 *
 * ## The pending-sync glyph
 *
 * §6.4: "Pending-sync rows carry a small clock glyph rather than a colour
 * change." Colour is already carrying status here, and a second meaning on the
 * same channel is how a no-show gets mistaken for an unsent row. It is also
 * `A11Y-03`: colour never carries meaning alone.
 */

import type { BookingStatus, QueueEntry, QueueState } from '@platform/domain';
import { format, formatNumber, formatSerial, t, type Locale, numeralsFor } from '@platform/i18n';
import { Button, Chip, type ChipTone } from '@platform/ui';

import type { ReactNode } from 'react';

/** Which chip family each status belongs to (FRONTEND.md §5.5). */
const STATUS_TONE: Record<BookingStatus, ChipTone> = {
  booked: 'neutral',
  waiting: 'neutral',
  in_chamber: 'positive',
  done: 'positive',
  late: 'caution',
  no_show: 'caution',
  cancelled: 'neutral',
  rescheduled: 'neutral',
};

const STATUS_LABEL = {
  booked: 'statusBooked',
  waiting: 'statusWaiting',
  in_chamber: 'statusInChamber',
  done: 'statusDone',
  late: 'statusLate',
  no_show: 'statusNoShow',
  cancelled: 'statusCancelled',
  rescheduled: 'statusRescheduled',
} as const;

const SOURCE_LABEL = {
  app: 'sourceApp',
  guest_link: 'sourceGuestLink',
  counter: 'sourceCounter',
  phone: 'sourcePhone',
  walkin: 'sourceWalkin',
} as const;

export interface QueueTableProps {
  readonly state: QueueState;
  readonly locale: Locale;
  /** Keys still waiting to reach the server, for the clock glyph (§6.4). */
  readonly pendingBookingIds: ReadonlySet<string>;
  readonly onDone: (entry: QueueEntry) => void;
  readonly onLate: (entry: QueueEntry) => void;
  readonly onNoShow: (entry: QueueEntry) => void;
  readonly onReinstate: (entry: QueueEntry) => void;
  /** `BTN-B02-CHECKIN`: the patient is at the counter (`FR-REC-18`). */
  readonly onCheckIn: (entry: QueueEntry) => void;
  /** Patient display names, by patient id. Absent while they load. */
  readonly patientNames: ReadonlyMap<string, string>;
}

export function QueueTable({
  state,
  locale,
  pendingBookingIds,
  onDone,
  onLate,
  onNoShow,
  onReinstate,
  onCheckIn,
  patientNames,
}: QueueTableProps): ReactNode {
  const numerals = numeralsFor(locale);
  if (state.entries.length === 0) {
    // GR-03: an empty state is a designed state. One plain Bangla sentence and
    // nothing else (FRONTEND.md §5.9).
    return (
      <p className="p-6 text-body-md text-ink-muted" data-testid="queue-empty">
        {t('emptyQueue', locale)}
      </p>
    );
  }

  return (
    <table className="w-full table-fixed border-collapse" data-testid="queue-table">
      <caption className="sr-only">{t('navQueue', locale)}</caption>

      <thead>
        <tr className="bg-sunken text-left text-caption font-semibold text-ink-secondary">
          <th scope="col" className="w-20 px-4 py-3">
            {t('colSerial', locale)}
          </th>
          <th scope="col" className="px-4 py-3">
            {t('colPatient', locale)}
          </th>
          <th scope="col" className="w-32 px-4 py-3">
            {t('colStatus', locale)}
          </th>
          <th scope="col" className="w-24 px-4 py-3">
            {t('colSource', locale)}
          </th>
          {/* Wide enough for the three buttons a waiting row carries, and no
              wider: the name column gets the rest, so a name reads on one
              line. */}
          <th scope="col" className="w-72 px-4 py-3">
            {t('colActions', locale)}
          </th>
        </tr>
      </thead>

      <tbody>
        {state.entries.map((entry) => {
          const serving = entry.status === 'in_chamber';
          const unsent = pendingBookingIds.has(entry.bookingId);

          return (
            <tr
              key={entry.bookingId}
              data-testid={`queue-row-${String(entry.serial)}`}
              data-status={entry.status}
              data-pending={unsent ? 'true' : 'false'}
              // Hairline separation, never zebra striping (§5.8).
              className={serving ? 'border-b border-line bg-brand-100' : 'border-b border-line'}
            >
              <td className="h-14 px-4 font-semibold tabular-nums">
                {formatSerial(entry.serial, numeralsFor(locale))}
              </td>

              <td className="px-4">
                <span className={serving ? 'text-body-md font-semibold' : 'text-body-md'}>
                  {patientNames.get(entry.patientId) ?? '—'}
                </span>
                {unsent ? <PendingGlyph label={t('pendingToSync', locale)} /> : null}
              </td>

              <td className="px-4">
                {/* Here, checked in: said as a word, because "waiting" is also
                    what a booked patient still at home is (`FR-REC-18`). */}
                <Chip tone={STATUS_TONE[entry.status]}>
                  {entry.status === 'waiting' && entry.arrivedAt !== null
                    ? t('statusArrived', locale)
                    : t(STATUS_LABEL[entry.status], locale)}
                </Chip>
                {entry.quotedWaitMinutes !== null && isWaiting(entry.status) ? (
                  <span
                    className="mt-1 block text-caption text-ink-muted tabular-nums"
                    data-testid={`quoted-${String(entry.serial)}`}
                  >
                    {format('quotedShort', locale, {
                      // Bengali, as the serial on the same row is.
                      minutes: formatNumber(entry.quotedWaitMinutes, numerals),
                    })}
                  </span>
                ) : null}
              </td>

              <td className="px-4 text-body-sm text-ink-muted">
                {t(SOURCE_LABEL[entry.source], locale)}
              </td>

              <td className="px-4">
                {/*
                  Always visible, never hover-revealed: a hover affordance
                  fails outright on the touch monitors many counters use, and
                  costs a second per patient on the ones it works on (§5.8).
                */}
                <div className="flex gap-2">
                  {entry.status === 'in_chamber' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        onDone(entry);
                      }}
                    >
                      {t('markDone', locale)}
                    </Button>
                  ) : null}

                  {/* `BTN-B02-CHECKIN`: first, because it is the first thing
                      that happens to a patient at the counter. */}
                  {entry.arrivedAt === null &&
                  (isWaiting(entry.status) || entry.status === 'late') ? (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        onCheckIn(entry);
                      }}
                      data-testid={`check-in-${String(entry.serial)}`}
                    >
                      {t('checkIn', locale)}
                    </Button>
                  ) : null}

                  {isWaiting(entry.status) ? (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          onLate(entry);
                        }}
                      >
                        {t('markLate', locale)}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          onNoShow(entry);
                        }}
                      >
                        {t('markNoShow', locale)}
                      </Button>
                    </>
                  ) : null}

                  {entry.status === 'no_show' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        onReinstate(entry);
                      }}
                    >
                      {t('reinstate', locale)}
                    </Button>
                  ) : null}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function isWaiting(status: BookingStatus): boolean {
  return status === 'booked' || status === 'waiting';
}

/**
 * The clock glyph on a row whose action has not reached the server (§6.4).
 *
 * Inline stroke SVG inheriting `currentColor` (`ICO-02`), with a real label
 * rather than a `title` — a tooltip is not announced and not reachable by
 * touch.
 */
function PendingGlyph({ label }: { readonly label: string }): ReactNode {
  return (
    <span className="ml-2 inline-flex items-center gap-1 align-middle text-warn-600">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}
