'use client';

import { AnimatePresence, m } from 'framer-motion';
import { useState } from 'react';

import { contactEmail, copy, demoHref } from '@/content/copy';

import { Parallax } from '../Cinema';
import { Icon } from '../icons';
import { Reveal } from '../motion';
import { Photo, PhotoCredit } from '../Photo';

import type { Locale } from '@/content/copy';
import type { ReactNode } from 'react';

/** The invitation, over the Buriganga at dusk: a private demonstration, by email (S-C-05). */
export function Contact({ locale }: { readonly locale: Locale }): ReactNode {
  const t = copy[locale];
  const [copied, setCopied] = useState(false);
  const copyAddress = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(contactEmail);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 2200);
    } catch {
      // The browser refused the clipboard; the address stays on screen to select.
    }
  };
  return (
    <section className="contact-section" id="contact" aria-labelledby="contact-heading">
      <Parallax className="contact-photo" distance={60} zoom={0.1}>
        <Photo name="buriganga" alt={t.contactAlt} sizes="100vw" position="50% 60%" />
      </Parallax>
      <i className="contact-shade" aria-hidden="true" />
      <PhotoCredit name="buriganga" label={t.photoCredit} />
      <div className="shell section-space contact-grid">
        <Reveal className="contact-copy">
          <p className="eyebrow">{t.contactLabel}</p>
          <h2 id="contact-heading">{t.contactTitle}</h2>
          <p>{t.contactBody}</p>
          <a className="button button-light button-large" href={demoHref}>
            {t.demo}
            <Icon name="diagonal" className="arrow" />
          </a>
        </Reveal>
        <Reveal className="contact-card" delay={0.12}>
          <span className="contact-card-label">
            <Icon name="mail" />
            {t.emailLabel}
          </span>
          <a className="contact-email" href={`mailto:${contactEmail}`}>
            {contactEmail}
          </a>
          <button
            type="button"
            className="copy-button"
            onClick={() => {
              void copyAddress();
            }}
          >
            <Icon name={copied ? 'check' : 'copy'} />
            <AnimatePresence mode="wait" initial={false}>
              <m.span
                key={copied ? 'copied' : 'copy'}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
              >
                {copied ? t.copied : t.copy}
              </m.span>
            </AnimatePresence>
          </button>
          <span className="sr-only" aria-live="polite">
            {copied ? t.copied : ''}
          </span>
          <p>{t.contactNote}</p>
        </Reveal>
      </div>
    </section>
  );
}
