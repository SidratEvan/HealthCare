/**
 * The hospital's own face on its consoles (plan K4; `PRD.md` `FR-BRD-12`;
 * `APP_FLOW.md` B1.1).
 *
 * One read, `GET /hospital/brand`, any member of the hospital's staff: its
 * names, its colours as its patients see them, and its logo as a `data:` URL.
 * Kept for the tab, per hospital, so moving between consoles does not ask
 * again and a console opened offline still wears the brand it last had.
 * Nothing here is a secret; the cache is a convenience, and its absence only
 * means the rail shows the session's name on the platform's colour.
 */

import { ApiClient } from '@platform/client';
import { BRAND_TOKENS, type BrandTheme } from '@platform/domain';

import { API_BASE } from '@/lib/settings';

export interface WorkspaceBrand {
  readonly nameBn: string;
  readonly nameEn: string;
  readonly theme: BrandTheme | null;
  readonly logo: string | null;
}

const KEY = 'medlivebd.console.brand.';

function kept(hospitalId: string): WorkspaceBrand | null {
  try {
    const raw = globalThis.sessionStorage.getItem(KEY + hospitalId);
    return raw === null ? null : (JSON.parse(raw) as WorkspaceBrand);
  } catch {
    return null;
  }
}

function keep(hospitalId: string, brand: WorkspaceBrand): void {
  try {
    globalThis.sessionStorage.setItem(KEY + hospitalId, JSON.stringify(brand));
  } catch {
    // A full or blocked store: the next console asks again.
  }
}

/** What this tab already holds for the hospital, without asking. */
export function brandKept(hospitalId: string): WorkspaceBrand | null {
  return kept(hospitalId);
}

/** The hospital's face, asked for once per tab. Null when it could not be read. */
export async function loadBrand(
  hospitalId: string,
  token: string | null,
): Promise<WorkspaceBrand | null> {
  const already = kept(hospitalId);
  if (already !== null) return already;
  try {
    const client = new ApiClient({ baseUrl: API_BASE, getToken: () => token });
    const brand = await client.get<WorkspaceBrand>('/hospital/brand');
    keep(hospitalId, brand);
    return brand;
  } catch {
    return null;
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const LOGO = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;

/** The logo, only if it is the image the API said it would be. */
export function logoOf(brand: WorkspaceBrand | null): string | null {
  return brand?.logo !== null && brand?.logo !== undefined && LOGO.test(brand.logo)
    ? brand.logo
    : null;
}

/**
 * Puts the hospital's colours on the workspace: the six brand tokens on the
 * document, as the patient app does for a portal, so every console reads them
 * and none knows it happened. No theme removes anything set.
 */
export function applyBrand(brand: WorkspaceBrand | null): void {
  const root = globalThis.document.documentElement;
  for (const token of BRAND_TOKENS) {
    const value = brand?.theme?.colors[token];
    if (value !== undefined && HEX.test(value)) root.style.setProperty(`--${token}`, value);
    else root.style.removeProperty(`--${token}`);
  }
}
