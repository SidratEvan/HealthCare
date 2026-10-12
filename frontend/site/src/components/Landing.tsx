import { copy } from '@/content/copy';

import { Footer } from './Footer';
import { Header } from './Header';
import { MotionProvider } from './motion';
import { Capabilities } from './sections/Capabilities';
import { Contact } from './sections/Contact';
import { Faq } from './sections/Faq';
import { Hero } from './sections/Hero';
import { HowItWorks } from './sections/HowItWorks';
import { Modules } from './sections/Modules';
import { Network } from './sections/Network';
import { Patients } from './sections/Patients';
import { Problem } from './sections/Problem';
import { Showcase } from './sections/Showcase';
import { Start } from './sections/Start';
import { Trust } from './sections/Trust';

import type { Locale } from '@/content/copy';
import type { ReactNode } from 'react';

/**
 * The company page (S-C-01–05). Its order is an argument: the product working
 * (hero), why live matters, how it works, the real screens, what each team
 * gets, the patient's side, the network, trust, how a hospital starts, the
 * questions, and the ask.
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
          <Modules locale={locale} />
          <Problem locale={locale} />
          <HowItWorks locale={locale} />
          <Showcase locale={locale} />
          <Capabilities locale={locale} />
          <Patients locale={locale} />
          <Network locale={locale} />
          <Trust locale={locale} />
          <Start locale={locale} />
          <Faq locale={locale} />
          <Contact locale={locale} />
        </main>
        <Footer locale={locale} />
      </div>
    </MotionProvider>
  );
}
