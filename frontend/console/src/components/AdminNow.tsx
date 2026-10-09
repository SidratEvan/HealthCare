'use client';

/**
 * `CARD-B10-NOW` — the hospital now, at a glance (`PRD.md` `FR-ADM-12`;
 * `APP_FLOW.md` B6; plan R6; the owner's decision 8b of 8 October).
 *
 * Five live figures for today above the dashboard's reports: doctors sitting
 * of those scheduled, patients waiting, appointments seen of booked, beds
 * free of those in service, and the emergency desk. Read on opening and
 * every minute after, with the panel's age beside it and the beds' own age
 * under their tile (`FR-OFF-03`). A figure the hospital has no means of
 * knowing says so rather than showing a zero (`PRD.md` §3.2). Counts only.
 */

import { useCallback, useEffect, useState } from 'react';

import { formatAge, formatNumber, numeralsFor, t } from '@platform/i18n';
import { Button, Card, FreshnessLine, useLocale } from '@platform/ui';

import { adminApi, failureOf, type Overview } from '@/lib/admin';
import { readDemoSession } from '@/lib/demo';

import type { ReactNode } from 'react';

const REFRESH_MS = 60_000;

export function AdminNow(): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const [data, setData] = useState<Overview | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'offline' | 'error'>('loading');
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    try {
      setData(await adminApi.overview(readDemoSession()?.token ?? ''));
      setState('ready');
    } catch (error: unknown) {
      // What was on screen stays, aged by its freshness line.
      setState(failureOf(error));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load();
    }, REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 15_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const num = (value: number): string => formatNumber(value, numerals);
  // A fraction, not words: each tile's note says what the two numbers are.
  const of = (part: number, whole: number): string => `${num(part)} / ${num(whole)}`;
  const freshness = (asOf: string | null): ReactNode => (
    <FreshnessLine
      asOf={asOf === null ? null : new Date(asOf)}
      now={now}
      labels={{
        justNow: t('updatedJustNow', locale),
        ago: t('updatedAgo', locale),
        never: t('adminNeverRecorded', locale),
        stale: t('staleWarning', locale),
      }}
      formatMinutes={(value) => formatAge(value, locale, numerals)}
    />
  );

  return (
    <Card>
      <section className="flex flex-col gap-3" data-testid="admin-now">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-title-sm">{t('adminNowTitle', locale)}</h2>
          {data === null ? null : freshness(data.serverTs)}
        </div>

        {state === 'offline' || state === 'error' ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 text-body-sm text-alert-700"
          >
            <span data-testid="admin-now-failed">
              {t(state === 'offline' ? 'adminOffline' : 'adminLoadFailed', locale)}
            </span>
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              {t('retry', locale)}
            </Button>
          </div>
        ) : null}

        {data === null ? (
          state === 'loading' ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-busy="true">
              {[0, 1, 2, 3, 4].map((key) => (
                <div key={key} className="h-16 rounded-sm bg-sunken" />
              ))}
            </div>
          ) : null
        ) : (
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Tile
              label={t('adminNowDoctors', locale)}
              value={of(data.doctors.sitting, data.doctors.scheduled)}
              note={t('adminNowDoctorsNote', locale)}
              testId="admin-now-doctors"
            />
            <Tile
              label={t('adminNowWaiting', locale)}
              value={num(data.waiting)}
              testId="admin-now-waiting"
            />
            <Tile
              label={t('adminNowAppointments', locale)}
              value={of(data.appointments.seen, data.appointments.booked)}
              note={t('adminNowAppointmentsNote', locale)}
              testId="admin-now-appointments"
            />
            <Tile
              label={t('adminNowBeds', locale)}
              value={data.beds === null ? null : of(data.beds.free, data.beds.total)}
              absent={t('adminNowNoWard', locale)}
              note={data.beds === null ? null : t('adminNowBedsNote', locale)}
              testId="admin-now-beds"
              extra={data.beds === null ? null : freshness(data.beds.asOf)}
            />
            <Tile
              label={t('adminNowEmergency', locale)}
              value={
                data.emergency === null
                  ? null
                  : t('adminNowEmergencyValue', locale)
                      .replace('{onTheWay}', num(data.emergency.onTheWay))
                      .replace('{inEr}', num(data.emergency.inEr))
              }
              absent={t('adminNowNoEr', locale)}
              testId="admin-now-emergency"
            />
          </dl>
        )}
      </section>
    </Card>
  );
}

function Tile({
  label,
  value,
  note = null,
  absent = null,
  extra = null,
  testId,
}: {
  readonly label: string;
  /** Null: the hospital has nothing to know this from, said as `absent`. */
  readonly value: string | null;
  readonly note?: string | null;
  readonly absent?: string | null;
  readonly extra?: ReactNode;
  readonly testId: string;
}): ReactNode {
  return (
    <div className="flex flex-col gap-1 rounded-sm bg-sunken p-3" data-testid={testId}>
      <dt className="text-caption text-ink-muted">{label}</dt>
      <dd className="text-title-sm font-semibold tabular-nums">
        {value ?? <span className="text-body-sm font-normal text-ink-muted">{absent}</span>}
      </dd>
      {note === null ? null : <p className="text-caption text-ink-muted">{note}</p>}
      {extra}
    </div>
  );
}
