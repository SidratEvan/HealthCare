/**
 * The faces this app sets type in (FRONTEND.md §2.1).
 *
 * Anek Bangla for everything a person reads on a screen, Tiro Bangla for the
 * few long-form reading surfaces. Loaded through `next/font`, which fetches
 * them when the app is built and serves them from this app's own origin: no
 * third-party request at runtime, nothing to fail on a bad connection, and
 * no new dependency — it is part of Next.
 *
 * Each face exposes a CSS variable, and `--font-ui` / `--font-reading` in
 * `@platform/ui` read those variables with the family name as fallback. Until
 * this file existed nothing loaded either face, and every screen rendered in
 * whatever Bangla font the device had.
 */

import { Anek_Bangla, Tiro_Bangla } from 'next/font/google';

export const anek = Anek_Bangla({
  subsets: ['bengali', 'latin'],
  variable: '--font-anek',
  display: 'swap',
});

export const tiro = Tiro_Bangla({
  subsets: ['bengali', 'latin'],
  weight: '400',
  variable: '--font-tiro',
  display: 'swap',
});

/** The class names that set both variables, for the root element. */
export const fontVariables = `${anek.variable} ${tiro.variable}`;
