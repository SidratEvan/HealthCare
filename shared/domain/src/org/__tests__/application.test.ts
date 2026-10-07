/**
 * A hospital applies by itself (`FR-ONB-09`; plan D1): what the form may
 * hold, and the code made for the workspace.
 */

import { describe, expect, it } from 'vitest';

import {
  APPLICATION_PASSWORD_MIN,
  applicationBody,
  codeFor,
  codeStem,
  facilityPhoneFrom,
  mobileFrom,
} from '../application.js';

const FORM = {
  nameBn: 'তিস্তা জেনারেল হাসপাতাল (ডেমো)',
  nameEn: 'Teesta General Hospital (Demo)',
  kind: 'hospital',
  division: 'Rangpur',
  district: 'Rangpur',
  phone: '+8802912345678',
  registrationNo: 'DEMO-REG-0001',
  adminName: 'Demo Administrator',
  adminEmail: 'Admin@Teesta.Example',
  adminMobile: '+8801712345678',
  password: 'a-long-enough-password',
} as const;

describe('what the form may hold', () => {
  it('everything the requirement names, and the email in lower case', () => {
    const parsed = applicationBody.parse(FORM);
    expect(parsed.adminEmail).toBe('admin@teesta.example');
    expect(parsed.nameEn).toBe(FORM.nameEn);
  });

  it('nothing missing: each field is required', () => {
    for (const field of Object.keys(FORM)) {
      const { [field as keyof typeof FORM]: _left, ...rest } = FORM;
      expect(applicationBody.safeParse(rest).success, field).toBe(false);
    }
  });

  it('nothing more: a code, a live switch or a role cannot be sent with it', () => {
    for (const extra of [{ code: 'TEESTA' }, { isLive: true }, { lifecycle: 'active' }]) {
      expect(applicationBody.safeParse({ ...FORM, ...extra }).success).toBe(false);
    }
  });

  it('a mobile is a Bangladeshi mobile; the facility’s phone may be a landline', () => {
    expect(applicationBody.safeParse({ ...FORM, adminMobile: '01712345678' }).success).toBe(false);
    expect(applicationBody.safeParse({ ...FORM, adminMobile: '+8802912345678' }).success).toBe(
      false,
    );
    expect(applicationBody.safeParse({ ...FORM, phone: '+8801712345678' }).success).toBe(true);
    expect(applicationBody.safeParse({ ...FORM, phone: '029123456' }).success).toBe(false);
  });

  it('a password shorter than the rule is refused before anything is made', () => {
    const short = 'x'.repeat(APPLICATION_PASSWORD_MIN - 1);
    expect(applicationBody.safeParse({ ...FORM, password: short }).success).toBe(false);
    expect(
      applicationBody.safeParse({ ...FORM, password: 'x'.repeat(APPLICATION_PASSWORD_MIN) })
        .success,
    ).toBe(true);
  });

  it('a kind is one of the kinds there are', () => {
    expect(applicationBody.safeParse({ ...FORM, kind: 'pharmacy' }).success).toBe(false);
  });
});

describe('a number as a person types it', () => {
  it('a mobile, in any of the ways one is written, is kept one way', () => {
    for (const typed of [
      '01712345678',
      '01712-345678',
      '+8801712345678',
      '+880 1712 345678',
      '8801712345678',
      '০১৭১২৩৪৫৬৭৮',
      ' 01712 345 678 ',
    ]) {
      expect(mobileFrom(typed), typed).toBe('+8801712345678');
    }
  });

  it('what is not a mobile is not turned into one', () => {
    for (const typed of ['', '0171234567', '017123456789', '02912345678', '01212345678', 'abc']) {
      expect(mobileFrom(typed), typed).toBeNull();
    }
  });

  it('a facility’s phone may be a landline', () => {
    expect(facilityPhoneFrom('02 912345678')).toBe('+8802912345678');
    expect(facilityPhoneFrom('01712-345678')).toBe('+8801712345678');
    expect(facilityPhoneFrom('12345')).toBeNull();
    expect(facilityPhoneFrom('')).toBeNull();
  });

  it('what they give is what the form accepts', () => {
    const mobile = mobileFrom('01712345678');
    const phone = facilityPhoneFrom('02 912345678');
    expect(applicationBody.safeParse({ ...FORM, adminMobile: mobile, phone }).success).toBe(true);
  });
});

describe('the code made for it (FR-BRD-01)', () => {
  it('is the first word of the English name that says which hospital it is', () => {
    expect(codeStem('Teesta General Hospital (Demo)')).toBe('TEESTA');
    expect(codeStem('The Padma Specialised Hospital')).toBe('PADMA');
    expect(codeStem('Green Life Medical College')).toBe('GREEN');
    expect(codeStem('al-Amin Clinic')).toBe('AL');
  });

  it('has the shape a code has, whatever the name', () => {
    for (const nameEn of [
      'Chattogram Metropolitan Hospital',
      'X',
      '২৪ ঘণ্টা',
      'General Hospital',
    ]) {
      expect(codeStem(nameEn)).toMatch(/^[A-Z0-9][A-Z0-9-]{1,15}$/);
    }
    // Nothing telling in it: the first word there is.
    expect(codeStem('General Hospital')).toBe('GENERAL');
    // Nothing at all in Latin letters.
    expect(codeStem('২৪ ঘণ্টা')).toBe('HOSPITAL');
  });

  it('takes the next number when the word is somebody’s already', () => {
    expect(codeFor('Padma Clinic', new Set())).toBe('PADMA');
    expect(codeFor('Padma Clinic', new Set(['PADMA']))).toBe('PADMA-2');
    expect(codeFor('Padma Clinic', new Set(['PADMA', 'PADMA-2', 'PADMA-3']))).toBe('PADMA-4');
  });

  it('never longer than a code may be, and gives up rather than count for ever', () => {
    const long = 'Chattogramnagar Hospital';
    const stem = codeStem(long);
    expect(stem.length).toBeLessThanOrEqual(12);
    expect((codeFor(long, new Set([stem])) ?? '').length).toBeLessThanOrEqual(16);

    const all = new Set([stem]);
    for (let n = 2; n < 100; n += 1) all.add(`${stem}-${String(n)}`);
    expect(codeFor(long, all)).toBeNull();
  });
});
