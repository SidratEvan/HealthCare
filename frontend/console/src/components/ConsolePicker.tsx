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

import { format, formatNumber, localName, numeralsFor, t, type ConsoleKey } from '@platform/i18n';
import { Button, Card, CardMeta, CardTitle, useLocale } from '@platform/ui';

import { ConsoleLanguageSwitch } from '@/components/ConsoleLanguageSwitch';
import { mintDemoToken, writeDemoSession } from '@/lib/demo';

import type { ReactNode } from 'react';

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

/** Roles whose console opens on the hospital rather than on one chamber. */
const HOSPITAL_CONSOLES = new Set(['ward', 'emergency', 'lab', 'pharmacy', 'hospital_admin']);

/** The roles this version has a console for. Others are not offered. */
const ROLE_LABEL: Record<string, ConsoleKey> = {
  receptionist: 'roleReceptionist',
  doctor: 'roleDoctor',
  ward: 'roleWard',
  emergency: 'roleEmergency',
  lab: 'roleLab',
  pharmacy: 'rolePharmacy',
  hospital_admin: 'roleHospitalAdmin',
};

interface DemoSessionCard {
  readonly id: string;
  readonly doctorNameBn: string;
  readonly doctorNameEn: string;
  readonly departmentNameBn: string;
  readonly departmentNameEn: string;
  readonly room: string | null;
  readonly status: string;
  readonly waiting: number;
  readonly total: number;
}

interface DemoConsole {
  readonly hospitalId: string;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly district: string;
  readonly roles: readonly string[];
  readonly sessions: readonly DemoSessionCard[];
}

/** A national role the API has a seeded account for (step 20). */
type NationalRole = 'gov_viewer';

/**
 * What the picker opened: a chamber, or a hospital's ward board.
 *
 * The ward is the one console that belongs to a hospital rather than to a
 * chamber (`S-B-06`), so it is chosen beside the chambers rather than on one.
 */
export type ConsoleChoice =
  | { readonly kind: 'chamber'; readonly sessionId: string }
  | { readonly kind: 'ward' }
  | { readonly kind: 'emergency' }
  | { readonly kind: 'lab' }
  | { readonly kind: 'pharmacy' }
  | { readonly kind: 'admin' }
  | { readonly kind: 'gov' };

export function ConsolePicker({
  onChosen,
}: {
  /** Called with what to open, once a principal is in place. */
  readonly onChosen: (choice: ConsoleChoice) => void;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const [consoles, setConsoles] = useState<DemoConsole[] | null>(null);
  const [national, setNational] = useState<readonly NationalRole[]>([]);
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

          const body = (await response.json()) as {
            data: { consoles: DemoConsole[]; national?: NationalRole[] };
          };
          if (cancelled) return;

          setConsoles(body.data.consoles);
          // Absent from an API older than step 20, which offers nothing
          // national rather than failing the picker.
          setNational(body.data.national ?? []);
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

  /**
   * Takes a principal for this hospital and role, then opens the chamber.
   *
   * A null hospital is the national console: the token is asked for with a
   * role alone, because naming a facility for a government viewer is refused
   * (`demoTokenBody`, migration 0024).
   */
  const open = useCallback(
    async (hospitalId: string | null, role: string, choice: ConsoleChoice) => {
      setBusy(true);
      try {
        const minted = await mintDemoToken(hospitalId, role);

        const picked = consoles?.find((entry) => entry.hospitalId === hospitalId);
        const chamber =
          choice.kind === 'chamber'
            ? picked?.sessions.find((session) => session.id === choice.sessionId)
            : undefined;

        writeDemoSession({
          token: minted.token,
          hospitalId: minted.hospitalId,
          staffName: minted.staffName,
          role,
          ...(picked === undefined
            ? {}
            : {
                hospitalNameBn: picked.nameBn,
                hospitalNameEn: picked.nameEn,
                // So the rail can offer this facility's other consoles.
                roles: picked.roles,
              }),
          ...(choice.kind === 'chamber' ? { chamberSessionId: choice.sessionId } : {}),
          ...(chamber === undefined
            ? {}
            : {
                chamber: {
                  doctorNameBn: chamber.doctorNameBn,
                  doctorNameEn: chamber.doctorNameEn,
                  departmentNameBn: chamber.departmentNameBn,
                  departmentNameEn: chamber.departmentNameEn,
                  room: chamber.room,
                },
              }),
        });

        onChosen(choice);
      } catch {
        setFailed(true);
      } finally {
        setBusy(false);
      }
    },
    [onChosen, consoles],
  );

  if (failed) {
    return (
      <Shell>
        <p
          role="alert"
          data-testid="picker-failed"
          className="rounded-sm bg-alert-100 px-3 py-2 text-body-md text-alert-700"
        >
          {t('consoleLoadFailed', locale)}
        </p>

        {/* A dead end is not a state. Reloading is the whole retry, because the
            screen has nothing else on it yet. */}
        <Button
          variant="secondary"
          onClick={() => {
            globalThis.location.reload();
          }}
        >
          {t('retry', locale)}
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
            {t('consoleWaking', locale)}
          </p>
        ) : null}

        <div className="flex flex-col gap-3" aria-busy="true" data-testid="picker-loading">
          <div className="h-20 rounded-md bg-sunken" />
          <div className="h-20 rounded-md bg-sunken" />
        </div>
      </Shell>
    );
  }

  // `S-B-13` belongs to no hospital, so it is offered whether or not any
  // hospital is running something today.
  const nationalSection =
    national.length === 0 ? null : (
      <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
        <h2 className="text-title-sm">{t('govSection', locale)}</h2>
        <p className="text-body-sm text-ink-secondary">{t('govSectionHint', locale)}</p>
        <div>
          <Button
            variant="secondary"
            loading={busy}
            data-testid="open-gov"
            onClick={() => {
              void open(null, 'gov_viewer', { kind: 'gov' });
            }}
          >
            {t('openGov', locale)}
          </Button>
        </div>
      </section>
    );

  if (consoles.length === 0) {
    return (
      <Shell>
        <p className="text-body-md text-ink-secondary" data-testid="picker-empty">
          {t('noConsoles', locale)}
        </p>
        {nationalSection}
      </Shell>
    );
  }

  return (
    <Shell>
      <section className="flex flex-col gap-3">
        <h2 className="text-title-sm">{t('chooseHospital', locale)}</h2>

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
                {localName(locale, candidate.nameBn, candidate.nameEn)}
              </Button>
            </li>
          ))}
        </ul>
      </section>

      {/* The hospital's own consoles — the ward board (`S-B-06`), the ER
          (`S-B-07`), the lab and the pharmacy (`S-B-08`, `S-B-09`) and the
          dashboard (`S-B-10`) — belong to the facility rather than to a
          chamber, so they are offered once, side by side, above the chambers.
          A facility is offered only what its roster staffs: a diagnostic
          centre gets a lab and no pharmacy, a clinic the reverse
          (`data/people.ts`). */}
      {hospital === null ? null : (
        <FacilityConsoles
          hospital={hospital}
          busy={busy}
          onOpen={(role, choice) => {
            void open(hospital.hospitalId, role, choice);
          }}
        />
      )}

      {hospital === null ? null : (
        <section className="flex flex-col gap-3">
          <h2 className="text-title-sm">{t('chooseChamber', locale)}</h2>

          {/* A Friday at a hospital with no weekend chamber: the facility's
              own consoles are still offered above, so say why this is empty
              rather than draw nothing. */}
          {hospital.sessions.length === 0 ? (
            <p className="text-body-md text-ink-secondary" data-testid="picker-no-chambers">
              {t('noChambersToday', locale)}
            </p>
          ) : null}

          <ul className="grid gap-3 md:grid-cols-2">
            {hospital.sessions.map((session) => (
              <li key={session.id}>
                <Card tone={session.status === 'running' ? 'brand' : 'default'}>
                  <CardTitle>
                    {localName(locale, session.doctorNameBn, session.doctorNameEn)}
                  </CardTitle>
                  <CardMeta>
                    {localName(locale, session.departmentNameBn, session.departmentNameEn)}
                    {session.room === null ? '' : ` · ${session.room}`} ·{' '}
                    {t(statusKey(session.status), locale)} ·{' '}
                    {format('waitingCount', locale, {
                      count: formatNumber(session.waiting, numerals),
                    })}
                  </CardMeta>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {hospital.roles
                      // The ward board, the ER, the lab, the pharmacy and the
                      // dashboard belong to the hospital, not to a chamber, and
                      // are offered once above.
                      .filter((role) => !HOSPITAL_CONSOLES.has(role))
                      .map((role) => (
                        <Button
                          key={role}
                          variant={role === 'receptionist' ? 'primary' : 'secondary'}
                          size="sm"
                          loading={busy}
                          data-testid={`open-${role}-${session.id}`}
                          onClick={() => {
                            void open(hospital.hospitalId, role, {
                              kind: 'chamber',
                              sessionId: session.id,
                            });
                          }}
                        >
                          {t(ROLE_LABEL[role] ?? 'roleReceptionist', locale)}
                        </Button>
                      ))}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {nationalSection}
    </Shell>
  );
}

/** The consoles that belong to a facility rather than to one chamber. */
const FACILITY_CONSOLES: readonly {
  readonly role: string;
  /** What the open button's test id calls it, which predates this list. */
  readonly id: string;
  readonly choice: ConsoleChoice;
  readonly title: ConsoleKey;
  readonly action: ConsoleKey;
}[] = [
  {
    role: 'ward',
    id: 'ward',
    choice: { kind: 'ward' },
    title: 'wardBoardSection',
    action: 'openWardBoard',
  },
  {
    role: 'emergency',
    id: 'er',
    choice: { kind: 'emergency' },
    title: 'erSection',
    action: 'openEr',
  },
  { role: 'lab', id: 'lab', choice: { kind: 'lab' }, title: 'labSection', action: 'openLab' },
  {
    role: 'pharmacy',
    id: 'pharmacy',
    choice: { kind: 'pharmacy' },
    title: 'pharmacySection',
    action: 'openPharmacy',
  },
  {
    role: 'hospital_admin',
    id: 'admin',
    choice: { kind: 'admin' },
    title: 'adminSection',
    action: 'openAdmin',
  },
];

function FacilityConsoles({
  hospital,
  busy,
  onOpen,
}: {
  readonly hospital: DemoConsole;
  readonly busy: boolean;
  readonly onOpen: (role: string, choice: ConsoleChoice) => void;
}): ReactNode {
  const locale = useLocale();
  const offered = FACILITY_CONSOLES.filter((entry) => hospital.roles.includes(entry.role));
  if (offered.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-title-sm">{t('facilityConsoles', locale)}</h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {offered.map((entry) => (
          <li key={entry.id}>
            <Card>
              <CardTitle>{t(entry.title, locale)}</CardTitle>
              <div className="mt-3">
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy}
                  data-testid={`open-${entry.id}-${hospital.hospitalId}`}
                  onClick={() => {
                    onOpen(entry.role, entry.choice);
                  }}
                >
                  {t(entry.action, locale)}
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

function statusKey(status: string): ConsoleKey {
  if (status === 'running') return 'sessionRunning';
  if (status === 'ended') return 'sessionEnded';
  return 'sessionScheduled';
}

function Shell({ children }: { readonly children: ReactNode }): ReactNode {
  const locale = useLocale();
  return (
    <div className="min-h-screen">
      {/* The institution's colour across the top, as the consoles' rail is:
          the first screen a director sees should look like the product, not
          like a form in front of it. */}
      <header className="bg-brand-700 text-ink-inverse">
        <div className="mx-auto flex max-w-[1040px] items-center gap-4 px-8 py-8">
          <h1 className="font-reading text-title-lg">{t('chooseConsole', locale)}</h1>
          <ConsoleLanguageSwitch />
        </div>
      </header>

      <main className="mx-auto flex max-w-[1040px] flex-col gap-6 p-8" data-testid="console-picker">
        {/* The console has no login. Saying so is the honest state, and it is
            the same reason every demo row carries its label (`FR-DEM-07`). */}
        <p className="rounded-sm bg-warn-100 px-3 py-2 text-caption text-warn-700">
          {t('demoSignIn', locale)}
        </p>

        {children}
      </main>
    </div>
  );
}
