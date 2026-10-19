/** Hold expiry, manual cleaning and admission review guards (FR-BED-01/02/07, GR-01). */
import { describe, expect, it } from 'vitest';

import { canConfirmAdmission, wardAttention, wardStateCounts } from '../wardWorkspace.js';

const at = '2026-10-11T06:00:00Z';
const bed = {
  id: 'demo-bed',
  wardId: 'demo-ward',
  label: 'Demo 1',
  kind: 'general',
  state: 'free',
  nightlyPoisha: 0,
  lastCleanedAt: null,
  stateChangedAt: at,
  expectedDischargeDate: null,
  reservedUntil: null,
  oosReason: null,
  admissionId: null,
  heldForRequestId: null,
  version: 1,
};

describe('ward derived reminders', () => {
  it('counts an expired hold as free and removes its reminder without changing source data', () => {
    const held = { ...bed, state: 'reserved', reservedUntil: at };
    expect(wardStateCounts([held], at)).toEqual({
      free: 1,
      occupied: 0,
      reserved: 0,
      cleaning: 0,
      out_of_service: 0,
    });
    expect(wardAttention([held], at)).toEqual([]);
    expect(held.state).toBe('reserved');
  });
  it('reminds at the cleaning threshold while keeping the bed unavailable', () => {
    const cleaning = {
      ...bed,
      state: 'cleaning',
      stateChangedAt: '2026-10-11T05:30:00Z',
    };
    expect(wardAttention([cleaning], '2026-10-11T05:59:59Z')).toEqual([]);
    expect(wardAttention([cleaning], at)).toEqual([cleaning]);
    expect(wardStateCounts([cleaning], at).free).toBe(0);
  });
  it('reminds only for live holds within thirty minutes, including request-bound holds', () => {
    const held = {
      ...bed,
      state: 'reserved',
      reservedUntil: '2026-10-11T06:30:00Z',
      heldForRequestId: 'demo-request',
    };
    expect(wardAttention([held], at)).toEqual([held]);
    expect(wardAttention([held], '2026-10-11T05:59:59Z')).toEqual([]);
  });
});

describe('admission review guard', () => {
  it('allows an unchanged free bed but rejects an unread or changed version even if still free', () => {
    expect(canConfirmAdmission(bed, 1, at)).toBe(true);
    expect(canConfirmAdmission(bed, null, at)).toBe(false);
    expect(canConfirmAdmission({ ...bed, version: 2 }, 1, at)).toBe(false);
  });
  it.each(['occupied', 'cleaning', 'out_of_service'])(
    'rejects %s even at the reviewed version',
    (state) => {
      expect(canConfirmAdmission({ ...bed, state }, 1, at)).toBe(false);
    },
  );
  it('does not assign a request-bound hold to an unrelated desk admission', () => {
    const held = {
      ...bed,
      state: 'reserved',
      reservedUntil: '2026-10-11T07:00:00Z',
      heldForRequestId: 'demo-request',
    };
    expect(canConfirmAdmission(held, 1, at)).toBe(false);
    expect(canConfirmAdmission({ ...held, heldForRequestId: null }, 1, at)).toBe(true);
  });
});
