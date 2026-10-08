/**
 * `<Monogram>`: a doctor's letter avatar (FRONTEND.md §0.5).
 *
 * The approved design shows a doctor by the first letter of their name on the
 * tint, never by a photograph: the network holds no photographs of its
 * doctors, and a stock face standing in for a real person is a claim this
 * product does not make (`CLAUDE.md` §8). The first *grapheme*, not the first
 * code unit, so a Bangla name keeps its vowel sign or conjunct whole.
 */

import type { ReactNode } from 'react';

function firstGrapheme(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') return '';
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const first = segmenter.segment(trimmed)[Symbol.iterator]().next().value;
  return (first?.segment ?? trimmed.charAt(0)).toLocaleUpperCase();
}

const SIZE = {
  sm: 'size-10 text-title-sm',
  md: 'size-12 text-title-md',
  lg: 'size-[60px] text-title-lg',
} as const;

export function Monogram({
  name,
  size = 'md',
}: {
  readonly name: string;
  readonly size?: keyof typeof SIZE;
}): ReactNode {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-pill bg-brand-100 font-bold text-brand-700 ${SIZE[size]}`}
    >
      {firstGrapheme(name)}
    </span>
  );
}
