/**
 * The patient app shell (FRONTEND.md §7, §9).
 *
 * `lang="bn"` is load-bearing: `tokens.css` keys the Bangla typesetting rules
 * off it — the 1.65 line-height floor, no letter-spacing, no conjunct breaking
 * (`TYP-01`, `TYP-02`, `TYP-06`). This product is written in Bangla, not
 * translated into it (CLAUDE.md §11.5).
 */

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
  themeColor: '#F6F4EF',
};

export default function RootLayout({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <html lang="bn">
      <body className="min-h-screen bg-canvas text-ink">{children}</body>
    </html>
  );
}
