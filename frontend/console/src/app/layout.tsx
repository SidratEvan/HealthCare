/**
 * The console shell (FRONTEND.md §7, §9).
 *
 * `lang="bn"` on the root element is not decoration: `tokens.css` keys the
 * Bangla typesetting rules off it — the 1.65 line-height floor, no
 * letter-spacing, no conjunct breaking (`TYP-01`, `TYP-02`, `TYP-06`). Bangla
 * is the default language of this product, not a translation of it
 * (CLAUDE.md §11.5).
 */

import '@platform/ui/styles.css';

import { fontVariables } from '@/app/fonts';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'হাসপাতাল কনসোল',
  description: 'রিসেপশন কনসোল — সিরিয়াল ব্যবস্থাপনা',
};

export const viewport: Viewport = {
  // The console runs on a counter monitor, but a supervisor's tablet is a real
  // case. A11Y-06 requires 200% text scaling without clipping, which a fixed
  // maximum-scale would break.
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <html lang="bn" className={fontVariables}>
      <body className="min-h-screen bg-canvas text-ink">{children}</body>
    </html>
  );
}
