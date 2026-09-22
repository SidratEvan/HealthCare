/**
 * `<BedTile>` and `<CapacityMirror>` (FRONTEND.md §6.5, `FR-BED-01`, `FR-BED-06`).
 *
 * The tile is asserted on the rule §6.5 states outright — state carried by a
 * word as well as a fill — and on being a real, keyboard-reachable button.
 * The mirror is asserted on the thing it exists for: when the board and the
 * published figure disagree, the ward is told, in words, beside the number.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';

import { BedTile } from '../BedTile.js';
import { CapacityMirror, type CapacityMirrorRow } from '../CapacityMirror.js';

/** Contrast is proven from the tokens by `contrast.test.ts`; jsdom has no stylesheet. */
async function violations(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  return results.violations;
}

const bengali = (value: number): string =>
  String(value).replace(/[0-9]/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)] ?? d);

describe('<BedTile>', () => {
  it('names its state in words, never by colour alone (A11Y-03)', () => {
    render(
      <BedTile
        label="301"
        state="cleaning"
        stateLabel="পরিষ্কার হচ্ছে"
        detail="১২ মিনিট"
        selected={false}
        onSelect={() => undefined}
      />,
    );

    const tile = screen.getByRole('button', { name: /301/ });
    expect(tile).toHaveTextContent('পরিষ্কার হচ্ছে');
    expect(tile).toHaveTextContent('১২ মিনিট');
    expect(tile).toHaveAttribute('data-state', 'cleaning');
  });

  it('is a button a keyboard can reach and press, and says when it is selected', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <BedTile label="302" state="free" stateLabel="খালি" selected={false} onSelect={onSelect} />,
    );

    await userEvent.tab();
    expect(screen.getByRole('button', { name: /302/ })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledOnce();

    rerender(<BedTile label="302" state="free" stateLabel="খালি" selected onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: /302/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('marks a change the server has not heard about, with a label a reader announces', () => {
    render(
      <BedTile
        label="ICU-01"
        state="occupied"
        stateLabel="ভর্তি"
        selected={false}
        pending
        pendingLabel="সার্ভারে পাঠানো বাকি"
        onSelect={() => undefined}
      />,
    );

    expect(screen.getByRole('img', { name: 'সার্ভারে পাঠানো বাকি' })).toBeInTheDocument();
    expect(screen.getByTestId('bed-tile-ICU-01')).toHaveAttribute('data-pending', 'true');
  });

  it('passes axe in every state', async () => {
    const { container } = render(
      <div>
        {(['free', 'occupied', 'cleaning', 'reserved', 'out_of_service'] as const).map((state) => (
          <BedTile
            key={state}
            label={state}
            state={state}
            stateLabel={state}
            selected={false}
            onSelect={() => undefined}
          />
        ))}
      </div>,
    );
    expect(await violations(container)).toEqual([]);
  });
});

describe('<CapacityMirror> (FR-BED-06)', () => {
  const NOW = new Date('2026-09-21T10:00:00Z');
  const labels = {
    justNow: 'এইমাত্র হালনাগাদ',
    ago: 'হালনাগাদ {time} মিনিট আগে',
    never: 'কখনো নিশ্চিত করা হয়নি',
    stale: 'তথ্য পুরনো হতে পারে',
  };

  function mirror(rows: readonly CapacityMirrorRow[]): ReturnType<typeof render> {
    return render(
      <CapacityMirror
        title="অ্যাপে দেখাচ্ছে"
        subtitle="রোগীরা এখন এই সংখ্যাগুলো দেখছেন"
        rows={rows}
        now={NOW}
        staleAfterMinutes={10}
        freshnessLabels={labels}
        formatMinutes={bengali}
        freeOfTotal="{free}/{total} খালি"
        mismatch="বোর্ডে {board} — অ্যাপ এখনো পুরনো সংখ্যা দেখাচ্ছে"
        empty="এই হাসপাতালে কোনো বেড নেই"
        formatCount={bengali}
      />,
    );
  }

  it('shows the published figure with its own age, per kind', () => {
    mirror([
      {
        key: 'icu',
        name: 'আইসিইউ',
        publishedFree: 1,
        publishedTotal: 6,
        boardFree: 1,
        asOf: new Date('2026-09-21T09:57:00Z'),
      },
    ]);

    const row = screen.getByTestId('mirror-icu');
    expect(row).toHaveTextContent('১/৬ খালি');
    expect(row).toHaveTextContent('হালনাগাদ ৩ মিনিট আগে');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says so, in words, when the board and the public disagree', () => {
    mirror([
      {
        key: 'general',
        name: 'সাধারণ',
        publishedFree: 2,
        publishedTotal: 8,
        boardFree: 1,
        asOf: new Date('2026-09-21T09:59:00Z'),
      },
    ]);

    expect(screen.getByRole('status')).toHaveTextContent(
      'বোর্ডে ১ — অ্যাপ এখনো পুরনো সংখ্যা দেখাচ্ছে',
    );
  });

  it('lets a stale figure look stale, so the ward sees the cost of not updating', () => {
    mirror([
      {
        key: 'burn',
        name: 'বার্ন',
        publishedFree: 2,
        publishedTotal: 8,
        boardFree: 2,
        asOf: new Date('2026-09-21T06:00:00Z'),
      },
    ]);

    expect(screen.getByTestId('freshness')).toHaveAttribute('data-stale', 'true');
  });

  it('says a hospital has no beds rather than drawing an empty card', async () => {
    const { container } = mirror([]);
    expect(screen.getByText('এই হাসপাতালে কোনো বেড নেই')).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
  });
});
