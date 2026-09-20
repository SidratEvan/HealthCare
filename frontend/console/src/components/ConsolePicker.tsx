'use client';

/**
 * `S-B-01` Role & counter selection, in the form a demo needs (CLAUDE.md §4.1).
 *
 * `S-B-00` Staff login is not built — authentication is deferred to Supabase
 * Auth — so this is how somebody gets into a console:
 *
 *   "Under `DEMO_MODE=true`, the console picks a hospital and a role without a
 *   password. That is the correct implementation for a pitch version, not a
 *   shortcut to apologise for."
 *
 * Before this screen existed, opening the console meant pasting a signed token
 * into `sessionStorage` by hand. That is workable on the machine that built it
 * and impossible to hand to anybody else, which made the whole console
 * undemonstrable over a link.
 *
 * ## It says what it is
 *
 * A console that anybody can open must not be mistaken for one that checked
 * who you are. The banner says so in Bangla, on the screen, every time — the
 * same honesty the demonstration-data label applies to the rows (`FR-DEM-07`).
 *
 * The token it receives is the same signed staff token `auth.service` will
 * issue later, with the same claims, verified by the same middleware. When
 * Supabase Auth arrives, this screen is deleted rather than rewritten.
 */

import { useCallback, useEffect, useState } from 'react';

import { formatNumber, t, type ConsoleKey } from '@platform/i18n';
import { Button, Card, CardMeta, CardTitle } from '@platform/ui';

import { writeDemoSession } from '@/lib/demo';

import type { ReactNode } from 'react';

const LOCALE = 'bn' as const;

/** Console surfaces use Latin numerals for data-entry speed (`TYP-04`). */
const NUMERALS = 'latin' as const;

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';

/**
 * How long one attempt at reaching the API may take.
 *
 * `fetch` has no timeout of its own: a request to a host that accepts the
 * connection and then never answers stays pending for as long as the page is
 * open. That is exactly what a sleeping demo API does while it boots, and it is
 * how this screen came to sit on its loading skeleton indefinitely — the one
 * state `GR-03` has no way out of, because nothing ever rejects.
 */
const ATTEMPT_TIMEOUT_MS = 12_000;

/**
 * How many times to try before giving up.
 *
 * The demo API sleeps when idle and takes the better part of a minute to wake,
 * so the first attempt failing is the *expected* case rather than the broken
 * one. Giving up after one would make the console unopenable exactly when
 * somebody is opening it for the first time — which is every demo.
 */
const ATTEMPTS = 4;

/** The roles this version has a console for. Others are not offered. */
const ROLE_LABEL: Record<string, ConsoleKey> = {
  receptionist: 'roleReceptionist',
  doctor: 'roleDoctor',
  hospital_admin: 'roleHospitalAdmin',
};

interface DemoSessionCard {
  readonly id: string;
  readonly doctorNameBn: string;
  readonly departmentNameBn: string;
  readonly room: string | null;
  readonly status: string;
  readonly waiting: number;
  readonly total: number;
}

interface DemoConsole {
  readonly hospitalId: string;
  readonly nameBn: string;
  readonly district: string;
  readonly roles: readonly string[];
  readonly sessions: readonly DemoSessionCard[];
}

export function ConsolePicker({
  onChosen,
}: {
  /** Called with the session to open, once a principal is in place. */
  readonly onChosen: (sessionId: string) => void;
}): ReactNode {
  const [consoles, setConsoles] = useState<DemoConsole[] | null>(null);
  const [failed, setFailed] = useState(false);
  /** True once an attempt has timed out and another is running. */
  const [waking, setWaking] = useState(false);
  const [hospital, setHospital] = useState<DemoConsole | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
        if (cancelled) return;

        // The second attempt onward means the first one timed out, which for
        // this API almost always means it is waking rather than broken. Say
        // that, instead of leaving a skeleton to be read as a hang.
        if (attempt > 1) setWaking(true);

        try {
          const response = await fetch(`${API}/demo/consoles`, {
            signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
          });
          if (!response.ok) throw new Error(String(response.status));

          const body = (await response.json()) as { data: { consoles: DemoConsole[] } };
          if (cancelled) return;

          setConsoles(body.data.consoles);
          // One facility is the common case in a demo; skipping a choice that
          // has one answer is not a shortcut, it is one fewer tap before the
          // thing being demonstrated.
          setHospital(body.data.consoles[0] ?? null);
          setWaking(false);
          return;
        } catch {
          // Fall through to the next attempt. The last one is the only failure
          // worth telling somebody about.
        }
      }

      if (!cancelled) {
        setWaking(false);
        setFailed(true);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  /** Takes a principal for this hospital and role, then opens the chamber. */
  const open = useCallback(
    async (hospitalId: string, role: string, sessionId: string) => {
      setBusy(true);
      try {
        const response = await fetch(`${API}/demo/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ hospitalId, role }),
        });

        if (!response.ok) throw new Error(String(response.status));

        const body = (await response.json()) as {
          data: { token: string; staffName: string; hospitalId: string };
        };

        writeDemoSession({
          token: body.data.token,
          hospitalId: body.data.hospitalId,
          staffName: body.data.staffName,
          role,
        });

        onChosen(sessionId);
      } catch {
        setFailed(true);
      } finally {
        setBusy(false);
      }
    },
    [onChosen],
  );

  if (failed) {
    return (
      <Shell>
        <p
          role="alert"
          data-testid="picker-failed"
          className="rounded-sm bg-alert-100 px-3 py-2 text-body-md text-alert-700"
        >
          {t('consoleLoadFailed', LOCALE)}
        </p>

        {/* A dead end is not a state. Reloading is the whole retry, because the
            screen has nothing else on it yet. */}
        <Button
          variant="secondary"
          onClick={() => {
            globalThis.location.reload();
          }}
        >
          {t('retry', LOCALE)}
        </Button>
      </Shell>
    );
  }

  if (consoles === null) {
    // `GR-03` loading: the shape of the answer, never a spinner over the page.
    return (
      <Shell>
        {waking ? (
          <p
            role="status"
            data-testid="picker-waking"
            className="rounded-sm bg-warn-100 px-3 py-2 text-body-md text-warn-700"
          >
            {t('consoleWaking', LOCALE)}
          </p>
        ) : null}

        <div className="flex flex-col gap-3" aria-busy="true" data-testid="picker-loading">
          <div className="h-20 rounded-md bg-sunken" />
          <div className="h-20 rounded-md bg-sunken" />
        </div>
      </Shell>
    );
  }

  if (consoles.length === 0) {
    return (
      <Shell>
        <p className="text-body-md text-ink-secondary" data-testid="picker-empty">
          {t('noConsoles', LOCALE)}
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <section className="flex flex-col gap-3">
        <h2 className="text-title-sm">{t('chooseHospital', LOCALE)}</h2>

        <ul className="flex flex-wrap gap-2">
          {consoles.map((candidate) => (
            <li key={candidate.hospitalId}>
              <Button
                variant={candidate.hospitalId === hospital?.hospitalId ? 'primary' : 'secondary'}
                size="sm"
                data-testid={`pick-hospital-${candidate.hospitalId}`}
                onClick={() => {
                  setHospital(candidate);
                }}
              >
                {candidate.nameBn}
              </Button>
            </li>
          ))}
        </ul>
      </section>

      {hospital === null ? null : (
        <section className="flex flex-col gap-3">
          <h2 className="text-title-sm">{t('chooseChamber', LOCALE)}</h2>

          <ul className="flex flex-col gap-3">
            {hospital.sessions.map((session) => (
              <li key={session.id}>
                <Card tone={session.status === 'running' ? 'brand' : 'default'}>
                  <CardTitle>{session.doctorNameBn}</CardTitle>
                  <CardMeta>
                    {session.departmentNameBn}
                    {session.room === null ? '' : ` · ${session.room}`} ·{' '}
                    {t(statusKey(session.status), LOCALE)} ·{' '}
                    {t('waitingCount', LOCALE).replace(
                      '{count}',
                      formatNumber(session.waiting, NUMERALS),
                    )}
                  </CardMeta>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {hospital.roles.map((role) => (
                      <Button
                        key={role}
                        variant={role === 'receptionist' ? 'primary' : 'secondary'}
                        size="sm"
                        loading={busy}
                        data-testid={`open-${role}-${session.id}`}
                        onClick={() => {
                          void open(hospital.hospitalId, role, session.id);
                        }}
                      >
                        {t(ROLE_LABEL[role] ?? 'roleReceptionist', LOCALE)}
                      </Button>
                    ))}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Shell>
  );
}

function statusKey(status: string): ConsoleKey {
  if (status === 'running') return 'sessionRunning';
  if (status === 'ended') return 'sessionEnded';
  return 'sessionScheduled';
}

function Shell({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-6 p-8" data-testid="console-picker">
      <header className="flex flex-col gap-2">
        <h1 className="font-reading text-title-lg">{t('chooseConsole', LOCALE)}</h1>

        {/* The console has no login. Saying so is the honest state, and it is
            the same reason every demo row carries its label (`FR-DEM-07`). */}
        <p className="rounded-sm bg-warn-100 px-3 py-2 text-caption text-warn-700">
          {t('demoSignIn', LOCALE)}
        </p>
      </header>

      {children}
    </main>
  );
}
