/**
 * The platform administrator's calls (`S-B-12`, `/platform/*`, `FR-ONB-*`).
 *
 * Organisations and counts, and what may be done to each. Nothing here carries
 * a patient, because nothing the server sends under `/platform` does
 * (`FR-ONB-08`).
 */

import { ApiClient, ApiError, NetworkError } from '@platform/client';

import { API_BASE } from '@/lib/admin';

function client(token) {
  return new ApiClient({ baseUrl: API_BASE, getToken: () => token });
}

function failureOf(error) {
  if (error instanceof NetworkError) return { kind: 'offline' };
  if (!(error instanceof ApiError)) return { kind: 'failed' };

  const details = error.details ?? {};
  if (error.code === 'SETTINGS_DUPLICATE') return { kind: 'duplicate_code' };
  if (error.code === 'VALIDATION_FAILED') {
    return details['note'] === 'required' ? { kind: 'note_required' } : { kind: 'invalid' };
  }
  if (error.code === 'SETTINGS_NOT_ALLOWED') {
    if (details['reason'] === 'not_ready') {
      const missing = Array.isArray(details['missing']) ? details['missing'] : [];
      return { kind: 'not_ready', missing };
    }
    if (details['reason'] === 'domain_taken') return { kind: 'domain_taken' };
    if (details['reason'] === 'domain_is_the_platforms') return { kind: 'domain_is_the_platforms' };
    // The workspace moved while this screen was open: somebody else answered.
    return { kind: 'changed' };
  }
  return { kind: 'failed' };
}

async function attempt(call) {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    return { ok: false, failure: failureOf(error) };
  }
}

export const platformApi = {
  async list(token) {
    const data = await client(token).get('/platform/hospitals');
    return data.workspaces;
  },

  async detail(token, hospitalId) {
    return await client(token).get(`/platform/hospitals/${hospitalId}`);
  },

  /** What was done to the organisation, newest first. Nothing done for a patient. */
  async trail(token, hospitalId) {
    return await client(token).get(`/platform/hospitals/${hospitalId}/audit`);
  },

  async create(token, body) {
    return await attempt(
      async () => await client(token).post('/platform/hospitals', body, crypto.randomUUID()),
    );
  },

  async act(token, hospitalId, action, note) {
    return await attempt(
      async () =>
        await client(token).post(
          `/platform/hospitals/${hospitalId}/${action}`,
          note.trim() === '' ? {} : { note: note.trim() },
          crypto.randomUUID(),
        ),
    );
  },

  /** Switches the hospital's modules: the whole list of what is off (`FR-BRD-11`). */
  async setModules(token, hospitalId, off) {
    return await attempt(
      async () =>
        await client(token).put(
          `/platform/hospitals/${hospitalId}/modules`,
          { off },
          crypto.randomUUID(),
        ),
    );
  },
  /** Records where the hospital's agreement stands, with a note or none (`FR-SUP-04`). */
  async setAgreement(token, hospitalId, state, note) {
    return await attempt(
      async () =>
        await client(token).put(
          `/platform/hospitals/${hospitalId}/agreement`,
          { state, note },
          crypto.randomUUID(),
        ),
    );
  },
  /** Records the hospital's own domain for its portal, or removes it with null (`FR-BRD-07`). */
  async setDomain(token, hospitalId, domain) {
    return await attempt(
      async () =>
        await client(token).post(
          `/platform/hospitals/${hospitalId}/domain`,
          { domain },
          crypto.randomUUID(),
        ),
    );
  },
  async verifyDoctor(token, hospitalId, doctorId) {
    return await attempt(
      async () =>
        await client(token).post(
          `/platform/hospitals/${hospitalId}/doctors/${doctorId}/verify`,
          {},
          crypto.randomUUID(),
        ),
    );
  },
};
