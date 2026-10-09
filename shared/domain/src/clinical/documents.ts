/**
 * A patient's own old papers (`PRD.md` `FR-PAT-62`; plan R3).
 *
 * What may be added, read from the file's contents and never from its name or
 * from what the sender says it is: a JPEG, PNG or WebP photograph, or a PDF,
 * up to 8 MB. The first bytes of each kind are fixed by its format, so a file
 * whose bytes are not one of the four is refused, whatever it is called.
 *
 * Pure.
 */

/** The four kinds a paper may be stored as. */
export const DOCUMENT_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;
export type DocumentContentType = (typeof DOCUMENT_CONTENT_TYPES)[number];

/** What a paper is, as the screens name it. */
export const DOCUMENT_KINDS = ['prescription', 'report', 'discharge', 'other'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** 8 MB: a phone photograph of a page, with room, and no more. */
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

const EXTENSION: Readonly<Record<DocumentContentType, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

function startsWith(bytes: Uint8Array, prefix: readonly number[], at = 0): boolean {
  return prefix.every((value, index) => bytes[at + index] === value);
}

/** The kind of file these bytes are, or null when they are none of the four. */
export function sniffDocument(bytes: Uint8Array): DocumentContentType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  // RIFF, four bytes of length, then WEBP.
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  return null;
}

/** The object key a paper is stored under: built here, never from a name a caller sent. */
export function documentKey(
  patientId: string,
  documentId: string,
  contentType: DocumentContentType,
): string {
  return `documents/${patientId}/${documentId}.${EXTENSION[contentType]}`;
}
