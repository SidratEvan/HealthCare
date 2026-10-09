'use client';

/**
 * The hospital's own face on whichever console is open (plan K4;
 * `PRD.md` `FR-BRD-12`).
 *
 * What this tab keeps is used at once, then the server's answer; the brand's
 * colours go on the document. Until it answers, and offline with nothing kept,
 * the answer is null and the console shows the session's name on the
 * platform's colour: the brand never stands between staff and their work.
 */

import { useEffect, useState } from 'react';

import { applyBrand, brandKept, loadBrand, logoOf, type WorkspaceBrand } from '@/lib/brand';
import { readDemoSession } from '@/lib/demo';

export function useWorkspaceBrand(): {
  readonly brand: WorkspaceBrand | null;
  readonly logo: string | null;
  readonly hospitalId: string | null;
} {
  const session = readDemoSession();
  const hospitalId = session?.hospitalId ?? null;
  const token = session?.token ?? null;
  const [brand, setBrand] = useState<WorkspaceBrand | null>(() =>
    hospitalId === null ? null : brandKept(hospitalId),
  );

  useEffect(() => {
    if (hospitalId === null) return undefined;
    let stale = false;
    void loadBrand(hospitalId, token).then((found) => {
      if (stale || found === null) return;
      setBrand(found);
    });
    return () => {
      stale = true;
    };
  }, [hospitalId, token]);

  useEffect(() => {
    applyBrand(brand);
  }, [brand]);

  return { brand, logo: logoOf(brand), hospitalId };
}
