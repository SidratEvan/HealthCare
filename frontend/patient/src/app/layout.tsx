/**
 * The patient app shell (FRONTEND.md §7, §9).
 *
 * `lang="bn"` is load-bearing: `tokens.css` keys the Bangla typesetting rules
 * off it — the 1.65 line-height floor, no letter-spacing, no conjunct breaking
 * (`TYP-01`, `TYP-02`, `TYP-06`). This product is written in Bangla, not
 * translated into it (CLAUDE.md §11.5).
 */

import { COLOUR } from '@platform/ui';

import '@platform/ui/styles.css';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'স্বাস্থ্যসেবা',
  description: 'ডাক্তারের সিরিয়াল নিন, আর অপেক্ষা সরাসরি দেখুন।',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // A11Y-06: 200% OS text scaling must not clip, so nothing is pinned here.
  // The one place a colour value is needed outside CSS — the browser chrome
  // reads this from the manifest, not from a stylesheet. Read from the token
  // module so it cannot drift from `--color-bg-canvas` (CLAUDE.md §7).
  themeColor: COLOUR['bg-canvas'],
};

export default function RootLayout({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <html lang="bn">
      <body className="min-h-screen bg-canvas text-ink">{children}</body>
    </html>
  );
}
