/**
 * The admin dashboard's calls to the API (BACKEND.md §7.7, `S-B-10`).
 *
 * Kept out of the screen for the reason `lib/lab.ts` is: a screen reads as a
 * sequence of decisions, and a test can hand it a fake.
 *
 * ## Read-only, and online-only
 *
 * The other consoles queue their actions in an outbox and keep working with
 * the network gone (`FR-OFF-01`), because a ward at two in the morning cannot
 * wait for a connection. A dashboard is not that: it has no actions, and an
 * aggregate computed against a stale local copy is a figure a director would
 * act on without knowing how old it is. So when the network is gone this
 * screen says so and shows what it last had, with its age ageing honestly
 * (`GR-03`, `FR-OFF-03`).
 *
 * ## The hospital is never in the request
 *
 * `/admin/dashboard` takes a date range and nothing else. The facility comes
 * off the caller's own principal, server-side, so there is no parameter here
 * to get wrong — see the header of `backend/api/src/routes/admin.routes.ts`.
 */

import { ApiClient, NetworkError } from '@platform/client';

export const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';

export interface TodayFigures {
  readonly seen: number;
  readonly booked: number;
  readonly noShows: number;
  readonly cancelled: number;
  readonly walkin: number;
  readonly bookedAhead: number;
  /** Check-in to call (`FR-REC-18`). Null when nobody was checked in and called. */
  readonly avgWaitMinutes: number | null;
  readonly longestWaitMinutes: number | null;
  readonly waitsMeasured: number;
  readonly avgOverrunMinutes: number | null;
  readonly longestOverrunMinutes: number | null;
  readonly overrunsMeasured: number;
  readonly sessionsTotal: number;
  readonly sessionsLate: number;
  readonly sessionsNeverStarted: number;
}

/** How often the wait quoted at check-in was kept (`FR-ADM-01`). */
export interface QuoteAccuracy {
  readonly quoted: number;
  readonly kept: number;
  readonly keptRate: number | null;
  readonly avgOverMinutes: number | null;
}

export interface TrendPoint {
  readonly date: string;
  readonly avgWaitMinutes: number | null;
  readonly avgOverrunMinutes: number | null;
  readonly seen: number;
  readonly waitsMeasured: number;
  readonly overrunsMeasured: number;
}

export interface LossFigures {
  readonly noShowCount: number;
  readonly forgonePoisha: number;
  readonly prepaidPoisha: number;
  readonly uncollectedPoisha: number;
  readonly offered: number;
  readonly accepted: number;
  readonly recoveredPoisha: number;
  readonly recoveryRate: number | null;
  readonly acceptanceRate: number | null;
  readonly netLossPoisha: number;
}

export interface RevenueSlice {
  readonly label: string;
  readonly labelEn: string;
  readonly collectedPoisha: number;
  readonly refundedPoisha: number;
  readonly billedPoisha: number;
  readonly bookings: number;
}

export interface DoctorPunctuality {
  readonly doctorId: string;
  readonly doctorNameBn: string;
  readonly doctorNameEn: string;
  readonly departmentNameBn: string;
  readonly departmentNameEn: string;
  readonly sessions: number;
  readonly neverStarted: number;
  readonly onTime: number;
  readonly medianDeltaMinutes: number | null;
  readonly worstDeltaMinutes: number | null;
  readonly avgConsultSeconds: number | null;
  readonly onTimeRate: number | null;
  readonly seen: number;
}

export interface BedUtilisation {
  readonly kind: string;
  readonly total: number;
  readonly occupied: number;
  readonly admissions: number;
  readonly alosHours: number | null;
  readonly turnoverHours: number | null;
}

export interface ReferralFlow {
  readonly sentTotal: number;
  readonly sentAccepted: number;
  readonly sentDeclined: number;
  readonly sentOpen: number;
  readonly leaked: number;
  readonly receivedTotal: number;
  readonly receivedAccepted: number;
  readonly receivedDeclined: number;
  readonly receivedOpen: number;
}

export interface FeedbackSummary {
  readonly responses: number;
  readonly waitScore: number | null;
  readonly doctorScore: number | null;
  readonly cleanlinessScore: number | null;
  readonly billingScore: number | null;
  readonly waitAnswered: number;
  readonly doctorAnswered: number;
  readonly cleanlinessAnswered: number;
  readonly billingAnswered: number;
}

export type ComplaintCategory = 'wait' | 'doctor' | 'cleanliness' | 'billing';

export interface ComplaintCount {
  readonly category: ComplaintCategory;
  readonly complaints: number;
  readonly answered: number;
}

export type ForecastSlot = 'morning' | 'afternoon' | 'evening';

export interface ForecastPoint {
  readonly weekday: number;
  readonly slot: ForecastSlot;
  readonly expected: number | null;
  readonly low: number | null;
  readonly high: number | null;
  readonly observations: number;
}

export interface Dashboard {
  readonly range: { readonly from: string; readonly to: string };
  readonly today: TodayFigures;
  readonly quotes: QuoteAccuracy;
  readonly trend: readonly TrendPoint[];
  readonly adoptionDate: string | null;
  readonly loss: LossFigures;
  readonly lossByDay: readonly {
    readonly date: string;
    readonly uncollectedPoisha: number;
    readonly recoveredPoisha: number;
  }[];
  readonly revenue: {
    readonly byDoctor: readonly RevenueSlice[];
    readonly byDepartment: readonly RevenueSlice[];
    readonly byMethod: readonly RevenueSlice[];
    readonly byService: readonly RevenueSlice[];
    readonly collectedPoisha: number;
    readonly billedPoisha: number;
    readonly refundedPoisha: number;
  };
  readonly staff: readonly DoctorPunctuality[];
  readonly beds: readonly BedUtilisation[];
  readonly referrals: ReferralFlow | null;
  readonly feedback: {
    readonly summary: FeedbackSummary;
    readonly complaints: readonly ComplaintCount[];
  };
  readonly forecast: readonly ForecastPoint[];
  readonly freshness: {
    readonly snapshotAt: string | null;
    readonly referralsAt: string | null;
    readonly feedbackAt: string | null;
    readonly serverTs: string;
  };
}

/** The windows `S-B-10`'s date selector offers. */
export const RANGES = [
  { days: 0, key: 'adminRangeToday' },
  { days: 6, key: 'adminRange7' },
  { days: 29, key: 'adminRange30' },
  { days: 89, key: 'adminRange90' },
] as const;

export type RangeDays = (typeof RANGES)[number]['days'];

/** Every section that can be exported, matching `admin.service.EXPORTABLE`. */
export type ExportView =
  | 'today'
  | 'trend'
  | 'loss'
  | 'revenue-doctor'
  | 'revenue-department'
  | 'revenue-method'
  | 'revenue-service'
  | 'staff'
  | 'beds'
  | 'referrals'
  | 'feedback'
  | 'forecast';

function client(token: string): ApiClient {
  return new ApiClient({ baseUrl: API_BASE, getToken: () => token });
}

/**
 * The Dhaka calendar date `daysAgo` before today.
 *
 * Computed here rather than sent as a duration, because "the last thirty days"
 * has to mean the same thirty days to the screen and to the server — and a
 * server in another zone counting back from its own midnight would silently
 * shift the window by a day for half of each day.
 */
export function dhakaDate(daysAgo: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const at = new Date(`${parts}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() - daysAgo);
  return at.toISOString().slice(0, 10);
}

export const adminApi = {
  async dashboard(token: string, days: RangeDays): Promise<Dashboard> {
    const to = dhakaDate(0);
    const from = dhakaDate(days);
    return await client(token).get<Dashboard>(`/admin/dashboard?from=${from}&to=${to}`);
  },
};

/**
 * Downloads one section as CSV (`FR-ADM-10`, `BTN-B10-EXPORT`).
 *
 * Fetched rather than followed as a link, because the request needs the
 * bearer token and a browser navigation carries no headers. The blob is
 * revoked immediately: a URL left alive pins the file in memory for the life
 * of the tab, and an administrator exporting eight sections in a morning
 * would pin eight.
 */
export async function downloadExport(
  token: string,
  view: ExportView,
  days: RangeDays,
): Promise<void> {
  const to = dhakaDate(0);
  const from = dhakaDate(days);

  const response = await fetch(`${API_BASE}/admin/export?view=${view}&from=${from}&to=${to}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) throw new Error(`export failed: ${String(response.status)}`);

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = `${view}-${from}-to-${to}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Which of the four `GR-03` states a failure puts the screen into.
 *
 * Never reaching the server is being offline; anything the server said —
 * a refusal or a fault — is an error, and says so.
 */
export function failureOf(error: unknown): 'offline' | 'error' {
  return error instanceof NetworkError ? 'offline' : 'error';
}
