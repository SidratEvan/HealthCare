/**
 * The modules a hospital runs (`FR-BRD-11`, `FR-SUP-03`; plan C4).
 *
 * `moduleRoutes.test.ts` in the API holds the route table against the routes
 * the server mounts. This is the part that needs no server.
 */

import { describe, expect, it } from 'vitest';

import {
  HOSPITAL_MODULES,
  MODULE_OF_ROLE,
  MODULE_ROUTES,
  isHospitalModule,
  moduleOn,
  modulesBody,
  modulesOfRequest,
  modulesProblems,
} from '../modules.js';

describe('the modules there are', () => {
  it('are the eight the requirement names', () => {
    expect([...HOSPITAL_MODULES].sort()).toEqual(
      ['beds', 'dashboard', 'doctor', 'emergency', 'import', 'lab', 'pharmacy', 'queue'].sort(),
    );
  });

  it('every console role but the administrator’s is one module’s', () => {
    expect(MODULE_OF_ROLE).toMatchObject({
      receptionist: 'queue',
      doctor: 'doctor',
      ward: 'beds',
      emergency: 'emergency',
      lab: 'lab',
      pharmacy: 'pharmacy',
      hospital_admin: null,
    });
  });

  it('a name is a module or it is not', () => {
    expect(isHospitalModule('beds')).toBe(true);
    expect(isHospitalModule('billing')).toBe(false);
  });
});

describe('what is on', () => {
  it('is everything that is not off', () => {
    expect(moduleOn([], 'beds')).toBe(true);
    expect(moduleOn(['beds'], 'beds')).toBe(false);
    expect(moduleOn(['beds'], 'lab')).toBe(true);
  });

  it('the doctor’s console is never on where serials are off', () => {
    expect(modulesProblems(['queue'])).toEqual(['doctor_needs_queue']);
    expect(modulesProblems(['queue', 'doctor'])).toEqual([]);
    expect(modulesProblems(['doctor'])).toEqual([]);
    expect(modulesProblems([])).toEqual([]);
    expect(modulesProblems([...HOSPITAL_MODULES])).toEqual([]);
  });

  it('a body is the modules that are off, each once, and nothing else', () => {
    expect(modulesBody.safeParse({ off: [] }).success).toBe(true);
    expect(modulesBody.safeParse({ off: ['beds', 'lab'] }).success).toBe(true);
    expect(modulesBody.safeParse({ off: ['beds', 'beds'] }).success).toBe(false);
    expect(modulesBody.safeParse({ off: ['billing'] }).success).toBe(false);
    expect(modulesBody.safeParse({ off: ['beds'], on: ['lab'] }).success).toBe(false);
    expect(modulesBody.safeParse({}).success).toBe(false);
  });
});

describe('which module a staff request belongs to', () => {
  it('every route in the table names modules there are', () => {
    for (const [key, modules] of Object.entries(MODULE_ROUTES)) {
      expect(modules.length, key).toBeGreaterThan(0);
      for (const module of modules) expect(isHospitalModule(module), key).toBe(true);
      expect(key, key).toMatch(/^(GET|POST|PUT|PATCH|DELETE) \/[a-zA-Z0-9/:_-]+$/);
    }
  });

  it('every module has at least one route, so none can be switched off to no effect', () => {
    const used = new Set(Object.values(MODULE_ROUTES).flat());
    expect([...used].sort()).toEqual([...HOSPITAL_MODULES].sort());
  });

  it('is read from the method and the path', () => {
    const id = '0190a1b2-0000-7000-8000-000000000001';
    expect(modulesOfRequest('POST', `/sessions/${id}/next`)).toEqual(['queue']);
    expect(modulesOfRequest('post', `/beds/${id}/admit`)).toEqual(['beds']);
    expect(modulesOfRequest('GET', `/hospitals/${id}/emergency`)).toEqual(['emergency']);
    expect(modulesOfRequest('GET', '/admin/dashboard')).toEqual(['dashboard']);
    expect(modulesOfRequest('GET', '/admin/dashboard/')).toEqual(['dashboard']);
    // A doctor ordering a test needs a doctor's console and a lab.
    expect(modulesOfRequest('POST', '/test-orders')).toEqual(['doctor', 'lab']);
  });

  it('a literal segment is not a parameter', () => {
    const id = '0190a1b2-0000-7000-8000-000000000001';
    expect(modulesOfRequest('POST', '/hospital/imports/analyse')).toEqual(['import']);
    expect(modulesOfRequest('POST', `/hospital/imports/${id}/commit`)).toEqual(['import']);
    // Not a route of anything: no module, and so not refused for one.
    expect(modulesOfRequest('POST', `/hospital/imports/${id}/nothing`)).toEqual([]);
    expect(modulesOfRequest('GET', '/hospital/setup')).toEqual([]);
    expect(modulesOfRequest('GET', '/hospitals')).toEqual([]);
  });
});
