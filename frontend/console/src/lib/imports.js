/**
 * `S-B-14` imports — the console's calls (pilot step 24, BACKEND.md §7.7
 * `/hospital/imports`, `FR-IMP-05`…`09`).
 *
 * Online only, like the rest of the administrator's screens (`lib/settings.js`):
 * a check needs the server's view of what already exists, and an approval
 * written from a stale preview is exactly what `FR-IMP-06` exists to prevent.
 * The chosen file stays chosen while the connection is gone.
 */

import { ApiClient, ApiError, NetworkError } from '@platform/client';
import { isLegacyXls, isZip, sheetHasRows, sheetToCsv } from '@platform/domain';

import { readDemoSession } from '@/lib/demo';

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';

function client() {
  return new ApiClient({ baseUrl: API_BASE, getToken: () => readDemoSession()?.token ?? null });
}

function failureOf(error) {
  if (error instanceof NetworkError) return { kind: 'offline' };
  if (error instanceof ApiError) {
    const details = error.details ?? {};
    const text = (value) => (typeof value === 'string' ? value : '');
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
      const blocking = Array.isArray(details['blocking']) ? details['blocking'] : [];
      return {
        kind: 'blocked',
        rows: blocking.map((entry) => (typeof entry.rowNumber === 'number' ? entry.rowNumber : 0)),
      };
    }
    if (error.code === 'PAYLOAD_TOO_LARGE') return { kind: 'tooLarge' };
  }
  return { kind: 'failed' };
}

async function attempt(call) {
  try {
    return { ok: true, value: await call(client()) };
  } catch (error) {
    return { ok: false, failure: failureOf(error) };
  }
}

export const importApi = {
  /** Reads a file and proposes a mapping. Writes nothing. */
  analyse: (set, csv, rowType) =>
    attempt(
      async (api) =>
        await api.post('/hospital/imports/analyse', {
          set,
          csv,
          ...(rowType === undefined ? {} : { rowType }),
        }),
    ),
  /** A confirmed mapping: the file goes to the ordinary check and preview. */
  checkMapped: (set, fileName, csv, mapping, suggestedByModel = []) =>
    attempt(
      async (api) =>
        await api.post(
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
  history: () => attempt(async (api) => (await api.get('/hospital/imports')).batches),
  view: (id) => attempt(async (api) => await api.get(`/hospital/imports/${id}`)),
  check: (set, fileName, csv) =>
    attempt(
      async (api) =>
        await api.post('/hospital/imports', { set, fileName, csv }, crypto.randomUUID()),
    ),
  commit: (id) =>
    attempt(
      async (api) => await api.post(`/hospital/imports/${id}/commit`, {}, crypto.randomUUID()),
    ),
  undo: (id) =>
    attempt(async (api) => await api.post(`/hospital/imports/${id}/undo`, {}, crypto.randomUUID())),
  discard: (id) =>
    attempt(
      async (api) => await api.post(`/hospital/imports/${id}/discard`, {}, crypto.randomUUID()),
    ),
};

/**
 * Saves a set's template (`BTN-B14-TEMPLATE`). Fetched rather than followed,
 * because the request needs the bearer token; the object URL is revoked at
 * once, as the dashboard's export does.
 */
export async function downloadTemplate(set) {
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
export async function readImportFile(file, sheet = null) {
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
    const sheets = (await readXlsxFile(file)).filter((entry) => sheetHasRows(entry.data));
    const chosen = sheets.find((entry) => entry.sheet === sheet) ?? sheets[0];
    if (chosen === undefined) return { kind: 'unreadable' };
    return {
      kind: 'ok',
      name: file.name,
      text: sheetToCsv(chosen.data),
      sheets: sheets.map((entry) => entry.sheet),
      sheet: chosen.sheet,
    };
  } catch {
    return { kind: 'unreadable' };
  }
}
