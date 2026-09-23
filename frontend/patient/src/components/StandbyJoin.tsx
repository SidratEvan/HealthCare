'use client';

/**
 * Joining a full chamber's standby list — `BTN-A06D-STANDBY` (`FR-PAT-25`,
 * `FR-PAT-26`).
 *
 * The same four things a guest booking asks (`FR-GST-02`), and one choice
 * that is the owner's ruling on STATUS decision 62: pay now and be seated the
 * moment a serial frees, or pay later and be asked on this phone. Both are
 * stated in full before the button, including that a prepayment for a serial
 * that never comes is returned — a person deciding wants the consequence, not
 * the label.
 */

import { useCallback, useState } from 'react';

import { formatDateTime, formatTaka, tp } from '@platform/i18n';
import { Button, Card, Input } from '@platform/ui';

import { joinStandby } from '@/lib/api';

import type { SessionCard, StandbyJoined } from '@/lib/types';
import type { ReactNode } from 'react';

const LOCALE = 'bn' as const;
const NUMERALS = 'bengali' as const;

type Prepay = 'bkash' | 'nagad' | 'card';

export function StandbyJoin({
  session,
  online,
  onJoined,
}: {
  readonly session: SessionCard;
  readonly online: boolean;
  readonly onJoined: (joined: StandbyJoined) => void;
}): ReactNode {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<'male' | 'female' | 'other'>('female');
  const [prepay, setPrepay] = useState<Prepay | null>('bkash');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [phoneTouched, setPhoneTouched] = useState(false);

  // One key per attempt, reused across its retries (`FR-QUE-51`).
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const phoneValid = /^\+8801[3-9]\d{8}$/.test(phone);
  const ready = online && name.trim().length >= 2 && phoneValid && age !== '';

  const submit = useCallback(async () => {
    setBusy(true);
    setFailure(null);
    try {
      onJoined(
        await joinStandby({
          sessionId: session.id,
          guest: { name: name.trim(), phone, ageYears: Number(age), sex },
          prepay,
          idempotencyKey,
        }),
      );
    } catch (error) {
      const guard = (error as { details?: { guard?: string } }).details?.guard;
      setFailure(
        guard === 'SESSION_NOT_FULL'
          ? tp('standbyNotFull', LOCALE)
          : guard === 'ALREADY_BOOKED'
            ? tp('standbyAlreadyBooked', LOCALE)
            : tp('standbyJoinFailed', LOCALE),
      );
    } finally {
      setBusy(false);
    }
  }, [session.id, name, phone, age, sex, prepay, idempotencyKey, onJoined]);

  return (
    <section className="flex flex-col gap-4" data-testid="standby-join">
      <h1 className="font-reading text-title-lg">{tp('standbyJoinTitle', LOCALE)}</h1>

      <Card>
        <p className="text-title-sm tabular-nums">
          {formatDateTime(session.plannedStart, NUMERALS)}
        </p>
        <p className="text-body-sm text-ink-muted">{session.doctorNameBn}</p>
        <p className="text-body-sm text-ink-muted">{session.hospitalNameBn}</p>
        <p className="mt-2 text-body-sm text-ink-secondary">{tp('standbyJoinWhy', LOCALE)}</p>
      </Card>

      <div className="flex flex-col gap-4">
        <Input
          label={tp('patientName', LOCALE)}
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <Input
          label={tp('mobileNumber', LOCALE)}
          kind="phone"
          required
          value={phone}
          placeholder="+8801XXXXXXXXX"
          helper={tp('mobileHelper', LOCALE)}
          {...(phoneTouched && !phoneValid ? { error: tp('mobileInvalid', LOCALE) } : {})}
          onBlur={() => {
            setPhoneTouched(true);
          }}
          onChange={(event) => {
            setPhone(event.target.value.trim());
          }}
        />
        <Input
          label={tp('age', LOCALE)}
          kind="number"
          required
          value={age}
          onChange={(event) => {
            setAge(event.target.value.replace(/\D/g, ''));
          }}
        />
        <fieldset className="flex flex-col gap-2 border-0 p-0">
          <legend className="font-ui text-body-sm font-semibold text-ink">
            {tp('sex', LOCALE)}
          </legend>
          <div className="flex gap-2">
            {(['female', 'male', 'other'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={sex === value}
                onClick={() => {
                  setSex(value);
                }}
                className="min-h-touch flex-1 rounded-sm border border-line-strong bg-surface px-3 text-body-md aria-pressed:border-brand-600 aria-pressed:bg-brand-100"
              >
                {tp(value, LOCALE)}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      {/* The ruling, as two whole choices with their consequences. */}
      <fieldset className="flex flex-col gap-3 border-0 p-0">
        <legend className="font-ui text-body-sm font-semibold text-ink">
          {tp('standbyHowTitle', LOCALE)}
        </legend>

        <button
          type="button"
          aria-pressed={prepay !== null}
          onClick={() => {
            setPrepay((current) => current ?? 'bkash');
          }}
          data-testid="standby-choice-prepay"
          className="flex flex-col gap-1 rounded-md border border-line-strong bg-surface p-4 text-left aria-pressed:border-brand-600 aria-pressed:bg-brand-100"
        >
          <span className="text-body-md font-semibold">{tp('standbyPrepayOption', LOCALE)}</span>
          <span className="text-body-sm text-ink-secondary">
            {formatTaka(session.feePoisha, NUMERALS)} · {tp('standbyPrepayNote', LOCALE)}
          </span>
        </button>

        {prepay === null ? null : (
          <div className="grid grid-cols-3 gap-2" data-testid="standby-prepay-methods">
            {(
              [
                ['bkash', 'payBkash'],
                ['nagad', 'payNagad'],
                ['card', 'payCard'],
              ] as const
            ).map(([value, key]) => (
              <button
                key={value}
                type="button"
                aria-pressed={prepay === value}
                onClick={() => {
                  setPrepay(value);
                }}
                className="min-h-touch rounded-sm border border-line-strong bg-surface px-3 text-body-md aria-pressed:border-brand-600 aria-pressed:bg-brand-100"
              >
                {tp(key, LOCALE)}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          aria-pressed={prepay === null}
          onClick={() => {
            setPrepay(null);
          }}
          data-testid="standby-choice-ask"
          className="flex flex-col gap-1 rounded-md border border-line-strong bg-surface p-4 text-left aria-pressed:border-brand-600 aria-pressed:bg-brand-100"
        >
          <span className="text-body-md font-semibold">{tp('standbyAskOption', LOCALE)}</span>
          <span className="text-body-sm text-ink-secondary">{tp('standbyAskNote', LOCALE)}</span>
        </button>
      </fieldset>

      {failure === null ? null : (
        <p role="alert" className="rounded-sm bg-alert-100 p-3 text-body-md text-alert-700">
          {failure}
        </p>
      )}

      <Button
        size="lg"
        fullWidth
        loading={busy}
        data-testid="standby-confirm"
        onClick={() => {
          void submit();
        }}
        {...(ready
          ? {}
          : {
              disabled: true as const,
              disabledReason: online ? tp('yourDetails', LOCALE) : tp('offline', LOCALE),
            })}
      >
        {tp('standbyConfirm', LOCALE)}
      </Button>
    </section>
  );
}
