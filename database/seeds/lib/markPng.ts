/**
 * A plain logo mark for a demo facility (`FR-BRD-06`, `FR-DEM-*`).
 *
 * A hospital's logo is a file the hospital uploads. A demo facility has none,
 * and a settings screen and a card with no logo on any of them show nothing
 * of the feature (CLAUDE.md §5: no feature ships with an empty screen). So
 * the seed draws one: a rounded square in the facility's own colour with a
 * ring in white. Nobody's trademark, and not a cross.
 *
 * Written out as a PNG by hand, for the reason `demoReportPdf` is: an image
 * library is a dependency to draw two shapes (CLAUDE.md §7). A PNG is a
 * signature, a header, the pixels deflated, and an end marker, each chunk
 * with a checksum.
 */

import { deflateSync } from 'node:zlib';

const SIZE = 96;

const CRC_TABLE: readonly number[] = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xff_ff_ff_ff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

/** A 96-pixel PNG mark in `colour` (`#rrggbb`). The same colour gives the same bytes. */
export function markPng(colour: string): Buffer {
  const red = Number.parseInt(colour.slice(1, 3), 16);
  const green = Number.parseInt(colour.slice(3, 5), 16);
  const blue = Number.parseInt(colour.slice(5, 7), 16);

  const centre = (SIZE - 1) / 2;
  const corner = 20;
  const rows: Buffer[] = [];

  for (let y = 0; y < SIZE; y += 1) {
    // Each scanline starts with its filter type: none.
    const row = Buffer.alloc(1 + SIZE * 4);
    for (let x = 0; x < SIZE; x += 1) {
      // Inside the rounded square?
      const dx = Math.max(corner - x, x - (SIZE - 1 - corner), 0);
      const dy = Math.max(corner - y, y - (SIZE - 1 - corner), 0);
      const inside = dx * dx + dy * dy <= corner * corner;

      // On the ring, or the dot at its centre?
      const distance = Math.hypot(x - centre, y - centre);
      const white = (distance >= 22 && distance <= 30) || distance <= 7;

      const at = 1 + x * 4;
      if (!inside) continue;
      row[at] = white ? 255 : red;
      row[at + 1] = white ? 255 : green;
      row[at + 2] = white ? 255 : blue;
      row[at + 3] = 255;
    }
    rows.push(row);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // red, green, blue, alpha
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // not interlaced

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
