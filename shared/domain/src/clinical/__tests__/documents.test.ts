/**
 * What a patient's old paper may be, read from its bytes (`FR-PAT-62`; plan R3).
 */

import { describe, expect, it } from 'vitest';

import { documentKey, sniffDocument } from '../documents.js';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);
const ascii = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));

describe('sniffDocument', () => {
  it('knows the four kinds by their first bytes', () => {
    expect(sniffDocument(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffDocument(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(
      'image/png',
    );
    expect(sniffDocument(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50))).toBe(
      'image/webp',
    );
    expect(sniffDocument(ascii('%PDF-1.7\n'))).toBe('application/pdf');
  });

  it('refuses anything else, whatever it would be called', () => {
    expect(sniffDocument(ascii('<html>'))).toBeNull();
    expect(sniffDocument(bytes(0x4d, 0x5a))).toBeNull(); // an executable
    expect(
      sniffDocument(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x41, 0x56, 0x49, 0x20)),
    ).toBeNull(); // a RIFF video
    expect(sniffDocument(bytes())).toBeNull();
  });
});

describe('documentKey', () => {
  it('is built from ids and the kind, never from a name a caller sent', () => {
    expect(documentKey('p1', 'd1', 'application/pdf')).toBe('documents/p1/d1.pdf');
    expect(documentKey('p1', 'd2', 'image/jpeg')).toBe('documents/p1/d2.jpg');
  });
});
