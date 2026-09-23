/**
 * The lab and pharmacy consoles' calls to the API (BACKEND.md §7.6).
 *
 * Kept out of the screens for the reason `lib/beds.ts` is: a screen reads as
 * a sequence of decisions, and a test can hand it a fake.
 *
 * ## The lab console is online-first, deliberately
 *
 * The ward board and the ER queue their actions in an outbox and work with
 * the network gone (`FR-OFF-01`), because a ward at two in the morning cannot
 * wait for a connection to admit somebody. A lab bench is not that: the
 * actions here are minutes apart, the report upload is a file that has to
 * reach a store, and a state button applied offline against an order another
 * bench already reported would be reconciled by the server anyway.
 *
 * So the state buttons apply optimistically and are sent at once. What they
 * do carry is the offline *contract* — every send has a `clientEventId` and
 * an idempotency key, and the server answers a replay as a replay
 * (`labOrderAlreadyApplied`) — so adding an outbox later is a store, not a
 * redesign. When the network is gone the screen says so and the buttons wait,
 * which is honest rather than pretending (`GR-03`).
 */

import { ApiClient, ApiError, NetworkError } from '@platform/client';
import type { LabAction, TestOrderView, TurnaroundSummary } from '@platform/domain';

export const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';
export const SOCKET_URL = process.env['NEXT_PUBLIC_SOCKET_URL'] ?? 'http://localhost:4000';

/** `GET /hospitals/:id/test-orders` — the bench's queue (`S-B-08`). */
export interface LabQueueResponse {
  readonly orders: readonly TestOrderView[];
  readonly turnaround: readonly TurnaroundSummary[];
  readonly serverTs: string;
}

/** What a write answers with, and what the screen reconciles against. */
export interface LabWriteResponse {
  readonly order: TestOrderView;
  readonly duplicate: boolean;
  readonly serverTs: string;
}

/** One row of `S-B-09`'s shelf. */
export interface StockRow {
  readonly medicineId: string;
  readonly genericName: string;
  readonly brandName: string | null;
  readonly form: string | null;
  readonly strengths: readonly string[];
  readonly inStock: boolean;
  readonly updatedAt: string;
  /** What a patient searching is told right now, given the flag's age. */
  readonly publishedAs: 'in_stock' | 'out_of_stock' | 'unknown';
}

export interface ShelfResponse {
  readonly rows: readonly StockRow[];
  readonly serverTs: string;
}

/** The largest report the API accepts (`REPORT_MAX_BYTES`). */
export const REPORT_MAX_BYTES = 10 * 1024 * 1024;

/** What `FR-LAB-03` calls "PDF or image". */
export const REPORT_FILE_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export function labApi(getToken: () => string | null): {
  readonly queue: (
    hospitalId: string,
    state: 'open' | 'reported' | 'all',
  ) => Promise<LabQueueResponse>;
  readonly advance: (orderId: string, action: LabAction) => Promise<LabWriteResponse>;
  readonly upload: (
    orderId: string,
    file: { type: string; base64: string },
  ) => Promise<LabWriteResponse>;
  readonly patientLabel: (orderId: string) => Promise<string | null>;
  readonly shelf: (hospitalId: string) => Promise<ShelfResponse>;
  readonly setFlags: (
    hospitalId: string,
    flags: readonly { medicineId: string; inStock: boolean }[],
  ) => Promise<ShelfResponse>;
} {
  const client = new ApiClient({ baseUrl: API_BASE, getToken });

  return {
    queue: async (hospitalId, state) =>
      await client.get<LabQueueResponse>(
        `/hospitals/${hospitalId}/test-orders?state=${state}&days=30`,
      ),

    advance: async (orderId, action) => {
      const clientEventId = crypto.randomUUID();
      return await client.patch<LabWriteResponse>(
        `/test-orders/${orderId}/state`,
        {
          action,
          clientEventId,
          clientTs: new Date().toISOString(),
          idempotencyKey: clientEventId,
        },
        clientEventId,
      );
    },

    upload: async (orderId, file) => {
      const clientEventId = crypto.randomUUID();
      return await client.post<LabWriteResponse>(
        `/test-orders/${orderId}/report`,
        {
          fileType: file.type,
          content: file.base64,
          clientEventId,
          clientTs: new Date().toISOString(),
          idempotencyKey: clientEventId,
        },
        clientEventId,
      );
    },

    // Its own call, not a column on the queue: this is the one identifying
    // read on the screen, and a separate request is what keeps it auditable
    // rather than fetched for every row nobody looked at (`DB-P7`).
    patientLabel: async (orderId) => {
      const result = await client.get<{ label: string | null }>(`/test-orders/${orderId}/patient`);
      return result.label;
    },

    shelf: async (hospitalId) =>
      await client.get<ShelfResponse>(`/hospitals/${hospitalId}/pharmacy-stock`),

    setFlags: async (hospitalId, flags) => {
      const clientEventId = crypto.randomUUID();
      return await client.put<ShelfResponse>(
        `/hospitals/${hospitalId}/pharmacy-stock`,
        {
          flags,
          clientEventId,
          clientTs: new Date().toISOString(),
          idempotencyKey: clientEventId,
        },
        clientEventId,
      );
    },
  };
}

/** Why a write did not land, in a form the screen can turn into a sentence. */
export type LabFailure =
  | { readonly kind: 'offline' }
  | { readonly kind: 'refused'; readonly code: string; readonly message: string };

export function failureOf(error: unknown): LabFailure {
  if (error instanceof NetworkError) return { kind: 'offline' };
  if (error instanceof ApiError) {
    return { kind: 'refused', code: error.code, message: error.message };
  }
  return { kind: 'refused', code: 'INTERNAL', message: 'Something went wrong.' };
}

/**
 * A chosen file as the API wants it: base64, without the `data:` prefix.
 *
 * Rejected here rather than at the server for the two things a bench can see
 * for itself — the wrong kind of file and one too large — so somebody does
 * not wait for ten megabytes to upload before being told.
 */
export async function readReportFile(
  file: File,
): Promise<{ ok: true; type: string; base64: string } | { ok: false; reason: 'type' | 'size' }> {
  if (!(REPORT_FILE_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, reason: 'type' };
  }
  if (file.size > REPORT_MAX_BYTES) return { ok: false, reason: 'size' };

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Chunked, because spreading a ten-megabyte array into `fromCharCode`
  // overflows the call stack on every browser that matters.
  let binary = '';
  const CHUNK = 0x8000;
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }

  return { ok: true, type: file.type, base64: btoa(binary) };
}
