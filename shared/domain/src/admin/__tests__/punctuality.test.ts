import { describe, expect, it } from 'vitest';

import { punctualityByDoctor, type SessionTiming } from '../punctuality.js';

function timing(overrides: Partial<SessionTiming> = {}): SessionTiming {
  return {
    doctorId: 'doc-rahman',
    doctorNameBn: 'ডা. আনিসুর রহমান',
    doctorNameEn: 'Dr Anisur Rahman',
    departmentNameBn: 'কার্ডিওলজি',
    departmentNameEn: 'Cardiology',
    startDeltaMinutes: 0,
    avgConsultSeconds: 480,
    seen: 20,
    ...overrides,
  };
}

describe('planned versus actual start', () => {
  it('reports the median late minutes, not the mean', () => {
    // Five minutes late four times and four hours late once. The mean says 51
    // minutes, which describes no day this doctor has ever had.
    const [row] = punctualityByDoctor([
      timing({ startDeltaMinutes: 5 }),
      timing({ startDeltaMinutes: 5 }),
      timing({ startDeltaMinutes: 5 }),
      timing({ startDeltaMinutes: 5 }),
      timing({ startDeltaMinutes: 240 }),
    ]);

    expect(row?.medianDeltaMinutes).toBe(5);
    expect(row?.worstDeltaMinutes).toBe(240);
  });

  it('averages the two middles on an even count', () => {
    const [row] = punctualityByDoctor([
      timing({ startDeltaMinutes: 0 }),
      timing({ startDeltaMinutes: 10 }),
      timing({ startDeltaMinutes: 20 }),
      timing({ startDeltaMinutes: 40 }),
    ]);

    expect(row?.medianDeltaMinutes).toBe(15);
  });

  it('counts early as off the promise, not as punctual', () => {
    // People told to come at four are not there at half past three. Starting
    // twenty minutes early breaks the same promise being late does.
    const [row] = punctualityByDoctor([
      timing({ startDeltaMinutes: -20 }),
      timing({ startDeltaMinutes: -20 }),
    ]);

    expect(row?.onTime).toBe(0);
    expect(row?.onTimeRate).toBe(0);
    expect(row?.medianDeltaMinutes).toBe(-20);
  });

  it('treats the ten-minute band either side as on time', () => {
    const [row] = punctualityByDoctor([
      timing({ startDeltaMinutes: -10 }),
      timing({ startDeltaMinutes: 10 }),
      timing({ startDeltaMinutes: 11 }),
    ]);

    expect(row?.onTime).toBe(2);
    expect(row?.onTimeRate).toBeCloseTo(2 / 3);
  });
});

describe('a session the doctor never started', () => {
  it('counts separately and changes neither figure', () => {
    // Null `actual_start` is a clinic that did not begin. Reading it as zero
    // lateness would flatter an absent doctor into a perfect record.
    const [row] = punctualityByDoctor([
      timing({ startDeltaMinutes: 30 }),
      timing({ startDeltaMinutes: null, avgConsultSeconds: null, seen: 0 }),
    ]);

    expect(row?.sessions).toBe(2);
    expect(row?.neverStarted).toBe(1);
    expect(row?.medianDeltaMinutes).toBe(30);
    expect(row?.onTimeRate).toBe(0);
  });

  it('reports no median at all when nothing ever started', () => {
    const [row] = punctualityByDoctor([
      timing({ startDeltaMinutes: null, avgConsultSeconds: null, seen: 0 }),
    ]);

    expect(row?.medianDeltaMinutes).toBeNull();
    expect(row?.worstDeltaMinutes).toBeNull();
    expect(row?.onTimeRate).toBeNull();
    expect(row?.avgConsultSeconds).toBeNull();
  });
});

describe('average consultation duration', () => {
  it('weights by patients seen rather than averaging the averages', () => {
    // A forty-minute consultation with one patient and eight-minute ones with
    // thirty say very different things about pace. A mean of means gives the
    // quiet session equal say and reports 24 minutes.
    const [row] = punctualityByDoctor([
      timing({ avgConsultSeconds: 2_400, seen: 1 }),
      timing({ avgConsultSeconds: 480, seen: 30 }),
    ]);

    expect(row?.seen).toBe(31);
    expect(row?.avgConsultSeconds).toBe(542);
  });
});

describe('the order the Staff section reads in', () => {
  it('opens on the doctor an administrator most needs to speak to', () => {
    const rows = punctualityByDoctor([
      timing({ doctorId: 'a', doctorNameEn: 'Dr A', startDeltaMinutes: 5 }),
      timing({ doctorId: 'b', doctorNameEn: 'Dr B', startDeltaMinutes: 55 }),
      timing({ doctorId: 'c', doctorNameEn: 'Dr C', startDeltaMinutes: 25 }),
    ]);

    expect(rows.map((row) => row.doctorId)).toEqual(['b', 'c', 'a']);
  });

  it('sorts doctors with no started session last, not first', () => {
    // "No data" is not "worst". Leading with them would bury the finding.
    const rows = punctualityByDoctor([
      timing({ doctorId: 'unknown', doctorNameEn: 'Dr Z', startDeltaMinutes: null, seen: 0 }),
      timing({ doctorId: 'late', doctorNameEn: 'Dr Y', startDeltaMinutes: 40 }),
    ]);

    expect(rows.map((row) => row.doctorId)).toEqual(['late', 'unknown']);
  });

  it('groups every session of one doctor into a single row', () => {
    const rows = punctualityByDoctor([
      timing({ doctorId: 'a' }),
      timing({ doctorId: 'a' }),
      timing({ doctorId: 'b' }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.doctorId === 'a')?.sessions).toBe(2);
  });
});
