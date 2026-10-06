/**
 * The mapping-suggestion adapter: a model that proposes which of a file's
 * columns is which template field, for the columns the rules could not place
 * (`PRD.md` §14b `FR-IMP-16`, `FR-IMP-17`; `PLATFORM_PLAN.md` §4).
 *
 * ## The only AI in the product, and what it may do
 *
 * It suggests a column for a field. That is all. It does not see a row, does
 * not decide what is imported, and writes nothing: its answer is read against
 * a fixed shape, filtered to the fields and columns it was asked about
 * (`withModelSuggestions`), shown to an administrator as a suggestion, and —
 * if they confirm it — handed to the same check every import goes through.
 * Nothing clinical is asked of it and nothing clinical could come back
 * through a shape that holds a field name, a column number, a word for
 * confidence and a sentence.
 *
 * ## What it is sent (`FR-IMP-17`)
 *
 * A `ModelMappingRequest`: the set, the open fields with what each means, the
 * unused columns' *headings* and *profiles*, and a made-up example per kind.
 * No value from any row. That is enforced upstream by the type the request is
 * built from (`modelMappingRequest`), not by care taken here. Real patient
 * data therefore does not leave the server, wherever the model runs.
 *
 * ## `MAPPING_PROVIDER=off` is the default, and off is a complete product
 *
 * With it off, slow, refused or failing, `propose` answers `unavailable` and
 * the import carries on with the rules and the administrator's own choices,
 * exactly as it does with no model configured. This file **never throws into
 * the request**: every failure is a value.
 *
 * ## Raw HTTPS, no SDK
 *
 * `PLATFORM_PLAN.md` §6 (conflict E) records the choice: one `fetch` to the
 * Messages API rather than a new dependency (`CLAUDE.md` §7). The request is
 * the documented shape — `output_config.format` for a JSON answer,
 * `output_config.effort`, and `fallbacks: "default"` so a declined request is
 * re-run server-side rather than returned as a refusal. Swapping this for the
 * official SDK is a change to this file and nothing else.
 */

import { z } from 'zod';

import type { ModelMappingRequest, ModelSuggestion } from '@platform/domain';

import { logger } from '../config/logger.js';
import { env } from '../env.js';

/** Why no suggestion came back. A code, never a sentence from a provider. */
export type MappingUnavailable =
  | 'off'
  | 'not_configured'
  | 'timeout'
  | 'network'
  | 'unauthorised'
  | 'rate_limited'
  | 'provider_error'
  | 'refused'
  | 'truncated'
  | 'unreadable';

export type MappingAnswer =
  | { readonly kind: 'suggestions'; readonly suggestions: readonly ModelSuggestion[] }
  | { readonly kind: 'unavailable'; readonly reason: MappingUnavailable };

export interface MappingProvider {
  readonly name: string;
  /** Never throws: a failure is `{ kind: 'unavailable' }`. */
  propose(request: ModelMappingRequest): Promise<MappingAnswer>;
}

/** `MAPPING_PROVIDER=off`: says so, and asks nobody. */
export class OffMappingProvider implements MappingProvider {
  readonly name = 'off';

  async propose(): Promise<MappingAnswer> {
    return await Promise.resolve({ kind: 'unavailable', reason: 'off' });
  }
}

/** What a model must answer with. Anything else is `unreadable`. */
const answerShape = z.strictObject({
  suggestions: z
    .array(
      z.strictObject({
        field: z.string().min(1).max(40),
        column: z.number().int().min(0).max(500),
        confidence: z.enum(['high', 'medium', 'low']),
        reason: z.string().max(600),
      }),
    )
    .max(60),
});

/** The same shape as a JSON schema, for `output_config.format`. */
const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          column: { type: 'integer' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          reason: { type: 'string' },
        },
        required: ['field', 'column', 'confidence', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['suggestions'],
  additionalProperties: false,
} as const;

const SYSTEM = [
  'You help a hospital administrator in Bangladesh match the columns of a spreadsheet export to the fields of an import template.',
  'You are given the template fields that still have no column, and the file columns that are still unused. For each column you are given only its heading, the kind of value it holds, how full it is, and a made-up example of that kind. You are never given a value from the file.',
  'Headings may be in English, Bangla, or abbreviated ("Pt. Cell", "Sx", "Yrs", "MR#").',
  'Suggest a column for a field only when the heading and the kind of value make it likely. Leave a field out when nothing fits: an honest gap is better than a guess, because a person reviews every suggestion and a wrong one costs them time.',
  'Use each column for at most one field and each field at most once. Only use the field names and column index numbers you were given.',
  'For each suggestion give a confidence (high, medium or low) and one short plain sentence saying why, which the administrator will read.',
  'Never suggest importing a national ID, an address, a photograph, a guardian or emergency contact, insurance, billing, or a password: the template has no field for them, and they are to be left out.',
].join('\n');

/** Models documented to accept the `fallbacks: "default"` refusal fallback. */
const FALLBACK_MODELS = new Set([
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
]);

interface MessagesResponse {
  readonly stop_reason?: string | null;
  readonly content?: readonly { readonly type?: string; readonly text?: string }[];
}

/**
 * Claude, over the Messages API.
 *
 * `fetchImpl` is a parameter so that a test can stand in for the network; in
 * the running API it is the platform's `fetch`.
 */
export class ClaudeMappingProvider implements MappingProvider {
  readonly name = 'claude';

  constructor(
    private readonly options: {
      readonly apiKey: string;
      readonly model: string;
      readonly baseUrl: string;
      readonly timeoutMs: number;
    },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async propose(request: ModelMappingRequest): Promise<MappingAnswer> {
    const started = Date.now();
    const answer = await this.ask(request);

    // Counts and an outcome. No heading, no suggestion, no key.
    logger.info(
      {
        provider: this.name,
        model: this.options.model,
        fieldsAsked: request.fields.length,
        columnsOffered: request.columns.length,
        outcome: answer.kind === 'suggestions' ? 'suggestions' : answer.reason,
        suggestions: answer.kind === 'suggestions' ? answer.suggestions.length : 0,
        durationMs: Date.now() - started,
      },
      'import mapping suggestions asked for',
    );
    return answer;
  }

  private async ask(request: ModelMappingRequest): Promise<MappingAnswer> {
    if (this.options.apiKey === '') return { kind: 'unavailable', reason: 'not_configured' };

    const withFallback = FALLBACK_MODELS.has(this.options.model);
    const body = {
      model: this.options.model,
      max_tokens: 8000,
      system: SYSTEM,
      // A small, well-specified matching task: low effort is enough, and the
      // administrator is waiting on the answer.
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: ANSWER_SCHEMA },
      },
      // A request the safety classifiers decline is re-run server-side on
      // another model rather than returned as a refusal.
      ...(withFallback ? { fallbacks: 'default' } : {}),
      messages: [
        {
          role: 'user',
          content: `Match these. Answer with JSON only.\n\n${JSON.stringify(request, null, 2)}`,
        },
      ],
    };

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.options.apiKey,
          'anthropic-version': '2023-06-01',
          ...(withFallback ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      const timedOut =
        error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      return { kind: 'unavailable', reason: timedOut ? 'timeout' : 'network' };
    }

    if (response.status === 401 || response.status === 403) {
      return { kind: 'unavailable', reason: 'unauthorised' };
    }
    if (response.status === 429) return { kind: 'unavailable', reason: 'rate_limited' };
    if (!response.ok) return { kind: 'unavailable', reason: 'provider_error' };

    let message: MessagesResponse;
    try {
      message = (await response.json()) as MessagesResponse;
    } catch {
      return { kind: 'unavailable', reason: 'unreadable' };
    }

    // Before reading the content: a refusal or a cut-off answer does not have
    // to match the schema.
    if (message.stop_reason === 'refusal') return { kind: 'unavailable', reason: 'refused' };
    if (message.stop_reason === 'max_tokens') return { kind: 'unavailable', reason: 'truncated' };

    const text = (message.content ?? []).find((block) => block.type === 'text')?.text;
    if (text === undefined) return { kind: 'unavailable', reason: 'unreadable' };

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { kind: 'unavailable', reason: 'unreadable' };
    }
    const checked = answerShape.safeParse(parsed);
    if (!checked.success) return { kind: 'unavailable', reason: 'unreadable' };

    return { kind: 'suggestions', suggestions: checked.data.suggestions };
  }
}

let current: MappingProvider | null = null;

/** The provider this process asks. */
export function mappingProvider(): MappingProvider {
  current ??=
    env.MAPPING_PROVIDER === 'claude'
      ? new ClaudeMappingProvider({
          apiKey: env.MAPPING_API_KEY,
          model: env.MAPPING_MODEL,
          baseUrl: env.MAPPING_BASE_URL,
          timeoutMs: env.MAPPING_TIMEOUT_MS,
        })
      : new OffMappingProvider();
  return current;
}

/** Replaces it. Called by tests; nothing in production calls this. */
export function setMappingProvider(provider: MappingProvider): void {
  current = provider;
}

/** Restores the environment's choice. */
export function resetMappingProvider(): MappingProvider {
  current = null;
  return mappingProvider();
}

/**
 * Asks the provider, and turns anything it throws into `unavailable`.
 *
 * A provider must not throw (`MappingProvider`). This is for the one that
 * does anyway: an import must never fail because a suggestion did.
 */
export async function proposeSafely(request: ModelMappingRequest): Promise<MappingAnswer> {
  try {
    return await mappingProvider().propose(request);
  } catch {
    return { kind: 'unavailable', reason: 'provider_error' };
  }
}
