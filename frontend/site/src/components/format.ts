import type { Locale } from '@/content/copy';

/** A whole number in the page's own numerals: Bengali digits in Bangla (GR-06). */
export function fmt(value: number, locale: Locale): string {
  return value.toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-US', { useGrouping: false });
}

/** A two-place ordinal for step markers: 01 / ০১. */
export function ordinal(value: number, locale: Locale): string {
  return fmt(value, locale).padStart(2, locale === 'bn' ? '০' : '0');
}
