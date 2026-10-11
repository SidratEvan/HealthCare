import { Anek_Bangla, Manrope } from 'next/font/google';

// Build-time downloads; the visitor receives fonts from this site (GR-06).
const anek = Anek_Bangla({
  subsets: ['bengali', 'latin'],
  variable: '--font-bangla',
  display: 'swap',
});
const manrope = Manrope({ subsets: ['latin'], variable: '--font-latin', display: 'swap' });

export const fontVariables = `${anek.variable} ${manrope.variable}`;
