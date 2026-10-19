'use client';

/** Explicit platform editor drafts, using the existing review/navigation guard
 * (FR-ONB-07/08, GR-03/06). No credentials enter this registry. */
import { useManagementDraft } from '@/components/AdminManagementContext';

export function usePlatformDraft(id, title, fields, reset) {
  const run = useManagementDraft(id, title, fields, async (call) => (await call()).ok, reset);
  return async (save) =>
    await run(
      async () =>
        (await save()) ? { ok: true, value: true } : { ok: false, failure: { kind: 'failed' } },
      () => '',
    );
}
