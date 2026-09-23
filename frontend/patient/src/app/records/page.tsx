'use client';

/**
 * `S-A-12` Health wallet — the timeline (`APP_FLOW.md` A7, `FR-PAT-60`–`65`).
 *
 * What a patient keeps. Everything before this screen is about getting seen on
 * time; this is the part they still want in five years.
 *
 * ## Whose records these are
 *
 * This device's, for the same reason `S-A-09`'s serials are: there are no
 * accounts (`CLAUDE.md` §4.1), so a guest's identity is one tracking link per
 * booking. Each link carries that booking's record once the doctor has signed
 * it (`FR-GST-08`: "downloadable from the tracking link"), so the timeline is
 * assembled by opening the links this phone already holds.
 *
 * It says so on screen rather than implying it holds a whole history. When
 * Supabase Auth lands this becomes one call to `GET /patients/:id/records`,
 * which already exists and already refuses everybody it should.
 *
 * ## Four outcomes per link, and none of them is borrowed by another
 *
 * A link answers with a record, with no record yet (booked, not seen), with
 * `GUEST_LINK_EXPIRED` (its "limited period" in `FR-GST-08` is over), or not at
 * all. Each is counted separately and said separately. Folding a failed request
 * into "no records" would be a statement about the patient's health standing in
 * for a statement about the network — the dishonesty `PRD.md` §3.2 forbids and
 * the discovery lists were already fixed for once.
 *
 * ## The tabs that are not here
 *
 * `TAB-A12-RX` (prescriptions) was dropped from this version.
 * `BTN-A12-UPLOAD` needs Supabase Storage, which is not configured.
 * `BTN-A12-EXPORT` needs a PDF writer, which is a dependency nobody has
 * agreed to yet. None is rendered as an empty tab: an empty tab tells a
 * patient something about their health rather than about this build.
 *
 * ## `TAB-A12-REP` arrived with step 17
 *
 * The links this device holds now carry the tests each booking's consultation
 * ordered (`FR-GST-08`), so Reports is a real tab rather than an absence. It
 * appears **only when there is something in it** — a person who has never had
 * a test is not shown an empty Reports tab, for the same reason the others
 * are named in a sentence instead.
 *
 * A test still on a bench is listed too, with what is happening to it. That
 * is the honest state: "we are testing it" is a different sentence from "you
 * have no reports", and the first is what stops somebody ringing the hospital.
 */

import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@platform/client';
import { formatDateTime, formatSerial, tp } from '@platform/i18n';
import { Button, Card } from '@platform/ui';

import { TabScreen } from '@/components/TabScreen';
import { WalletConsent, type Speaker } from '@/components/WalletConsent';
import { useOnline } from '@/hooks/useOnline';
import { openReportFile, openTrackingLink } from '@/lib/api';
import { recentBookings, type SavedBooking } from '@/lib/bookings';

import type { TestOrder, VisitRecord } from '@/lib/types';
import type { ReactNode } from 'react';

const LOCALE = 'bn' as const;
const NUMERALS = 'bengali' as const;

/** What the links on this device added up to. */
interface Wallet {
  readonly records: readonly VisitRecord[];
  /** Every test ordered on this device's bookings, newest first. */
  readonly tests: readonly LinkedTest[];
  /** Booked, not yet seen: a visit that has not happened is not a record. */
  readonly pending: number;
  /** Links past their period (`FR-GST-08`). Their records are real but out of reach. */
  readonly expired: number;
  /** Links that did not answer at all. */
  readonly failed: number;
  /** One per patient this device holds a live link for — who may consent. */
  readonly speakers: readonly Speaker[];
}

/**
 * A test, with the link that opens its report.
 *
 * The link is what the report is fetched with, so it travels with the test
 * rather than being looked up again: this phone may hold several, and only
 * the one that carried the test can open its report.
 */
interface LinkedTest extends TestOrder {
  readonly linkToken: string;
}

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'ready'; readonly wallet: Wallet };

export default function RecordsPage(): ReactNode {
  const online = useOnline();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });

    void loadWallet(recentBookings()).then((wallet) => {
      if (cancelled) return;

      // Every link failed and there was at least one to try: that is an
      // error, not an empty wallet.
      const tried = wallet.records.length + wallet.pending + wallet.expired + wallet.failed;
      setState(
        tried > 0 && wallet.failed === tried ? { kind: 'failed' } : { kind: 'ready', wallet },
      );
    });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  return (
    <TabScreen title={tp('navRecords', LOCALE)}>
      {state.kind === 'loading' ? (
        // GR-03 loading: the shape of the answer, never a spinner.
        <div className="flex flex-col gap-3" aria-busy="true" data-testid="records-loading">
          <div className="h-24 rounded-md bg-sunken" />
          <div className="h-24 rounded-md bg-sunken" />
          <span className="sr-only">{tp('loading', LOCALE)}</span>
        </div>
      ) : state.kind === 'failed' ? (
        // GR-03 offline and error. Offline first, because it names the cause
        // and the remedy; the service worker never answers an API request from
        // a cache (`FR-OFF-03`), so there is nothing older to show instead.
        <Problem
          message={online ? tp('listFailed', LOCALE) : tp('recordsOffline', LOCALE)}
          onRetry={retry}
        />
      ) : (
        <Loaded wallet={state.wallet} online={online} onRetry={retry} />
      )}
    </TabScreen>
  );
}

function Loaded({
  wallet,
  online,
  onRetry,
}: {
  readonly wallet: Wallet;
  readonly online: boolean;
  readonly onRetry: () => void;
}): ReactNode {
  // `TAB-A12-REP` appears only when there is something in it. A person who has
  // never had a test is not shown an empty Reports tab.
  const [tab, setTab] = useState<'timeline' | 'reports'>('timeline');
  const hasTests = wallet.tests.length > 0;

  return (
    <>
      {hasTests ? (
        <div
          className="flex gap-2"
          role="tablist"
          aria-label={tp('navRecords', LOCALE)}
          data-testid="wallet-tabs"
        >
          {(['timeline', 'reports'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              data-testid={`wallet-tab-${value}`}
              onClick={() => {
                setTab(value);
              }}
              className="min-h-touch rounded-pill px-4 text-body-md aria-selected:bg-brand-100 aria-selected:font-semibold"
            >
              {tp(value === 'timeline' ? 'timelineTab' : 'reportsTab', LOCALE)}
            </button>
          ))}
        </div>
      ) : null}

      {online ? null : (
        <p
          data-testid="records-offline"
          className="rounded-sm bg-warn-100 px-3 py-2 text-body-sm text-warn-700"
        >
          {tp('offline', LOCALE)}
        </p>
      )}

      {tab === 'reports' ? (
        <ReportList tests={wallet.tests} />
      ) : wallet.records.length === 0 ? (
        <div
          data-testid="records-empty"
          className="flex flex-col gap-3 rounded-md border border-line bg-surface p-5"
        >
          <p className="text-body-md text-ink-secondary">
            {wallet.pending === 0
              ? tp('noRecordsYet', LOCALE)
              : tp('recordsAfterVisit', LOCALE).replace(
                  '{count}',
                  formatSerial(wallet.pending, NUMERALS),
                )}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="record-list">
          {wallet.records.map((record) => (
            <li key={record.id}>
              <RecordCard record={record} />
            </li>
          ))}
        </ul>
      )}

      {tab === 'reports' || wallet.records.length === 0 || wallet.pending === 0 ? null : (
        <p className="text-caption text-ink-muted">
          {tp('recordsPending', LOCALE).replace('{count}', formatSerial(wallet.pending, NUMERALS))}
        </p>
      )}

      {tab === 'reports' || wallet.expired === 0 ? null : (
        <p className="text-caption text-ink-muted" data-testid="records-expired">
          {tp('recordsExpiredLinks', LOCALE).replace(
            '{count}',
            formatSerial(wallet.expired, NUMERALS),
          )}
        </p>
      )}

      {wallet.failed === 0 ? null : (
        <div className="flex flex-wrap items-center gap-3" data-testid="records-partly-failed">
          <p className="text-body-sm text-alert-700">
            {tp('recordsPartlyFailed', LOCALE).replace(
              '{count}',
              formatSerial(wallet.failed, NUMERALS),
            )}
          </p>
          <Button variant="quiet" size="sm" onClick={onRetry}>
            {tp('tryAgain', LOCALE)}
          </Button>
        </div>
      )}

      {wallet.speakers.map((speaker) => (
        <WalletConsent
          key={speaker.patientId}
          speaker={speaker}
          online={online}
          showName={wallet.speakers.length > 1}
        />
      ))}

      <p className="text-caption text-ink-muted">{tp('recordsOnThisDevice', LOCALE)}</p>

      {/* What the wallet cannot hold yet, named rather than rendered as empty
          tabs (`PRD.md` §3.2). */}
      <p data-testid="wallet-absent" className="text-caption text-ink-muted">
        {tp('walletAbsent', LOCALE)}
      </p>
    </>
  );
}

/** `CARD-A12-<recordId>` — the visit, opened out rather than behind a tap. */
function RecordCard({ record }: { readonly record: VisitRecord }): ReactNode {
  return (
    <Card>
      <div className="flex flex-col gap-2" data-testid={`record-${record.id}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-title-sm">{record.departmentNameBn}</p>
          <p className="text-body-sm tabular-nums text-ink-muted">
            {formatDateTime(record.visitedAt, NUMERALS)}
          </p>
        </div>

        <p className="text-body-sm text-ink-secondary">
          {record.doctorNameBn} · {record.hospitalNameBn}
        </p>

        {record.diagnosisText === null ? null : (
          <p className="text-body-lg font-semibold">{record.diagnosisText}</p>
        )}

        {record.adviceTextBn === null ? null : (
          <p className="text-body-md text-ink-secondary">{record.adviceTextBn}</p>
        )}

        {record.followUpDate === null ? null : (
          <p className="rounded-sm bg-brand-100 px-3 py-2 text-body-sm text-brand-700">
            {tp('followUpOn', LOCALE).replace(
              '{date}',
              formatDateTime(`${record.followUpDate}T09:00:00+06:00`, NUMERALS),
            )}
          </p>
        )}
      </div>
    </Card>
  );
}

/**
 * `TAB-A12-REP` — the tests this device's bookings produced (`FR-LAB-03`,
 * `FR-PAT-61`).
 *
 * Every test is listed, not only the finished ones. A test still on a bench
 * says what is happening to it, because "we are testing it" is a different
 * sentence from "you have no reports" — and the first is what stops somebody
 * ringing the hospital to ask.
 *
 * A delivered report opens through its signed URL. The link is fetched at the
 * moment of tapping rather than held on the page: a signed URL expires, and
 * one minted when the screen loaded would be dead by the time somebody
 * scrolled to it.
 */
function ReportList({ tests }: { readonly tests: readonly LinkedTest[] }): ReactNode {
  if (tests.length === 0) {
    return (
      <div
        data-testid="reports-empty"
        className="flex flex-col gap-3 rounded-md border border-line bg-surface p-5"
      >
        <p className="text-body-md text-ink-secondary">{tp('reportsNone', LOCALE)}</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3" data-testid="report-list">
      {tests.map((test) => (
        <li key={test.id}>
          <ReportCard test={test} />
        </li>
      ))}
    </ul>
  );
}

/** The state a patient is shown for a test with no report yet. */
const WAITING_LABEL: Readonly<Record<string, string>> = {
  ordered: 'reportStateOrdered',
  sample_collected: 'reportStateSampleCollected',
  processing: 'reportStateProcessing',
  cancelled: 'reportStateCancelled',
};

function ReportCard({ test }: { readonly test: LinkedTest }): ReactNode {
  const ready = test.report !== null && test.report.deliveredToWalletAt !== null;
  const waitingKey = WAITING_LABEL[test.state];

  return (
    <Card>
      <div className="flex flex-col gap-2" data-testid={`report-${test.id}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-title-sm">{test.testName}</p>
          <p className="text-body-sm tabular-nums text-ink-muted">
            {tp('reportOrderedOn', LOCALE).replace(
              '{date}',
              formatDateTime(test.orderedAt, NUMERALS),
            )}
          </p>
        </div>

        {ready ? (
          <>
            <p className="text-body-sm text-ok-700">
              {test.readyAt === null
                ? tp('reportReady', LOCALE)
                : tp('reportReadyOn', LOCALE).replace(
                    '{date}',
                    formatDateTime(test.readyAt, NUMERALS),
                  )}
            </p>
            <OpenReport
              testId={test.id}
              linkToken={test.linkToken}
              reportId={test.report?.id ?? ''}
            />
          </>
        ) : (
          <p className="text-body-sm text-ink-secondary">
            {waitingKey === undefined
              ? tp('reportWaiting', LOCALE)
              : tp(waitingKey as never, LOCALE)}
          </p>
        )}
      </div>
    </Card>
  );
}

/**
 * Opens a delivered report.
 *
 * The signed URL is fetched on the tap, for the reason the header gives, and
 * the window is opened with the result. A failure says so and stays put
 * rather than navigating somewhere blank.
 */
function OpenReport({
  testId,
  linkToken,
  reportId,
}: {
  readonly testId: string;
  readonly linkToken: string;
  readonly reportId: string;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="secondary"
        size="sm"
        data-testid={`report-open-${testId}`}
        onClick={() => {
          setBusy(true);
          setFailed(false);
          void openReportFile(linkToken, reportId)
            .then((url) => {
              globalThis.open(url, '_blank', 'noopener');
            })
            .catch(() => {
              setFailed(true);
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        {busy ? tp('loading', LOCALE) : tp('reportOpen', LOCALE)}
      </Button>

      {failed ? (
        <p role="alert" className="text-body-sm text-alert-700">
          {tp('reportOpenFailed', LOCALE)}
        </p>
      ) : null}
    </div>
  );
}

function Problem({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}): ReactNode {
  return (
    <div data-testid="records-error" className="flex flex-col gap-3">
      <p className="rounded-sm bg-alert-100 px-3 py-2 text-body-md text-alert-700">{message}</p>
      <Button onClick={onRetry} data-testid="records-retry">
        {tp('tryAgain', LOCALE)}
      </Button>
    </div>
  );
}

/**
 * Opens every link this device holds and sorts what comes back.
 *
 * Settled rather than awaited in sequence: one revoked or expired link must not
 * stop the records beside it from loading (`GR-03` — a partial answer beats
 * none).
 */
async function loadWallet(saved: readonly SavedBooking[]): Promise<Wallet> {
  const results = await Promise.allSettled(
    saved.map(async (booking) => ({ booking, view: await openTrackingLink(booking.token) })),
  );

  const records: VisitRecord[] = [];
  const tests: LinkedTest[] = [];
  const speakers = new Map<string, Speaker>();
  let pending = 0;
  let expired = 0;
  let failed = 0;

  for (const result of results) {
    if (result.status === 'rejected') {
      const reason: unknown = result.reason;
      if (reason instanceof ApiError && reason.code === 'GUEST_LINK_EXPIRED') expired += 1;
      else failed += 1;
      continue;
    }

    const { booking, view } = result.value;

    // Saved bookings are newest first, so the first live link for a patient is
    // the one that will stay valid longest.
    if (!speakers.has(view.booking.patientId)) {
      speakers.set(view.booking.patientId, {
        patientId: view.booking.patientId,
        patientName: view.booking.patientName,
        linkToken: booking.token,
      });
    }

    if (view.record === null) pending += 1;
    else records.push(view.record);

    tests.push(...view.tests.map((test) => ({ ...test, linkToken: booking.token })));
  }

  records.sort((a, b) => b.visitedAt.localeCompare(a.visitedAt));
  tests.sort((a, b) => b.orderedAt.localeCompare(a.orderedAt));

  return { records, tests, pending, expired, failed, speakers: [...speakers.values()] };
}
