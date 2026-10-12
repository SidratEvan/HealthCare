'use client';

import { m, useScroll, useTransform } from 'framer-motion';

import { copy } from '@/content/copy';

import { CampaignImage } from '../CampaignImage';
import { AudienceDoors } from '../links';
import { useCinema } from '../scroll';

import type { Locale } from '@/content/copy';
import type { ReactNode } from 'react';

/**
 * The opening (S-C-01): one photograph, the headline, and the two audience
 * doors in the first screen on every device. The entrance is CSS, so it runs
 * before any script; on large screens the photograph then eases back as the
 * page scrolls away.
 */
export function Hero({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  const cinema = useCinema();
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 900], ['0%', '12%']);
  const scale = useTransform(scrollY, [0, 900], [1, 1.05]);
  return (
    <section className="hero" aria-labelledby="hero-title">
      <m.div className="hero-media" style={cinema ? { y, scale } : {}}>
        <CampaignImage name="hero" alt={t.hero.alt} priority sizes="100vw" />
      </m.div>
      <div className="hero-shade" aria-hidden="true" />
      <div className="shell hero-inner">
        <div className="hero-copy">
          <h1 id="hero-title" className="display-xl hero-title">
            {t.hero.title.map((part) => (
              <span key={part.text} className={part.accent ? 'accent' : undefined}>
                {part.text}
              </span>
            ))}
          </h1>
          <p className="hero-lead">{t.hero.lead}</p>
          <AudienceDoors locale={locale} className="hero-doors" />
          <p className="hero-note">{t.demoNotice}</p>
        </div>
      </div>
    </section>
  );
}
