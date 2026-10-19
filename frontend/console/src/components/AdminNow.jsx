'use client';

/**
 * `CARD-B10-NOW` — the hospital now, at a glance (`PRD.md` `FR-ADM-12`;
 * `APP_FLOW.md` B6; plan R6; the owner's decision 8b of 8 October).
 *
 * Five periodically refreshed figures for today above the dashboard's reports: doctors sitting
 * of those scheduled, patients waiting, appointments seen of booked, beds
 * free of those in service, and the emergency desk. Read on opening and
 * every minute after, with the panel's age beside it and the beds' own age
 * under their tile (`FR-OFF-03`). A figure the hospital has no means of
 * knowing says so rather than showing a zero (`PRD.md` §3.2). Counts only.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  CONSOLE,
  formatAge,
  formatClock,
  formatNumber,
  localName,
  numeralsFor,
  t,
} from '@platform/i18n';
import { Button, Card, ConsoleStatus, FreshnessLine, useLocale } from '@platform/ui';

import { adminApi, failureOf } from '@/lib/admin';
import { attentionFor, chamberGroups } from '@/lib/adminBoard';
import { readDemoSession } from '@/lib/demo';

const REFRESH_MS = 60_000;

export function AdminNow() {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading');
  const [now, setNow] = useState(() => new Date());

  const latest = useRef(0);
  const token = readDemoSession()?.token ?? '';
  const load = useCallback(async () => {
    const request = ++latest.current;
    try {
      const fresh = await adminApi.overview(token);
      if (request !== latest.current) return;
      setData(fresh);
      setState('ready');
    } catch (error) {
      if (request !== latest.current) return;
      // What was on screen stays, aged by its freshness line.
      setState(failureOf(error));
    }
  }, [token]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load();
    }, REFRESH_MS);
    return () => {
      latest.current += 1;
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

  const num = (value) => formatNumber(value, numerals);
  // A fraction, not words: each tile's note says what the two numbers are.
  const of = (part, whole) => `${num(part)} / ${num(whole)}`;
  const freshness = (asOf) => (
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
  const groups = chamberGroups(data?.chambers ?? []);
  const firstGroupFor = new Map();
  groups.forEach((group, index) => {
    group.chambers.forEach((chamber) => {
      if (!firstGroupFor.has(chamber.sessionId)) firstGroupFor.set(chamber.sessionId, index);
    });
  });
  const attention = data === null ? [] : attentionFor(data);

  return (
    <section className="admin-now flex flex-col gap-4" data-testid="admin-now">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-title-sm">{t('adminNowTitle', locale)}</h2>
        <div className="admin-snapshot">
          <span>
            {t('adminDhakaTime', locale)} ·{' '}
            <time data-testid="admin-now-date">{data?.date ?? '—'}</time>
          </span>
          {data === null ? null : freshness(data.serverTs)}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void load()}
            data-testid="admin-now-refresh"
          >
            {t('retry', locale)}
          </Button>
        </div>
      </div>

      <p className="admin-notice">{t('adminPollingNotice', locale)}</p>
      {data !== null &&
      (new Date(now).getTime() - new Date(data.serverTs).getTime() > 90_000 ||
        state !== 'ready') ? (
        <p role="status" className="admin-old" data-testid="admin-snapshot-old">
          {t('adminSnapshotOld', locale)}
        </p>
      ) : null}
      {state === 'offline' || state === 'error' ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-body-sm text-alert-700">
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
        <dl className="admin-tiles">
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
            absent={t('adminBedsUnavailable', locale)}
            note={t(data.beds === null ? 'adminBedsUnavailableNote' : 'adminNowBedsNote', locale)}
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
      {data === null ? null : (
        <>
          {data.chambersTruncated ? (
            <p role="status" className="admin-old" data-testid="admin-chambers-truncated">
              {t('adminChambersTruncated', locale)}
            </p>
          ) : null}
          <Card>
            <section className="admin-attention" data-testid="admin-attention">
              <h2>
                {t('adminAttentionTitle', locale)} · {num(attention.length)}
              </h2>
              {attention.length === 0 ? (
                <p>{t('adminAttentionNone', locale)}</p>
              ) : (
                <ul tabIndex={0} aria-label={t('adminAttentionTitle', locale)}>
                  {attention.map((item) => (
                    <li key={item.id}>
                      <div>
                        <strong>
                          {item.chamber === null
                            ? t('adminNowBeds', locale)
                            : localName(
                                locale,
                                item.chamber.doctorNameBn,
                                item.chamber.doctorNameEn,
                              )}
                        </strong>
                        <p>{t(item.message, locale)}</p>
                        {item.settings === null && item.chamber !== null ? (
                          <small>{t('adminAttentionContact', locale)}</small>
                        ) : null}
                      </div>
                      {item.settings !== null ? (
                        <a href={`/?view=settings&tab=${item.settings}`}>
                          {t('adminViewExistingSetup', locale)}
                        </a>
                      ) : item.chamber !== null ? (
                        <a href={`#chamber-${item.chamber.sessionId}`}>
                          {t('adminInspectChamber', locale)}
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </Card>
          <Card>
            <section className="admin-board" data-testid="admin-chambers">
              <div className="admin-board-heading">
                <h2>{t('adminChambersTitle', locale)}</h2>
                {freshness(data.serverTs)}
              </div>
              <p className="admin-notice">{t('adminChambersDescription', locale)}</p>
              {data.chambers.length === 0 ? (
                <p data-testid="admin-chambers-empty">{t('adminChambersEmpty', locale)}</p>
              ) : (
                groups.map((group, groupIndex) => (
                  <section
                    key={group.id}
                    className="admin-desk-group"
                    data-testid="admin-desk-group"
                  >
                    <h3>
                      {group.nameBn === null
                        ? t('adminNoDesk', locale)
                        : localName(locale, group.nameBn, group.nameEn ?? group.nameBn)}
                    </h3>
                    <div
                      className="admin-table-scroll"
                      role="region"
                      aria-label={
                        group.nameBn === null
                          ? t('adminNoDesk', locale)
                          : localName(locale, group.nameBn, group.nameEn ?? group.nameBn)
                      }
                      tabIndex={0}
                    >
                      <table>
                        <thead>
                          <tr>
                            <th scope="col">{t('adminNavDoctors', locale)}</th>
                            <th scope="col">{t('adminRoom', locale)}</th>
                            <th scope="col">{t('adminChamberStatus', locale)}</th>
                            <th scope="col">{t('adminChamberTime', locale)}</th>
                            <th scope="col">{t('adminChamberWaiting', locale)}</th>
                            <th scope="col">{t('adminChamberSeen', locale)}</th>
                            <th scope="col">{t('adminChamberNoShows', locale)}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.chambers.map((chamber) => {
                            const labels = {
                              scheduled: CONSOLE.adminChamberScheduled,
                              running: CONSOLE.adminChamberRunning,
                              paused: CONSOLE.adminChamberPaused,
                              ended: CONSOLE.adminChamberEnded,
                              cancelled: CONSOLE.adminChamberCancelled,
                            };
                            return (
                              <tr
                                key={chamber.sessionId}
                                id={
                                  groupIndex === firstGroupFor.get(chamber.sessionId)
                                    ? `chamber-${chamber.sessionId}`
                                    : undefined
                                }
                                tabIndex={-1}
                                data-testid="admin-chamber-row"
                                data-session-id={chamber.sessionId}
                              >
                                <th scope="row">
                                  <strong>
                                    {localName(locale, chamber.doctorNameBn, chamber.doctorNameEn)}
                                  </strong>
                                  <small>
                                    {localName(
                                      locale,
                                      chamber.departmentNameBn,
                                      chamber.departmentNameEn,
                                    )}
                                  </small>
                                </th>
                                <td>{chamber.room ?? '—'}</td>
                                <td>
                                  <ConsoleStatus
                                    label={labels[chamber.status]}
                                    tone={
                                      chamber.status === 'running'
                                        ? 'positive'
                                        : chamber.status === 'paused'
                                          ? 'caution'
                                          : 'neutral'
                                    }
                                  />
                                  {chamber.declaredDelayMinutes === 0 ? null : (
                                    <small>
                                      {t('adminDeclaredDelay', locale).replace(
                                        '{minutes}',
                                        num(chamber.declaredDelayMinutes),
                                      )}
                                    </small>
                                  )}
                                </td>
                                <td>
                                  <span>
                                    {formatClock(chamber.plannedStart, numerals)} –{' '}
                                    {formatClock(chamber.plannedEnd, numerals)}
                                  </span>
                                  <small>
                                    {chamber.actualStart === null
                                      ? '—'
                                      : formatClock(chamber.actualStart, numerals)}
                                  </small>
                                </td>
                                <td>{num(chamber.waiting)}</td>
                                <td>{num(chamber.seen)}</td>
                                <td>{num(chamber.noShows)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ))
              )}
              <p className="admin-notice">{t('adminChamberCountsNote', locale)}</p>
            </section>
          </Card>
        </>
      )}
    </section>
  );
}

function Tile({ label, value, note = null, absent = null, extra = null, testId }) {
  return (
    <div className="admin-tile" data-testid={testId}>
      <dt className="text-caption text-ink-muted">{label}</dt>
      <dd className="text-title-sm font-semibold tabular-nums">
        {value ?? <span className="text-body-sm font-normal text-ink-muted">{absent}</span>}
        {note === null ? null : <p className="text-caption font-normal text-ink-muted">{note}</p>}
        {extra}
      </dd>
    </div>
  );
}
