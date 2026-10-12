'use client';

import { m, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';

import { copy } from '@/content/copy';

import { Parallax, ScrollEcg } from '../Cinema';
import { Icon } from '../icons';
import { RevealItem, RevealList } from '../motion';
import { Photo, PhotoCredit } from '../Photo';

import type { IconName } from '../icons';
import type { Locale } from '@/content/copy';
import type { MotionValue } from 'framer-motion';
import type { ReactNode } from 'react';

const PILLAR_ICONS: readonly IconName[] = ['people', 'eye', 'phone'];

/** One word of the statement, lit as the reader's scroll reaches it. */
function Word({
  word,
  index,
  count,
  progress,
}: {
  readonly word: string;
  readonly index: number;
  readonly count: number;
  readonly progress: MotionValue<number>;
}): ReactNode {
  const start = index / count;
  const opacity = useTransform(progress, [start, start + 1.5 / count], [0.16, 1]);
  return (
    <>
      <m.span style={{ opacity }}>{word}</m.span>{' '}
    </>
  );
}

/** Why MedLiveBD exists, said once, and the city it begins in (S-C-02). */
export function Vision({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  const statement = useRef<HTMLParagraphElement>(null);
  const reduced = useReducedMotion() ?? false;
  const { scrollYProgress } = useScroll({ target: statement, offset: ['start 85%', 'end 45%'] });
  const words = t.vision.split(' ');
  return (
    <section className="vision" id="vision" aria-labelledby="vision-heading">
      <div className="shell">
        <h2 id="vision-heading" className="eyebrow">
          {t.visionLabel}
        </h2>
        <p className="vision-statement" ref={statement}>
          {reduced
            ? t.vision
            : words.map((word, index) => (
                <Word
                  // Words repeat; their place in the sentence does not.
                  key={`${word}-${String(index)}`}
                  word={word}
                  index={index}
                  count={words.length}
                  progress={scrollYProgress}
                />
              ))}
        </p>
      </div>
      <ScrollEcg className="vision-ecg" beats={5} />
      <div className="vision-band">
        <Parallax className="vision-photo" distance={70} zoom={0.12}>
          <Photo name="dhaka" alt={t.visionAlt} sizes="(max-width: 1440px) 100vw, 1440px" />
        </Parallax>
        <i className="vision-shade" aria-hidden="true" />
        <span className="vision-place" aria-hidden="true">
          <Icon name="map" />
          {t.visionPlace}
        </span>
        <PhotoCredit name="dhaka" label={t.photoCredit} />
        <RevealList className="pillars">
          {t.pillars.map((pillar, index) => (
            <RevealItem key={pillar.title} className="pillar">
              <span className="pillar-icon" aria-hidden="true">
                <Icon name={PILLAR_ICONS[index] ?? 'check'} />
              </span>
              <h3>{pillar.title}</h3>
              <p>{pillar.body}</p>
            </RevealItem>
          ))}
        </RevealList>
      </div>
    </section>
  );
}
