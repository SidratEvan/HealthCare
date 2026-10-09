import { describe, expect, it } from 'vitest';

import { timestamp, type BookingId, type SlotOfferId } from '../../types/ids.js';
import { computeEtas } from '../eta.js';
import { NO_PATIENT, patientViewOf } from '../patientView.js';
import { emptyState, patientsAhead, type QueueState } from '../state.js';

import { bookingId, makeSeed } from './support.js';

const NOW = timestamp('2026-10-07T10:00:00.000Z');

/** A stand-in for the server's keyed ticket: anything that is not the id, the same each time. */
const ticketOf = (id: BookingId): BookingId =>
  `ticket-${id.slice(-4)}-0000-0000-000000000000` as BookingId;

/** A chamber with a cancellation and a priority reception gave reasons for, and an offer out. */
function chamber(): QueueState {
  const state = emptyState(makeSeed(5));
  return {
    ...state,
    entries: state.entries.map((entry, index) => {
      if (index === 1) {
        return {
          ...entry,
          status: 'cancelled' as const,
          cancelled: { cancelledAt: NOW, reason: 'রোগী হাসপাতালে ভর্তি (ডেমো)' },
        };
      }
      if (index === 3) {
        return { ...entry, priority: { movedAt: NOW, reason: 'বয়স্ক, শ্বাসকষ্ট (ডেমো)' } };
      }
      return entry;
    }),
    offers: [
      {
        offerId: '55555555-5555-7555-8555-000000000001' as SlotOfferId,
        freedBookingId: bookingId(2),
        offeredTo: [state.entries[4]?.patientId ?? NO_PATIENT],
        offeredAt: NOW,
        expiresAt: NOW,
        outcome: 'pending',
        acceptedBookingId: null,
      },
    ],
  };
}

describe('what a patient’s phone is sent of a chamber (plan I2c, handover 30)', () => {
  it('names no booking and no patient anywhere in it', () => {
    const state = chamber();
    const view = patientViewOf(state, computeEtas(state, NOW), ticketOf);
    const sent = JSON.stringify(view);

    for (const entry of state.entries) {
      expect(sent).not.toContain(entry.bookingId);
      expect(sent).not.toContain(entry.patientId);
    }
    expect(view.state.entries.every((entry) => entry.patientId === NO_PATIENT)).toBe(true);
    expect(view.state.offers[0]?.offeredTo).toEqual([]);
  });

  it('sends nothing reception typed', () => {
    const view = patientViewOf(chamber(), [], ticketOf);
    const sent = JSON.stringify(view);
    expect(sent).not.toContain('ভর্তি');
    expect(sent).not.toContain('শ্বাসকষ্ট');
    // That a row was cancelled or moved forward is still said: it moves the queue.
    expect(view.state.entries[1]?.cancelled).toEqual({ cancelledAt: NOW, reason: null });
    expect(view.state.entries[3]?.priority).toEqual({ movedAt: NOW, reason: '' });
  });

  it('a phone finds its own row and estimate by its ticket, and reads the same queue', () => {
    const state = chamber();
    const etas = computeEtas(state, NOW);
    const view = patientViewOf(state, etas, ticketOf);
    const mine = bookingId(5);

    const row = view.state.entries.find((entry) => entry.bookingId === ticketOf(mine));
    expect(row?.serial).toBe(state.entries[4]?.serial);
    expect(patientsAhead(view.state, ticketOf(mine))).toBe(patientsAhead(state, mine));
    expect(view.etas.find((eta) => eta.bookingId === ticketOf(mine))?.etaAt).toBe(
      etas.find((eta) => eta.bookingId === mine)?.etaAt,
    );
    expect(view.state.offers[0]?.freedBookingId).toBe(ticketOf(bookingId(2)));
  });

  it('changes nothing about the queue itself: order, statuses, timing', () => {
    const state = chamber();
    const view = patientViewOf(state, [], ticketOf);
    expect(view.state.entries.map((entry) => [entry.serial, entry.status])).toEqual(
      state.entries.map((entry) => [entry.serial, entry.status]),
    );
    expect(view.state.rate).toEqual(state.rate);
    expect(view.state.plan).toEqual(state.plan);
    expect(view.state.lastSeq).toBe(state.lastSeq);
  });
});
