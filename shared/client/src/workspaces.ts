/** Staff entry presentation over server-confirmed assignments (FR-ROLE-01,
 * FR-REC-32). These helpers never grant API access or infer doctor identity.
 */
import { MODULE_OF_ROLE } from '@platform/domain';

export const WORKSPACE_ROLES = [
  'receptionist',
  'doctor',
  'ward',
  'emergency',
  'lab',
  'pharmacy',
  'hospital_admin',
  'platform_admin',
  'gov_viewer',
] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
export interface WorkspaceDesk {
  readonly id: string;
  readonly doctorIds: readonly string[];
  readonly staffIds: readonly string[];
}
export interface WorkspaceChamber {
  readonly id: string;
  readonly hospitalId: string;
  readonly doctorId: string;
  readonly status: string;
}
export function workspaceRoles(
  roles: readonly string[],
  hospitalId: string | null,
  off: readonly string[],
): WorkspaceRole[] {
  return WORKSPACE_ROLES.filter((role) => {
    const national = role === 'platform_admin' || role === 'gov_viewer';
    if (national !== (hospitalId === null) || !roles.includes(role)) return false;
    const module = MODULE_OF_ROLE[role];
    return (
      (module == null || !off.includes(module)) && (role !== 'doctor' || !off.includes('queue'))
    );
  });
}
export function workspaceView(role: WorkspaceRole, off: readonly string[]): string | null {
  switch (role) {
    case 'receptionist':
      return 'reception';
    case 'doctor':
      return null;
    case 'emergency':
      return 'er';
    case 'hospital_admin':
      return off.includes('dashboard') ? 'settings' : 'admin';
    case 'platform_admin':
      return 'platform';
    case 'gov_viewer':
      return 'gov';
    case 'ward':
    case 'lab':
    case 'pharmacy':
      return role;
  }
}
export function workspaceRoleFor(
  view: string | null,
  sessionId: string | null,
  selectedRole: string,
): WorkspaceRole | null {
  if (view === null && sessionId !== null)
    return selectedRole === 'doctor'
      ? 'doctor'
      : selectedRole === 'receptionist'
        ? 'receptionist'
        : null;
  const byView: Readonly<Record<string, WorkspaceRole>> = {
    reception: 'receptionist',
    ward: 'ward',
    er: 'emergency',
    lab: 'lab',
    pharmacy: 'pharmacy',
    admin: 'hospital_admin',
    settings: 'hospital_admin',
    imports: 'hospital_admin',
    registration: 'receptionist',
    platform: 'platform_admin',
    gov: 'gov_viewer',
  };
  return view === null ? null : (byView[view] ?? null);
}
export function assignedDesks<T extends WorkspaceDesk>(desks: readonly T[], staffId: string): T[] {
  return desks.filter((desk) => desk.staffIds.includes(staffId));
}
export function deskChambers<T extends WorkspaceChamber>(
  chambers: readonly T[],
  desks: readonly WorkspaceDesk[],
  staffId: string,
  deskId: string | null,
): T[] {
  if (deskId === null) return [...chambers]; // V1's no-assigned-desk common workspace.
  const desk = assignedDesks(desks, staffId).find((candidate) => candidate.id === deskId);
  return desk === undefined
    ? []
    : chambers.filter((chamber) => desk.doctorIds.includes(chamber.doctorId));
}
export function workspaceRouteAllowed(input: {
  readonly roles: readonly string[];
  readonly hospitalId: string | null;
  readonly modulesOff: readonly string[];
  readonly chambers: readonly WorkspaceChamber[];
  readonly view: string | null;
  readonly sessionId: string | null;
  readonly selectedRole: string;
}): boolean {
  const role = workspaceRoleFor(input.view, input.sessionId, input.selectedRole);
  if (
    role === null ||
    !workspaceRoles(input.roles, input.hospitalId, input.modulesOff).includes(role)
  )
    return false;
  if (input.sessionId !== null && input.view === null)
    return input.chambers.some(
      (chamber) =>
        chamber.id === input.sessionId &&
        chamber.hospitalId === input.hospitalId &&
        chamber.status !== 'ended' &&
        chamber.status !== 'cancelled',
    );
  if (input.view === 'admin' && input.modulesOff.includes('dashboard')) return false;
  if (input.view === 'imports' && input.modulesOff.includes('import')) return false;
  return true;
}
