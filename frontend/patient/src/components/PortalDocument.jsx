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

import { useEffect } from 'react';

import { tp } from '@platform/i18n';
import { useLocale } from '@platform/ui';

import { useDeployment } from '@/hooks/useDeployment';
import { logoUrl } from '@/lib/api';

const MANIFEST = '/manifest.webmanifest';
const PLATFORM_ICON = '/icon.svg';

export function PortalDocument() {
  const scope = useDeployment()?.scope ?? null;
  const locale = useLocale();

  useEffect(() => {
    const head = globalThis.document.head;
    const title =
      scope === null ? tp('appName', locale) : locale === 'bn' ? scope.nameBn : scope.nameEn;
    const updateDocument = () => {
      globalThis.document.documentElement.lang = locale;
      if (globalThis.document.title !== title) globalThis.document.title = title;
    };
    updateDocument();
    // Next's metadata reconciler can write the static layout title after this
    // client component hydrates. Keep the scoped title authoritative when it
    // does, and follow locale changes through the effect dependencies.
    const observer = new MutationObserver(updateDocument);
    observer.observe(head, { childList: true, subtree: true, characterData: true });

    const manifest = head.querySelector('link[rel="manifest"]');
    if (manifest !== null) {
      manifest.href =
        scope === null || scope.byAddress === true
          ? MANIFEST
          : `${MANIFEST}?scope=${encodeURIComponent(scope.code)}`;
    }

    // What an iPhone offers as the name, and takes as the icon.
    const name = head.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (name !== null) name.content = scope === null ? tp('appName', 'bn') : scope.nameBn;

    const icon = head.querySelector('link[rel="apple-touch-icon"]');
    if (icon !== null) {
      icon.href =
        scope?.logoVersion == null ? PLATFORM_ICON : logoUrl(scope.hospitalId, scope.logoVersion);
    }
    return () => observer.disconnect();
  }, [locale, scope]);

  return null;
}
