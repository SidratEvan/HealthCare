import { describe, expect, it } from 'vitest';

import { findIdentifiers } from '../identifiers.js';

describe('the national layer sends nothing that identifies (FR-GOV-06)', () => {
  it('passes a district count', () => {
    expect(
      findIdentifiers({
        districts: [{ division: 'Dhaka', district: 'Dhaka', bedFree: 27, asOf: '2026-09-23T14:49:07Z' }],
        totals: { bedFree: 31 },
      }),
    ).toEqual([]);
  });

  it.each([
    ['an id', { id: 'x' }, 'id'],
    ['a camelCase id', { rows: [{ patientId: 'x' }] }, 'rows[0].patientId'],
    ['a snake_case id', { hospital_id: 'x' }, 'hospital_id'],
    ['a phone', { contactPhone: 'x' }, 'contactPhone'],
    ['a name', { nameBn: 'x' }, 'nameBn'],
    ['an email', { email: 'x' }, 'email'],
    ['a token', { trackingToken: 'x' }, 'trackingToken'],
  ])('refuses %s by its key', (_label, payload, path) => {
    expect(findIdentifiers(payload)).toEqual([path]);
  });

  it('refuses a UUID wherever it sits, whatever the key', () => {
    expect(findIdentifiers({ rows: [{ label: '0192a4c1-7a4e-7c3b-9f2d-4b1e8a9c0d11' }] })).toEqual([
      'rows[0].label',
    ]);
  });

  it.each(['+8801712345678', '01712345678', 'call 8801912345678'])(
    'refuses a mobile number in a value: %s',
    (value) => {
      expect(findIdentifiers({ note: value })).toEqual(['note']);
    },
  );

  it('does not mistake a key that merely ends in the letters for an id', () => {
    expect(findIdentifiers({ paid: 3, covid: 1 })).toEqual([]);
  });

  it('does not mistake a timestamp or a count for a phone', () => {
    expect(findIdentifiers({ hour: '2026-09-23T19:00:00.000Z', cases: 17_123_456_789 })).toEqual(
      [],
    );
  });
});
