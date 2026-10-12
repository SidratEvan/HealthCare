import { copy } from '@/content/copy';

import {
  HumanHero,
  Connection,
  AudienceStage,
  BangladeshScene,
  Responsibility,
  ClosingInvitation,
} from './CinematicStory';
import { Footer } from './Footer';
import { Header } from './Header';
import { MotionProvider } from './motion';

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
      <div className="company-page cinematic-page" lang={locale} id="top">
        <a className="skip-link" href="#main">
          {t.skip}
        </a>
        <Header locale={locale} />
        <main id="main">
          <HumanHero locale={locale} />
          <Connection locale={locale} />
          <AudienceStage locale={locale} />
          <BangladeshScene locale={locale} />
          <Responsibility locale={locale} />
          <ClosingInvitation locale={locale} />
        </main>
        <Footer locale={locale} />
      </div>
    </MotionProvider>
  );
}
