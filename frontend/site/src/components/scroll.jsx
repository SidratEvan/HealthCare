'use client';

import { m, useScroll, useTransform } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

import { CampaignImage } from './CampaignImage';

/*
 * Motion ownership (GR-06). Scroll-linked motion maps a section's own scroll
 * progress straight onto transform or opacity: no springs (nothing trails the
 * visitor's hand), no React state per frame, no scroll hijacking. Framer
 * Motion is the only engine; nothing else writes these transforms. The server
 * HTML is the finished, still page: motion is switched on after hydration, and
 * only where it is welcome.
 */
function useMediaQuery(query) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => {
      setMatches(list.matches);
    };
    update();
    list.addEventListener('change', update);
    return () => {
      list.removeEventListener('change', update);
    };
  }, [query]);
  return matches;
}

/** Scroll-linked motion of any kind: never when the visitor asks for less. */
export const useMotionWelcome = () => useMediaQuery('(prefers-reduced-motion: no-preference)');

/** Photograph drift and the pinned map: large screens only, where it reads as a camera. */
export const useCinema = () =>
  useMediaQuery(
    '(min-width: 1024px) and (min-height: 640px) and (prefers-reduced-motion: no-preference)',
  );

/**
 * A photograph that drifts a little slower than the page while it passes:
 * the frame stays put, the picture inside moves, so nothing is ever cropped
 * past its art direction.
 */
export function DriftImage({ name, alt, sizes, className = '', priority = false }) {
  const frame = useRef(null);
  const cinema = useCinema();
  const { scrollYProgress } = useScroll({ target: frame, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], ['-5%', '5%']);
  return (
    <div className={`drift-frame ${className}`} ref={frame}>
      <m.div className="drift-inner" style={cinema ? { y } : {}}>
        <CampaignImage name={name} alt={alt} sizes={sizes} priority={priority} />
      </m.div>
    </div>
  );
}
