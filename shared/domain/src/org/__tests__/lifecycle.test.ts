/**
 * A workspace's state and its checklist (`FR-ONB-02`–`04`, `FR-ONB-06`).
 */

import { describe, expect, it } from 'vitest';

import { ORG_LIFECYCLES, type OrgLifecycle } from '../../types/enums.js';
import {
  CHECKLIST_ITEMS,
  ORG_ACTIONS,
  actionNeedsNote,
  identityEditable,
  isPublicLifecycle,
  missingForApproval,
  missingForReview,
  nextLifecycle,
  platformActions,
  setupChecklist,
  type OrgAction,
  type SetupCounts,
} from '../lifecycle.js';

const EMPTY: SetupCounts = {
  departments: 0,
  doctors: 0,
  verifiedDoctors: 0,
  schedules: 0,
  beds: 0,
  staff: 1,
  contact: 0,
  location: 0,
  capabilities: 0,
};

const SET_UP: SetupCounts = {
  departments: 3,
  doctors: 5,
  verifiedDoctors: 0,
  schedules: 8,
  beds: 0,
  staff: 4,
  contact: 0,
  location: 0,
  capabilities: 0,
};

describe('the path to going live (FR-ONB-04)', () => {
  it('is asked for by the hospital and approved by the platform', () => {
    expect(nextLifecycle('setup', 'request_review')).toBe('ready_for_review');
    expect(nextLifecycle('ready_for_review', 'approve')).toBe('active');
    expect(ORG_ACTIONS.request_review).toBe('hospital');
    expect(ORG_ACTIONS.approve).toBe('platform');
  });

  it('cannot be approved without having been asked for', () => {
    expect(nextLifecycle('setup', 'approve')).toBeNull();
  });

  it('sends a workspace back to setting up, from review only', () => {
    expect(nextLifecycle('ready_for_review', 'send_back')).toBe('setup');
    expect(nextLifecycle('active', 'send_back')).toBeNull();
  });

  it('cannot be asked for twice, or once live', () => {
    expect(nextLifecycle('ready_for_review', 'request_review')).toBeNull();
    expect(nextLifecycle('active', 'request_review')).toBeNull();
    expect(nextLifecycle('suspended', 'request_review')).toBeNull();
  });
});

describe('suspending and closing (FR-ONB-06)', () => {
  it('suspends an active workspace and reinstates a suspended one', () => {
    expect(nextLifecycle('active', 'suspend')).toBe('suspended');
    expect(nextLifecycle('suspended', 'reinstate')).toBe('active');
    expect(nextLifecycle('setup', 'suspend')).toBeNull();
    expect(nextLifecycle('active', 'reinstate')).toBeNull();
  });

  it('closes from active or suspended, and nothing leaves closed', () => {
    expect(nextLifecycle('active', 'close')).toBe('closed');
    expect(nextLifecycle('suspended', 'close')).toBe('closed');
    // One that never went live as well: an application is declined this way
    // (`FR-ONB-10`).
    expect(nextLifecycle('setup', 'close')).toBe('closed');
    expect(nextLifecycle('ready_for_review', 'close')).toBe('closed');
    expect(ORG_ACTIONS.close).toBe('platform');
    expect(actionNeedsNote('close')).toBe(true);
    for (const action of Object.keys(ORG_ACTIONS) as OrgAction[]) {
      expect(nextLifecycle('closed', action), action).toBeNull();
    }
  });
});

describe('every state and action is accounted for', () => {
  it('only ever leads to a state that exists', () => {
    for (const from of ORG_LIFECYCLES) {
      for (const action of Object.keys(ORG_ACTIONS) as OrgAction[]) {
        const to = nextLifecycle(from, action);
        if (to !== null) expect(ORG_LIFECYCLES).toContain(to);
      }
    }
  });

  it('offers the platform exactly what is allowed from each state', () => {
    const offered: Record<OrgLifecycle, readonly OrgAction[]> = {
      setup: ['close'],
      ready_for_review: ['approve', 'send_back', 'close'],
      active: ['suspend', 'close'],
      suspended: ['reinstate', 'close'],
      closed: [],
    };
    for (const from of ORG_LIFECYCLES) {
      expect([...platformActions(from)].sort(), from).toEqual([...offered[from]].sort());
    }
  });

  it('is public only while active (FR-NET-03)', () => {
    expect(ORG_LIFECYCLES.filter(isPublicLifecycle)).toEqual(['active']);
  });

  it('asks for a reason where the hospital will have to act on it', () => {
    expect(actionNeedsNote('send_back')).toBe(true);
    expect(actionNeedsNote('suspend')).toBe(true);
    expect(actionNeedsNote('close')).toBe(true);
    expect(actionNeedsNote('approve')).toBe(false);
    expect(actionNeedsNote('reinstate')).toBe(false);
    expect(actionNeedsNote('request_review')).toBe(false);
  });
});

describe('the checklist (FR-ONB-03)', () => {
  it('names what a new workspace is missing', () => {
    expect(missingForReview(EMPTY)).toEqual(['departments', 'doctors', 'schedules']);
  });

  it('lets a hospital with no beds and no verified doctors ask for review', () => {
    // A clinic has no beds; verifying doctors is the platform's part.
    expect(missingForReview(SET_UP)).toEqual([]);
    const items = setupChecklist(SET_UP);
    expect(items.find((item) => item.key === 'beds')).toMatchObject({
      done: false,
      required: false,
    });
    expect(items.find((item) => item.key === 'verified_doctors')).toMatchObject({
      done: false,
      required: false,
    });
  });

  it('counts what exists rather than remembering it', () => {
    const before = setupChecklist(SET_UP).find((item) => item.key === 'schedules');
    const after = setupChecklist({ ...SET_UP, schedules: 0 }).find(
      (item) => item.key === 'schedules',
    );
    expect(before?.done).toBe(true);
    expect(after?.done).toBe(false);
    expect(missingForReview({ ...SET_UP, schedules: 0 })).toEqual(['schedules']);
  });

  it('will not approve a hospital nobody could book at', () => {
    expect(missingForApproval(SET_UP)).toEqual(['verified_doctors']);
    expect(missingForApproval({ ...SET_UP, verifiedDoctors: 1 })).toEqual([]);
    expect(missingForApproval(EMPTY)).toEqual([
      'departments',
      'doctors',
      'schedules',
      'verified_doctors',
    ]);
  });
});

describe('what a patient needs to reach the place (plan D2)', () => {
  const advised = (counts: SetupCounts): string[] =>
    setupChecklist(counts)
      .filter((item) => item.advised)
      .map((item) => item.key);

  it('is named: an address and a phone, a place on the map, the emergency services', () => {
    expect(advised(SET_UP)).toEqual(['contact', 'location', 'emergency_services']);
    for (const item of setupChecklist(SET_UP).filter((entry) => entry.advised)) {
      expect(item, item.key).toMatchObject({ done: false, required: false });
    }
    const filled = setupChecklist({ ...SET_UP, contact: 1, location: 1, capabilities: 3 });
    expect(filled.filter((item) => item.advised).every((item) => item.done)).toBe(true);
    expect(filled.find((item) => item.key === 'emergency_services')?.count).toBe(3);
  });

  it('and review does not wait for any of it (FR-ONB-03)', () => {
    expect(missingForReview(SET_UP)).toEqual([]);
    expect(missingForApproval({ ...SET_UP, verifiedDoctors: 1 })).toEqual([]);
    // Nothing is both: what is required refuses, what is advised only says.
    expect(setupChecklist(SET_UP).filter((item) => item.required && item.advised)).toEqual([]);
  });

  it('a hospital with no emergency desk is not told it lacks emergency services', () => {
    expect(advised({ ...SET_UP, capabilities: null })).toEqual(['contact', 'location']);
  });

  it('every item the checklist can hold is one it knows how to name', () => {
    for (const item of setupChecklist({ ...SET_UP, capabilities: 1 })) {
      expect(CHECKLIST_ITEMS).toContain(item.key);
    }
  });
});

describe('what it was registered as (plan D2)', () => {
  it('is the hospital’s to correct only while it is setting up', () => {
    expect(ORG_LIFECYCLES.filter(identityEditable)).toEqual(['setup']);
    // Sent back is setting up again.
    expect(identityEditable(nextLifecycle('ready_for_review', 'send_back') ?? 'active')).toBe(true);
  });
});
