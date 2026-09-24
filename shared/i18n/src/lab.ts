/**
 * What each test in the demo catalogue is called (`BTN-B05-TEST`, `FR-LAB-01`).
 *
 * Keyed by test code, the thing a `test_orders` row keeps beside its name,
 * so an order can be named in either language whenever it is read. The row
 * itself stores the Bangla name it was ordered under (`lab.service`), which
 * stays the record of what was ordered; this is how the same order reads on
 * a screen switched to English.
 *
 * Codes the table does not know — a test ordered by free-text name — are
 * shown as stored, in whatever language they were typed in.
 */

import type { Locale, Message } from './messages.js';

export const LAB_TEST_NAMES = {
  CBC: { bn: 'সম্পূর্ণ রক্ত পরীক্ষা (CBC)', en: 'Complete blood count (CBC)' },
  'BLOOD-SUGAR': { bn: 'রক্তে শর্করা (FBS)', en: 'Blood sugar (FBS)' },
  'LIPID-PROFILE': { bn: 'লিপিড প্রোফাইল', en: 'Lipid profile' },
  'SERUM-CREATININE': { bn: 'সিরাম ক্রিয়েটিনিন', en: 'Serum creatinine' },
  LFT: { bn: 'লিভার ফাংশন টেস্ট', en: 'Liver function test' },
  TSH: { bn: 'থাইরয়েড (TSH)', en: 'Thyroid (TSH)' },
  'URINE-RE': { bn: 'প্রস্রাব পরীক্ষা (R/E)', en: 'Urine test (R/E)' },
  'XR-CHEST': { bn: 'বুকের এক্স-রে', en: 'Chest X-ray' },
  ECG: { bn: 'ইসিজি', en: 'ECG' },
  ECHO: { bn: 'ইকোকার্ডিওগ্রাম', en: 'Echocardiogram' },
  'USG-ABDOMEN': { bn: 'পেটের আলট্রাসনোগ্রাম', en: 'Abdominal ultrasound' },
  HBA1C: { bn: 'HbA1c', en: 'HbA1c' },
} as const satisfies Record<string, Message>;

export type LabTestCode = keyof typeof LAB_TEST_NAMES;

export function isLabTestCode(code: string): code is LabTestCode {
  return Object.hasOwn(LAB_TEST_NAMES, code);
}

/** A test's name in the language being read, or the stored name if unknown. */
export function labTestName(code: string, locale: Locale, stored: string): string {
  return isLabTestCode(code) ? LAB_TEST_NAMES[code][locale] : stored;
}
