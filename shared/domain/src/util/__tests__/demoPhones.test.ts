import { afterEach, describe, expect, it } from 'vitest';

import { otpRequestBody } from '../../schemas/auth.schema.js';
import { createBookingBody, guestDetails } from '../../schemas/booking.schema.js';
import { registrationLookupQuery } from '../../schemas/registration.schema.js';
import {
  DEMO_PERSON_PHONES,
  DEMO_PHONE_NOT_ALLOWED,
  personPhoneAdmitted,
  refusedPhonePaths,
  setPersonPhoneAdmission,
} from '../demoPhones.js';
import { BD_MOBILE } from '../phone.js';

const onTheList = (phone: string): boolean => DEMO_PERSON_PHONES.includes(phone);

const guest = (phone: string): Record<string, unknown> => ({
  name: 'অতিথি (ডেমো)',
  phone,
  ageYears: 30,
  sex: 'female',
});

afterEach(() => {
  setPersonPhoneAdmission(null);
});

describe('FR-DEM-08: the phones a demonstration takes', () => {
  it('admits every valid number until a rule is installed, as the apps and seeds need', () => {
    expect(personPhoneAdmitted('+8801712345678')).toBe(true);
    expect(guestDetails.safeParse(guest('+8801712345678')).success).toBe(true);
  });

  it('refuses a stored-shape number off the list, and says so in its own words', () => {
    setPersonPhoneAdmission(onTheList);
    const refused = guestDetails.safeParse(guest('+8801712345678'));
    expect(refused.success).toBe(false);
    expect(refused.error?.issues.map((issue) => issue.message)).toEqual([DEMO_PHONE_NOT_ALLOWED]);
    expect(guestDetails.safeParse(guest('+8801380000001')).success).toBe(true);
  });

  it('holds a number as typed to the same list, after normalising it', () => {
    setPersonPhoneAdmission(onTheList);
    expect(otpRequestBody.safeParse({ phone: '01712-345678' }).success).toBe(false);
    expect(otpRequestBody.safeParse({ phone: '0131 0000 001' }).success).toBe(true);
    expect(registrationLookupQuery.safeParse({ phone: '01712345678' }).success).toBe(false);
    expect(registrationLookupQuery.safeParse({ phone: '+880 1380-000002' }).success).toBe(true);
  });

  it('leaves a value that is no mobile at all to the format check', () => {
    setPersonPhoneAdmission(onTheList);
    const result = guestDetails.safeParse(guest('12345'));
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).not.toContain(
      DEMO_PHONE_NOT_ALLOWED,
    );
  });

  it('finds the refusal inside a union, where a guest booking reports it', () => {
    setPersonPhoneAdmission(onTheList);
    const result = createBookingBody.safeParse({
      sessionId: '01900000-0000-7000-8000-000000000001',
      method: 'at_hospital',
      guest: guest('+8801712345678'),
    });
    expect(result.success).toBe(false);
    expect(refusedPhonePaths(result.error?.issues ?? [], ['body'])).toContain('body.guest.phone');
  });

  it('is a list of distinct numbers in the stored shape, never a pattern', () => {
    for (const phone of DEMO_PERSON_PHONES) expect(phone).toMatch(BD_MOBILE);
    expect(new Set(DEMO_PERSON_PHONES).size).toBe(DEMO_PERSON_PHONES.length);
  });
});
