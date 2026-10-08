'use client';

/**
 * `CARD-A07D-HOLD` and `BTN-A07D-PAY` (plan H3; `APP_FLOW.md` `S-A-07d`;
 * `PRD.md` `FR-PAY-08`).
 *
 * The serial is the patient's while it is held for its online payment. The
 * card counts down to the server's deadline and says, before it runs out,
 * what happens if it does (`GR-01`): the serial stands to be paid at the
 * counter, or it is released. The pay button sends the patient to bKash or
 * Nagad; the booking and its link are already kept on the phone, so the
 * return page can ask about it.
 */

import { useEffect, useState } from 'react';

import { formatNumber, numeralsFor, tp } from '@platform/i18n';
import { Button, useLocale } from '@platform/ui';

import { useOnline } from '@/hooks/useOnline';
import { goPay, minutesLeft } from '@/lib/payments';

import type { BookingPaymentView } from '@/lib/api';
import type { ReactNode } from 'react';

const PAY_LABEL = {
  bkash: 'payNowBkash',
  nagad: 'payNowNagad',
  card: 'payNowCard',
} as const;

export function PaymentHold({
  bookingId,
  payment,
}: {
  readonly bookingId: string;
  readonly payment: BookingPaymentView;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const online = useOnline();
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const left = minutesLeft(payment.holdUntil, now);
  const over = left <= 0;
  const label =
    payment.method === 'bkash' || payment.method === 'nagad' || payment.method === 'card'
      ? PAY_LABEL[payment.method]
      : 'payNowBkash';

  return (
    <section
      className="flex flex-col gap-3 rounded-md border border-warn-600 bg-warn-100 p-4"
      data-testid="payment-hold"
    >
      <p className="text-title-sm font-bold">{tp(over ? 'holdOver' : 'holdTitle', locale)}</p>
      {over ? null : (
        <p className="text-body-md font-semibold tabular-nums" data-testid="payment-hold-left">
          {tp('holdPayWithin', locale).replace('{minutes}', formatNumber(left, numerals))}
        </p>
      )}
      <p className="text-body-sm text-ink-secondary">
        {tp(payment.afterHold === 'released' ? 'holdThenReleased' : 'holdThenCounter', locale)}
      </p>
      {over ? null : (
        <Button
          size="lg"
          loading={busy}
          {...(online ? {} : { disabled: true, disabledReason: tp('offline', locale) })}
          data-testid="payment-hold-pay"
          onClick={() => {
            setBusy(true);
            setFailed(false);
            void goPay({ bookingId, method: payment.method, redirectUrl: payment.redirectUrl })
              .then((went) => {
                if (!went) setFailed(true);
              })
              .catch(() => {
                setFailed(true);
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          {tp(label, locale)}
        </Button>
      )}
      {failed ? (
        <p role="alert" className="text-body-sm text-alert-700">
          {tp('payStartFailed', locale)}
        </p>
      ) : null}
    </section>
  );
}
