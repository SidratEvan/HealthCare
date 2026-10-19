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
];
export function workspaceRoles(roles, hospitalId, off) {
  return WORKSPACE_ROLES.filter((role) => {
    const national = role === 'platform_admin' || role === 'gov_viewer';
    if (national !== (hospitalId === null) || !roles.includes(role)) return false;
    const module = MODULE_OF_ROLE[role];
    return (
      (module == null || !off.includes(module)) && (role !== 'doctor' || !off.includes('queue'))
    );
  });
}
export function workspaceView(role, off) {
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
export function workspaceRoleFor(view, sessionId, selectedRole) {
  if (view === null && sessionId !== null)
    return selectedRole === 'doctor'
      ? 'doctor'
      : selectedRole === 'receptionist'
        ? 'receptionist'
        : null;
  const byView = {
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
export function assignedDesks(desks, staffId) {
  return desks.filter((desk) => desk.staffIds.includes(staffId));
}
export function deskChambers(chambers, desks, staffId, deskId) {
  if (deskId === null) return [...chambers]; // V1's no-assigned-desk common workspace.
  const desk = assignedDesks(desks, staffId).find((candidate) => candidate.id === deskId);
  return desk === undefined
    ? []
    : chambers.filter((chamber) => desk.doctorIds.includes(chamber.doctorId));
}
export function workspaceRouteAllowed(input) {
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
