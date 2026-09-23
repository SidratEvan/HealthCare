/**
 * The hospital admin dashboard (`S-B-10`, `FR-ADM-01`..`FR-ADM-10`).
 *
 * Assembles the eight sections `APP_FLOW.md` B6 lists, and writes the CSV the
 * export button produces. The arithmetic is `shared/domain/admin`; the rows
 * are `admin.repo`; what is here is the assembly and the two decisions that
 * are neither — when the snapshot is too old to serve, and what to do when a
 * figure cannot honestly be given.
 *
 * ## The freshness rule this screen is held to
 *
 * Every figure on `S-B-10` comes with an age, and there are three different
 * ages on one screen: the materialised snapshot's, the referral view's newest
 * row, and the feedback's. They are reported separately rather than reduced to
 * one, for the same reason `v_public_hospital_capacity` carries two stamps
 * instead of one — a single age would have to be one of them and would lie
 * about the others (`PRD.md` §3.2).
 *
 * ## Why a read can trigger a rebuild
 *
 * `DATABASE.md` §4 says `v_admin_daily` is "refreshed every 5 min", and
 * nothing in this version runs on a schedule (`pg-boss` is not installed). So
 * the read refreshes it when it is older than that and shows its age either
 * way. The alternative — serving whatever the snapshot last happened to hold —
 * would put a figure on screen with no bound on its staleness at all, which is
 * the one thing this product does not do.
 *
 * A refresh that fails does not fail the read. The dashboard then renders the
 * older snapshot with its true age, which is worse than fresh data and far
 * better than an error page: an administrator can see that the figures are
 * twenty minutes old and decide for themselves.
 */

import {
  forecastVolume,
  lossAndRecovery,
  punctualityByDoctor,
  type DoctorPunctuality,
  type ForecastPoint,
  type LossAndRecovery,
} from '@platform/domain';

import { logger } from '../config/logger.js';
import { AppError } from '../errors/AppError.js';
import * as adminRepo from '../repositories/admin.repo.js';
import { withTransaction } from '../repositories/transaction.js';

/**
 * How stale the snapshot may be before a read rebuilds it.
 *
 * Five minutes, from `DATABASE.md` §4. It is a product decision and not a
 * performance one: a hospital director watching the day unfold will refresh
 * the page, and a figure that cannot move for longer than that stops being a
 * live dashboard and becomes a report.
 */
export const SNAPSHOT_MAX_AGE_MS = 5 * 60_000;

/** How far back the forecast looks for its weekday averages (`FR-ADM-09`). */
export const FORECAST_HISTORY_DAYS = 84;

/** The widest window a dashboard read may ask for, in days. */
export const MAX_RANGE_DAYS = 400;

export interface DashboardInput {
  readonly hospitalId: string;
  readonly from: string;
  readonly to: string;
}

export interface TodayFigures {
  readonly seen: number;
  readonly booked: number;
  readonly noShows: number;
  readonly cancelled: number;
  readonly walkin: number;
  readonly bookedAhead: number;
  readonly avgWaitMinutes: number | null;
  readonly longestWaitMinutes: number | null;
  readonly waitsMeasured: number;
  readonly sessionsTotal: number;
  readonly sessionsLate: number;
  readonly sessionsNeverStarted: number;
}

export interface TrendPoint {
  readonly date: string;
  readonly avgWaitMinutes: number | null;
  readonly seen: number;
  readonly waitsMeasured: number;
}

export interface Dashboard {
  readonly range: adminRepo.DateRange;
  readonly today: TodayFigures;
  readonly trend: readonly TrendPoint[];
  readonly adoptionDate: string | null;
  readonly loss: LossAndRecovery;
  readonly lossByDay: readonly {
    readonly date: string;
    readonly uncollectedPoisha: number;
    readonly recoveredPoisha: number;
  }[];
  readonly revenue: {
    readonly byDoctor: readonly adminRepo.RevenueSlice[];
    readonly byDepartment: readonly adminRepo.RevenueSlice[];
    readonly byMethod: readonly adminRepo.RevenueSlice[];
    readonly byService: readonly adminRepo.RevenueSlice[];
    readonly collectedPoisha: number;
    readonly billedPoisha: number;
    readonly refundedPoisha: number;
  };
  readonly staff: readonly DoctorPunctuality[];
  readonly beds: readonly adminRepo.BedUtilisation[];
  readonly referrals: adminRepo.ReferralFlow | null;
  readonly feedback: {
    readonly summary: adminRepo.FeedbackSummary;
    readonly complaints: readonly adminRepo.ComplaintCount[];
  };
  readonly forecast: readonly ForecastPoint[];
  readonly freshness: {
    /** When `v_admin_daily` was last rebuilt. Null before any refresh. */
    readonly snapshotAt: string | null;
    /** The newest referral this hospital sent or received. */
    readonly referralsAt: string | null;
    /** The newest feedback response. */
    readonly feedbackAt: string | null;
    readonly serverTs: string;
  };
}

/**
 * `GET /admin/dashboard?from&to` — every section of `S-B-10` in one read.
 *
 * One call rather than eight, because the sections share a date range and a
 * hospital and eight round trips would each re-establish both. The queries run
 * concurrently; the only sequenced part is the refresh, which has to finish
 * before anything reads the snapshot.
 */
export async function dashboard(input: DashboardInput): Promise<Dashboard> {
  const range = validRange(input.from, input.to);
  const snapshotAt = await ensureFresh();

  const [daily, lossTotals, lossDays, byDoctor, byDepartment, byMethod, byService] =
    await Promise.all([
      adminRepo.dailyRows(input.hospitalId, range),
      adminRepo.lossTotals(input.hospitalId, range),
      adminRepo.lossByDay(input.hospitalId, range),
      adminRepo.revenueBy(input.hospitalId, range, 'doctor'),
      adminRepo.revenueBy(input.hospitalId, range, 'department'),
      adminRepo.revenueBy(input.hospitalId, range, 'method'),
      adminRepo.revenueByService(input.hospitalId, range),
    ]);

  const [timings, beds, referrals, feedbackSummary, complaints, adoption, history] =
    await Promise.all([
      adminRepo.sessionTimings(input.hospitalId, range),
      adminRepo.bedUtilisation(input.hospitalId, range),
      adminRepo.referralFlow(input.hospitalId),
      adminRepo.feedbackSummary(input.hospitalId, range),
      adminRepo.complaintCategories(input.hospitalId, range),
      adminRepo.adoptionDate(input.hospitalId),
      adminRepo.volumeHistory(
        input.hospitalId,
        daysBefore(range.to, FORECAST_HISTORY_DAYS),
        range.to,
      ),
    ]);

  const loss = lossAndRecovery(
    {
      count: lossTotals.noShowCount,
      forgonePoisha: lossTotals.forgonePoisha,
      prepaidPoisha: lossTotals.prepaidPoisha,
    },
    {
      offered: lossTotals.offersMade,
      accepted: lossTotals.offersAccepted,
      recoveredPoisha: lossTotals.recoveredPoisha,
    },
  );

  return {
    range,
    today: totalsOf(daily),
    trend: daily.map((row) => ({
      date: row.sessionDate,
      avgWaitMinutes: row.avgWaitMinutes,
      seen: row.seen,
      waitsMeasured: row.waitsMeasured,
    })),
    adoptionDate: adoption,
    loss,
    lossByDay: lossDays.map((row) => ({
      date: row.sessionDate,
      uncollectedPoisha: Math.max(0, row.forgonePoisha - row.prepaidPoisha),
      recoveredPoisha: row.recoveredPoisha,
    })),
    revenue: {
      byDoctor,
      byDepartment,
      byMethod,
      byService: withDeclaredZeroes(byService),
      collectedPoisha: daily.reduce((total, row) => total + row.collectedPoisha, 0),
      billedPoisha: daily.reduce((total, row) => total + row.billedPoisha, 0),
      refundedPoisha: daily.reduce((total, row) => total + row.refundedPoisha, 0),
    },
    staff: punctualityByDoctor(timings),
    beds,
    referrals,
    feedback: { summary: feedbackSummary, complaints },
    forecast: forecastVolume(history),
    freshness: {
      snapshotAt: snapshotAt?.toISOString() ?? null,
      referralsAt: referrals?.asOf?.toISOString() ?? null,
      feedbackAt: feedbackSummary.asOf?.toISOString() ?? null,
      serverTs: new Date().toISOString(),
    },
  };
}

/**
 * Rebuilds the snapshot if it is older than the limit, and returns its age.
 *
 * Swallows a failed refresh deliberately. A dashboard that will not open
 * because a rebuild timed out is worse than one that opens with figures
 * honestly labelled twenty minutes old — and the label is what makes that
 * true, so the stamp returned here is the *real* one either way, never the
 * time this function ran.
 */
async function ensureFresh(): Promise<Date | null> {
  const current = await adminRepo.dailyRefreshedAt();
  const age = current === null ? Number.POSITIVE_INFINITY : Date.now() - current.getTime();
  if (age < SNAPSHOT_MAX_AGE_MS) return current;

  try {
    return await adminRepo.refreshDaily();
  } catch (cause: unknown) {
    logger.warn({ err: cause }, 'could not refresh v_admin_daily; serving the older snapshot');
    return current;
  }
}

/**
 * The window's totals.
 *
 * The waits are re-weighted by how many were measured on each day rather than
 * averaged across days: a day with two measured waits and a day with ninety
 * are not equal evidence, and a mean of the two daily means would give them
 * equal say. The longest wait is the longest anywhere in the window, which is
 * the only reading of "longest" that is not a different number per range.
 */
function totalsOf(daily: readonly adminRepo.DailyRow[]): TodayFigures {
  const measured = daily.reduce((total, row) => total + row.waitsMeasured, 0);
  const waitedMinutes = daily.reduce(
    (total, row) => total + (row.avgWaitMinutes ?? 0) * row.waitsMeasured,
    0,
  );

  const longest = daily.reduce<number | null>((worst, row) => {
    if (row.longestWaitMinutes === null) return worst;
    return worst === null ? row.longestWaitMinutes : Math.max(worst, row.longestWaitMinutes);
  }, null);

  return {
    seen: sum(daily, (row) => row.seen),
    booked: sum(daily, (row) => row.bookedTotal),
    noShows: sum(daily, (row) => row.noShows),
    cancelled: sum(daily, (row) => row.cancelled),
    walkin: sum(daily, (row) => row.walkinCount),
    bookedAhead: sum(daily, (row) => row.bookedCount),

    // Null rather than zero when nothing was measured. A queue nobody checked
    // patients into has no wait to report, and a zero on this tile would be
    // the single most flattering lie the dashboard could tell.
    avgWaitMinutes: measured === 0 ? null : Math.round(waitedMinutes / measured),
    longestWaitMinutes: longest,
    waitsMeasured: measured,
    sessionsTotal: sum(daily, (row) => row.sessionsTotal),
    sessionsLate: sum(daily, (row) => row.sessionsLate),
    sessionsNeverStarted: sum(daily, (row) => row.sessionsNeverStarted),
  };
}

/**
 * The four service types `FR-ADM-04` names, whichever ones had money.
 *
 * Three of them cannot have any in this version — nothing charges for a bed, a
 * test or an ambulance (`CLAUDE.md` §1.1) — and they are returned as explicit
 * zeroes. An omitted row reads as "we did not look at tests"; a zero says "we
 * looked, and nothing was charged", which is the true statement and the one a
 * hospital can ask a question about.
 */
const SERVICE_TYPES = ['consultation', 'test', 'bed', 'ambulance'] as const;

function withDeclaredZeroes(
  slices: readonly adminRepo.RevenueSlice[],
): readonly adminRepo.RevenueSlice[] {
  const found = new Map(slices.map((slice) => [slice.label, slice]));

  return SERVICE_TYPES.map(
    (service) =>
      found.get(service) ?? {
        label: service,
        labelEn: service,
        collectedPoisha: 0,
        refundedPoisha: 0,
        billedPoisha: 0,
        bookings: 0,
      },
  );
}

/**
 * Checks the window is a window.
 *
 * A reversed range would return nothing and read as a quiet month; an
 * unbounded one would scan every booking a hospital has ever taken. Both are
 * refused rather than silently corrected, because a dashboard that quietly
 * changes what you asked for is a dashboard you cannot check.
 */
export function validRange(from: string, to: string): adminRepo.DateRange {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'A date range is two calendar dates, as YYYY-MM-DD.',
      details: { from, to },
    });
  }

  if (from > to) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'The range starts after it ends.',
      details: { from, to },
    });
  }

  const days = Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
  if (days > MAX_RANGE_DAYS) {
    throw new AppError('VALIDATION_FAILED', {
      message: `A dashboard range covers at most ${String(MAX_RANGE_DAYS)} days.`,
      details: { days },
    });
  }

  return { from, to };
}

// ---------------------------------------------------------------------------
// FR-ADM-10 — export
// ---------------------------------------------------------------------------

/** Which sections may be exported. One per tab that holds a table. */
export const EXPORTABLE = [
  'today',
  'trend',
  'loss',
  'revenue-doctor',
  'revenue-department',
  'revenue-method',
  'revenue-service',
  'staff',
  'beds',
  'referrals',
  'feedback',
  'forecast',
] as const;

export type ExportView = (typeof EXPORTABLE)[number];

export function isExportable(view: string): view is ExportView {
  return (EXPORTABLE as readonly string[]).includes(view);
}

export interface ExportInput extends DashboardInput {
  readonly view: ExportView;
  readonly staffUserId: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export interface ExportResult {
  readonly filename: string;
  readonly csv: string;
  readonly rows: number;
}

/**
 * `GET /admin/export?view=` — one section as CSV, audited (`FR-ADM-10`).
 *
 * The audit row is written before the file is returned and in its own
 * transaction, so a response that fails to reach the browser still leaves the
 * record that somebody asked. An export is the one dashboard action that
 * produces something which outlives the session and leaves the hospital's
 * systems; the log has to be at least as durable as the file.
 *
 * PDF is the browser's own, from a print stylesheet on `S-B-10`, which is why
 * only CSV is produced here. That keeps the PDF showing exactly the figures
 * and freshness lines on screen — a server-rendered one would be a second
 * implementation of the same page and would eventually disagree with it.
 */
export async function exportView(input: ExportInput): Promise<ExportResult> {
  const data = await dashboard(input);
  const table = tableFor(data, input.view);
  const csv = toCsv(table.header, table.rows);

  await withTransaction(async (trx) => {
    await adminRepo.recordExport(trx, {
      staffUserId: input.staffUserId,
      hospitalId: input.hospitalId,
      view: input.view,
      range: data.range,
      rows: table.rows.length,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  });

  return {
    filename: `${input.view}-${data.range.from}-to-${data.range.to}.csv`,
    csv,
    rows: table.rows.length,
  };
}

interface Table {
  readonly header: readonly string[];
  readonly rows: readonly (readonly (string | number | null)[])[];
}

function tableFor(data: Dashboard, view: ExportView): Table {
  switch (view) {
    case 'today':
      return {
        header: ['metric', 'value'],
        rows: [
          ['seen', data.today.seen],
          ['booked', data.today.booked],
          ['no_shows', data.today.noShows],
          ['cancelled', data.today.cancelled],
          ['walkin', data.today.walkin],
          ['booked_ahead', data.today.bookedAhead],
          ['avg_wait_minutes', data.today.avgWaitMinutes],
          ['longest_wait_minutes', data.today.longestWaitMinutes],
          ['waits_measured', data.today.waitsMeasured],
          ['sessions_total', data.today.sessionsTotal],
          ['sessions_late', data.today.sessionsLate],
          ['sessions_never_started', data.today.sessionsNeverStarted],
        ],
      };

    case 'trend':
      return {
        header: ['date', 'avg_wait_minutes', 'waits_measured', 'seen'],
        rows: data.trend.map((point) => [
          point.date,
          point.avgWaitMinutes,
          point.waitsMeasured,
          point.seen,
        ]),
      };

    case 'loss':
      return {
        header: ['date', 'uncollected_poisha', 'recovered_poisha'],
        rows: data.lossByDay.map((row) => [row.date, row.uncollectedPoisha, row.recoveredPoisha]),
      };

    case 'revenue-doctor':
      return revenueTable(data.revenue.byDoctor);
    case 'revenue-department':
      return revenueTable(data.revenue.byDepartment);
    case 'revenue-method':
      return revenueTable(data.revenue.byMethod);
    case 'revenue-service':
      return revenueTable(data.revenue.byService);

    case 'staff':
      return {
        header: [
          'doctor',
          'department',
          'sessions',
          'never_started',
          'on_time',
          'median_delta_minutes',
          'worst_delta_minutes',
          'avg_consult_seconds',
          'seen',
        ],
        rows: data.staff.map((row) => [
          row.doctorNameEn,
          row.departmentNameBn,
          row.sessions,
          row.neverStarted,
          row.onTime,
          row.medianDeltaMinutes,
          row.worstDeltaMinutes,
          row.avgConsultSeconds,
          row.seen,
        ]),
      };

    case 'beds':
      return {
        header: ['kind', 'total', 'occupied', 'admissions', 'alos_hours', 'turnover_hours'],
        rows: data.beds.map((row) => [
          row.kind,
          row.total,
          row.occupied,
          row.admissions,
          row.alosHours,
          row.turnoverHours,
        ]),
      };

    case 'referrals':
      return {
        header: ['metric', 'value'],
        rows:
          data.referrals === null
            ? []
            : [
                ['sent_total', data.referrals.sentTotal],
                ['sent_accepted', data.referrals.sentAccepted],
                ['sent_declined', data.referrals.sentDeclined],
                ['sent_open', data.referrals.sentOpen],
                ['leaked', data.referrals.leaked],
                ['received_total', data.referrals.receivedTotal],
                ['received_accepted', data.referrals.receivedAccepted],
                ['received_declined', data.referrals.receivedDeclined],
                ['received_open', data.referrals.receivedOpen],
              ],
      };

    case 'feedback':
      return {
        header: ['category', 'average', 'answered', 'complaints'],
        rows: data.feedback.complaints.map((complaint) => [
          complaint.category,
          scoreFor(data.feedback.summary, complaint.category),
          complaint.answered,
          complaint.complaints,
        ]),
      };

    case 'forecast':
      return {
        header: ['weekday', 'slot', 'expected', 'low', 'high', 'observations'],
        rows: data.forecast.map((point) => [
          point.weekday,
          point.slot,
          point.expected,
          point.low,
          point.high,
          point.observations,
        ]),
      };
  }
}

function revenueTable(slices: readonly adminRepo.RevenueSlice[]): Table {
  return {
    header: [
      'label',
      'label_en',
      'bookings',
      'billed_poisha',
      'collected_poisha',
      'refunded_poisha',
    ],
    rows: slices.map((slice) => [
      slice.label,
      slice.labelEn,
      slice.bookings,
      slice.billedPoisha,
      slice.collectedPoisha,
      slice.refundedPoisha,
    ]),
  };
}

function scoreFor(
  summary: adminRepo.FeedbackSummary,
  category: adminRepo.ComplaintCount['category'],
): number | null {
  switch (category) {
    case 'wait':
      return summary.waitScore;
    case 'doctor':
      return summary.doctorScore;
    case 'cleanliness':
      return summary.cleanlinessScore;
    case 'billing':
      return summary.billingScore;
  }
}

/**
 * RFC 4180 CSV, with a UTF-8 byte-order mark.
 *
 * The BOM is there for one reason and it is not decoration: Excel on Windows
 * reads a CSV without one as the system code page, which turns every Bangla
 * doctor's name and department into mojibake. A hospital administrator opening
 * the export in Excel is the whole point of the feature, and a file they
 * cannot read is a feature that does not work.
 *
 * A null becomes an empty field, never the string "null" and never a zero. A
 * wait that was never measured must not arrive in a spreadsheet as 0 and get
 * averaged into somebody's board paper.
 */
const BOM = '\uFEFF';

export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number | null)[])[],
): string {
  const lines = [
    header.map(escapeCsv).join(','),
    ...rows.map((row) => row.map(escapeCsv).join(',')),
  ];
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

function escapeCsv(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);

  // A leading =, +, - or @ makes Excel and Sheets treat the cell as a formula.
  // Hospital data contains none today, but an exported field is user-supplied
  // text the moment a department is renamed, and a CSV that can execute is a
  // CSV that will.
  //
  // The apostrophe alone is not enough. On a CSV *import* Excel shows a bare
  // leading apostrophe as data rather than reading it as the text marker it is
  // when somebody types into a cell — so a guarded field is also quoted, which
  // is what makes the whole value unambiguously text.
  if (/^[=+\-@\t\r]/.test(text)) return `"'${text.replace(/"/g, '""')}"`;

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function sum(rows: readonly adminRepo.DailyRow[], of: (row: adminRepo.DailyRow) => number): number {
  return rows.reduce((total, row) => total + of(row), 0);
}

function daysBefore(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() - days);
  return at.toISOString().slice(0, 10);
}
