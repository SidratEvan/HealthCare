/**
 * The typed API client (FRONTEND.md §10).
 *
 * One place that knows the response envelope, so no screen ever parses
 * `{ ok, data }` by hand and no screen invents its own error handling. Every
 * endpoint returns that shape or the failure shape (BACKEND.md §7), and this
 * turns the failure half into a thrown `ApiError` carrying the stable code —
 * which is what a caller maps to Bangla copy.
 */

import type { Eta, QueueEvent, QueueState } from '@platform/domain';

/** A failure the server described, with the code the UI maps to a message. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * A failure that never reached the server.
 *
 * Distinct from `ApiError` on purpose: the console's whole offline design
 * turns on telling "the server said no" apart from "there was no server".
 * The first rolls a row back; the second leaves it applied and queues it.
 */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('The request did not reach the server.', { cause });
    this.name = 'NetworkError';
  }
}

export interface ApiClientOptions {
  readonly baseUrl: string;
  /** Returns the current access token, or null when there is none. */
  readonly getToken: () => string | null;
  /** Injected so tests need no network and no global patching. */
  readonly fetchImpl?: typeof fetch;
}

interface Envelope<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: { code: string; message: string; details?: Record<string, unknown> };
}

export class ApiClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ApiClientOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async get<T>(path: string): Promise<T> {
    return await this.send<T>('GET', path);
  }

  async post<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
    return await this.send<T>('POST', path, body, idempotencyKey);
  }

  private async send<T>(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const token = this.options.getToken();

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token !== null) headers['authorization'] = `Bearer ${token}`;
    if (idempotencyKey !== undefined) headers['idempotency-key'] = idempotencyKey;

    // `exactOptionalPropertyTypes` means an explicit `undefined` body is not
    // the same as an absent one, and `RequestInit` accepts only the latter.
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.baseUrl}${path}`, init);
    } catch (cause) {
      // Never reached the server. The caller decides what that means; for a
      // queue action it means "stay applied, stay queued".
      throw new NetworkError(cause);
    }

    const envelope = (await response.json()) as Envelope<T>;

    if (!response.ok || envelope.ok !== true || envelope.data === undefined) {
      const error = envelope.error;
      throw new ApiError(
        error?.code ?? 'INTERNAL',
        error?.message ?? 'Something went wrong.',
        response.status,
        error?.details,
      );
    }

    return envelope.data;
  }
}

// ---------------------------------------------------------------------------
// The endpoints the console uses
// ---------------------------------------------------------------------------

/** `SY-05`, as the console receives it. */
export interface SyncPushResponse {
  readonly accepted: readonly { readonly clientEventId: string; readonly seq: number }[];
  readonly conflicts: readonly {
    readonly clientEventId: string;
    readonly reason: string;
    readonly code: string;
  }[];
  readonly state: QueueState;
  readonly etas: readonly Eta[];
  readonly seq: number;
  readonly serverTs: string;
}

export interface SyncPullResponse {
  readonly events: readonly QueueEvent[];
  readonly state: QueueState;
  readonly etas: readonly Eta[];
  readonly seq: number;
  readonly serverTs: string;
  readonly fullResync: boolean;
}

export function createSyncApi(client: ApiClient) {
  return {
    /** `POST /sync/events` — replay the local queue. */
    async push(
      sessionId: string,
      events: readonly {
        readonly clientEventId: string;
        readonly type: string;
        readonly payload: Record<string, unknown>;
        readonly clientTs: string;
      }[],
    ): Promise<SyncPushResponse> {
      return await client.post<SyncPushResponse>('/sync/events', { sessionId, events });
    },

    /** `GET /sync/session/:id` — what this device missed. */
    async pull(
      sessionId: string,
      sinceSeq: number,
      lastSyncedAt: string | null,
    ): Promise<SyncPullResponse> {
      const query = new URLSearchParams({ sinceSeq: String(sinceSeq) });
      if (lastSyncedAt !== null) query.set('lastSyncedAt', lastSyncedAt);
      return await client.get<SyncPullResponse>(`/sync/session/${sessionId}?${query.toString()}`);
    },
  };
}
