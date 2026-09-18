/**
 * `<FreshnessLine>` (FRONTEND.md §6.2, `GR-05`, `FR-OFF-03`, `FR-OFF-05`).
 *
 * The most load-bearing three lines of markup in the product. `PRD.md` §3.2
 * says never show a live number without saying how old it is, and this is the
 * component that keeps that promise — so it gets tested harder than its size
 * suggests.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FreshnessLine } from '../FreshnessLine.js';

const NOW = new Date('2026-09-18T12:00:00Z');

const LABELS = {
  justNow: 'এইমাত্র হালনাগাদ',
  ago: 'হালনাগাদ {time} মিনিট আগে',
  never: 'এখনো সংযোগ হয়নি',
  stale: 'তথ্য পুরনো হতে পারে',
};

/** Bengali numerals, as a patient surface would pass in (TYP-04). */
const bengali = (minutes: number): string =>
  String(minutes).replace(/[0-9]/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)] ?? d);

function at(minutesAgo: number): Date {
  return new Date(NOW.getTime() - minutesAgo * 60_000);
}

describe('what it says', () => {
  it('reads "just now" for a figure confirmed this minute', () => {
    render(<FreshnessLine asOf={at(0)} now={NOW} labels={LABELS} formatMinutes={bengali} />);
    expect(screen.getByTestId('freshness')).toHaveTextContent('এইমাত্র হালনাগাদ');
  });

  it('counts the minutes, in the numerals it was given', () => {
    render(<FreshnessLine asOf={at(3)} now={NOW} labels={LABELS} formatMinutes={bengali} />);
    // ৩, not 3 — a Latin digit inside a Bangla sentence is the tell
    // FRONTEND.md §0.2 bans by name.
    expect(screen.getByTestId('freshness')).toHaveTextContent('হালনাগাদ ৩ মিনিট আগে');
  });

  it('never claims a negative age when the clocks disagree', () => {
    // A console clock ahead of the server would otherwise render "-2 minutes",
    // which reads as a bug and undermines the one thing this line is for.
    const future = new Date(NOW.getTime() + 5 * 60_000);
    render(<FreshnessLine asOf={future} now={NOW} labels={LABELS} formatMinutes={bengali} />);
    expect(screen.getByTestId('freshness')).toHaveTextContent('এইমাত্র হালনাগাদ');
  });
});

describe('staleness (FR-OFF-04)', () => {
  it('stays muted inside the threshold', () => {
    render(<FreshnessLine asOf={at(9)} now={NOW} labels={LABELS} formatMinutes={bengali} />);
    const line = screen.getByTestId('freshness');
    expect(line).toHaveAttribute('data-stale', 'false');
    expect(line).not.toHaveTextContent('তথ্য পুরনো হতে পারে');
  });

  it('warns past it, in words as well as colour (A11Y-03)', () => {
    render(<FreshnessLine asOf={at(11)} now={NOW} labels={LABELS} formatMinutes={bengali} />);
    const line = screen.getByTestId('freshness');

    expect(line).toHaveAttribute('data-stale', 'true');
    // Colour never carries meaning alone: the warning is also a sentence.
    expect(line).toHaveTextContent('তথ্য পুরনো হতে পারে');
  });

  it('warns exactly at the threshold', () => {
    render(<FreshnessLine asOf={at(10)} now={NOW} labels={LABELS} formatMinutes={bengali} />);
    expect(screen.getByTestId('freshness')).toHaveAttribute('data-stale', 'true');
  });

  it('honours a hospital that set its own threshold', () => {
    render(
      <FreshnessLine
        asOf={at(3)}
        now={NOW}
        staleAfterMinutes={2}
        labels={LABELS}
        formatMinutes={bengali}
      />,
    );
    expect(screen.getByTestId('freshness')).toHaveAttribute('data-stale', 'true');
  });
});

describe('when the server has never been heard from (FR-OFF-05)', () => {
  it('says so rather than rendering nothing', () => {
    // Absence of information is information. A blank line here would let a
    // console show yesterday's queue as though it were live.
    render(<FreshnessLine asOf={null} now={NOW} labels={LABELS} formatMinutes={bengali} />);
    expect(screen.getByTestId('freshness')).toHaveTextContent('এখনো সংযোগ হয়নি');
  });
});

describe('accessibility', () => {
  it('announces politely as the age changes (A11Y-04)', () => {
    render(<FreshnessLine asOf={at(1)} now={NOW} labels={LABELS} formatMinutes={bengali} />);
    expect(screen.getByTestId('freshness')).toHaveAttribute('aria-live', 'polite');
  });
});
