import { describe, expect, it } from 'vitest';

import {
  assignedDesks,
  deskChambers,
  workspaceRoles,
  workspaceView,
  workspaceRouteAllowed,
} from '../workspaces.js';

const chambers = [
  { id: 'a1', hospitalId: 'hospital-a', doctorId: 'doctor-a', status: 'running' },
  { id: 'a2', hospitalId: 'hospital-a', doctorId: 'doctor-b', status: 'scheduled' },
];
const desks = [
  { id: 'd1', doctorIds: ['doctor-a'], staffIds: ['staff-a'] },
  { id: 'd2', doctorIds: ['doctor-b'], staffIds: ['staff-a'] },
  { id: 'other', doctorIds: ['doctor-a'], staffIds: ['staff-b'] },
];
const access = {
  roles: ['receptionist'],
  hospitalId: 'hospital-a',
  modulesOff: [],
  chambers,
  view: null,
  sessionId: 'a1',
  selectedRole: 'receptionist',
};

describe('server-confirmed workspace presentation', () => {
  it.each(['ward', 'emergency', 'lab', 'pharmacy', 'hospital_admin'])(
    '%s has a facility destination without a guessed chamber',
    (role) => {
      expect(workspaceRoles([role], 'hospital-a', [])).toEqual([role]);
      expect(workspaceView(role, [])).not.toBeNull();
    },
  );
  it('keeps multiple roles explicit and unknown roles out', () => {
    expect(workspaceRoles(['doctor', 'receptionist', 'unknown'], 'hospital-a', [])).toEqual([
      'receptionist',
      'doctor',
    ]);
    expect(workspaceRoles([], 'hospital-a', [])).toEqual([]);
  });
  it('national roles never become hospital roles and never require chamber data', () => {
    expect(workspaceRoles(['platform_admin', 'gov_viewer', 'doctor'], null, [])).toEqual([
      'platform_admin',
      'gov_viewer',
    ]);
    expect(workspaceRoles(['platform_admin', 'gov_viewer'], 'hospital-a', [])).toEqual([]);
    expect(workspaceView('platform_admin', [])).toBe('platform');
  });
  it('module-off choices do not grant access and admin settings remain supported', () => {
    expect(workspaceRoles(['lab', 'hospital_admin'], 'hospital-a', ['lab', 'dashboard'])).toEqual([
      'hospital_admin',
    ]);
    expect(workspaceView('hospital_admin', ['dashboard'])).toBe('settings');
    expect(
      workspaceRouteAllowed({
        ...access,
        roles: ['hospital_admin'],
        view: 'admin',
        sessionId: null,
        modulesOff: ['dashboard'],
      }),
    ).toBe(false);
  });
  it('only own desk memberships are shown; a removed desk is not remembered access', () => {
    expect(assignedDesks(desks, 'staff-a').map((desk) => desk.id)).toEqual(['d1', 'd2']);
    expect(deskChambers(chambers, desks, 'staff-a', 'other')).toEqual([]);
    expect(deskChambers(chambers, [], 'staff-a', 'd1')).toEqual([]);
    expect(deskChambers(chambers, desks, 'staff-a', 'd1').map((chamber) => chamber.id)).toEqual([
      'a1',
    ]);
  });
  it('no assigned desk retains V1 common-workspace capability, not a fabricated denial', () => {
    expect(assignedDesks(desks, 'unassigned')).toEqual([]);
    expect(deskChambers(chambers, desks, 'unassigned', null)).toEqual(chambers);
  });
  it('direct URLs require actual roles, own hospital and current chamber scope', () => {
    expect(workspaceRouteAllowed(access)).toBe(true);
    expect(workspaceRouteAllowed({ ...access, view: 'admin', sessionId: null })).toBe(false);
    expect(workspaceRouteAllowed({ ...access, roles: [] })).toBe(false);
    expect(workspaceRouteAllowed({ ...access, hospitalId: 'hospital-b' })).toBe(false);
    expect(workspaceRouteAllowed({ ...access, chambers: [] })).toBe(false);
    expect(
      workspaceRouteAllowed({ ...access, chambers: [{ ...chambers[0], status: 'ended' }] }),
    ).toBe(false);
  });
  it('doctor selection uses a doctor role and a server-listed chamber, not staff name/email', () => {
    expect(workspaceView('doctor', [])).toBeNull();
    expect(workspaceRouteAllowed({ ...access, roles: ['doctor'], selectedRole: 'doctor' })).toBe(
      true,
    );
    expect(
      workspaceRouteAllowed({ ...access, roles: ['doctor'], selectedRole: 'receptionist' }),
    ).toBe(false);
  });
});
