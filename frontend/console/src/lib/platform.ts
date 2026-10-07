/**
 * The platform administrator's calls (`S-B-12`, `/platform/*`, `FR-ONB-*`).
 *
 * Organisations and counts, and what may be done to each. Nothing here carries
 * a patient, because nothing the server sends under `/platform` does
 * (`FR-ONB-08`).
 */

import { ApiClient, ApiError, NetworkError } from '@platform/client';
import type {
  ChecklistItem,
  FacilityKind,
  OrgAction,
  OrgLifecycle,
  SetupCounts,
} from '@platform/domain';

import { API_BASE } from '@/lib/admin';

export interface Workspace {
  readonly id: string;
  readonly code: string | null;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly kind: string;
  readonly division: string;
  readonly district: string;
  readonly registrationNo: string | null;
  /** True when the hospital applied for this workspace itself (`FR-ONB-10`). */
  readonly selfRegistered?: boolean;
  /** A domain the hospital owns, recorded for its portal (`FR-BRD-07`). */
  readonly portalDomain: string | null;
  /** The modules it does not run (`FR-BRD-11`); empty when everything is on. */
  readonly modulesOff: readonly string[];
  readonly lifecycle: OrgLifecycle;
  readonly isLive: boolean;
  readonly reviewRequestedAt: string | null;
  readonly reviewedAt: string | null;
  readonly reviewNote: string | null;
  readonly createdAt: string;
  readonly counts: SetupCounts;
  readonly checklist: readonly ChecklistItem[];
  /** What the platform may do from this state. */
  readonly actions: readonly OrgAction[];
}

export interface WorkspaceDoctor {
  readonly doctorId: string;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly bmdcNumber: string;
  readonly degrees: string | null;
  readonly verifiedAt: string | null;
}

export interface WorkspaceDetail extends Workspace {
  /** Where its portal is: under the platform's domain, and at its own. */
  readonly portal: { readonly platform: string | null; readonly own: string | null };
  /** The facility's own phone, as it gave it; on the opened workspace only (`FR-ONB-08`). */
  readonly phone?: string | null;
  readonly doctors: readonly WorkspaceDoctor[];
  readonly administrators: readonly {
    readonly fullName: string;
    readonly email: string;
    /** The mobile an applying administrator gave (`FR-ONB-09`). */
    readonly phone?: string | null;
  }[];
  /** What stops an approval now; empty when nothing does. */
  readonly missingForApproval: readonly string[];
}

export interface NewWorkspace {
  readonly code: string;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly kind: FacilityKind;
  readonly division: string;
  readonly district: string;
  readonly registrationNo?: string;
  readonly adminName: string;
  readonly adminEmail: string;
}

export interface CreatedWorkspace {
  readonly hospitalId: string;
  readonly code: string;
  readonly adminEmail: string;
  /** In the answer once; it is never shown again. */
  readonly temporaryPassword: string;
}

/** The acts that are the platform's, as the routes name them. */
export type PlatformAct = 'approve' | 'send-back' | 'suspend' | 'reinstate' | 'close';

/** Why a write did not happen, in the terms the screen can say. */
export type PlatformFailure =
  | { readonly kind: 'offline' }
  | { readonly kind: 'duplicate_code' }
  | { readonly kind: 'not_ready'; readonly missing: readonly string[] }
  | { readonly kind: 'note_required' }
  | { readonly kind: 'changed' }
  | { readonly kind: 'domain_taken' }
  | { readonly kind: 'domain_is_the_platforms' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'failed' };

export type PlatformResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: PlatformFailure };

function client(token: string): ApiClient {
  return new ApiClient({ baseUrl: API_BASE, getToken: () => token });
}

function failureOf(error: unknown): PlatformFailure {
  if (error instanceof NetworkError) return { kind: 'offline' };
  if (!(error instanceof ApiError)) return { kind: 'failed' };

  const details = error.details ?? {};
  if (error.code === 'SETTINGS_DUPLICATE') return { kind: 'duplicate_code' };
  if (error.code === 'VALIDATION_FAILED') {
    return details['note'] === 'required' ? { kind: 'note_required' } : { kind: 'invalid' };
  }
  if (error.code === 'SETTINGS_NOT_ALLOWED') {
    if (details['reason'] === 'not_ready') {
      const missing = Array.isArray(details['missing']) ? (details['missing'] as string[]) : [];
      return { kind: 'not_ready', missing };
    }
    if (details['reason'] === 'domain_taken') return { kind: 'domain_taken' };
    if (details['reason'] === 'domain_is_the_platforms') return { kind: 'domain_is_the_platforms' };
    // The workspace moved while this screen was open: somebody else answered.
    return { kind: 'changed' };
  }
  return { kind: 'failed' };
}

async function attempt<T>(call: () => Promise<T>): Promise<PlatformResult<T>> {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    return { ok: false, failure: failureOf(error) };
  }
}

export const platformApi = {
  async list(token: string): Promise<readonly Workspace[]> {
    const data = await client(token).get<{ workspaces: Workspace[] }>('/platform/hospitals');
    return data.workspaces;
  },

  async detail(token: string, hospitalId: string): Promise<WorkspaceDetail> {
    return await client(token).get<WorkspaceDetail>(`/platform/hospitals/${hospitalId}`);
  },

  async create(token: string, body: NewWorkspace): Promise<PlatformResult<CreatedWorkspace>> {
    return await attempt(
      async () =>
        await client(token).post<CreatedWorkspace>(
          '/platform/hospitals',
          body,
          crypto.randomUUID(),
        ),
    );
  },

  async act(
    token: string,
    hospitalId: string,
    action: PlatformAct,
    note: string,
  ): Promise<PlatformResult<WorkspaceDetail>> {
    return await attempt(
      async () =>
        await client(token).post<WorkspaceDetail>(
          `/platform/hospitals/${hospitalId}/${action}`,
          note.trim() === '' ? {} : { note: note.trim() },
          crypto.randomUUID(),
        ),
    );
  },

  /** Switches the hospital's modules: the whole list of what is off (`FR-BRD-11`). */
  async setModules(
    token: string,
    hospitalId: string,
    off: readonly string[],
  ): Promise<PlatformResult<WorkspaceDetail>> {
    return await attempt(
      async () =>
        await client(token).put<WorkspaceDetail>(
          `/platform/hospitals/${hospitalId}/modules`,
          { off },
          crypto.randomUUID(),
        ),
    );
  },
  /** Records the hospital's own domain for its portal, or removes it with null (`FR-BRD-07`). */
  async setDomain(
    token: string,
    hospitalId: string,
    domain: string | null,
  ): Promise<PlatformResult<WorkspaceDetail>> {
    return await attempt(
      async () =>
        await client(token).post<WorkspaceDetail>(
          `/platform/hospitals/${hospitalId}/domain`,
          { domain },
          crypto.randomUUID(),
        ),
    );
  },
  async verifyDoctor(
    token: string,
    hospitalId: string,
    doctorId: string,
  ): Promise<PlatformResult<WorkspaceDetail>> {
    return await attempt(
      async () =>
        await client(token).post<WorkspaceDetail>(
          `/platform/hospitals/${hospitalId}/doctors/${doctorId}/verify`,
          {},
          crypto.randomUUID(),
        ),
    );
  },
};
