import { describe, expect, it } from 'vitest';

import {
  SEND_MAX_ATTEMPTS,
  SEND_RETRY_SECONDS,
  afterFailedSend,
  dhakaHour,
  endOfQuietHours,
  inQuietHours,
} from '../sending.js';

import type { Timestamp } from '../../types/ids.js';

const at = (iso: string): Timestamp => iso as Timestamp;
const NOW = at('2026-10-06T12:00:00.000Z');
const secondsAfter = (from: Timestamp, to: Timestamp): number =>
  (Date.parse(to) - Date.parse(from)) / 1_000;

describe('after a try that failed (FR-NOT-06, plan H1)', () => {
  it('waits a quarter of a minute, then one minute, five, fifteen', () => {
    const waits = [1, 2, 3, 4].map((attempts) => {
      const next = afterFailedSend({ attempts, now: NOW, retryable: true });
      if (next.kind !== 'retry') throw new Error(`gave up after ${String(attempts)}`);
      return secondsAfter(NOW, next.at);
    });
    expect(waits).toEqual([15, 60, 300, 900]);
    expect(waits).toEqual([...SEND_RETRY_SECONDS]);
  });

  it('gives up after the fifth, and not before', () => {
    expect(
      afterFailedSend({ attempts: SEND_MAX_ATTEMPTS - 1, now: NOW, retryable: true }).kind,
    ).toBe('retry');
    expect(afterFailedSend({ attempts: SEND_MAX_ATTEMPTS, now: NOW, retryable: true })).toEqual({
      kind: 'give_up',
    });
    // A row that somehow counted past the limit is not tried for ever.
    expect(afterFailedSend({ attempts: 40, now: NOW, retryable: true }).kind).toBe('give_up');
  });

  it('gives up at once where trying again cannot help', () => {
    expect(afterFailedSend({ attempts: 1, now: NOW, retryable: false })).toEqual({
      kind: 'give_up',
    });
  });

  it('is done in about twenty minutes: a queue message an hour late is a wrong one', () => {
    const total = SEND_RETRY_SECONDS.reduce((sum, wait) => sum + wait, 0);
    expect(total).toBeLessThanOrEqual(30 * 60);
    expect(SEND_RETRY_SECONDS).toHaveLength(SEND_MAX_ATTEMPTS - 1);
  });
});

describe('quiet hours are Dhaka’s, ten at night to seven in the morning (FR-NOT-07)', () => {
  it('reads the hour in Dhaka, six ahead of UTC', () => {
    expect(dhakaHour(at('2026-10-06T00:00:00.000Z'))).toBe(6);
    expect(dhakaHour(at('2026-10-06T17:59:59.000Z'))).toBe(23);
    expect(dhakaHour(at('2026-10-06T18:00:00.000Z'))).toBe(0);
  });

  it('starts at ten and ends at seven, to the minute', () => {
    // 21:59 and 22:00 in Dhaka.
    expect(inQuietHours(at('2026-10-06T15:59:00.000Z'))).toBe(false);
    expect(inQuietHours(at('2026-10-06T16:00:00.000Z'))).toBe(true);
    // 06:59 and 07:00 in Dhaka.
    expect(inQuietHours(at('2026-10-06T00:59:00.000Z'))).toBe(true);
    expect(inQuietHours(at('2026-10-06T01:00:00.000Z'))).toBe(false);
  });
});

describe('a held message goes at seven in the morning (FR-NOT-07, plan H1)', () => {
  it('tomorrow’s seven for a message written before midnight', () => {
    // 23:30 on the 6th in Dhaka → 07:00 on the 7th in Dhaka, which is 01:00 UTC.
    expect(endOfQuietHours(at('2026-10-06T17:30:00.000Z'))).toBe('2026-10-07T01:00:00.000Z');
  });

  it('today’s seven for one written after midnight', () => {
    // 02:15 on the 7th in Dhaka → 07:00 the same day.
    expect(endOfQuietHours(at('2026-10-06T20:15:00.000Z'))).toBe('2026-10-07T01:00:00.000Z');
  });

  it('the last night of a month ends on the first of the next', () => {
    // 23:00 on 31 October in Dhaka → 07:00 on 1 November.
    expect(endOfQuietHours(at('2026-10-31T17:00:00.000Z'))).toBe('2026-11-01T01:00:00.000Z');
  });

  it('a moment outside quiet hours is its own answer: nothing is held', () => {
    const noon = at('2026-10-06T06:00:00.000Z');
    expect(endOfQuietHours(noon)).toBe(noon);
  });

  it('what it answers is never itself in quiet hours', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const moment = at(new Date(Date.UTC(2026, 9, 6, hour, 20)).toISOString());
      expect(inQuietHours(endOfQuietHours(moment)), String(hour)).toBe(false);
    }
  });
});
