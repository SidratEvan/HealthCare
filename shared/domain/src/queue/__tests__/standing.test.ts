import { describe, expect, it } from 'vitest';

import { BOOKING_STATUSES, SESSION_STATUSES } from '../../types/enums.js';
import { bookingStanding } from '../standing.js';

describe('bookingStanding (FR-PAT-39, FR-QUE-06)', () => {
  it('is current while the patient is unresolved in a session that has not ended', () => {
    for (const session of ['scheduled', 'running', 'paused'] as const) {
      for (const booking of ['booked', 'waiting', 'late', 'in_chamber'] as const) {
        expect(bookingStanding(session, booking), `${session}/${booking}`).toBe('current');
      }
    }
  });

  it('takes no date: waiting at 23:59 is waiting at 00:01', () => {
    // The whole rule is two statuses. There is nothing here that a clock
    // passing midnight could change, which is the point.
    expect(bookingStanding.length).toBe(2);
    expect(bookingStanding('running', 'waiting')).toBe('current');
  });

  it('a chamber paused across midnight is still the patient’s chamber', () => {
    expect(bookingStanding('paused', 'waiting')).toBe('current');
    expect(bookingStanding('paused', 'late')).toBe('current');
  });

  it('is past once the patient has been seen, or has given the serial up', () => {
    for (const session of ['scheduled', 'running', 'paused'] as const) {
      expect(bookingStanding(session, 'done')).toBe('past');
      expect(bookingStanding(session, 'cancelled')).toBe('past');
      expect(bookingStanding(session, 'rescheduled')).toBe('past');
    }
  });

  it('is past once the session has actually ended, whoever was still waiting', () => {
    for (const booking of BOOKING_STATUSES) {
      expect(bookingStanding('ended', booking)).toBe('past');
      expect(bookingStanding('cancelled', booking)).toBe('past');
    }
  });

  it('marked absent is not settled while the chamber is open: reception can bring them back', () => {
    expect(bookingStanding('running', 'no_show')).toBe('current');
    expect(bookingStanding('paused', 'no_show')).toBe('current');
    expect(bookingStanding('ended', 'no_show')).toBe('past');
  });

  it('answers for every pair of statuses there is', () => {
    for (const session of SESSION_STATUSES) {
      for (const booking of BOOKING_STATUSES) {
        expect(['current', 'past']).toContain(bookingStanding(session, booking));
      }
    }
  });
});
