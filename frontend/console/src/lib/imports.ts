/**
 * `S-B-14` imports — the console's calls (pilot step 24, BACKEND.md §7.7
 * `/hospital/imports`, `FR-IMP-05`…`09`).
 *
 * Online only, like the rest of the administrator's screens (`lib/settings.ts`):
 * a check needs the server's view of what already exists, and an approval
 * written from a stale preview is exactly what `FR-IMP-06` exists to prevent.
 * The chosen file stays chosen while the connection is gone.
 */

import { ApiClient, ApiError, NetworkError } from '@platform/client';
import type {
  ColumnMapping,
  FieldProposal,
  FileColumn,
  ImportSet,
  StructureType,
} from '@platform/domain';

import { readDemoSession } from '@/lib/demo';

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';

export type BatchState = 'checked' | 'committed' | 'undone' | 'discarded';

export interface ImportBatch {
  readonly id: string;
  readonly setKind: ImportSet;
  readonly fileName: string;
  readonly state: BatchState;
  readonly counts: {
    readonly add: number;
    readonly update: number;
    readonly skip: number;
    readonly error: number;
  };
  readonly createdByName: string | null;
  readonly createdAt: string;
  readonly committedByName: string | null;
  readonly committedAt: string | null;
  readonly undoneByName: string | null;
  readonly undoneAt: string | null;
}

export interface ImportBatchView extends ImportBatch {
  readonly errors: readonly {
    readonly rowNumber: number;
    readonly field: string;
    readonly code: string;
  }[];
}

export type ImportFailure =
  | { readonly kind: 'offline' }
  | { readonly kind: 'file'; readonly reason: string; readonly columns: readonly string[] }
  | { readonly kind: 'state'; readonly reason: string; readonly rowNumber: number | null }
  | { readonly kind: 'blocked'; readonly rows: readonly number[] }
  | { readonly kind: 'tooLarge' }
  | { readonly kind: 'failed' };

export type ImportResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ImportFailure };

function client(): ApiClient {
  return new ApiClient({ baseUrl: API_BASE, getToken: () => readDemoSession()?.token ?? null });
}

function failureOf(error: unknown): ImportFailure {
  if (error instanceof NetworkError) return { kind: 'offline' };
  if (error instanceof ApiError) {
    const details = error.details ?? {};
    const text = (value: unknown): string => (typeof value === 'string' ? value : '');
    if (error.code === 'IMPORT_FILE') {
      const columns = Array.isArray(details['columns']) ? details['columns'].map(String) : [];
      return { kind: 'file', reason: text(details['reason']), columns };
    }
    if (error.code === 'IMPORT_STATE') {
      const row = details['rowNumber'];
      return {
        kind: 'state',
        reason: text(details['reason']),
        rowNumber: typeof row === 'number' ? row : null,
      };
    }
    if (error.code === 'IMPORT_UNDO_BLOCKED') {
      const blocking = Array.isArray(details['blocking'])
        ? (details['blocking'] as { rowNumber?: unknown }[])
        : [];
      return {
        kind: 'blocked',
        rows: blocking.map((entry) => (typeof entry.rowNumber === 'number' ? entry.rowNumber : 0)),
      };
    }
    if (error.code === 'PAYLOAD_TOO_LARGE') return { kind: 'tooLarge' };
  }
  return { kind: 'failed' };
}

async function attempt<T>(call: (api: ApiClient) => Promise<T>): Promise<ImportResult<T>> {
  try {
    return { ok: true, value: await call(client()) };
  } catch (error: unknown) {
    return { ok: false, failure: failureOf(error) };
  }
}

/** What `POST /hospital/imports/analyse` answers (`FR-IMP-13`–`15`). */
export interface MappingAnalysis {
  /** The file already has the template's columns; nothing to map. */
  readonly templateShaped: boolean;
  readonly rowCount: number;
  readonly columns: readonly FileColumn[];
  readonly rowType: StructureType | null;
  /** A structure file whose kind of row has to be chosen first. */
  readonly needsRowType: boolean;
  readonly fields: readonly { readonly field: string; readonly required: boolean }[];
  readonly oneOf: readonly (readonly string[])[];
  readonly proposal: readonly FieldProposal[];
  /** The proposal is this hospital's last confirmed mapping for these headings. */
  readonly fromSaved: boolean;
  /** What part a model played in the proposal (`FR-IMP-16`). */
  readonly model: 'used' | 'nothing' | 'unavailable' | 'not_asked';
}

export const importApi = {
  /** Reads a file and proposes a mapping. Writes nothing. */
  analyse: (set: ImportSet, csv: string, rowType?: StructureType) =>
    attempt(
      async (api) =>
        await api.post<MappingAnalysis>('/hospital/imports/analyse', {
          set,
          csv,
          ...(rowType === undefined ? {} : { rowType }),
        }),
    ),
  /** A confirmed mapping: the file goes to the ordinary check and preview. */
  checkMapped: (
    set: ImportSet,
    fileName: string,
    csv: string,
    mapping: ColumnMapping,
    suggestedByModel: readonly string[] = [],
  ) =>
    attempt(
      async (api) =>
        await api.post<ImportBatchView>(
          '/hospital/imports/mapped',
          {
            set,
            fileName,
            csv,
            mapping,
            ...(suggestedByModel.length === 0 ? {} : { suggestedByModel }),
          },
          crypto.randomUUID(),
        ),
    ),
  history: () =>
    attempt(
      async (api) => (await api.get<{ batches: ImportBatch[] }>('/hospital/imports')).batches,
    ),
  check: (set: ImportSet, fileName: string, csv: string) =>
    attempt(
      async (api) =>
        await api.post<ImportBatchView>(
          '/hospital/imports',
          { set, fileName, csv },
          crypto.randomUUID(),
        ),
    ),
  commit: (id: string) =>
    attempt(
      async (api) =>
        await api.post<ImportBatchView>(`/hospital/imports/${id}/commit`, {}, crypto.randomUUID()),
    ),
  undo: (id: string) =>
    attempt(
      async (api) =>
        await api.post<ImportBatchView>(`/hospital/imports/${id}/undo`, {}, crypto.randomUUID()),
    ),
  discard: (id: string) =>
    attempt(
      async (api) =>
        await api.post<ImportBatchView>(`/hospital/imports/${id}/discard`, {}, crypto.randomUUID()),
    ),
};

/**
 * Saves a set's template (`BTN-B14-TEMPLATE`). Fetched rather than followed,
 * because the request needs the bearer token; the object URL is revoked at
 * once, as the dashboard's export does.
 */
export async function downloadTemplate(set: ImportSet): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/hospital/imports/templates/${set}`, {
      headers: { authorization: `Bearer ${readDemoSession()?.token ?? ''}` },
    });
    if (!response.ok) return false;
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `medlivebd-${set}-template.csv`;
    link.click();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}
