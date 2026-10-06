'use client';

/**
 * `S-B-12` Hospital onboarding — the platform administrator's screen
 * (`APP_FLOW.md` B7, `PRD.md` §14c `FR-ONB-*`).
 *
 * The other half of going live. A hospital's administrator sets the hospital
 * up on `S-B-11` and asks for review; here somebody who does not work for that
 * hospital looks at it and answers. So this screen does four things and no
 * others: lists the workspaces with the ones waiting first, creates a
 * workspace with its first administrator, records that a doctor's BMDC number
 * was checked, and decides — approve, send back, suspend, reinstate, close.
 *
 * ## What is never on it
 *
 * A patient. `FR-ONB-08`: it "shows organisations and counts. It never shows a
 * patient, a booking or a record." Nothing the server sends under `/platform`
 * carries one, and the line under the title says so, because the person at
 * this screen can see every hospital on the platform and should know what
 * that does and does not include.
 *
 * ## A reason is asked for where the hospital has to act on it
 *
 * Sending a workspace back, suspending it and closing it each land on a
 * hospital administrator's screen as a sentence (`S-B-11`,
 * `settings-review-note`). An empty one is a closed door with no sign, so
 * those three are refused without a note, here before the server does.
 *
 * ## The four states (`GR-03`)
 *
 * Loading shows the shape of the list. No workspace yet says so and offers
 * the form. A list that could not be loaded says that, with a retry, and is
 * never drawn as empty. Offline, the list stays and every write is switched
 * off with the reason.
 */

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';

import {
  FACILITY_KINDS,
  actionNeedsNote,
  type FacilityKind,
  type OrgLifecycle,
} from '@platform/domain';
import {
  DIVISION_NAMES,
  divisionName,
  districtName,
  facilityKindName,
  format,
  formatAge,
  formatDateTime,
  formatNumber,
  localName,
  numeralsFor,
  t,
  type ConsoleKey,
} from '@platform/i18n';
import { Button, Card, Chip, FilterChip, FreshnessLine, Input, useLocale } from '@platform/ui';

import { ConsoleLanguageSwitch } from '@/components/ConsoleLanguageSwitch';
import { DemoBanner } from '@/components/DemoBanner';
import { readDemoSession } from '@/lib/demo';
import {
  platformApi,
  type CreatedWorkspace,
  type PlatformAct,
  type PlatformFailure,
  type Workspace,
  type WorkspaceDetail,
} from '@/lib/platform';

type List =
  | { readonly state: 'loading' }
  | { readonly state: 'failed' }
  | { readonly state: 'ready'; readonly items: readonly Workspace[]; readonly asOf: Date };

/** What the right-hand side is showing. */
type Panel =
  | { readonly kind: 'none' }
  | { readonly kind: 'new' }
  | { readonly kind: 'created'; readonly created: CreatedWorkspace }
  | { readonly kind: 'workspace'; readonly id: string };

const STATE_NAME: Readonly<Record<OrgLifecycle, ConsoleKey>> = {
  setup: 'platformStateSetup',
  ready_for_review: 'platformStateReview',
  active: 'platformStateActive',
  suspended: 'platformStateSuspended',
  closed: 'platformStateClosed',
};

const STATE_TONE: Readonly<Record<OrgLifecycle, 'neutral' | 'positive' | 'caution'>> = {
  setup: 'neutral',
  ready_for_review: 'caution',
  active: 'positive',
  suspended: 'caution',
  closed: 'neutral',
};

/** The acts, in the order they are offered, with their labels and routes. */
const ACTS: readonly {
  readonly action: 'approve' | 'send_back' | 'suspend' | 'reinstate' | 'close';
  readonly route: PlatformAct;
  readonly label: ConsoleKey;
  readonly variant: 'primary' | 'secondary' | 'quiet';
}[] = [
  { action: 'approve', route: 'approve', label: 'platformApprove', variant: 'primary' },
  { action: 'send_back', route: 'send-back', label: 'platformSendBack', variant: 'secondary' },
  { action: 'reinstate', route: 'reinstate', label: 'platformReinstate', variant: 'primary' },
  { action: 'suspend', route: 'suspend', label: 'platformSuspend', variant: 'secondary' },
  { action: 'close', route: 'close', label: 'platformClose', variant: 'quiet' },
];

/** The checklist's count lines, shared with `S-B-11`. */
const COUNT_LABEL: Readonly<Record<string, ConsoleKey>> = {
  departments: 'settingsCountDepartments',
  doctors: 'settingsCountDoctors',
  schedules: 'settingsCountSchedules',
  staff: 'settingsCountStaff',
  beds: 'settingsCountBeds',
  verified_doctors: 'settingsCountVerified',
};

/** What a missing item is called in the sentence that refuses an approval. */
const MISSING_NAME: Readonly<Record<string, ConsoleKey>> = {
  departments: 'settingsItemDepartments',
  doctors: 'settingsItemDoctors',
  schedules: 'settingsItemSchedules',
  staff: 'settingsItemStaff',
  verified_doctors: 'platformItemVerified',
};

function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = (): void => {
      setOnline(globalThis.navigator.onLine);
    };
    update();
    globalThis.addEventListener('online', update);
    globalThis.addEventListener('offline', update);
    return () => {
      globalThis.removeEventListener('online', update);
      globalThis.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = globalThis.setInterval(() => {
      setNow(new Date());
    }, 30_000);
    return () => {
      globalThis.clearInterval(timer);
    };
  }, []);
  return now;
}

export function PlatformConsole(): ReactNode {
  const locale = useLocale();
  const online = useOnline();
  const now = useNow();
  const session = readDemoSession();
  const token = session?.token ?? '';

  const [list, setList] = useState<List>({ state: 'loading' });
  const [panel, setPanel] = useState<Panel>({ kind: 'none' });

  const load = useCallback(async (): Promise<void> => {
    try {
      const items = await platformApi.list(token);
      setList({ state: 'ready', items, asOf: new Date() });
    } catch {
      // Never drawn as an empty platform: that would be a statement about
      // hospitals standing in for a statement about the network.
      setList((current) => (current.state === 'ready' ? current : { state: 'failed' }));
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const waiting =
    list.state === 'ready'
      ? list.items.filter((item) => item.lifecycle === 'ready_for_review').length
      : 0;

  return (
    <div className="min-h-screen">
      {/* FR-DEM-07: a demonstration says so, where the server says it is one. */}
      <DemoBanner />

      <main className="mx-auto flex max-w-6xl flex-col gap-5 p-6" data-testid="platform-console">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="text-title-lg">{t('platformTitle', locale)}</h1>
            {session?.staffName === undefined ? null : (
              <p className="text-body-sm text-ink-muted">{session.staffName}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <ConsoleLanguageSwitch className="" />
            <a
              href="/"
              className="flex min-h-touch items-center rounded-sm px-3 text-body-sm text-brand-600 hover:bg-brand-100"
            >
              {t('changeConsole', locale)}
            </a>
          </div>
        </header>

        {/* FR-ONB-08, said where it is true. */}
        <p className="text-body-sm text-ink-secondary" data-testid="platform-no-patients">
          {t('platformIntro', locale)}
        </p>

        {online ? null : (
          <p
            role="status"
            data-testid="platform-offline"
            className="rounded-sm bg-warn-100 px-3 py-2 text-body-md text-warn-700"
          >
            {t('platformOffline', locale)}
          </p>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <section className="flex flex-col gap-3" aria-labelledby="platform-list-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="platform-list-title" className="text-title-sm">
                  {t('platformListTitle', locale)}
                </h2>
                {list.state === 'ready' && waiting > 0 ? (
                  <p className="text-body-sm text-warn-700" data-testid="platform-waiting">
                    {format('platformWaitingCount', locale, {
                      count: formatNumber(waiting, numeralsFor(locale)),
                    })}
                  </p>
                ) : null}
              </div>
              <GuardedButton
                variant="secondary"
                size="sm"
                data-testid="platform-new"
                reason={online ? null : t('platformOffline', locale)}
                onClick={() => {
                  setPanel({ kind: 'new' });
                }}
              >
                {t('platformNew', locale)}
              </GuardedButton>
            </div>

            <WorkspaceList
              list={list}
              now={now}
              selected={panel.kind === 'workspace' ? panel.id : null}
              onSelect={(id) => {
                setPanel({ kind: 'workspace', id });
              }}
              onRetry={() => {
                setList({ state: 'loading' });
                void load();
              }}
            />
          </section>

          <section aria-live="polite">
            {panel.kind === 'none' ? (
              <p
                className="rounded-md border border-line bg-surface p-5 text-body-md text-ink-secondary"
                data-testid="platform-pick"
              >
                {t('platformPickOne', locale)}
              </p>
            ) : null}

            {panel.kind === 'new' ? (
              <NewWorkspaceForm
                token={token}
                online={online}
                onCancel={() => {
                  setPanel({ kind: 'none' });
                }}
                onCreated={(created) => {
                  setPanel({ kind: 'created', created });
                  void load();
                }}
              />
            ) : null}

            {panel.kind === 'created' ? (
              <CreatedCard
                created={panel.created}
                onDone={() => {
                  setPanel({ kind: 'workspace', id: panel.created.hospitalId });
                }}
              />
            ) : null}

            {panel.kind === 'workspace' ? (
              <WorkspacePanel
                key={panel.id}
                token={token}
                hospitalId={panel.id}
                online={online}
                onChanged={() => {
                  void load();
                }}
              />
            ) : null}
          </section>
        </div>
      </main>
    </div>
  );
}

/**
 * A button that is off for a reason, or on.
 *
 * `<Button>` will not compile disabled without a reason (`FRONTEND.md` §5.1),
 * which is right and means the two cases are two elements. Every write on
 * this screen can be off — no connection, a note still owed, a workspace not
 * ready — so the choice is made once, here.
 */
function GuardedButton({
  reason,
  children,
  ...rest
}: {
  /** Why it cannot be pressed now; null when it can. */
  readonly reason: string | null;
  readonly children: ReactNode;
  readonly variant?: 'primary' | 'secondary' | 'quiet';
  readonly size?: 'sm' | 'md';
  readonly loading?: boolean;
  readonly type?: 'button' | 'submit';
  readonly onClick?: () => void;
  readonly 'data-testid'?: string;
}): ReactNode {
  return reason === null ? (
    <Button {...rest}>{children}</Button>
  ) : (
    <Button {...rest} disabled disabledReason={reason}>
      {children}
    </Button>
  );
}

function StateChip({ lifecycle }: { readonly lifecycle: OrgLifecycle }): ReactNode {
  const locale = useLocale();
  // A11Y-03: the state is a word, and the tone only repeats it.
  return <Chip tone={STATE_TONE[lifecycle]}>{t(STATE_NAME[lifecycle], locale)}</Chip>;
}

function WorkspaceList({
  list,
  now,
  selected,
  onSelect,
  onRetry,
}: {
  readonly list: List;
  readonly now: Date;
  readonly selected: string | null;
  readonly onSelect: (id: string) => void;
  readonly onRetry: () => void;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);

  if (list.state === 'loading') {
    // GR-03 loading: the shape of the answer, never a spinner.
    return (
      <div className="flex flex-col gap-2" aria-busy="true" data-testid="platform-loading">
        <div className="h-20 rounded-md bg-sunken" />
        <div className="h-20 rounded-md bg-sunken" />
        <div className="h-20 rounded-md bg-sunken" />
      </div>
    );
  }

  if (list.state === 'failed') {
    return (
      <div
        role="alert"
        data-testid="platform-failed"
        className="flex flex-col gap-3 rounded-md border border-line bg-surface p-5"
      >
        <p className="text-body-md">{t('platformLoadFailed', locale)}</p>
        <div>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {t('retry', locale)}
          </Button>
        </div>
      </div>
    );
  }

  if (list.items.length === 0) {
    return (
      <p
        className="rounded-md border border-line bg-surface p-5 text-body-md text-ink-secondary"
        data-testid="platform-empty"
      >
        {t('platformEmpty', locale)}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* The counts on each row are live; the list says when it was read. */}
      <FreshnessLine
        asOf={list.asOf}
        now={now}
        labels={{
          justNow: t('updatedJustNow', locale),
          ago: t('updatedAgo', locale),
          never: t('platformListAge', locale),
          stale: t('staleWarning', locale),
        }}
        formatMinutes={(value) => formatAge(value, locale, numerals)}
      />

      <ul className="flex flex-col gap-2" data-testid="platform-list">
        {list.items.map((item) => {
          const active = item.id === selected;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(item.id);
                }}
                aria-current={active ? 'true' : undefined}
                data-testid={`platform-row-${item.code ?? item.id}`}
                data-lifecycle={item.lifecycle}
                className={`flex w-full flex-col gap-1.5 rounded-md border p-4 text-left ${
                  active
                    ? 'border-brand-600 bg-brand-100'
                    : 'border-line bg-surface hover:bg-sunken'
                }`}
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-body-md font-semibold">
                    {localName(locale, item.nameBn, item.nameEn)}
                  </span>
                  <StateChip lifecycle={item.lifecycle} />
                </span>
                <span className="text-body-sm text-ink-secondary">
                  {[
                    facilityKindName(item.kind as FacilityKind, locale),
                    districtName(item.district, locale),
                    item.code === null ? null : format('platformCode', locale, { code: item.code }),
                  ]
                    .filter((part) => part !== null)
                    .join(' · ')}
                </span>
                <span className="text-caption text-ink-muted">
                  {[
                    format('settingsCountDoctors', locale, {
                      count: formatNumber(item.counts.doctors, numerals),
                    }),
                    format('settingsCountVerified', locale, {
                      count: formatNumber(item.counts.verifiedDoctors, numerals),
                    }),
                    format('settingsCountSchedules', locale, {
                      count: formatNumber(item.counts.schedules, numerals),
                    }),
                  ].join(' · ')}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** What a refusal is, as a sentence. */
function failureLine(failure: PlatformFailure, locale: 'bn' | 'en'): string {
  switch (failure.kind) {
    case 'offline':
      return t('platformOffline', locale);
    case 'duplicate_code':
      return t('platformDuplicateCode', locale);
    case 'note_required':
      return t('platformNoteRequired', locale);
    case 'changed':
      return t('platformChanged', locale);
    case 'invalid':
      return t('platformInvalid', locale);
    case 'not_ready':
      return format('platformNotReady', locale, {
        items: failure.missing
          .map((key) => {
            const name = MISSING_NAME[key];
            return name === undefined ? key : t(name, locale);
          })
          .join(', '),
      });
    case 'failed':
      return t('platformActionFailed', locale);
  }
}

function WorkspacePanel({
  token,
  hospitalId,
  online,
  onChanged,
}: {
  readonly token: string;
  readonly hospitalId: string;
  readonly online: boolean;
  readonly onChanged: () => void;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);

  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [sure, setSure] = useState(false);

  const read = useCallback(async (): Promise<void> => {
    try {
      setDetail(await platformApi.detail(token, hospitalId));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [token, hospitalId]);

  useEffect(() => {
    void read();
  }, [read]);

  if (failed) {
    return (
      <div
        role="alert"
        className="flex flex-col gap-3 rounded-md border border-line bg-surface p-5"
      >
        <p className="text-body-md">{t('platformLoadFailed', locale)}</p>
        <div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void read();
            }}
          >
            {t('retry', locale)}
          </Button>
        </div>
      </div>
    );
  }

  if (detail === null) {
    return <div className="h-64 rounded-md bg-sunken" aria-busy="true" />;
  }

  const settle = (
    key: string,
    call: Promise<
      | { readonly ok: true; readonly value: WorkspaceDetail }
      | { readonly ok: false; readonly failure: PlatformFailure }
    >,
  ): void => {
    setBusy(key);
    setProblem(null);
    void call
      .then((result) => {
        if (result.ok) {
          setDetail(result.value);
          setNote('');
          setSure(false);
          onChanged();
          return;
        }
        setProblem(failureLine(result.failure, locale));
        // Somebody else answered first: show what is true now.
        if (result.failure.kind === 'changed') {
          void read();
          onChanged();
        }
      })
      .finally(() => {
        setBusy(null);
      });
  };

  const offered = ACTS.filter((act) => detail.actions.includes(act.action));

  return (
    <Card data-testid="platform-workspace" data-lifecycle={detail.lifecycle}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-title-md">{localName(locale, detail.nameBn, detail.nameEn)}</h2>
            <p className="text-body-sm text-ink-secondary">
              {[
                facilityKindName(detail.kind as FacilityKind, locale),
                districtName(detail.district, locale),
                detail.code === null ? null : format('platformCode', locale, { code: detail.code }),
              ]
                .filter((part) => part !== null)
                .join(' · ')}
            </p>
            <p className="text-body-sm text-ink-secondary">
              {detail.registrationNo === null
                ? t('platformRegistrationNone', locale)
                : format('platformRegistration', locale, { number: detail.registrationNo })}
            </p>
            {detail.lifecycle === 'ready_for_review' && detail.reviewRequestedAt !== null ? (
              <p className="text-body-sm text-ink-secondary">
                {format('platformRequestedAt', locale, {
                  when: formatDateTime(detail.reviewRequestedAt, numerals),
                })}
              </p>
            ) : null}
          </div>
          <StateChip lifecycle={detail.lifecycle} />
        </div>

        {detail.reviewNote === null ? null : (
          <p
            className="rounded-sm bg-sunken px-3 py-2 text-body-sm"
            data-testid="platform-last-note"
          >
            {format('platformLastNote', locale, { note: detail.reviewNote })}
          </p>
        )}

        {/* The same checklist the hospital sees, over the same counts. */}
        <section className="flex flex-col gap-2">
          <h3 className="text-body-md font-semibold">{t('settingsChecklistTitle', locale)}</h3>
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-body-sm">
            {detail.checklist.map((item) => (
              <li
                key={item.key}
                className="flex items-center gap-2"
                data-testid={`platform-check-${item.key}`}
                data-done={item.done ? 'true' : 'false'}
              >
                <Chip tone={item.done ? 'positive' : item.required ? 'caution' : 'neutral'}>
                  {item.done
                    ? t('settingsCheckDone', locale)
                    : item.required || item.key === 'verified_doctors'
                      ? t('settingsCheckMissing', locale)
                      : t('settingsCheckOptional', locale)}
                </Chip>
                <span className="text-ink-secondary">
                  {format(COUNT_LABEL[item.key] ?? 'settingsCountStaff', locale, {
                    count: formatNumber(item.count, numerals),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-body-md font-semibold">{t('platformDoctors', locale)}</h3>
          <p className="text-caption text-ink-muted">{t('platformVerifyHint', locale)}</p>
          {detail.doctors.length === 0 ? (
            <p className="text-body-sm text-ink-secondary">{t('platformNoDoctors', locale)}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {detail.doctors.map((doctor) => (
                <li
                  key={doctor.doctorId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-line px-3 py-2"
                  data-testid={`platform-doctor-${doctor.bmdcNumber}`}
                >
                  <div className="min-w-0">
                    <p className="text-body-md">
                      {localName(locale, doctor.nameBn, doctor.nameEn)}
                    </p>
                    <p className="text-body-sm text-ink-secondary">
                      {[
                        format('platformBmdc', locale, { number: doctor.bmdcNumber }),
                        doctor.degrees,
                      ]
                        .filter((part) => part !== null)
                        .join(' · ')}
                    </p>
                  </div>
                  {doctor.verifiedAt === null ? (
                    <div className="flex items-center gap-2">
                      <Chip tone="caution">{t('platformUnverified', locale)}</Chip>
                      <GuardedButton
                        variant="secondary"
                        size="sm"
                        loading={busy === doctor.doctorId}
                        reason={
                          !online
                            ? t('platformOffline', locale)
                            : detail.lifecycle === 'closed'
                              ? t('platformClosedLine', locale)
                              : null
                        }
                        data-testid={`platform-verify-${doctor.bmdcNumber}`}
                        onClick={() => {
                          settle(
                            doctor.doctorId,
                            platformApi.verifyDoctor(token, hospitalId, doctor.doctorId),
                          );
                        }}
                      >
                        {t('platformVerify', locale)}
                      </GuardedButton>
                    </div>
                  ) : (
                    <Chip tone="positive">{t('platformVerified', locale)}</Chip>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-1">
          <h3 className="text-body-md font-semibold">{t('platformAdmins', locale)}</h3>
          <ul className="text-body-sm text-ink-secondary">
            {detail.administrators.map((admin) => (
              <li key={admin.email}>
                {admin.fullName} · {admin.email}
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-3 border-t border-line pt-4">
          <h3 className="text-body-md font-semibold">{t('platformActionsTitle', locale)}</h3>

          {offered.length === 0 ? (
            <p className="text-body-sm text-ink-secondary" data-testid="platform-no-actions">
              {t(
                detail.lifecycle === 'closed' ? 'platformClosedLine' : 'platformNoActions',
                locale,
              )}
            </p>
          ) : (
            <>
              {/* Why an approval would be refused, before it is asked for. */}
              {detail.actions.includes('approve') && detail.missingForApproval.length > 0 ? (
                <p className="text-body-sm text-warn-700" data-testid="platform-not-ready">
                  {failureLine({ kind: 'not_ready', missing: detail.missingForApproval }, locale)}
                </p>
              ) : null}

              {offered.some((act) => actionNeedsNote(act.action)) ? (
                <Input
                  density="console"
                  label={t('platformNoteLabel', locale)}
                  helper={t('platformNoteHelper', locale)}
                  value={note}
                  maxLength={500}
                  onChange={(event) => {
                    setNote(event.target.value);
                  }}
                  data-testid="platform-note"
                />
              ) : null}

              {offered.some((act) => act.action === 'close') ? (
                <label className="flex items-center gap-2 text-body-sm">
                  <input
                    type="checkbox"
                    checked={sure}
                    onChange={(event) => {
                      setSure(event.target.checked);
                    }}
                    data-testid="platform-close-sure"
                  />
                  {t('platformCloseConfirm', locale)}
                </label>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {offered.map((act) => {
                  const needsNote = actionNeedsNote(act.action);
                  const blockedApproval =
                    act.action === 'approve' && detail.missingForApproval.length > 0;
                  const blockedClose = act.action === 'close' && !sure;
                  const reason = !online
                    ? t('platformOffline', locale)
                    : blockedApproval
                      ? failureLine(
                          { kind: 'not_ready', missing: detail.missingForApproval },
                          locale,
                        )
                      : needsNote && note.trim().length < 3
                        ? t('platformNoteRequired', locale)
                        : blockedClose
                          ? t('platformCloseConfirm', locale)
                          : null;
                  return (
                    <GuardedButton
                      key={act.action}
                      variant={act.variant}
                      loading={busy === act.action}
                      reason={reason}
                      data-testid={`platform-act-${act.action}`}
                      onClick={() => {
                        settle(
                          act.action,
                          platformApi.act(token, hospitalId, act.route, needsNote ? note : ''),
                        );
                      }}
                    >
                      {t(act.label, locale)}
                    </GuardedButton>
                  );
                })}
              </div>
            </>
          )}

          {problem === null ? null : (
            <p role="alert" className="text-body-sm text-warn-700" data-testid="platform-problem">
              {problem}
            </p>
          )}
        </section>
      </div>
    </Card>
  );
}

function NewWorkspaceForm({
  token,
  online,
  onCancel,
  onCreated,
}: {
  readonly token: string;
  readonly online: boolean;
  readonly onCancel: () => void;
  readonly onCreated: (created: CreatedWorkspace) => void;
}): ReactNode {
  const locale = useLocale();
  const [code, setCode] = useState('');
  const [nameBn, setNameBn] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [kind, setKind] = useState<FacilityKind>('hospital');
  const [division, setDivision] = useState<string>('Dhaka');
  const [district, setDistrict] = useState('');
  const [registrationNo, setRegistrationNo] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const codeOk = /^[A-Za-z0-9][A-Za-z0-9-]{1,15}$/.test(code.trim());
  const ready =
    codeOk &&
    nameBn.trim() !== '' &&
    nameEn.trim() !== '' &&
    district.trim().length >= 2 &&
    adminName.trim() !== '' &&
    adminEmail.includes('@');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!ready || !online) return;
    setBusy(true);
    setProblem(null);
    void platformApi
      .create(token, {
        code: code.trim(),
        nameBn: nameBn.trim(),
        nameEn: nameEn.trim(),
        kind,
        division,
        district: district.trim(),
        ...(registrationNo.trim() === '' ? {} : { registrationNo: registrationNo.trim() }),
        adminName: adminName.trim(),
        adminEmail: adminEmail.trim(),
      })
      .then((result) => {
        if (result.ok) onCreated(result.value);
        else setProblem(failureLine(result.failure, locale));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const reason = !online
    ? t('platformOffline', locale)
    : ready
      ? null
      : t('platformInvalid', locale);

  return (
    <Card data-testid="platform-new-form">
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <div>
          <h2 className="text-title-md">{t('platformFormTitle', locale)}</h2>
          <p className="text-body-sm text-ink-secondary">{t('platformFormIntro', locale)}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Input
            density="console"
            label={t('platformFieldNameBn', locale)}
            value={nameBn}
            onChange={(event) => {
              setNameBn(event.target.value);
            }}
          />
          <Input
            density="console"
            label={t('platformFieldNameEn', locale)}
            value={nameEn}
            onChange={(event) => {
              setNameEn(event.target.value);
            }}
          />
          <Input
            density="console"
            label={t('platformFieldCode', locale)}
            helper={t('platformFieldCodeHelp', locale)}
            value={code}
            autoCapitalize="characters"
            onChange={(event) => {
              setCode(event.target.value.toUpperCase());
            }}
          />
          <Input
            density="console"
            label={t('platformFieldRegistration', locale)}
            value={registrationNo}
            onChange={(event) => {
              setRegistrationNo(event.target.value);
            }}
          />
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-body-sm font-semibold">{t('platformFieldKind', locale)}</legend>
          <div className="flex flex-wrap gap-2">
            {FACILITY_KINDS.map((candidate) => (
              <FilterChip
                key={candidate}
                selected={kind === candidate}
                onToggle={() => {
                  setKind(candidate);
                }}
              >
                {facilityKindName(candidate, locale)}
              </FilterChip>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-body-sm font-semibold">
            {t('platformFieldDivision', locale)}
          </legend>
          <div className="flex flex-wrap gap-2">
            {Object.keys(DIVISION_NAMES).map((candidate) => (
              <FilterChip
                key={candidate}
                selected={division === candidate}
                onToggle={() => {
                  setDivision(candidate);
                }}
              >
                {divisionName(candidate, locale)}
              </FilterChip>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 md:grid-cols-2">
          <Input
            density="console"
            label={t('platformFieldDistrict', locale)}
            value={district}
            onChange={(event) => {
              setDistrict(event.target.value);
            }}
          />
          <span />
          <Input
            density="console"
            label={t('platformFieldAdminName', locale)}
            value={adminName}
            onChange={(event) => {
              setAdminName(event.target.value);
            }}
          />
          <Input
            density="console"
            kind="email"
            label={t('platformFieldAdminEmail', locale)}
            value={adminEmail}
            onChange={(event) => {
              setAdminEmail(event.target.value);
            }}
          />
        </div>

        {problem === null ? null : (
          <p
            role="alert"
            className="text-body-sm text-warn-700"
            data-testid="platform-form-problem"
          >
            {problem}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <GuardedButton type="submit" loading={busy} reason={reason} data-testid="platform-create">
            {t('platformCreate', locale)}
          </GuardedButton>
          <Button variant="quiet" onClick={onCancel}>
            {t('platformCancel', locale)}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** The temporary password, once. */
function CreatedCard({
  created,
  onDone,
}: {
  readonly created: CreatedWorkspace;
  readonly onDone: () => void;
}): ReactNode {
  const locale = useLocale();
  return (
    <Card tone="brand" data-testid="platform-created">
      <div className="flex flex-col gap-3">
        <h2 className="text-title-md">{t('platformCreatedTitle', locale)}</h2>
        <p className="text-body-md">
          {format('platformCreatedLine', locale, { email: created.adminEmail })}
        </p>
        <div>
          <p className="text-caption text-ink-muted">{t('platformTempPassword', locale)}</p>
          <p className="font-mono text-title-md tabular-nums" data-testid="platform-temp-password">
            {created.temporaryPassword}
          </p>
        </div>
        <div>
          <Button variant="secondary" data-testid="platform-created-done" onClick={onDone}>
            {t('platformCreatedDone', locale)}
          </Button>
        </div>
      </div>
    </Card>
  );
}
