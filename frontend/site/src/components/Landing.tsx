import { copy } from '@/content/copy';

import { Footer } from './Footer';
import { Header } from './Header';
import { MotionProvider } from './motion';
import { ConnectedMap } from './sections/ConnectedMap';
import { Contact } from './sections/Contact';
import { Experiences } from './sections/Experiences';
import { Hero } from './sections/Hero';
import { Hospitals } from './sections/Hospitals';
import { Patients } from './sections/Patients';
import { Trust } from './sections/Trust';
import { Vision } from './sections/Vision';

import type { Locale } from '@/content/copy';
import type { ReactNode } from 'react';

/**
 * The company page (S-C-01–05), told as a story rather than a manual (owner,
 * 12 October 2026): who we are, why connected care matters, the two
 * experiences it serves, the country it is for, how it behaves, and an
 * invitation to see it privately.
 */
export function Landing({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  return (
    <MotionProvider>
      <div className="company-page" lang={locale} id="top">
        <a className="skip-link" href="#main">
          {t.skip}
        </a>
        <Header locale={locale} />
        <main id="main">
          <Hero locale={locale} />
          <Vision locale={locale} />
          <Experiences locale={locale} />
          <Hospitals locale={locale} />
          <Patients locale={locale} />
          <ConnectedMap locale={locale} />
          <Trust locale={locale} />
          <Contact locale={locale} />
        </main>
        <Footer locale={locale} />
      </div>
    </MotionProvider>
  );
}
