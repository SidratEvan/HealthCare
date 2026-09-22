/**
 * Bangladeshi mobile numbers (`DB-P6`).
 *
 * Every way a person in Dhaka writes their own number is accepted; every
 * number that cannot reach a phone is refused rather than patched.
 */

import { describe, expect, it } from 'vitest';

import { normaliseBdMobile } from '../phone.js';

describe('normaliseBdMobile', () => {
  it.each([
    ['01712345678', '+8801712345678'],
    ['01712-345678', '+8801712345678'],
    ['017 1234 5678', '+8801712345678'],
    ['8801712345678', '+8801712345678'],
    ['+8801712345678', '+8801712345678'],
    ['+880 1912-345678', '+8801912345678'],
  ])('accepts %s as %s', (typed, stored) => {
    expect(normaliseBdMobile(typed)).toBe(stored);
  });

  it.each([
    ['0171234567', 'a digit short'],
    ['017123456789', 'a digit long'],
    ['01212345678', 'no operator uses 2'],
    ['0255010001', 'a landline'],
    ['', 'nothing at all'],
  ])('refuses %s (%s)', (typed) => {
    expect(normaliseBdMobile(typed)).toBeNull();
  });
});
