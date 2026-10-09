/**
 * A patient's own papers are named the same everywhere (`FR-PAT-62`; plan R3).
 */

import { describe, expect, it } from 'vitest';

import { PATIENT_PROVIDED, paperDate, paperKindName } from '../papers.js';

describe('paperKindName', () => {
  it('names the four kinds in both languages', () => {
    expect(paperKindName('report', 'bn')).toBe('টেস্টের রিপোর্ট');
    expect(paperKindName('discharge', 'en')).toBe('Discharge paper');
  });

  it('calls anything it does not know "other", rather than printing a code', () => {
    expect(paperKindName(null, 'bn')).toBe('অন্যান্য');
    expect(paperKindName('xray', 'en')).toBe('Other');
  });
});

describe('paperDate', () => {
  it('writes the paper’s own date, in Bangla with Bengali digits', () => {
    expect(paperDate('2025-03-04', 'bn')).toMatch(/মার্চ/);
    expect(paperDate('2025-03-04', 'bn')).not.toMatch(/[0-9]/);
    expect(paperDate('2025-03-04', 'en')).toBe('4 March 2025');
  });
});

it('labels a paper as the patient’s in both languages', () => {
  expect(PATIENT_PROVIDED.bn).toBe('রোগীর দেওয়া কাগজ');
  expect(PATIENT_PROVIDED.en).toBe('Provided by the patient');
});
