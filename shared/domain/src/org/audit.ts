/**
 * What can be in an organisation's trail of changes (`PRD.md` `FR-ONB-07`,
 * `FR-SUP-06`; `S-B-12`; plan G2).
 *
 * The trail a platform administrator reads on a workspace is what was done
 * *to the organisation*: its settings, its staff, its workspace's state, its
 * imports and exports. It is never what was done for a patient: a record
 * opened and a queue action are audited too, with the patient they concern,
 * and neither is in this list or in what the platform is sent (`FR-ONB-08`).
 *
 * Every code a service writes as a `SETTINGS_CHANGE` is here, with the four
 * things an import does and an export. `@platform/i18n` names each in both
 * languages, by this type, so a code added here without a name does not
 * compile; a test in the API reads the services and fails on a code written
 * there and missing here.
 */

export const AUDIT_CHANGES = [
  // The hospital's own settings (`S-B-11`).
  'profile',
  'publishing',
  'brand',
  'brand_cleared',
  'logo',
  'logo_removed',
  'queue_rules',
  'department_added',
  'department_changed',
  'department_removed',
  'doctor_added',
  'doctor_changed',
  'schedule_added',
  'schedule_removed',
  'ward_added',
  'ward_changed',
  'ward_removed',
  'beds_added',
  'bed_changed',
  'bed_removed',
  'staff_added',
  'staff_changed',
  'password_reset',
  'two_factor_reset',
  'two_factor_reset_from_server',
  'two_factor_enabled',
  'capabilities_declared',
  'review_requested',
  // The platform's acts on the workspace (`S-B-12`).
  'workspace_created',
  'workspace_applied',
  'workspace_approve',
  'workspace_send_back',
  'workspace_suspend',
  'workspace_reinstate',
  'workspace_close',
  'doctor_verified',
  'modules',
  'portal_domain',
  'portal_domain_removed',
  'agreement_trial',
  'agreement_active',
  'agreement_overdue',
  'agreement_ended',
  // Imports and exports (`S-B-14`, `FR-ADM-10`).
  'import_checked',
  'import_committed',
  'import_undone',
  'import_discarded',
  'export',
] as const;

export type AuditChange = (typeof AUDIT_CHANGES)[number];

/** A code this version knows; anything else is shown as a change without a name. */
export function isAuditChange(value: string): value is AuditChange {
  return (AUDIT_CHANGES as readonly string[]).includes(value);
}
