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

import { formatDateTime, formatTaka, tp, numeralsFor, localName } from '@platform/i18n';
import { Button, Card, Input, useLocale } from '@platform/ui';

import { joinStandby } from '@/lib/api';

import type { SessionCard, StandbyJoined } from '@/lib/types';
import type { ReactNode } from 'react';

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
  const locale = useLocale();
  const numerals = numeralsFor(locale);
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
          ? tp('standbyNotFull', locale)
          : guard === 'ALREADY_BOOKED'
            ? tp('standbyAlreadyBooked', locale)
            : tp('standbyJoinFailed', locale),
      );
    } finally {
      setBusy(false);
    }
  }, [session.id, name, phone, age, sex, prepay, idempotencyKey, onJoined, locale]);

  return (
    <section className="flex flex-col gap-4" data-testid="standby-join">
      <h1 className="font-reading text-title-lg">{tp('standbyJoinTitle', locale)}</h1>

      <Card>
        <p className="text-title-sm tabular-nums">
          {formatDateTime(session.plannedStart, numerals)}
        </p>
        <p className="text-body-sm text-ink-muted">
          {localName(locale, session.doctorNameBn, session.doctorNameEn)}
        </p>
        <p className="text-body-sm text-ink-muted">
          {localName(locale, session.hospitalNameBn, session.hospitalNameEn)}
        </p>
        <p className="mt-2 text-body-sm text-ink-secondary">{tp('standbyJoinWhy', locale)}</p>
      </Card>

      <div className="flex flex-col gap-4">
        <Input
          label={tp('patientName', locale)}
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <Input
          label={tp('mobileNumber', locale)}
          kind="phone"
          required
          value={phone}
          placeholder="+8801XXXXXXXXX"
          helper={tp('mobileHelper', locale)}
          {...(phoneTouched && !phoneValid ? { error: tp('mobileInvalid', locale) } : {})}
          onBlur={() => {
            setPhoneTouched(true);
          }}
          onChange={(event) => {
            setPhone(event.target.value.trim());
          }}
        />
        <Input
          label={tp('age', locale)}
          kind="number"
          required
          value={age}
          onChange={(event) => {
            setAge(event.target.value.replace(/\D/g, ''));
          }}
        />
        <fieldset className="flex flex-col gap-2 border-0 p-0">
          <legend className="font-ui text-body-sm font-semibold text-ink">
            {tp('sex', locale)}
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
                {tp(value, locale)}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      {/* The ruling, as two whole choices with their consequences. */}
      <fieldset className="flex flex-col gap-3 border-0 p-0">
        <legend className="font-ui text-body-sm font-semibold text-ink">
          {tp('standbyHowTitle', locale)}
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
          <span className="text-body-md font-semibold">{tp('standbyPrepayOption', locale)}</span>
          <span className="text-body-sm text-ink-secondary">
            {formatTaka(session.feePoisha, numerals)} · {tp('standbyPrepayNote', locale)}
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
                {tp(key, locale)}
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
          <span className="text-body-md font-semibold">{tp('standbyAskOption', locale)}</span>
          <span className="text-body-sm text-ink-secondary">{tp('standbyAskNote', locale)}</span>
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
              disabledReason: online ? tp('yourDetails', locale) : tp('offline', locale),
            })}
      >
        {tp('standbyConfirm', locale)}
      </Button>
    </section>
  );
}
