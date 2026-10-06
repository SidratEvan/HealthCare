/**
 * The model adapter behind the import mapping (`adapters/mapping.ts`,
 * `FR-IMP-16`, `FR-IMP-17`).
 *
 * The network is stood in for: no test here calls a model. What is tested is
 * the contract on both sides of it — the request this server sends, and that
 * whatever comes back, or does not, becomes either a checked list of
 * suggestions or `unavailable`, and never an exception.
 */

import { describe, expect, it } from 'vitest';

import type { ModelMappingRequest } from '@platform/domain';

import {
  ClaudeMappingProvider,
  OffMappingProvider,
  mappingProvider,
  proposeSafely,
  resetMappingProvider,
  setMappingProvider,
} from '../adapters/mapping.js';
import { EnvError, loadEnv } from '../env.js';

const REQUEST: ModelMappingRequest = {
  set: 'patients',
  rowType: null,
  fields: [{ field: 'ref', required: true, means: 'The identifier the hospital uses.' }],
  columns: [
    { index: 0, heading: 'MR#', holds: 'text', filled: 1, variety: 'unique', looksLike: null },
  ],
  alreadyMatched: [{ field: 'mobile', heading: 'Pt. Cell' }],
};

const OPTIONS = {
  apiKey: 'test-key-not-real',
  model: 'claude-opus-5-5',
  baseUrl: 'https://api.example.test',
  timeoutMs: 5_000,
};

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** A `fetch` that records what it was sent and answers as told. */
function network(answer: { status?: number; json?: unknown; text?: string } | (() => never)): {
  fetchImpl: typeof fetch;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    sent.push({
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<
        string,
        unknown
      >,
    });
    if (typeof answer === 'function') return answer();
    return await Promise.resolve(
      new Response(answer.text ?? JSON.stringify(answer.json ?? {}), {
        status: answer.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;
  return { fetchImpl, sent };
}

function message(text: string, stopReason = 'end_turn'): unknown {
  return {
    id: 'msg_test',
    model: 'claude-opus-5-5',
    stop_reason: stopReason,
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text },
    ],
  };
}

const GOOD = JSON.stringify({
  suggestions: [
    { field: 'ref', column: 0, confidence: 'high', reason: 'MR# is a medical record number.' },
  ],
});

describe('the request this server sends', () => {
  it('is the documented Messages API shape, with a JSON answer and a bounded wait', async () => {
    const { fetchImpl, sent } = network({ json: message(GOOD) });
    await new ClaudeMappingProvider(OPTIONS, fetchImpl).propose(REQUEST);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('https://api.example.test/v1/messages');
    expect(sent[0]?.headers).toMatchObject({
      'x-api-key': 'test-key-not-real',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    });

    const body = sent[0]?.body ?? {};
    expect(body['model']).toBe('claude-opus-5-5');
    expect(body['max_tokens']).toBe(8000);
    // Structured output, and the effort said rather than left to a default.
    expect(body['output_config']).toMatchObject({
      effort: 'low',
      format: { type: 'json_schema', schema: { type: 'object', additionalProperties: false } },
    });
    // Nothing this model rejects: no thinking budget, no sampling parameters,
    // no forced tool, no prefilled assistant turn.
    for (const absent of ['thinking', 'temperature', 'top_p', 'top_k', 'tools', 'tool_choice']) {
      expect(body, absent).not.toHaveProperty(absent);
    }
    expect((body['messages'] as { role: string }[]).map((entry) => entry.role)).toEqual(['user']);
  });

  it('opts into the default refusal fallback on a model that has it, and not on one that does not', async () => {
    const withIt = network({ json: message(GOOD) });
    await new ClaudeMappingProvider(OPTIONS, withIt.fetchImpl).propose(REQUEST);
    expect(withIt.sent[0]?.body['fallbacks']).toBe('default');
    expect(withIt.sent[0]?.headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01');

    const without = network({ json: message(GOOD) });
    await new ClaudeMappingProvider(
      { ...OPTIONS, model: 'claude-haiku-4-5' },
      without.fetchImpl,
    ).propose(REQUEST);
    expect(without.sent[0]?.body).not.toHaveProperty('fallbacks');
    expect(without.sent[0]?.headers).not.toHaveProperty('anthropic-beta');
  });

  it('sends what it was given and nothing else about the file (FR-IMP-17)', async () => {
    const { fetchImpl, sent } = network({ json: message(GOOD) });
    await new ClaudeMappingProvider(OPTIONS, fetchImpl).propose(REQUEST);

    const content = (sent[0]?.body['messages'] as { content: string }[])[0]?.content ?? '';
    // The request, serialised: headings and profiles.
    expect(content).toContain('"heading": "MR#"');
    expect(content).toContain('"means"');
    // The instruction that keeps what must never be imported out.
    expect(String(sent[0]?.body['system'])).toContain('national ID');
    expect(String(sent[0]?.body['system'])).toContain('never given a value from the file');
  });
});

describe('what comes back becomes suggestions or "unavailable", never an exception', () => {
  it('reads a well-formed answer', async () => {
    const { fetchImpl } = network({ json: message(GOOD) });
    expect(await new ClaudeMappingProvider(OPTIONS, fetchImpl).propose(REQUEST)).toEqual({
      kind: 'suggestions',
      suggestions: [
        { field: 'ref', column: 0, confidence: 'high', reason: 'MR# is a medical record number.' },
      ],
    });
  });

  it.each([
    ['a refusal', { json: message('', 'refusal') }, 'refused'],
    ['an answer cut off', { json: message('{"suggestions": [', 'max_tokens') }, 'truncated'],
    ['text that is not JSON', { json: message('Here are my suggestions!') }, 'unreadable'],
    ['JSON of another shape', { json: message('{"mappings": {}}') }, 'unreadable'],
    [
      'a suggestion with a field outside the shape',
      {
        json: message(
          JSON.stringify({
            suggestions: [
              { field: 'ref', column: 0, confidence: 'certain', reason: 'x', write: true },
            ],
          }),
        ),
      },
      'unreadable',
    ],
    ['a body that is not JSON at all', { text: '<html>bad gateway</html>' }, 'unreadable'],
    ['no text block', { json: { stop_reason: 'end_turn', content: [] } }, 'unreadable'],
    [
      'a wrong key',
      { status: 401, json: { error: { type: 'authentication_error' } } },
      'unauthorised',
    ],
    ['a rate limit', { status: 429, json: {} }, 'rate_limited'],
    ['an overloaded provider', { status: 529, json: {} }, 'provider_error'],
    ['a server error', { status: 500, json: {} }, 'provider_error'],
    ['a bad request', { status: 400, json: {} }, 'provider_error'],
  ])('%s', async (_name, answer, reason) => {
    const { fetchImpl } = network(answer);
    expect(await new ClaudeMappingProvider(OPTIONS, fetchImpl).propose(REQUEST)).toEqual({
      kind: 'unavailable',
      reason,
    });
  });

  it('a wait that runs out', async () => {
    const { fetchImpl } = network(() => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });
    expect(await new ClaudeMappingProvider(OPTIONS, fetchImpl).propose(REQUEST)).toEqual({
      kind: 'unavailable',
      reason: 'timeout',
    });
  });

  it('a network that is not there', async () => {
    const { fetchImpl } = network(() => {
      throw new TypeError('fetch failed');
    });
    expect(await new ClaudeMappingProvider(OPTIONS, fetchImpl).propose(REQUEST)).toEqual({
      kind: 'unavailable',
      reason: 'network',
    });
  });

  it('no key: nobody is asked', async () => {
    const { fetchImpl, sent } = network({ json: message(GOOD) });
    const answer = await new ClaudeMappingProvider({ ...OPTIONS, apiKey: '' }, fetchImpl).propose(
      REQUEST,
    );
    expect(answer).toEqual({ kind: 'unavailable', reason: 'not_configured' });
    expect(sent).toHaveLength(0);
  });
});

describe('off is the default, and a provider that throws is still not an error', () => {
  it('asks nobody when no model is configured', async () => {
    resetMappingProvider();
    expect(mappingProvider()).toBeInstanceOf(OffMappingProvider);
    expect(await proposeSafely(REQUEST)).toEqual({ kind: 'unavailable', reason: 'off' });
  });

  it('turns a provider that throws into "unavailable"', async () => {
    setMappingProvider({
      name: 'broken',
      propose: async () => {
        return await Promise.reject(new Error('a provider must not throw, and this one does'));
      },
    });
    try {
      expect(await proposeSafely(REQUEST)).toEqual({
        kind: 'unavailable',
        reason: 'provider_error',
      });
    } finally {
      resetMappingProvider();
    }
  });
});

describe('configuration', () => {
  const DEV = {
    NODE_ENV: 'development',
    API_BASE_URL: 'http://localhost:4000',
    WEB_BASE_URL: 'http://localhost:3000',
    DATABASE_URL: 'postgresql://healthcare:healthcare@localhost:5432/healthcare_dev',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    GUEST_LINK_SECRET: 'c'.repeat(32),
  };

  it('is off unless set, on the current Opus when set, and waits twenty seconds at most', () => {
    const env = loadEnv({ ...DEV });
    expect(env.MAPPING_PROVIDER).toBe('off');
    expect(env.MAPPING_MODEL).toBe('claude-opus-5-5');
    expect(env.MAPPING_BASE_URL).toBe('https://api.anthropic.com');
    expect(env.MAPPING_TIMEOUT_MS).toBe(20_000);
  });

  it('refuses a provider it does not know', () => {
    expect(() => loadEnv({ ...DEV, MAPPING_PROVIDER: 'something-else' })).toThrow(EnvError);
  });
});
