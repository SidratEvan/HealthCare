'use client';

/**
 * The document says whose app this is (`FR-BRD-08`, `FR-PAT-19`; plan C3).
 *
 * The page is built once for every address, as the network's: its title, the
 * name a phone suggests when it is added to a home screen, the icon an iPhone
 * takes, and where the install description is read from. Opened as a
 * hospital's portal, those four become the hospital's, here, once the server
 * has said whose it is.
 *
 * The install description is asked for at the same address either way
 * (`/manifest.webmanifest`). At a portal's own address the server knows whose
 * it is from the address. Opened by `?scope=`, it cannot, so the scope is put
 * on the link for it.
 *
 * Renders `<LocaleDocument>`, which keeps the title and the page's language
 * in step with the language chosen.
 */

import { useEffect, type ReactNode } from 'react';

import { tp } from '@platform/i18n';
import { LocaleDocument } from '@platform/ui';

import { useDeployment } from '@/hooks/useDeployment';
import { logoUrl } from '@/lib/api';

const MANIFEST = '/manifest.webmanifest';
const PLATFORM_ICON = '/icon.svg';

export function PortalDocument(): ReactNode {
  const scope = useDeployment()?.scope ?? null;

  useEffect(() => {
    const head = globalThis.document.head;

    const manifest = head.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (manifest !== null) {
      manifest.href =
        scope === null || scope.byAddress === true
          ? MANIFEST
          : `${MANIFEST}?scope=${encodeURIComponent(scope.code)}`;
    }

    // What an iPhone offers as the name, and takes as the icon.
    const name = head.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    if (name !== null) name.content = scope === null ? tp('appName', 'bn') : scope.nameBn;

    const icon = head.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    if (icon !== null) {
      icon.href =
        scope?.logoVersion == null ? PLATFORM_ICON : logoUrl(scope.hospitalId, scope.logoVersion);
    }
  }, [scope]);

  return (
    <LocaleDocument
      title={
        scope === null
          ? { bn: tp('appName', 'bn'), en: tp('appName', 'en') }
          : { bn: scope.nameBn, en: scope.nameEn }
      }
    />
  );
}
