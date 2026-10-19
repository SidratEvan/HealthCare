import { describe, expect, it, vi } from 'vitest';

import {
  assignmentChanges,
  sameDesk,
  writeAssignments,
  reconcileAssignmentResults,
} from '../deskAssignments.js';

const person = 'receptionist';
const desks = Array.from({ length: 3 }, (_, i) => ({
  id: `desk-${i}`,
  nameBn: `Desk ${i}`,
  nameEn: `Desk ${i}`,
  staffIds: i === 0 ? [person, 'unchanged'] : ['unchanged'],
  doctorIds: ['own-doctor'],
}));
const ok = { ok: true, value: {} };
describe('FR-REC-32 multi-desk recovery', () => {
  it('plans additions/removals only and preserves other staff and untouched desks', () => {
    const changes = assignmentChanges(desks, person, new Set(['desk-1']));
    expect(changes.map((c) => c.before.id)).toEqual(['desk-0', 'desk-1']);
    expect(changes[0]?.staffIds).toEqual(['unchanged']);
    expect(changes[1]?.staffIds).toEqual(['unchanged', person]);
    expect(desks[0]?.staffIds).toEqual([person, 'unchanged']);
  });
  it('stops on rejection, reads back, and plans only remaining writes on explicit retry', async () => {
    const wanted = new Set(['desk-1', 'desk-2']);
    const changes = assignmentChanges(desks, person, wanted);
    const authoritative = desks.map((d, i) => (i === 0 ? { ...d, staffIds: ['unchanged'] } : d));
    const write = vi
      .fn()
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce({
        ok: false,
        failure: { kind: 'notAllowed', reason: 'desk_changed' },
      });
    const read = vi.fn().mockResolvedValue(authoritative);
    const outcome = await writeAssignments(changes, write, read);
    expect(write).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledOnce();
    expect(outcome.results.map((r) => [r.status, r.confirmed])).toEqual([
      ['completed', true],
      ['rejected', false],
      ['pending', false],
    ]);
    expect(assignmentChanges(outcome.desks ?? [], person, wanted).map((c) => c.before.id)).toEqual([
      'desk-1',
      'desk-2',
    ]);
  });
  it('does not silently retry an uncertain response even when the server committed it', async () => {
    const changes = assignmentChanges(desks, person, new Set());
    const authoritative = desks.map((d, i) => (i === 0 ? { ...d, staffIds: ['unchanged'] } : d));
    const write = vi.fn().mockResolvedValue({ ok: false, failure: { kind: 'offline' } });
    const outcome = await writeAssignments(changes, write, () => Promise.resolve(authoritative));
    expect(write).toHaveBeenCalledOnce();
    expect(outcome.results[0]).toMatchObject({ status: 'uncertain', confirmed: true });
    expect(assignmentChanges(outcome.desks ?? [], person, new Set())).toHaveLength(0);
  });
  it('keeps acknowledged and pending rows when write throws and authoritative read fails', async () => {
    const changes = assignmentChanges(desks, person, new Set(['desk-1', 'desk-2']));
    const write = vi.fn().mockResolvedValueOnce(ok).mockRejectedValueOnce(new Error('network'));
    const outcome = await writeAssignments(changes, write, () =>
      Promise.reject(new Error('read failed')),
    );
    expect(outcome.desks).toBeNull();
    expect(outcome.results.map((r) => [r.status, r.confirmed])).toEqual([
      ['completed', false],
      ['uncertain', false],
      ['pending', false],
    ]);
    expect(write).toHaveBeenCalledTimes(2);
    const recovered = desks.map((desk, index) =>
      index === 0
        ? { ...desk, staffIds: ['unchanged'] }
        : index === 2
          ? { ...desk, staffIds: ['unchanged', person] }
          : desk,
    );
    expect(
      reconcileAssignmentResults(outcome.results, recovered).map((r) => [r.status, r.confirmed]),
    ).toEqual([
      ['completed', true],
      ['uncertain', false],
      ['pending', true],
    ]);
    expect(write).toHaveBeenCalledTimes(2);
  });
  it('distinguishes every accepted response from current server confirmation', async () => {
    const outcome = await writeAssignments(
      assignmentChanges(desks, person, new Set()),
      () => Promise.resolve(ok),
      () => Promise.resolve(desks),
    );
    expect(outcome.results[0]).toMatchObject({ status: 'completed', confirmed: false });
  });
  it('accepts order differences but rejects changed names, members, doctors and desk IDs', () => {
    const a = desks[0];
    if (a === undefined) throw new Error('Missing fixture');
    expect(sameDesk(a, { ...a, staffIds: [...a.staffIds].reverse() })).toBe(true);
    for (const change of [
      { nameEn: 'renamed' },
      { staffIds: [] },
      { doctorIds: [] },
      { id: 'foreign' },
    ])
      expect(sameDesk(a, { ...a, ...change })).toBe(false);
  });
});
