/**
 * `GET /manifest.webmanifest` — what a phone is told when this app is added
 * to its home screen (`FR-BRD-08`; plan C3).
 *
 * A file until now, which could describe one app. A hospital's portal is the
 * same build at another address, and has to install as that hospital's: its
 * name under the icon, its logo, its colour. So the description is made per
 * request, from whose address it was asked at (`FR-BRD-07`) or, where a
 * portal is opened by a parameter, from the `scope` the page puts on this
 * address (`<PortalDocument>`).
 *
 * It never fails. Whatever cannot be found out (the API not answering, a
 * code nobody has) gives the network's own description, because an app that
 * will not install is worse than one that installs under the platform's name.
 */

import { installManifest, type InstallSubject } from '@platform/domain';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';
const SCOPE = /^[A-Za-z0-9][A-Za-z0-9-]{1,15}$/;

/** Made for each request: whose it is depends on the address it was asked at. */
export const dynamic = 'force-dynamic';

interface ScopeAnswer {
  readonly code: string;
  readonly hospitalId: string;
  readonly nameBn: string;
  readonly descriptionBn?: string | null;
  readonly theme?: { readonly colors: Readonly<Record<string, string>> } | null;
  readonly logoVersion?: string | null;
  readonly logoImage?: {
    readonly type: string;
    readonly width: number;
    readonly height: number;
  } | null;
  readonly byAddress?: boolean;
}

async function subjectFor(scope: string | null, host: string): Promise<InstallSubject | null> {
  try {
    const params = new URLSearchParams({ host });
    if (scope !== null) params.set('scope', scope);
    const response = await fetch(`${API}/config?${params.toString()}`, {
      cache: 'no-store',
      // A launcher will not wait long for this, and neither does this.
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return null;

    const body = (await response.json()) as { data?: { scope?: ScopeAnswer | null } };
    const hospital = body.data?.scope;
    if (hospital == null) return null;

    return {
      nameBn: hospital.nameBn,
      descriptionBn: hospital.descriptionBn ?? null,
      mainColour: hospital.theme?.colors['brand-600'] ?? null,
      icon:
        hospital.logoVersion == null || hospital.logoImage == null
          ? null
          : {
              src: `${API}/hospitals/${hospital.hospitalId}/logo?v=${encodeURIComponent(hospital.logoVersion)}`,
              ...hospital.logoImage,
            },
      // At its own address the app opens at the root. Opened by a parameter,
      // the parameter goes with the icon, or the installed app is the network.
      startUrl: hospital.byAddress === true ? '/' : `/?scope=${hospital.code}`,
    };
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const asked = url.searchParams.get('scope');
  const scope = asked !== null && SCOPE.test(asked) ? asked.toUpperCase() : null;
  // Behind the proxy that serves every portal, the name the phone asked for
  // is the forwarded one. What it selects is public either way.
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host;

  const manifest = installManifest(await subjectFor(scope, host));
  return new Response(JSON.stringify(manifest), {
    headers: {
      'content-type': 'application/manifest+json; charset=utf-8',
      // Asked again each time: a hospital that changes its logo or its name
      // should not be installed under the old one for a day.
      'cache-control': 'no-cache',
    },
  });
}
