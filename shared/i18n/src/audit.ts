/**
 * What was done to an organisation, as a sentence (`PRD.md` `FR-ONB-07`,
 * `FR-SUP-06`; `S-B-12`; plan G2).
 *
 * One name for each code in `@platform/domain`'s `AUDIT_CHANGES`. This
 * package does not depend on that one, so the two lists are held together by
 * a test where both are in reach (`platformHealth.routes.test.ts`): a code
 * without a name, or a name without a code, fails there. A code this version
 * does not know (written by a newer server, or by hand) is said as a change
 * without a name, never left blank and never shown as its code.
 */

import type { Locale, Message } from './messages.js';

export const AUDIT_CHANGE_NAMES = {
  profile: { bn: 'হাসপাতালের পরিচিতি বদলানো হয়েছে', en: 'Hospital profile changed' },
  publishing: {
    bn: 'নেটওয়ার্কে কোন তথ্য দেখানো হবে তা বদলানো হয়েছে',
    en: 'What is shared with the network changed',
  },
  brand: { bn: 'পোর্টালের রং বদলানো হয়েছে', en: 'Portal colours changed' },
  brand_cleared: { bn: 'পোর্টালের নিজস্ব রং সরানো হয়েছে', en: 'Portal colours removed' },
  logo: { bn: 'লোগো বদলানো হয়েছে', en: 'Logo changed' },
  logo_removed: { bn: 'লোগো সরানো হয়েছে', en: 'Logo removed' },
  queue_rules: { bn: 'সিরিয়ালের নিয়ম বদলানো হয়েছে', en: 'Queue rules changed' },
  department_added: { bn: 'বিভাগ যোগ করা হয়েছে', en: 'Department added' },
  department_changed: { bn: 'বিভাগ বদলানো হয়েছে', en: 'Department changed' },
  department_removed: { bn: 'বিভাগ সরানো হয়েছে', en: 'Department removed' },
  doctor_added: { bn: 'ডাক্তার যোগ করা হয়েছে', en: 'Doctor added' },
  doctor_changed: { bn: 'ডাক্তারের তথ্য বদলানো হয়েছে', en: 'Doctor’s details changed' },
  schedule_added: { bn: 'চেম্বারের সময়সূচি যোগ করা হয়েছে', en: 'Chamber schedule added' },
  schedule_removed: { bn: 'চেম্বারের সময়সূচি সরানো হয়েছে', en: 'Chamber schedule removed' },
  ward_added: { bn: 'ওয়ার্ড যোগ করা হয়েছে', en: 'Ward added' },
  ward_changed: { bn: 'ওয়ার্ড বদলানো হয়েছে', en: 'Ward changed' },
  ward_removed: { bn: 'ওয়ার্ড সরানো হয়েছে', en: 'Ward removed' },
  beds_added: { bn: 'বেড যোগ করা হয়েছে', en: 'Beds added' },
  bed_changed: { bn: 'বেডের তথ্য বদলানো হয়েছে', en: 'Bed changed' },
  bed_removed: { bn: 'বেড সরানো হয়েছে', en: 'Bed removed' },
  staff_added: { bn: 'কর্মী যোগ করা হয়েছে', en: 'Staff member added' },
  staff_changed: { bn: 'কর্মীর তথ্য বা দায়িত্ব বদলানো হয়েছে', en: 'Staff member changed' },
  password_reset: { bn: 'কর্মীর পাসওয়ার্ড নতুন করে দেওয়া হয়েছে', en: 'Staff password reset' },
  two_factor_reset: {
    bn: 'কর্মীর দুই ধাপের যাচাই নতুন করে চালু করতে বলা হয়েছে',
    en: 'Staff two-step verification reset',
  },
  two_factor_reset_from_server: {
    bn: 'সার্ভার থেকে দুই ধাপের যাচাই নতুন করে চালু করতে বলা হয়েছে',
    en: 'Two-step verification reset from the server',
  },
  two_factor_enabled: { bn: 'দুই ধাপের যাচাই চালু করা হয়েছে', en: 'Two-step verification set up' },
  capabilities_declared: {
    bn: 'জরুরি সেবার ঘোষণা হালনাগাদ করা হয়েছে',
    en: 'Emergency services declared',
  },
  review_requested: { bn: 'পর্যালোচনার অনুরোধ করা হয়েছে', en: 'Review requested' },
  workspace_created: { bn: 'হাসপাতালটি যোগ করা হয়েছে', en: 'Workspace created' },
  workspace_applied: { bn: 'হাসপাতাল নিজে আবেদন করেছে', en: 'Hospital applied' },
  workspace_approve: { bn: 'অনুমোদন করে লাইভ করা হয়েছে', en: 'Approved and made live' },
  workspace_send_back: { bn: 'সংশোধনের জন্য ফেরত পাঠানো হয়েছে', en: 'Sent back for changes' },
  workspace_suspend: { bn: 'স্থগিত করা হয়েছে', en: 'Suspended' },
  workspace_reinstate: { bn: 'আবার চালু করা হয়েছে', en: 'Reinstated' },
  workspace_close: { bn: 'স্থায়ীভাবে বন্ধ করা হয়েছে', en: 'Closed' },
  doctor_verified: { bn: 'ডাক্তারের বিএমডিসি যাচাই করা হয়েছে', en: 'Doctor’s BMDC verified' },
  modules: { bn: 'মডিউল বদলানো হয়েছে', en: 'Modules changed' },
  portal_domain: { bn: 'পোর্টালের নিজস্ব ডোমেইন লেখা হয়েছে', en: 'Portal domain recorded' },
  portal_domain_removed: {
    bn: 'পোর্টালের নিজস্ব ডোমেইন সরানো হয়েছে',
    en: 'Portal domain removed',
  },
  agreement_trial: { bn: 'চুক্তির অবস্থা: পরীক্ষামূলক', en: 'Agreement set to trial' },
  agreement_active: { bn: 'চুক্তির অবস্থা: সক্রিয়', en: 'Agreement set to active' },
  agreement_overdue: { bn: 'চুক্তির অবস্থা: বকেয়া', en: 'Agreement set to overdue' },
  agreement_ended: { bn: 'চুক্তির অবস্থা: শেষ হয়েছে', en: 'Agreement set to ended' },
  import_checked: { bn: 'আমদানির ফাইল পরীক্ষা করা হয়েছে', en: 'Import file checked' },
  import_committed: { bn: 'তথ্য আমদানি করা হয়েছে', en: 'Data imported' },
  import_undone: { bn: 'আমদানি ফিরিয়ে নেওয়া হয়েছে', en: 'Import undone' },
  import_discarded: { bn: 'আমদানির ফাইল বাতিল করা হয়েছে', en: 'Import file discarded' },
  export: { bn: 'প্রতিবেদন ডাউনলোড করা হয়েছে', en: 'Report exported' },
} as const satisfies Record<string, Message>;

/** A change whose code this version has no name for. */
export const AUDIT_CHANGE_UNNAMED: Message = {
  bn: 'একটি পরিবর্তন করা হয়েছে',
  en: 'A change was made',
};

export function auditChangeName(change: string, locale: Locale): string {
  const named = (AUDIT_CHANGE_NAMES as Record<string, Message | undefined>)[change];
  return (named ?? AUDIT_CHANGE_UNNAMED)[locale];
}
