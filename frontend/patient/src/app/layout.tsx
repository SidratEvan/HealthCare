/**
 * The patient app shell (FRONTEND.md §7, §9).
 *
 * `lang="bn"` is load-bearing: `tokens.css` keys the Bangla typesetting rules
 * off it — the 1.65 line-height floor, no letter-spacing, no conjunct breaking
 * (`TYP-01`, `TYP-02`, `TYP-06`). This product is written in Bangla, not
 * translated into it (CLAUDE.md §11.5).
 *
 * ## What makes this an app rather than a page
 *
 * Three things, and all three were missing until now:
 *
 * **A manifest**, so it installs to a home screen with its own icon and opens
 * without browser chrome. `display: standalone` is the difference between a
 * bookmark and an app.
 *
 * **A service worker**, so it opens on a bad connection and shows its own
 * offline state rather than the browser's error page — while never serving a
 * queue from a cache, because a serial with no age is the one thing this
 * product does not show (`FR-OFF-03`).
 *
 * **Safe-area insets and no user scaling of the chrome**, so the bottom
 * navigation sits above the home indicator instead of under the system
 * gesture area.
 */

import { COLOUR } from '@platform/ui';

import '@platform/ui/styles.css';

import { ServiceWorker } from '@/components/ServiceWorker';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'স্বাস্থ্যসেবা',
  description: 'ডাক্তারের সিরিয়াল নিন, আর অপেক্ষা সরাসরি দেখুন।',
  manifest: '/manifest.webmanifest',
  applicationName: 'স্বাস্থ্যসেবা',
  appleWebApp: {
    capable: true,
    title: 'স্বাস্থ্যসেবা',
    // The ground, so the status bar matches the page rather than fighting it.
    statusBarStyle: 'default',
  },
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
  // The marketing site is a separate app (FRONTEND.md §10); nothing here is
  // meant to be indexed, and a patient's booking screen least of all.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // A11Y-06: 200% OS text scaling must not clip, so scaling is not pinned.
  // `viewport-fit=cover` is what lets `env(safe-area-inset-*)` return
  // anything other than zero on a notched phone — without it the bottom
  // navigation sits under the home indicator.
  viewportFit: 'cover',
  // Read from the token module so it cannot drift from `--color-bg-canvas`.
  themeColor: COLOUR['bg-canvas'],
};

export default function RootLayout({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <html lang="bn">
      {/*
        `overscroll-none` stops the rubber-band bounce revealing the browser's
        background behind a fixed bottom bar, which is the single clearest
        tell that a standalone app is a web page.
      */}
      <body className="min-h-screen overscroll-none bg-canvas text-ink">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
