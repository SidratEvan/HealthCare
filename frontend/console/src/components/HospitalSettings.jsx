'use client';

/** Legacy S-B-11 links enter the integrated Administration workspace (FR-ADM-11). */
import { AdminDashboard } from '@/components/AdminDashboard';
export { MODULE_KEY } from '@/components/AdminManagementPanels';
export function HospitalSettings() {
  return <AdminDashboard legacySettings />;
}
