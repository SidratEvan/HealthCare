import { Anek_Bangla, Geist, Geist_Mono } from 'next/font/google';

// Build-time downloads; the visitor receives fonts from this site (GR-06).
// Anek Bangla is the brand's Bangla face (docs/design/patient-direction-2.png);
// Geist carries English, Geist Mono the small "live" labels — times, serials.
const anek = Anek_Bangla({
  subsets: ['bengali', 'latin'],
  variable: '--font-bangla',
  display: 'swap',
});
const geist = Geist({ subsets: ['latin'], variable: '--font-latin', display: 'swap' });
const mono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  weight: ['400', '500'],
});

export const fontVariables = `${anek.variable} ${geist.variable} ${mono.variable}`;
