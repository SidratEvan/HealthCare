/**
 * `S-B-11` hospital settings — the console's calls (pilot step 22,
 * BACKEND.md §7.7 `/hospital/*`, `FR-SUP-01`, `FR-ADM-11`).
 *
 * Kept out of the screen for the reason `lib/admin.ts` is: the screen reads as
 * a sequence of decisions, and a test can hand it a fake.
 *
 * ## Online only
 *
 * Settings are not queued offline the way a queue action is. A fee or a
 * staff account changed from a stale copy could undo somebody else's change
 * without either person knowing, and none of this is urgent the way calling
 * the next patient is. So with the network gone the screen keeps what it
 * last read, says how old it is, and disables every save with the reason.
 *
 * ## The facility is never in the request
 *
 * Every path is `/hospital/...`: the API takes the facility off the
 * administrator's own principal (`FR-ROLE-01`).
 */

import { ApiClient, ApiError, NetworkError } from '@platform/client';
import type {
  OrgLifecycle,
  SetupCounts,
  BedPatchBody,
  BedsBody,
  DepartmentBody,
  DepartmentPatchBody,
  BrandTheme,
  DoctorBody,
  DoctorPatchBody,
  LogoBody,
  ProfileBody,
  RulesBody,
  StaffBody,
  StaffPatchBody,
  TemplateBody,
  WardBody,
  WardPatchBody,
} from '@platform/domain';

import { readDemoSession } from '@/lib/demo';

export const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';

export interface SetupSnapshot {
  readonly hospital: {
    readonly id: string;
    readonly code: string | null;
    readonly nameBn: string;
    readonly nameEn: string;
    readonly kind: string;
    readonly division: string;
    readonly district: string;
    /** Its licence or registration number; its own to correct while setting up (plan D2). */
    readonly registrationNo: string | null;
    readonly thana: string | null;
    readonly addressBn: string | null;
    readonly addressEn: string | null;
    readonly phone: string | null;
    readonly emergencyPhone: string | null;
    /** The modules it does not run (`FR-BRD-11`); empty when everything is on. */
    readonly modulesOff: readonly string[];
    /** The live figures it does not share with the network (`FR-NET-04`). */
    readonly unpublished: readonly string[];
    /** What the hospital says of itself to patients (`FR-BRD-06`). */
    readonly descriptionBn: string | null;
    readonly descriptionEn: string | null;
    readonly lat: number | null;
    readonly lng: number | null;
    readonly isLive: boolean;
    readonly onboardedAt: string | null;
    /** The workspace's state (`FR-ONB-02`). */
    readonly lifecycle: OrgLifecycle;
    readonly reviewRequestedAt: string | null;
    /** Why the platform sent it back or suspended it. */
    readonly reviewNote: string | null;
  };
  /** What exists here, counted by the server when asked (`FR-ONB-03`). */
  readonly counts: SetupCounts;
  readonly rules: {
    readonly noShowGracePatients: number;
    readonly noShowGraceMinutes: number;
    readonly lateReinsertAfter: number;
    readonly staleThresholdMinutes: number;
    readonly smsBudgetMonthly: number | null;
    /** How long a serial waits for its online payment (plan H3, `FR-PAY-08`). */
    readonly paymentHoldMinutes?: number;
  };
  /** Whether this deployment takes payment online (plan H3). */
  readonly onlinePayments?: boolean;
  /**
   * Where patients reach this hospital's own portal (`FR-BRD-07`): under the
   * platform's domain, and at a domain of its own when the platform has
   * recorded one. Both null on a deployment with no domain.
   */
  readonly portal: { readonly platform: string | null; readonly own: string | null };
  /** Its colours and its logo (`FR-BRD-06`). */
  readonly face: {
    /** Null: the platform's own colours. */
    readonly theme: BrandTheme | null;
    readonly logo: {
      readonly version: string;
      readonly contentType: string;
      readonly bytes: number;
    } | null;
  };
  readonly departments: readonly SettingsDepartment[];
  readonly doctors: readonly SettingsDoctor[];
  readonly templates: readonly SettingsTemplate[];
  readonly wards: readonly SettingsWard[];
  readonly staff: readonly SettingsStaff[];
  readonly capabilities: readonly {
    readonly kind: string;
    readonly isAvailable: boolean;
    readonly updatedAt: string;
  }[];
  readonly serverTs: string;
}

export interface SettingsDepartment {
  readonly id: string;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly code: string;
  readonly sortOrder: number;
}

export interface SettingsDoctor {
  readonly doctorHospitalId: string;
  readonly doctorId: string;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly bmdcNumber: string;
  readonly verified: boolean;
  readonly degrees: string | null;
  readonly specialties: readonly string[];
  readonly defaultConsultMinutes: number;
  readonly departmentId: string;
  readonly room: string | null;
  readonly feePoisha: number;
  readonly isActive: boolean;
}

export interface SettingsTemplate {
  readonly id: string;
  readonly doctorHospitalId: string;
  readonly weekday: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly capacity: number | null;
}

export interface SettingsWard {
  readonly id: string;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly floor: number;
  readonly kind: string;
  readonly beds: readonly {
    readonly id: string;
    readonly label: string;
    readonly kind: string;
    readonly state: string;
    readonly nightlyPoisha: number;
    /** Added here and never brought into service by the ward: the one kind that can be removed. */
    readonly unconfirmed: boolean;
  }[];
}

export interface SettingsStaff {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly staffCode: string | null;
  readonly isActive: boolean;
  readonly mustChangePassword: boolean;
  /** The second factor is on (pilot step 28, FR-SEC-10). */
  readonly twoFactorEnabled: boolean;
  readonly lastLoginAt: string | null;
  readonly roles: readonly string[];
}

/**
 * Why a save failed, in the words the screen has copy for. `field` or
 * `reason` come from the API's `details`, so "that code is taken" and "you
 * cannot remove your own access" can each be said precisely.
 */
export type SaveFailure =
  | { readonly kind: 'offline' }
  | { readonly kind: 'duplicate'; readonly field: string; readonly labels?: readonly string[] }
  | { readonly kind: 'notAllowed'; readonly reason: string }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'failed' };

export type Saved<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: SaveFailure };

function client(): ApiClient {
  return new ApiClient({ baseUrl: API_BASE, getToken: () => readDemoSession()?.token ?? null });
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function failureOf(error: unknown): SaveFailure {
  if (error instanceof NetworkError) return { kind: 'offline' };
  if (error instanceof ApiError) {
    const details = error.details ?? {};
    if (error.code === 'SETTINGS_DUPLICATE') {
      const labels = Array.isArray(details['labels'])
        ? (details['labels'] as unknown[]).map(String)
        : undefined;
      return {
        kind: 'duplicate',
        field: textOf(details['field']),
        ...(labels === undefined ? {} : { labels }),
      };
    }
    if (error.code === 'SETTINGS_NOT_ALLOWED') {
      return { kind: 'notAllowed', reason: textOf(details['reason']) };
    }
    if (error.code === 'VALIDATION_FAILED') return { kind: 'invalid' };
  }
  return { kind: 'failed' };
}

async function save<T>(call: (api: ApiClient, key: string) => Promise<T>): Promise<Saved<T>> {
  try {
    return { ok: true, value: await call(client(), crypto.randomUUID()) };
  } catch (error: unknown) {
    return { ok: false, failure: failureOf(error) };
  }
}

/**
 * The signed-in account's id, from the access token's `sub` — only to mark
 * "you" on the staff list and hide the actions the API refuses on oneself.
 * Read, not verified: the server checks every one of those itself.
 */
export function signedInStaffId(): string | null {
  const token = readDemoSession()?.token;
  const payload = token?.split('.')[1];
  if (payload === undefined) return null;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
}

/**
 * The hospital's own logo as an address this page can show, or null.
 *
 * Read with the administrator's token and turned into a blob address, because
 * the public address answers for a live hospital only and an `<img>` cannot
 * send a token. The caller revokes the address when it is done with it.
 */
export async function loadOwnLogo(): Promise<string | null> {
  const token = readDemoSession()?.token;
  if (token === undefined) return null;
  try {
    const response = await fetch(`${API_BASE}/hospital/logo`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return URL.createObjectURL(await response.blob());
  } catch {
    return null;
  }
}

/** A hospital's SMS this month, by what became of them (`FR-NOT-06`). */
export interface MonthOfMessages {
  readonly sent: number;
  readonly delivered: number;
  readonly failed: number;
  readonly held: number;
  readonly waiting: number;
  /** False where the provider reports no delivery: "delivered" is then unknown, not nought. */
  readonly reportsDelivery: boolean;
  readonly asOf: string;
}

export async function loadMonthOfMessages(): Promise<MonthOfMessages | 'offline' | 'error'> {
  try {
    return await client().get<MonthOfMessages>('/hospital/messages');
  } catch (error: unknown) {
    return error instanceof NetworkError ? 'offline' : 'error';
  }
}

/** Loading: `'offline'` when the request never reached the server. */
export async function loadSetup(): Promise<SetupSnapshot | 'offline' | 'error'> {
  try {
    return await client().get<SetupSnapshot>('/hospital/setup');
  } catch (error: unknown) {
    return error instanceof NetworkError ? 'offline' : 'error';
  }
}

export const settingsApi = {
  profile: (body: ProfileBody) => save((api, key) => api.patch('/hospital/profile', body, key)),
  /** The hospital's colours, or null for the platform's own (`FR-BRD-06`). */
  brand: (theme: BrandTheme | null) =>
    save((api, key) => api.put('/hospital/brand', { theme }, key)),
  /** Which live figures the hospital keeps to itself (`FR-NET-04`). */
  publishing: (unpublished: readonly string[]) =>
    save((api, key) => api.put('/hospital/publishing', { unpublished }, key)),
  logo: (body: LogoBody) =>
    save((api, key) => api.put<{ version: string }>('/hospital/logo', body, key)),
  removeLogo: () => save((api, key) => api.delete('/hospital/logo', key)),
  rules: (body: RulesBody) => save((api, key) => api.patch('/hospital/rules', body, key)),
  addDepartment: (body: DepartmentBody) =>
    save((api, key) => api.post<{ departmentId: string }>('/hospital/departments', body, key)),
  updateDepartment: (departmentId: string, body: DepartmentPatchBody) =>
    save((api, key) => api.patch(`/hospital/departments/${departmentId}`, body, key)),
  /** One nobody sits in (plan D2); refused, with why, while a doctor is listed under it. */
  removeDepartment: (departmentId: string) =>
    save((api, key) => api.delete(`/hospital/departments/${departmentId}`, key)),
  addDoctor: (body: DoctorBody) =>
    save((api, key) =>
      api.post<{ doctorHospitalId: string; linkedExisting: boolean }>(
        '/hospital/doctors',
        body,
        key,
      ),
    ),
  updateDoctor: (doctorHospitalId: string, body: DoctorPatchBody) =>
    save((api, key) => api.patch(`/hospital/doctors/${doctorHospitalId}`, body, key)),
  addSchedule: (body: TemplateBody) =>
    save((api, key) =>
      api.post<{ templateId: string; sessionsCreated: number }>('/hospital/templates', body, key),
    ),
  removeSchedule: (templateId: string) =>
    save((api, key) =>
      api.delete<{ bookedChambersKept: number }>(`/hospital/templates/${templateId}`, key),
    ),
  addWard: (body: WardBody) =>
    save((api, key) => api.post<{ wardId: string }>('/hospital/wards', body, key)),
  updateWard: (wardId: string, body: WardPatchBody) =>
    save((api, key) => api.patch(`/hospital/wards/${wardId}`, body, key)),
  /** One that holds no bed (plan D2). */
  removeWard: (wardId: string) => save((api, key) => api.delete(`/hospital/wards/${wardId}`, key)),
  addBeds: (body: BedsBody) =>
    save((api, key) => api.post<{ bedIds: string[] }>('/hospital/beds', body, key)),
  updateBed: (bedId: string, body: BedPatchBody) =>
    save((api, key) => api.patch(`/hospital/beds/${bedId}`, body, key)),
  /** One the ward never brought into service (plan D2). */
  removeBed: (bedId: string) => save((api, key) => api.delete(`/hospital/beds/${bedId}`, key)),
  addStaff: (body: StaffBody) =>
    save((api, key) =>
      api.post<{ staffId: string; temporaryPassword: string }>('/hospital/staff', body, key),
    ),
  updateStaff: (staffId: string, body: StaffPatchBody) =>
    save((api, key) => api.patch(`/hospital/staff/${staffId}`, body, key)),
  resetPassword: (staffId: string) =>
    save((api, key) =>
      api.post<{ temporaryPassword: string }>(`/hospital/staff/${staffId}/reset-password`, {}, key),
    ),
  /** A lost phone (pilot step 28): the second factor off, every session ended. */
  resetTwoFactor: (staffId: string) =>
    save((api, key) => api.post(`/hospital/staff/${staffId}/reset-2fa`, {}, key)),
  capabilities: (kinds: readonly string[]) =>
    save((api, key) => api.put('/hospital/capabilities', { kinds }, key)),
  /**
   * `FR-ONB-04`: asks the platform to review the workspace. Publishes
   * nothing; a platform administrator approves it or sends it back.
   */
  requestReview: () => save((api, key) => api.post('/hospital/request-review', {}, key)),
};

/**
 * Bed labels as an administrator types them: `301-320`, `ICU-1, ICU-2`, or
 * one per line. A range expands with the width of its first number kept
 * (`01-12` gives `01`…`12`), and a prefix before the range repeats
 * (`ICU-1-8` gives `ICU-1`…`ICU-8`). Returns null for anything it cannot
 * read, and never more than two hundred.
 */
export function expandBedLabels(input: string): string[] | null {
  const labels: string[] = [];
  for (const raw of input.split(/[,\n]/)) {
    const part = raw.trim();
    if (part === '') continue;
    const range = /^(.*?)(\d+)\s*-\s*(\d+)$/.exec(part);
    if (range !== null) {
      const [, prefix = '', fromText = '', toText = ''] = range;
      const from = Number(fromText);
      const to = Number(toText);
      if (to < from || to - from >= 200) return null;
      for (let n = from; n <= to; n += 1)
        labels.push(`${prefix}${String(n).padStart(fromText.length, '0')}`);
    } else {
      labels.push(part);
    }
  }
  if (labels.length === 0 || labels.length > 200) return null;
  if (labels.some((label) => label.length > 20)) return null;
  return labels;
}

/** Taka as typed (`800`, `800.50`) to integer poisha (`DB-P5`); null when it is not money. */
export function takaToPoisha(input: string): number | null {
  const match = /^\s*(\d{1,7})(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (match === null) return null;
  const taka = Number(match[1]);
  const paisa = Number((match[2] ?? '').padEnd(2, '0'));
  return taka * 100 + paisa;
}
