/**
 * The staff second factor's arithmetic (pilot step 28, FR-SEC-10,
 * `config/totp.ts`): that the code the server computes is the code a phone
 * shows, that a code works once, and that what is stored opens only with the
 * key that sealed it.
 */

import { describe, expect, it } from 'vitest';

import {
  base32Decode,
  base32Encode,
  codeAt,
  matchStep,
  newRecoveryCodes,
  newTotpSecret,
  normaliseRecoveryCode,
  openSecret,
  otpauthUri,
  recoveryHash,
  sealSecret,
  stepAt,
} from '../config/totp.js';

/** RFC 6238 Appendix B's SHA-1 seed, "12345678901234567890", in base32. */
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('TOTP (RFC 6238)', () => {
  it('encodes the RFC seed the way every app reads it', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(RFC_SECRET).toString('ascii')).toBe('12345678901234567890');
    // Typed from the screen: lower case, in groups.
    expect(base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq').toString('ascii')).toBe(
      '12345678901234567890',
    );
  });

  it("gives the RFC's reference codes, to six digits", () => {
    // Appendix B lists eight digits; an app shows the last six.
    const vectors: readonly (readonly [number, string])[] = [
      [59, '287082'],
      [1_111_111_109, '081804'],
      [1_111_111_111, '050471'],
      [1_234_567_890, '005924'],
      [2_000_000_000, '279037'],
      [20_000_000_000, '353130'],
    ];
    for (const [seconds, code] of vectors) {
      expect(codeAt(RFC_SECRET, stepAt(seconds * 1_000)), String(seconds)).toBe(code);
    }
  });

  it('accepts a code from one step either side of now, and no further', () => {
    const now = 1_234_567_890_000;
    const step = stepAt(now);
    expect(matchStep(RFC_SECRET, codeAt(RFC_SECRET, step), now, null)).toBe(step);
    expect(matchStep(RFC_SECRET, codeAt(RFC_SECRET, step - 1), now, null)).toBe(step - 1);
    expect(matchStep(RFC_SECRET, codeAt(RFC_SECRET, step + 1), now, null)).toBe(step + 1);
    expect(matchStep(RFC_SECRET, codeAt(RFC_SECRET, step - 2), now, null)).toBeNull();
    expect(matchStep(RFC_SECRET, codeAt(RFC_SECRET, step + 2), now, null)).toBeNull();
  });

  it('never accepts a step already used, so a code works once', () => {
    const now = 1_234_567_890_000;
    const step = stepAt(now);
    const code = codeAt(RFC_SECRET, step);
    expect(matchStep(RFC_SECRET, code, now, step)).toBeNull();
    // Nor an earlier one that is still inside the window.
    expect(matchStep(RFC_SECRET, codeAt(RFC_SECRET, step - 1), now, step)).toBeNull();
  });

  it('refuses anything that is not six digits', () => {
    const now = 1_234_567_890_000;
    for (const code of ['', '12345', '1234567', 'abcdef', '১২৩৪৫৬']) {
      expect(matchStep(RFC_SECRET, code, now, null), code).toBeNull();
    }
  });

  it('makes a 160-bit secret an app accepts', () => {
    const secret = newTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(newTotpSecret()).not.toBe(secret);
  });

  it('puts the facility and the person in the QR code, and nothing else of theirs', () => {
    const uri = otpauthUri({
      secret: RFC_SECRET,
      account: 'admin@shapla.demo.invalid',
      issuer: 'Shapla General: Hospital',
    });
    expect(uri.startsWith('otpauth://totp/Shapla%20General%20%20Hospital:admin%40shapla')).toBe(
      true,
    );
    const query = new URL(uri).searchParams;
    expect(query.get('secret')).toBe(RFC_SECRET);
    expect(query.get('digits')).toBe('6');
    expect(query.get('period')).toBe('30');
    expect(query.get('algorithm')).toBe('SHA1');
  });
});

describe('the stored secret', () => {
  it('is sealed, and opens to what went in', () => {
    const secret = newTotpSecret();
    const sealed = sealSecret(secret);
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain(secret);
    expect(openSecret(sealed)).toBe(secret);
    // A fresh IV each time: two seals of one secret do not match.
    expect(sealSecret(secret)).not.toBe(sealed);
  });

  it('refuses to open if anything was changed', () => {
    const sealed = sealSecret(newTotpSecret());
    const parts = sealed.split('.');
    const body = parts[3] ?? '';
    const flipped = `${body.slice(0, -1)}${body.endsWith('A') ? 'B' : 'A'}`;
    expect(() => openSecret([parts[0], parts[1], parts[2], flipped].join('.'))).toThrow();
    expect(() => openSecret('not-sealed')).toThrow();
  });
});

describe('recovery codes', () => {
  it('are ten, unambiguous, and different', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{4}-[a-hj-km-np-z2-9]{4}$/);
    }
  });

  it('are read however they are typed, and hashed the same', () => {
    const [code] = newRecoveryCodes(1);
    if (code === undefined) throw new Error('no code');
    const typed = code.toUpperCase().replace(/-/g, ' ');
    expect(normaliseRecoveryCode(typed)).toBe(code.replace(/-/g, ''));
    expect(recoveryHash(typed)).toBe(recoveryHash(code));
    expect(recoveryHash(code)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuse the wrong shape and the ambiguous letters', () => {
    expect(normaliseRecoveryCode('123456')).toBeNull();
    expect(normaliseRecoveryCode('abcd-efgh-ijk0')).toBeNull();
    expect(normaliseRecoveryCode('abcd-efgh-jkmn-p')).toBeNull();
  });
});
