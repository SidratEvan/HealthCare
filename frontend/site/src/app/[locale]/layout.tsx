import { notFound } from 'next/navigation';

import { SITE_ORIGIN } from '@/content/site';

import { fontVariables } from '../fonts';

import '../medlive.css';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

/**
 * The origin every page beneath resolves its share image against. Without it a
 * child page (the privacy notice) inherits the image with a localhost address.
 */
export const metadata: Metadata = { metadataBase: new URL(SITE_ORIGIN) };
export const viewport: Viewport = { themeColor: '#040b16', colorScheme: 'dark' };

/** Server-rendered document language, including without JavaScript (GR-06). */
export default async function LocaleLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ locale: string }>;
}): Promise<ReactNode> {
  const { locale } = await params;
  if (locale !== 'bn' && locale !== 'en') notFound();
  return (
    <html lang={locale} className={fontVariables}>
      <body>
        {/* Without script nothing moves, so nothing may wait hidden or dim for it. */}
        <noscript>
          <style>
            {
              '[data-reveal],[data-scrub]{opacity:1!important;transform:none!important}.menu-toggle{display:none!important}'
            }
          </style>
        </noscript>
        {children}
      </body>
    </html>
  );
}
