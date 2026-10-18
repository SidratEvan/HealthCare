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
import {
  format,
  formatNumber,
  formatSerial,
  t,
  CONSOLE,
  type Locale,
  numeralsFor,
} from '@platform/i18n';
import { BilingualLabel, ConsoleAction, Chip, type ChipTone } from '@platform/ui';

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
  // An appointment brought in from the hospital's own system (pilot step 24).
  import: 'sourceImport',
} as const;

export interface QueueTableProps {
  readonly scope?: string | null;
  readonly ended?: boolean;
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
  scope = null,
  ended = false,
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
  const testId = (name: string): string => (scope === null ? name : `${name}-${scope}`);
  if (state.entries.length === 0) {
    // GR-03: an empty state is a designed state. One plain Bangla sentence and
    // nothing else (FRONTEND.md §5.9).
    return (
      <p className="p-6 text-body-md text-ink-muted" data-testid={testId('queue-empty')}>
        {t('emptyQueue', locale)}
      </p>
    );
  }

  return (
    <table className="cf-reception-table" data-testid={testId('queue-table')}>
      <caption className="sr-only">{t('navQueue', locale)}</caption>
      <thead className="sr-only">
        <tr>
          {['colSerial', 'colPatient', 'colStatus', 'colActions'].map((key) => (
            <th key={key} scope="col">
              {t(key as 'colSerial', locale)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {state.entries.map((entry) => {
          const unsent = pendingBookingIds.has(entry.bookingId);
          return (
            <tr
              className="cf-reception-row"
              key={entry.bookingId}
              data-testid={testId(`queue-row-${entry.serial}`)}
              data-status={entry.status}
              data-pending={unsent ? 'true' : 'false'}
            >
              <td>
                <strong>{formatSerial(entry.serial, numerals)}</strong>
              </td>
              <td>
                <strong>{patientNames.get(entry.patientId) ?? '—'}</strong>
                <p className="cf-secondary">{t(SOURCE_LABEL[entry.source], locale)}</p>
                {unsent ? <PendingGlyph label={t('pendingToSync', locale)} /> : null}
              </td>
              <td>
                <Chip tone={STATUS_TONE[entry.status]}>
                  <span aria-hidden="true">
                    {entry.status === 'done'
                      ? '✓ '
                      : entry.status === 'in_chamber'
                        ? '● '
                        : entry.status === 'late' || entry.status === 'no_show'
                          ? '! '
                          : '○ '}
                  </span>
                  {isWaiting(entry.status) && entry.arrivedAt === null
                    ? t('receptionNotArrived', locale)
                    : entry.status === 'waiting' && entry.arrivedAt !== null
                      ? t('statusArrived', locale)
                      : t(STATUS_LABEL[entry.status], locale)}
                </Chip>
                {entry.quotedWaitMinutes !== null && isWaiting(entry.status) ? (
                  <p className="cf-secondary" data-testid={testId(`quoted-${entry.serial}`)}>
                    {format('quotedShort', locale, {
                      minutes: formatNumber(entry.quotedWaitMinutes, numerals),
                    })}
                  </p>
                ) : null}
              </td>
              <td className="cf-reception-actions">
                {!ended &&
                entry.arrivedAt === null &&
                (isWaiting(entry.status) || entry.status === 'late') ? (
                  <ConsoleAction
                    label={CONSOLE.checkIn}
                    variant="secondary"
                    data-testid={testId(`check-in-${entry.serial}`)}
                    onClick={() => onCheckIn(entry)}
                  />
                ) : null}
                {!ended &&
                ['in_chamber', 'booked', 'waiting', 'late', 'no_show'].includes(entry.status) ? (
                  <details className="cf-reception-menu">
                    <summary data-testid={testId(`row-more-${entry.serial}`)}>
                      <BilingualLabel label={CONSOLE.receptionMore} />
                    </summary>
                    <div className="cf-stack">
                      {entry.status === 'in_chamber' ? (
                        <ConsoleAction
                          label={CONSOLE.markDone}
                          variant="secondary"
                          onClick={() => onDone(entry)}
                        />
                      ) : null}
                      {isWaiting(entry.status) ? (
                        <>
                          <ConsoleAction
                            label={CONSOLE.markLate}
                            variant="secondary"
                            onClick={() => onLate(entry)}
                          />
                          <ConsoleAction
                            label={CONSOLE.markNoShow}
                            variant="secondary"
                            {...(state.status === 'paused'
                              ? { disabled: true, disabledReason: t('pausedResumeFirst', locale) }
                              : {})}
                            onClick={() => onNoShow(entry)}
                          />
                        </>
                      ) : null}
                      {entry.status === 'late' || entry.status === 'no_show' ? (
                        <ConsoleAction
                          label={CONSOLE.reinstate}
                          variant="secondary"
                          onClick={() => onReinstate(entry)}
                        />
                      ) : null}
                    </div>
                  </details>
                ) : null}
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
