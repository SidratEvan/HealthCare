/**
 * The primitives, rendered (FRONTEND.md §5).
 *
 * What is asserted here is **behaviour and accessibility**, not appearance.
 * Tailwind class names are inert strings in jsdom, so a colour cannot be
 * checked from here — `tokens.test.ts` and `contrast.test.ts` cover the visual
 * layer. What these tests protect is the part that breaks silently: a button
 * that stops being reachable by keyboard, an error that never reaches a screen
 * reader, a sheet that traps nobody.
 *
 * Every rule below traces to a line in §5 or to a `GR-*` global rule, and each
 * is one somebody would otherwise have to remember at every call site.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '../Button.js';
import { Card, CardMeta, CardTitle } from '../Card.js';
import { Chip, FilterChip } from '../Chip.js';
import { Input } from '../Input.js';
import { OTP_LENGTH, OtpInput } from '../OtpInput.js';
import { Sheet, SheetActions } from '../Sheet.js';
import { ToastProvider, useToast } from '../Toast.js';

import type { ReactNode } from 'react';

/**
 * Runs axe over a container and returns its violations.
 *
 * The rendered markup carries no stylesheet in jsdom, so colour-contrast is
 * disabled here — it would report every element as unknown. Contrast is
 * proven from the token values instead, by `contrast.test.ts`, which is the
 * stronger check anyway: it runs against the palette rather than against
 * whatever one fixture happened to render.
 */
async function violations(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations;
}

/** Prints a readable failure instead of "expected 1 to be 0". */
function describeViolations(found: readonly axe.Result[]): string {
  return found.map((violation) => `${violation.id}: ${violation.help}`).join('\n');
}

describe('Button (§5.1)', () => {
  it('is a real button, reachable and activated by the keyboard', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>সিরিয়াল নিন</Button>);

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'সিরিয়াল নিন' })).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('defaults to type="button", so it cannot submit a form by accident', () => {
    render(<Button>বাতিল</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('keeps its width while loading, and says it is busy', () => {
    const { rerender } = render(<Button>পরবর্তী রোগী</Button>);
    const before = screen.getByRole('button').textContent;

    rerender(<Button loading>পরবর্তী রোগী</Button>);
    const button = screen.getByRole('button');

    // §5.1: "inline spinner replacing the label, width preserved so layout
    // never jumps". The label stays in the flow, only made invisible.
    expect(button.textContent).toBe(before);
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('stays focusable while loading', async () => {
    // A disabled control leaves the tab order, losing the focus the user just
    // placed on it. `aria-disabled` keeps it announced and reachable.
    render(<Button loading>পরবর্তী রোগী</Button>);
    await userEvent.tab();
    expect(screen.getByRole('button')).toHaveFocus();
  });

  it('never disables silently — the reason is the accessible description', () => {
    // §5.1: "Never disable a primary silently — always say what's missing."
    // The type makes `disabled` without `disabledReason` a compile error; this
    // proves the reason actually reaches the user.
    render(
      <Button disabled disabledReason="আগে একটি সময় বেছে নিন">
        নিশ্চিত করুন
      </Button>,
    );

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'আগে একটি সময় বেছে নিন');
  });

  it('passes axe in every variant', async () => {
    const { container } = render(
      <div>
        <Button variant="primary">প্রাথমিক</Button>
        <Button variant="secondary">দ্বিতীয়</Button>
        <Button variant="quiet">শান্ত</Button>
        <Button variant="emergency">জরুরি</Button>
        <Button variant="danger-quiet">মুছে ফেলুন</Button>
      </div>,
    );

    const found = await violations(container);
    expect(found, describeViolations(found)).toHaveLength(0);
  });
});

describe('Input (§5.2)', () => {
  it('labels the field properly, rather than using the placeholder', async () => {
    render(<Input label="মোবাইল নম্বর" kind="phone" placeholder="01XXXXXXXXX" />);

    // Found *by its label* — which is what a screen reader and a label click
    // both rely on, and what placeholder-as-label breaks.
    const field = screen.getByLabelText('মোবাইল নম্বর');
    expect(field).toBeInTheDocument();

    await userEvent.click(screen.getByText('মোবাইল নম্বর'));
    expect(field).toHaveFocus();
  });

  it('opens the numeric keypad for a phone number', () => {
    // A phone field that opens QWERTY on a cheap Android is a field people
    // mistype (§5.2).
    render(<Input label="মোবাইল নম্বর" kind="phone" />);
    expect(screen.getByLabelText('মোবাইল নম্বর')).toHaveAttribute('inputmode', 'tel');
  });

  it('announces an error and links it to the field', () => {
    render(<Input label="মোবাইল নম্বর" kind="phone" error="১১ সংখ্যার মোবাইল নম্বর দিন" />);

    const field = screen.getByLabelText('মোবাইল নম্বর');
    expect(field).toHaveAttribute('aria-invalid', 'true');

    // role="alert" so it is spoken when it appears, not at the next focus move.
    const error = screen.getByRole('alert');
    expect(error).toHaveTextContent('১১ সংখ্যার মোবাইল নম্বর দিন');
    expect(field).toHaveAttribute('aria-describedby', error.id);
  });

  it('describes the field with its helper while valid', () => {
    render(<Input label="বয়স" kind="number" helper="বছরে" />);
    const field = screen.getByLabelText('বয়স');
    expect(field.getAttribute('aria-describedby')).toBe(screen.getByText('বছরে').id);
  });

  it('passes axe', async () => {
    const { container } = render(
      <Input label="মোবাইল নম্বর" kind="phone" error="১১ সংখ্যার মোবাইল নম্বর দিন" />,
    );
    const found = await violations(container);
    expect(found, describeViolations(found)).toHaveLength(0);
  });
});

describe('OtpInput (§5.3)', () => {
  it('renders six boxes that offer the SMS code', () => {
    render(<OtpInput label="কোড" onComplete={vi.fn()} />);

    const boxes = screen.getAllByRole('textbox');
    expect(boxes).toHaveLength(OTP_LENGTH);
    for (const box of boxes) {
      expect(box).toHaveAttribute('autocomplete', 'one-time-code');
      expect(box).toHaveAttribute('inputmode', 'numeric');
    }
  });

  it('advances as you type and submits on the last digit', async () => {
    const onComplete = vi.fn();
    render(<OtpInput label="কোড" onComplete={onComplete} />);

    const boxes = screen.getAllByRole('textbox');
    boxes[0]?.focus();
    await userEvent.keyboard('123456');

    expect(onComplete).toHaveBeenCalledExactlyOnceWith('123456');
  });

  it('ignores anything that is not a digit', async () => {
    const onComplete = vi.fn();
    render(<OtpInput label="কোড" onComplete={onComplete} />);

    const boxes = screen.getAllByRole('textbox');
    boxes[0]?.focus();
    await userEvent.keyboard('a');

    expect(boxes[0]).toHaveValue('');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('steps back on backspace from an empty box', async () => {
    render(<OtpInput label="কোড" onComplete={vi.fn()} />);

    const boxes = screen.getAllByRole('textbox');
    boxes[0]?.focus();
    await userEvent.keyboard('12');

    // Focus is now in box 3, which is empty. Backspace should clear box 2 and
    // move there, rather than trapping focus in the empty box.
    await userEvent.keyboard('{Backspace}');
    expect(boxes[1]).toHaveFocus();
    expect(boxes[1]).toHaveValue('');
  });

  it('spreads a pasted code across the boxes', async () => {
    const onComplete = vi.fn();
    render(<OtpInput label="কোড" onComplete={onComplete} />);

    const boxes = screen.getAllByRole('textbox');
    boxes[0]?.focus();
    await userEvent.paste('654321');

    expect(onComplete).toHaveBeenCalledExactlyOnceWith('654321');
    expect(boxes[5]).toHaveValue('1');
  });

  it('clears and returns focus to the first box when the code was wrong', async () => {
    const { rerender } = render(<OtpInput label="কোড" onComplete={vi.fn()} />);

    const boxes = screen.getAllByRole('textbox');
    boxes[0]?.focus();
    await userEvent.keyboard('111111');

    rerender(<OtpInput label="কোড" onComplete={vi.fn()} invalid errorMessage="ভুল কোড" />);

    await waitFor(() => {
      expect(screen.getAllByRole('textbox')[0]).toHaveFocus();
    });
    for (const box of screen.getAllByRole('textbox')) expect(box).toHaveValue('');
    expect(screen.getByRole('alert')).toHaveTextContent('ভুল কোড');
  });

  it('passes axe', async () => {
    const { container } = render(<OtpInput label="কোড" onComplete={vi.fn()} />);
    const found = await violations(container);
    expect(found, describeViolations(found)).toHaveLength(0);
  });
});

describe('Card (§5.4) and Chip (§5.5)', () => {
  it('gives a card a real heading', async () => {
    const { container } = render(
      <Card>
        <CardTitle>ডা. আয়েশা সিদ্দিকা</CardTitle>
        <CardMeta>কার্ডিওলজি · শাপলা জেনারেল</CardMeta>
      </Card>,
    );

    expect(screen.getByRole('heading', { name: 'ডা. আয়েশা সিদ্দিকা' })).toBeInTheDocument();
    const found = await violations(container);
    expect(found, describeViolations(found)).toHaveLength(0);
  });

  it('renders a status chip as text, never as a control', () => {
    // §5.5: "A chip never carries an action — chips inform; buttons act." A
    // status announced as a button is a status somebody will try to press.
    render(<Chip tone="caution">দেরিতে</Chip>);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('দেরিতে')).toBeInTheDocument();
  });

  it('renders a filter chip as a toggle button', async () => {
    function Harness(): ReactNode {
      const [on, setOn] = useState(false);
      return (
        <FilterChip
          selected={on}
          onToggle={() => {
            setOn((value) => !value);
          }}
        >
          আজ
        </FilterChip>
      );
    }

    render(<Harness />);
    const chip = screen.getByRole('button', { name: 'আজ' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Sheet (§5.6)', () => {
  function Harness({ dismissible = true }: { readonly dismissible?: boolean }): ReactNode {
    const [open, setOpen] = useState(false);
    return (
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="সিরিয়াল বাতিল করবেন?"
        description="বাতিল করলে আপনার সিরিয়ালটি অন্য কাউকে দেওয়া হবে।"
        dismissible={dismissible}
        trigger={<Button>খুলুন</Button>}
      >
        <SheetActions destructive>
          <Button variant="danger-quiet">হ্যাঁ, বাতিল</Button>
          <Button variant="secondary">ফিরে যান</Button>
        </SheetActions>
      </Sheet>
    );
  }

  it('is a labelled dialog, closes on Escape, and restores focus', async () => {
    render(<Harness />);

    const opener = screen.getByRole('button', { name: 'খুলুন' });
    await userEvent.click(opener);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('সিরিয়াল বাতিল করবেন?');
    expect(dialog).toHaveAccessibleDescription(
      'বাতিল করলে আপনার সিরিয়ালটি অন্য কাউকে দেওয়া হবে।',
    );

    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // §5.6: "restore focus on close" — otherwise a keyboard user is dumped at
    // the top of the document. Radix restores it after the close settles, so
    // this waits rather than asserting on the same tick.
    await waitFor(() => {
      expect(opener).toHaveFocus();
    });
  });

  it('refuses to be dismissed by accident when the answer matters', async () => {
    render(<Harness dismissible={false} />);

    await userEvent.click(screen.getByRole('button', { name: 'খুলুন' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    // Still there: a destructive confirmation is not dismissed by a stray key.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('puts the safe option on the left for a destructive choice (GR-01)', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'খুলুন' }));

    // `flex-row-reverse` means the *last* child renders leftmost. The safe
    // option is written second and therefore appears on the left.
    const actions = screen.getByRole('button', { name: 'ফিরে যান' }).parentElement;
    expect(actions?.className).toContain('flex-row-reverse');
  });

  it('passes axe while open', async () => {
    const { baseElement } = render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'খুলুন' }));

    // The sheet renders in a portal, so axe runs over the whole document.
    const found = await violations(baseElement);
    expect(found, describeViolations(found)).toHaveLength(0);
  });
});

describe('Toast (§5.7)', () => {
  function Harness(): ReactNode {
    const { show } = useToast();
    return (
      <>
        <Button
          onClick={() => {
            show({ title: 'সংরক্ষিত হয়েছে' });
          }}
        >
          প্রথম
        </Button>
        <Button
          onClick={() => {
            show({ title: 'রোগী অনুপস্থিত', action: { label: 'ফেরান', onAction: vi.fn() } });
          }}
        >
          দ্বিতীয়
        </Button>
      </>
    );
  }

  it('shows one toast at a time — a new one replaces the old (§5.7)', async () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'প্রথম' }));
    expect(screen.getByText('সংরক্ষিত হয়েছে')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'দ্বিতীয়' }));

    // A stack of toasts over a console is how staff miss the one that
    // mattered, so the provider holds a single toast rather than a queue.
    await waitFor(() => {
      expect(screen.queryByText('সংরক্ষিত হয়েছে')).not.toBeInTheDocument();
    });
    expect(screen.getByText('রোগী অনুপস্থিত')).toBeInTheDocument();
  });

  it('offers undo as a real button (GR-02)', async () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'দ্বিতীয়' }));
    expect(screen.getByRole('button', { name: 'ফেরান' })).toBeInTheDocument();
  });

  it('refuses to be used without a provider, rather than silently doing nothing', () => {
    // A toast that never appears is a confirmation somebody waited for and did
    // not get. React logs the thrown error; silencing that keeps the output
    // readable without hiding the assertion.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    function Orphan(): ReactNode {
      useToast();
      return null;
    }

    expect(() => render(<Orphan />)).toThrow(/ToastProvider/);
    consoleError.mockRestore();
  });
});
