'use client';

/**
 * `/pay/return` — `S-A-07p`, where bKash or Nagad sends the patient back
 * (plan H3; `PRD.md` `FR-PAY-08`, `FR-PAY-09`; `APP_FLOW.md` `S-A-07p`).
 *
 * **The address's status is never believed.** On load the page asks the
 * server, which asks the provider; the provider's word in the address goes
 * along only to choose how it is asked. A pending answer is asked again every
 * ten seconds while the hold lasts.
 *
 * States (`GR-03`): checking; paid; still pending; failed or cancelled, with
 * a new attempt and, where the hospital takes it, the counter; the hold run
 * out, turned to the counter or released; could not check; offline; and a
 * phone that holds no link for the booking, which is told the server will
 * confirm it by itself and say so by SMS.
 */

import { useCallback, useEffect, useState } from 'react';

import { formatNumber, numeralsFor, tp } from '@platform/i18n';
import { Button, useLocale } from '@platform/ui';

import { FailedState, OfflineNotice, Panel, SkeletonCards } from '@/components/States';
import { TabScreen } from '@/components/TabScreen';
import { useOnline } from '@/hooks/useOnline';
import { liveUrlFor } from '@/lib/bookings';
import { askAbout, goPay, hintFrom, minutesLeft, payAtCounter } from '@/lib/payments';

import type { PaymentConfirmation } from '@/lib/api';
import type { ReactNode } from 'react';

type View =
  | { readonly kind: 'reading' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'answered'; readonly answer: PaymentConfirmation }
  | { readonly kind: 'noCredential' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'counterChosen' };

const ASK_AGAIN_MS = 10_000;

export default function PaymentReturnPage(): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const online = useOnline();
  const [target, setTarget] = useState<{
    readonly bookingId: string;
    readonly paymentId: string;
    readonly hint: 'success' | 'failure' | 'cancel' | null;
  } | null>(null);
  const [view, setView] = useState<View>({ kind: 'reading' });
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // Read after mount: the server has no `location`.
  useEffect(() => {
    const params = new URLSearchParams(globalThis.location.search);
    const bookingId = params.get('booking');
    const paymentId = params.get('payment');
    if (bookingId === null || paymentId === null || bookingId === '' || paymentId === '') {
      setView({ kind: 'failed' });
      return;
    }
    setTarget({ bookingId, paymentId, hint: hintFrom(params) });
  }, []);

  const ask = useCallback(async () => {
    if (target === null) return;
    setView((current) => (current.kind === 'answered' ? current : { kind: 'checking' }));
    try {
      const answer = await askAbout(target);
      setView(answer === null ? { kind: 'noCredential' } : { kind: 'answered', answer });
    } catch {
      setView({ kind: 'failed' });
    }
  }, [target]);

  useEffect(() => {
    if (target !== null && online) void ask();
  }, [target, online, ask]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  // Still pending at the provider: asked again while the hold lasts.
  const pending =
    view.kind === 'answered' &&
    view.answer.payment.state === 'pending' &&
    view.answer.serial === 'held';
  useEffect(() => {
    if (!pending || !online) return undefined;
    const timer = setInterval(() => {
      void ask();
    }, ASK_AGAIN_MS);
    return () => {
      clearInterval(timer);
    };
  }, [pending, online, ask]);

  const title = tp('payReturnTitle', locale);

  if (!online && view.kind !== 'answered') {
    return (
      <TabScreen title={title} testId="pay-return">
        <OfflineNotice testId="pay-return-offline">{tp('payOffline', locale)}</OfflineNotice>
      </TabScreen>
    );
  }

  if (view.kind === 'reading' || view.kind === 'checking') {
    return (
      <TabScreen title={title} testId="pay-return">
        <p className="text-body-md" aria-live="polite" data-testid="pay-return-checking">
          {tp('payChecking', locale)}
        </p>
        <div aria-busy="true">
          <SkeletonCards count={1} height={120} />
        </div>
      </TabScreen>
    );
  }

  if (view.kind === 'noCredential') {
    return (
      <TabScreen title={title} testId="pay-return">
        <Panel className="p-4" testId="pay-return-no-credential">
          <p className="text-body-md">{tp('payNoCredential', locale)}</p>
        </Panel>
      </TabScreen>
    );
  }

  if (view.kind === 'failed' || target === null) {
    return (
      <TabScreen title={title} testId="pay-return">
        <FailedState
          testId="pay-return-error"
          action={
            <Button variant="secondary" onClick={() => void ask()}>
              {tp('tryAgain', locale)}
            </Button>
          }
        >
          {tp('payCheckFailed', locale)}
        </FailedState>
      </TabScreen>
    );
  }

  const live = (
    <a
      href={liveUrlFor(target.bookingId)}
      data-testid="pay-return-live"
      className="flex min-h-[52px] items-center justify-center rounded-md bg-brand-600 px-5 text-body-lg font-bold text-white"
    >
      {tp('viewLiveSerial', locale)}
    </a>
  );

  if (view.kind === 'counterChosen') {
    return (
      <TabScreen title={title} testId="pay-return">
        <Panel className="p-4" testId="pay-return-counter">
          <p className="text-body-md">{tp('payCounterChosen', locale)}</p>
        </Panel>
        {live}
      </TabScreen>
    );
  }

  const { answer } = view;
  const left = minutesLeft(answer.payment.holdUntil, now);

  if (answer.payment.state === 'paid' || answer.serial === 'confirmed') {
    return (
      <TabScreen title={title} testId="pay-return">
        <section
          className="flex flex-col gap-1 rounded-lg bg-brand-100 p-5 text-center"
          data-testid="pay-return-paid"
        >
          <p className="text-title-md font-bold text-brand-700">{tp('payPaidTitle', locale)}</p>
          <p className="text-body-md">{tp('payPaidBody', locale)}</p>
        </section>
        {live}
      </TabScreen>
    );
  }

  if (
    answer.serial === 'counter' ||
    answer.serial === 'released' ||
    answer.serial === 'cancelled'
  ) {
    const released = answer.serial !== 'counter';
    return (
      <TabScreen title={title} testId="pay-return">
        <Panel className="p-4" testId={released ? 'pay-return-released' : 'pay-return-counter'}>
          <p className="text-body-md">
            {tp(released ? 'payExpiredReleased' : 'payExpiredCounter', locale)}
          </p>
        </Panel>
        {released ? null : live}
      </TabScreen>
    );
  }

  if (answer.payment.state === 'pending') {
    return (
      <TabScreen title={title} testId="pay-return">
        <Panel className="flex flex-col gap-2 p-4" testId="pay-return-pending">
          <p className="text-title-sm font-bold">{tp('payPendingTitle', locale)}</p>
          <p className="text-body-md">{tp('payPendingBody', locale)}</p>
          <p className="text-body-sm text-ink-secondary tabular-nums">
            {tp('payTimeLeft', locale).replace('{minutes}', formatNumber(left, numerals))}
          </p>
        </Panel>
      </TabScreen>
    );
  }

  // Failed or cancelled, with the hold still running.
  const cancelled = answer.payment.failureReason === 'cancelled';
  return (
    <TabScreen title={title} testId="pay-return">
      <Panel className="flex flex-col gap-2 p-4" testId="pay-return-failed">
        <p className="text-title-sm font-bold">
          {tp(cancelled ? 'payCancelledTitle' : 'payFailedTitle', locale)}
        </p>
        {left > 0 ? (
          <p className="text-body-sm text-ink-secondary tabular-nums">
            {tp('payTimeLeft', locale).replace('{minutes}', formatNumber(left, numerals))}
          </p>
        ) : null}
      </Panel>
      {left > 0 ? (
        <div className="flex flex-col gap-2.5">
          <Button
            size="lg"
            loading={busy}
            data-testid="pay-return-retry"
            onClick={() => {
              setBusy(true);
              void goPay({
                bookingId: target.bookingId,
                method: answer.payment.method,
                redirectUrl: null,
              })
                .then((went) => {
                  if (!went) setView({ kind: 'failed' });
                })
                .catch(() => {
                  setView({ kind: 'failed' });
                })
                .finally(() => {
                  setBusy(false);
                });
            }}
          >
            {tp('payRetry', locale)}
          </Button>
          {answer.counterAllowed ? (
            <Button
              variant="secondary"
              size="lg"
              {...(busy ? { disabled: true, disabledReason: tp('payChecking', locale) } : {})}
              data-testid="pay-return-counter-choice"
              onClick={() => {
                setBusy(true);
                void payAtCounter(target.bookingId)
                  .then((done) => {
                    setView(done ? { kind: 'counterChosen' } : { kind: 'failed' });
                  })
                  .catch(() => {
                    // Refused (`PREPAYMENT_REQUIRED`): this serial must be paid
                    // online, and the retry is the way.
                    setView({ kind: 'failed' });
                  })
                  .finally(() => {
                    setBusy(false);
                  });
              }}
            >
              {tp('payAtCounterInstead', locale)}
            </Button>
          ) : null}
        </div>
      ) : null}
    </TabScreen>
  );
}
