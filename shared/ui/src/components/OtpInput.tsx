/**
 * OTP input (FRONTEND.md §5.3).
 *
 * "Six separate boxes, 48 × 56 px, `numeric-tabular`, auto-advance,
 * paste-aware, SMS autofill enabled, auto-submit on completion. Failure shakes
 * once (respecting reduced motion) and clears."
 *
 * ## Why this exists when authentication does not
 *
 * CLAUDE.md §4.1 defers every OTP *flow* to Supabase Auth, and none is built.
 * This is the input primitive, not a flow: it is named in step 7's component
 * list, it holds no credential and calls no endpoint, and Supabase's flow will
 * need exactly this box when it arrives. Flagged in `docs/STATUS.md` as the
 * one piece of step 7 with no current caller.
 *
 * ## Paste, and the phone that fills it for you
 *
 * Android and iOS both offer the code from the SMS. `autoComplete="one-time-code"`
 * is what makes that offer appear, and the paste handler is what makes it land
 * in six separate boxes rather than all six characters in the first one — the
 * failure mode that makes split OTP inputs infuriating on a real phone.
 */

import { useEffect, useRef, useState } from 'react';

import { cx } from './cx.js';

import type { ClipboardEvent, KeyboardEvent, ReactNode } from 'react';

/** `FR-PAT-01`'s code length. Six is what every Bangladeshi aggregator sends. */
export const OTP_LENGTH = 6;

export interface OtpInputProps {
  readonly label: string;
  /** Called once the last box is filled (§5.3: auto-submit on completion). */
  readonly onComplete: (code: string) => void;
  /** Set by the caller when the code was wrong: shakes once, then clears. */
  readonly invalid?: boolean;
  readonly errorMessage?: string;
  readonly disabled?: boolean;
}

export function OtpInput({
  label,
  onComplete,
  invalid = false,
  errorMessage,
  disabled = false,
}: OtpInputProps): ReactNode {
  const [digits, setDigits] = useState<string[]>(() => Array<string>(OTP_LENGTH).fill(''));
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  // §5.3: a failed code clears itself and returns focus to the first box, so
  // the next attempt starts where the thumb already is.
  useEffect(() => {
    if (!invalid) return;
    setDigits(Array<string>(OTP_LENGTH).fill(''));
    boxes.current[0]?.focus();
  }, [invalid]);

  const write = (next: string[]): void => {
    setDigits(next);
    const code = next.join('');
    if (code.length === OTP_LENGTH && !next.includes('')) onComplete(code);
  };

  const handleChange = (index: number, raw: string): void => {
    // Accept only digits, and take the last one typed — so overtyping a filled
    // box replaces it rather than being ignored.
    const digit = raw.replace(/\D/g, '').slice(-1);
    if (digit === '') return;

    const next = [...digits];
    next[index] = digit;
    write(next);

    if (index < OTP_LENGTH - 1) boxes.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      const next = [...digits];

      // Backspace in an empty box steps back and clears the previous one,
      // which is what people expect and what a naive implementation gets
      // wrong by trapping focus in the empty box.
      if (next[index] === '' && index > 0) {
        next[index - 1] = '';
        setDigits(next);
        boxes.current[index - 1]?.focus();
        return;
      }

      next[index] = '';
      setDigits(next);
      return;
    }

    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      boxes.current[index - 1]?.focus();
    }

    if (event.key === 'ArrowRight' && index < OTP_LENGTH - 1) {
      event.preventDefault();
      boxes.current[index + 1]?.focus();
    }
  };

  /** Spreads a pasted or autofilled code across the boxes (§5.3). */
  const handlePaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    if (pasted === '') return;

    event.preventDefault();
    const next = Array<string>(OTP_LENGTH).fill('');
    for (const [index, character] of [...pasted].entries()) next[index] = character;
    write(next);

    // Focus the first empty box, or the last one when the code was complete.
    const landing = Math.min(pasted.length, OTP_LENGTH - 1);
    boxes.current[landing]?.focus();
  };

  return (
    <fieldset className="flex flex-col gap-2 border-0 p-0" disabled={disabled}>
      <legend className="font-ui text-body-sm font-semibold text-ink">{label}</legend>

      <div
        className={cx('flex gap-2', invalid && 'motion-safe:animate-[shake_160ms_ease-in-out_1]')}
      >
        {digits.map((digit, index) => (
          <input
            // The boxes are positional and never reordered, so the index is a
            // stable identity here.
            key={index}
            ref={(element) => {
              boxes.current[index] = element;
            }}
            value={digit}
            onChange={(event) => {
              handleChange(index, event.target.value);
            }}
            onKeyDown={(event) => {
              handleKeyDown(index, event);
            }}
            onPaste={handlePaste}
            type="text"
            inputMode="numeric"
            // What makes the phone offer the code from the SMS.
            autoComplete="one-time-code"
            maxLength={1}
            aria-label={`${label} ${String(index + 1)}`}
            aria-invalid={invalid || undefined}
            className={cx(
              'h-[56px] w-[48px] rounded-sm border bg-surface text-center',
              'font-ui text-title-lg tabular-nums text-ink',
              'focus:outline-none focus:ring-2 focus:ring-brand-600 focus:ring-offset-1',
              invalid ? 'border-alert-600' : 'border-line-strong focus:border-brand-600',
            )}
          />
        ))}
      </div>

      {invalid && errorMessage !== undefined ? (
        <p role="alert" className="text-body-sm text-alert-600">
          {errorMessage}
        </p>
      ) : null}
    </fieldset>
  );
}
