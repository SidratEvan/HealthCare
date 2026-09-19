/**
 * `<LiveSerialCard>` (FRONTEND.md §6.1).
 *
 * The card a patient stares at in a corridor. Two things are worth testing
 * harder than the markup:
 *
 *   **which state it is in**, because §6.1 names six and they contradict each
 *   other — a delayed chamber whose patient has just been called is one card,
 *   not two, and the rule deciding which wins is `liveSerialTone`.
 *
 *   **what it refuses to claim**, because `FR-QUE-13` and `PRD.md` §3.2 both
 *   say the same thing from different directions: an estimate the chamber
 *   cannot support must not be shown as a time.
 *
 * Under jsdom a Tailwind class is an inert string, so nothing here asserts on
 * appearance (`tokens.test.ts` and `contrast.test.ts` prove the visual layer
 * from the token values). What is asserted is behaviour, text and roles.
 */

import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { FreshnessLine } from '../FreshnessLine.js';
import { LiveSerialCard, liveSerialTone, type LiveSerialCardProps } from '../LiveSerialCard.js';

import type { ReactNode } from 'react';

const NOW = new Date('2026-09-18T12:00:00Z');

/**
 * Violations axe found, colour-contrast aside.
 *
 * The same exclusion `primitives.test.tsx` makes and for the same reason:
 * jsdom renders no stylesheet, so contrast would report every element as
 * unknown. The palette is proven by `contrast.test.ts` instead.
 */
async function violations(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  return results.violations;
}

function describeViolations(found: readonly axe.Result[]): string {
  return found.map((violation) => `${violation.id}: ${violation.help}`).join('\n');
}

const LABELS = {
  status: 'ডাক্তার এসেছেন',
  yourSerial: 'আপনার সিরিয়াল',
  nowServing: 'এখন চলছে',
  nobodyCalledYet: 'এখনো কাউকে ডাকা হয়নি',
  progress: 'সেশনের অগ্রগতি',
  eta: 'আনুমানিক সময়',
  etaUnknown: 'এখনো বলা যাচ্ছে না',
  countdown: 'আর বাকি প্রায় ৪০ মিনিট',
  disconnected: 'সংযোগ নেই',
};

function freshness(minutesAgo = 1): ReactNode {
  return (
    <FreshnessLine
      asOf={new Date(NOW.getTime() - minutesAgo * 60_000)}
      now={NOW}
      labels={{
        justNow: 'এইমাত্র হালনাগাদ',
        ago: 'হালনাগাদ {time} মিনিট আগে',
        never: 'এখনো হালনাগাদ হয়নি',
        stale: 'তথ্য পুরনো হতে পারে',
      }}
      formatMinutes={(minutes) =>
        String(minutes).replace(/[0-9]/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)] ?? d)
      }
    />
  );
}

function card(overrides: Partial<LiveSerialCardProps> = {}): LiveSerialCardProps {
  return {
    serial: '১৮',
    nowServing: '৬',
    seen: 5,
    total: 17,
    etaText: 'আনুমানিক ৬:০৫ · ±১৫ মিনিট',
    confidence: 'measured',
    stale: false,
    doctorArrived: true,
    delayMinutes: 0,
    patientsAhead: 11,
    called: false,
    labels: LABELS,
    freshness: freshness(),
    ...overrides,
  };
}

describe('what it shows (FR-PAT-30)', () => {
  it('carries the five facts the requirement names', () => {
    render(<LiveSerialCard {...card()} />);

    // Doctor status, the patient's number, the number being served, the
    // estimate, and the countdown. All five, on one card, without scrolling
    // past anything.
    expect(screen.getByTestId('live-serial-status')).toHaveTextContent('ডাক্তার এসেছেন');
    expect(screen.getByTestId('live-serial-number')).toHaveTextContent('১৮');
    expect(screen.getByTestId('now-serving')).toHaveTextContent('৬');
    expect(screen.getByTestId('live-serial-eta')).toHaveTextContent('আনুমানিক ৬:০৫');
    expect(screen.getByTestId('live-serial-countdown')).toHaveTextContent('আর বাকি প্রায় ৪০ মিনিট');
  });

  it('renders the numerals it was given and converts nothing (I18N-04)', () => {
    render(<LiveSerialCard {...card()} />);

    // A Latin digit inside a Bangla sentence is the tell FRONTEND.md §0.2 bans
    // by name — and a component that converted digits itself would be a second
    // place the rule lives.
    expect(screen.getByTestId('live-serial-number')).not.toHaveTextContent('18');
  });

  it('says nobody has been called rather than showing an empty slot', () => {
    render(<LiveSerialCard {...card({ nowServing: null })} />);
    expect(screen.getByTestId('now-serving')).toHaveTextContent('এখনো কাউকে ডাকা হয়নি');
  });

  it('always carries a freshness line (CLAUDE.md §5.8)', () => {
    render(<LiveSerialCard {...card()} />);
    expect(screen.getByTestId('freshness')).toBeInTheDocument();
  });
});

describe('the ETA refuses false precision (FR-QUE-13, PRD.md §3.2)', () => {
  it('shows a time with its band when the rate is measured', () => {
    render(<LiveSerialCard {...card()} />);
    expect(screen.getByTestId('live-serial-eta')).toHaveTextContent('±১৫ মিনিট');
  });

  it('shows no time at all when the estimate would be a guess', () => {
    render(<LiveSerialCard {...card({ confidence: 'unknown' })} />);

    // The doctor has not arrived, or the chamber is paused. A number here
    // would be a guess dressed up as information.
    expect(screen.getByTestId('live-serial-eta')).toHaveTextContent('এখনো বলা যাচ্ছে না');
    expect(screen.getByTestId('live-serial-eta')).not.toHaveTextContent('৬:০৫');
  });

  it('says so when there is no estimate to show', () => {
    render(<LiveSerialCard {...card({ etaText: null })} />);
    expect(screen.getByTestId('live-serial-eta')).toHaveTextContent('এখনো বলা যাচ্ছে না');
  });
});

describe('the six states (§6.1)', () => {
  it('is waiting in the ordinary case', () => {
    render(<LiveSerialCard {...card()} />);
    expect(screen.getByTestId('live-serial')).toHaveAttribute('data-tone', 'waiting');
  });

  it("is doctor-not-arrived before the chamber opens", () => {
    render(<LiveSerialCard {...card({ doctorArrived: false })} />);
    expect(screen.getByTestId('live-serial')).toHaveAttribute('data-tone', 'not-arrived');
  });

  it('is delayed once a delay is declared', () => {
    render(<LiveSerialCard {...card({ delayMinutes: 30 })} />);
    expect(screen.getByTestId('live-serial')).toHaveAttribute('data-tone', 'delayed');
  });

  it("is you're-next when nobody is ahead", () => {
    render(<LiveSerialCard {...card({ patientsAhead: 0 })} />);
    expect(screen.getByTestId('live-serial')).toHaveAttribute('data-tone', 'next');
  });

  it('is called when this patient is the one in the chamber', () => {
    render(<LiveSerialCard {...card({ called: true })} />);
    expect(screen.getByTestId('live-serial')).toHaveAttribute('data-tone', 'called');
  });

  it('being called outranks everything else', () => {
    // A delayed chamber that has just called this patient is one card, and the
    // instruction to move is the thing that matters.
    expect(
      liveSerialTone({ called: true, delayMinutes: 30, doctorArrived: false, patientsAhead: 0 }),
    ).toBe('called');
  });

  it('a declared delay outranks "not started yet"', () => {
    // Both mean the chamber has not opened; only one carries a number.
    expect(
      liveSerialTone({ called: false, delayMinutes: 30, doctorArrived: false, patientsAhead: 4 }),
    ).toBe('delayed');
  });

  it('being first in line means nothing before the doctor arrives', () => {
    // "You're next" with no doctor in the room would send somebody to a door
    // that is shut.
    expect(
      liveSerialTone({ called: false, delayMinutes: 0, doctorArrived: false, patientsAhead: 0 }),
    ).toBe('not-arrived');
  });
});

describe('when the connection is lost (FR-PAT-36, FR-OFF-02)', () => {
  it('says the number may be stale instead of blanking the card', () => {
    render(<LiveSerialCard {...card({ stale: true })} />);

    // A number that has stopped updating, labelled as such, is more use to
    // somebody in a corridor than an empty screen.
    expect(screen.getByTestId('live-serial-number')).toHaveTextContent('১৮');
    expect(screen.getByTestId('live-serial-disconnected')).toHaveTextContent('সংযোগ নেই');
    expect(screen.getByTestId('live-serial')).toHaveAttribute('data-stale', 'true');
  });

  it('stops the live dot, so "is this live" needs no reading', () => {
    render(<LiveSerialCard {...card({ stale: true })} />);
    expect(screen.getByTestId('live-dot')).toHaveAttribute('data-live', 'false');
  });

  it('says nothing about a lost connection while there is one', () => {
    render(<LiveSerialCard {...card()} />);
    expect(screen.queryByTestId('live-serial-disconnected')).not.toBeInTheDocument();
    expect(screen.getByTestId('live-dot')).toHaveAttribute('data-live', 'true');
  });
});

describe('the progress track', () => {
  it('reports position within the session in words as well as fill (A11Y-03)', () => {
    render(<LiveSerialCard {...card()} />);
    const bar = screen.getByRole('progressbar', { name: 'সেশনের অগ্রগতি' });

    // 5 of 17 seen.
    expect(bar).toHaveAttribute('aria-valuenow', '29');
  });

  it('does not divide by zero on an empty chamber', () => {
    render(<LiveSerialCard {...card({ seen: 0, total: 0 })} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('never claims more than a full session', () => {
    render(<LiveSerialCard {...card({ seen: 20, total: 17 })} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });
});

describe('accessibility (A11Y-04)', () => {
  it('announces an ordinary change politely', () => {
    render(<LiveSerialCard {...card()} />);
    expect(screen.getByTestId('live-serial')).toHaveAttribute('aria-live', 'polite');
  });

  it('announces being called assertively, because it is an instruction', () => {
    render(<LiveSerialCard {...card({ called: true })} />);
    expect(screen.getByTestId('live-serial')).toHaveAttribute('aria-live', 'assertive');
  });

  it('passes axe in every state', async () => {
    for (const state of [
      card(),
      card({ called: true }),
      card({ delayMinutes: 30 }),
      card({ doctorArrived: false, confidence: 'unknown' }),
      card({ stale: true }),
    ]) {
      const { container, unmount } = render(<LiveSerialCard {...state} />);
      const found = await violations(container);
      expect(found, describeViolations(found)).toHaveLength(0);
      unmount();
    }
  });
});
