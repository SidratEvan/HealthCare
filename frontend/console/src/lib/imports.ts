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
import { isLegacyXls, isZip, sheetHasRows, sheetToCsv } from '@platform/domain';
import type {
  ColumnMapping,
  FieldProposal,
  FileColumn,
  ImportSet,
  ImportWarnings,
  SpreadsheetCell,
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
  /**
   * What is not an error and is still worth a look before approving
   * (`FR-IMP-21`). Optional because the console and the API are deployed
   * separately: for the minutes a newer screen talks to an older server, the
   * field is not there, and the import must still open.
   */
  readonly warnings?: ImportWarnings;
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

// ---------------------------------------------------------------------------
// A spreadsheet read in the browser (`FR-IMP-22`; plan E1)
// ---------------------------------------------------------------------------

/** What choosing a file gave: text for the importer, or why there is none. */
export type ReadFile =
  | {
      readonly kind: 'ok';
      readonly name: string;
      readonly text: string;
      /** The sheets that hold rows, when the file was a spreadsheet; the first is read. */
      readonly sheets: readonly string[];
      readonly sheet: string | null;
    }
  | { readonly kind: 'legacy_xls' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'too_big' };

/** A spreadsheet larger than this is refused before it is opened in the browser. */
const MAX_SPREADSHEET_BYTES = 10 * 1024 * 1024;

/**
 * Reads a chosen file as the CSV text the importer takes. A CSV is read as it
 * is; an `.xlsx` is opened with `read-excel-file` (loaded only now) and one of
 * its sheets written as CSV (`sheetToCsv`); an old `.xls` is not read, and the
 * screen says to save it as `.xlsx` or CSV (the owner's answer to question 19).
 * Everything after this is the importer as it was: analyse, mapping, check,
 * preview, approval, audit and undo.
 */
export async function readImportFile(file: File, sheet: string | null = null): Promise<ReadFile> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const looksXlsx = isZip(head) || /\.xlsx$/i.test(file.name);
  if (isLegacyXls(head) || (/\.xls$/i.test(file.name) && !isZip(head))) {
    return { kind: 'legacy_xls' };
  }
  if (!looksXlsx) {
    return { kind: 'ok', name: file.name, text: await file.text(), sheets: [], sheet: null };
  }
  if (file.size > MAX_SPREADSHEET_BYTES) return { kind: 'too_big' };
  try {
    const { default: readXlsxFile } = await import('read-excel-file/browser');
    const sheets = (await readXlsxFile(file)).filter((entry) =>
      sheetHasRows(entry.data as unknown as readonly (readonly SpreadsheetCell[])[]),
    );
    const chosen = sheets.find((entry) => entry.sheet === sheet) ?? sheets[0];
    if (chosen === undefined) return { kind: 'unreadable' };
    return {
      kind: 'ok',
      name: file.name,
      text: sheetToCsv(chosen.data as unknown as readonly (readonly SpreadsheetCell[])[]),
      sheets: sheets.map((entry) => entry.sheet),
      sheet: chosen.sheet,
    };
  } catch {
    return { kind: 'unreadable' };
  }
}
