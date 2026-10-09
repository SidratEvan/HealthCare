/**
 * A doctor's name as the patient app shows it: "ডা. আয়েশা সিদ্দিকা".
 *
 * The approved design titles every doctor (FRONTEND.md §0.5). A name a
 * hospital typed may already carry the title ("ডা. আমদানি", "Dr Imported"),
 * and a title said twice reads as a mistake, so it is added only where it is
 * not there already.
 */

import { localName, tp, type Locale } from '@platform/i18n';

const ALREADY_TITLED = /^(ডা\.|ডাঃ|ডাক্তার\s|dr\.?\s|prof\.?\s|অধ্যাপক\s)/iu;

export function doctorName(
  locale: Locale,
  nameBn: string,
  nameEn: string | null | undefined,
): string {
  const name = localName(locale, nameBn, nameEn).trim();
  return ALREADY_TITLED.test(name) ? name : tp('doctorTitled', locale).replace('{name}', name);
}
