/** A failure the server described, with the code the UI maps to a message. */
export class ApiError extends Error {
  code;
  status;
  details;
  constructor(code, message, status, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
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
  constructor(cause) {
    super('The request did not reach the server.', { cause });
    this.name = 'NetworkError';
  }
}

export class ApiClient {
  options;
  fetchImpl;

  constructor(options) {
    this.options = options;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async get(path) {
    return await this.send('GET', path);
  }

  async post(path, body, idempotencyKey) {
    return await this.send('POST', path, body, idempotencyKey);
  }

  /** `PATCH /emergency/cases/:id` — "triage, state" (BACKEND.md §7.5). */
  async patch(path, body, idempotencyKey) {
    return await this.send('PATCH', path, body, idempotencyKey);
  }

  /** `PUT /hospitals/:id/capabilities` (`FR-EMG-05`). */
  async put(path, body, idempotencyKey) {
    return await this.send('PUT', path, body, idempotencyKey);
  }

  /** `DELETE /hospital/templates/:id` — ending a weekly schedule (pilot step 22). */
  async delete(path, idempotencyKey) {
    return await this.send('DELETE', path, undefined, idempotencyKey);
  }

  async send(method, path, body, idempotencyKey) {
    const token = this.options.getToken();

    const headers = { 'content-type': 'application/json' };
    if (token !== null) headers['authorization'] = `Bearer ${token}`;
    if (idempotencyKey !== undefined) headers['idempotency-key'] = idempotencyKey;

    // `exactOptionalPropertyTypes` means an explicit `undefined` body is not
    // the same as an absent one, and `RequestInit` accepts only the latter.
    const init = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);

    let response;
    try {
      response = await this.fetchImpl(`${this.options.baseUrl}${path}`, init);
    } catch (cause) {
      // Never reached the server. The caller decides what that means; for a
      // queue action it means "stay applied, stay queued".
      throw new NetworkError(cause);
    }

    const envelope = await response.json();

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

/** The queue's own routes, for what the sync batch does not carry. */
export function createQueueApi(client) {
  return {
    /**
     * `POST /sessions/:id/end` (`BTN-B02-END`). Refused by the server while a
     * patient is in the chamber (`QUEUE_GUARD_FAILED`, guard
     * `PATIENT_IN_CHAMBER`); answered with the ended queue otherwise.
     */
    async end(sessionId, idempotencyKey) {
      return await client.post(`/sessions/${sessionId}/end`, { reason: null }, idempotencyKey);
    },
    /**
     * `POST /events/:id/undo` (`GR-02`) — by the stored event's id, inside
     * the window, by whoever did it. The key makes a retried press one undo.
     */
    async undo(eventId, idempotencyKey) {
      await client.post(`/events/${eventId}/undo`, {}, idempotencyKey);
    },
  };
}

export function createSyncApi(client) {
  return {
    /** `POST /sync/events` — replay the local queue. */
    async push(sessionId, events) {
      return await client.post('/sync/events', { sessionId, events });
    },

    /** `GET /sync/session/:id` — what this device missed. */
    async pull(sessionId, sinceSeq, lastSyncedAt) {
      const query = new URLSearchParams({ sinceSeq: String(sinceSeq) });
      if (lastSyncedAt !== null) query.set('lastSyncedAt', lastSyncedAt);
      return await client.get(`/sync/session/${sessionId}?${query.toString()}`);
    },
  };
}
