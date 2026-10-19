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

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';

import {
  AGREEMENT_STATES,
  FACILITY_KINDS,
  HEALTH_WINDOW_DAYS,
  actionNeedsNote,
  deliveryPercent,
  HOSPITAL_MODULES,
} from '@platform/domain';
import {
  CONSOLE,
  DIVISION_NAMES,
  auditChangeName,
  divisionName,
  districtName,
  facilityKindName,
  format,
  formatAge,
  formatDateTime,
  formatNumber,
  formatPhone,
  localName,
  numeralsFor,
  t,
} from '@platform/i18n';
import {
  Button,
  Card,
  Chip,
  ConsoleHelp,
  ConsolePageHeader,
  FilterChip,
  FreshnessLine,
  Input,
  useLocale,
} from '@platform/ui';

import {
  AdminManagementProvider,
  AdminManagementFeedback,
  useAdminManagement,
  reviewField,
} from '@/components/AdminManagementContext';
import { ConsoleWorkspaceFrame } from '@/components/ConsoleWorkspaceFrame';
import '@platform/ui/console-admin.css';
import './platform-workspace.css';
import { DemoBanner } from '@/components/DemoBanner';
import { MODULE_KEY } from '@/components/HospitalSettings';
import { usePlatformDraft } from '@/components/PlatformDraft';
import { readDemoSession } from '@/lib/demo';
import { platformApi } from '@/lib/platform';

const STATE_NAME = {
  setup: 'platformStateSetup',
  ready_for_review: 'platformStateReview',
  active: 'platformStateActive',
  suspended: 'platformStateSuspended',
  closed: 'platformStateClosed',
};

/** What asks for attention at a workspace, as words (`FR-SUP-06`). */
const ATTENTION_NAME = {
  unconfirmed_figures: 'platformAttentionUnconfirmed',
  messages: 'platformAttentionMessages',
};

const FIGURE_NAME = {
  beds: 'platformHealthFigureBeds',
  capabilities: 'platformHealthFigureCapabilities',
};

/** The agreement's state as a word (`FR-SUP-04`). */
const AGREEMENT_NAME = {
  trial: 'agreementTrial',
  active: 'agreementActive',
  overdue: 'agreementOverdue',
  ended: 'agreementEnded',
};

const STATE_TONE = {
  setup: 'neutral',
  ready_for_review: 'caution',
  active: 'positive',
  suspended: 'caution',
  closed: 'neutral',
};

/** The acts, in the order they are offered, with their labels and routes. */
const ACTS = [
  { action: 'approve', route: 'approve', label: 'platformApprove', variant: 'primary' },
  { action: 'send_back', route: 'send-back', label: 'platformSendBack', variant: 'secondary' },
  { action: 'reinstate', route: 'reinstate', label: 'platformReinstate', variant: 'primary' },
  { action: 'suspend', route: 'suspend', label: 'platformSuspend', variant: 'secondary' },
  { action: 'close', route: 'close', label: 'platformClose', variant: 'quiet' },
];

/** The checklist's count lines, shared with `S-B-11`. */
const COUNT_LABEL = {
  departments: 'settingsCountDepartments',
  doctors: 'settingsCountDoctors',
  schedules: 'settingsCountSchedules',
  staff: 'settingsCountStaff',
  contact: 'settingsCountContact',
  location: 'settingsCountLocation',
  emergency_services: 'settingsCountEmergency',
  beds: 'settingsCountBeds',
  verified_doctors: 'settingsCountVerified',
};

/** What a missing item is called in the sentence that refuses an approval. */
const MISSING_NAME = {
  departments: 'settingsItemDepartments',
  doctors: 'settingsItemDoctors',
  schedules: 'settingsItemSchedules',
  staff: 'settingsItemStaff',
  verified_doctors: 'platformItemVerified',
};

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => {
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

function useNow() {
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

export function PlatformConsole() {
  return (
    <AdminManagementProvider>
      <PlatformWorkspace />
    </AdminManagementProvider>
  );
}
function PlatformWorkspace() {
  const locale = useLocale();
  const online = useOnline();
  const now = useNow();
  const session = readDemoSession();
  const token = session?.token ?? '';

  const management = useAdminManagement();
  const [listFailed, setListFailed] = useState(false);
  const sequence = useRef(0);
  const [list, setList] = useState({ state: 'loading' });
  const [panel, setPanel] = useState({ kind: 'none' });

  const load = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const items = await platformApi.list(token);
      if (request !== sequence.current) return;
      setListFailed(false);
      setList({ state: 'ready', items, asOf: new Date() });
    } catch {
      if (request !== sequence.current) return;
      setListFailed(true);
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

  if (session === null) return null;
  return (
    <div className="platform-workspace admin-workspace">
      <ConsoleWorkspaceFrame
        session={session}
        workspace={CONSOLE.platformTitle}
        navigation={[
          {
            id: 'organisations',
            label: { bn: 'প্রতিষ্ঠান', en: 'Organisations' },
            current: true,
            roles: ['platform_admin'],
            enabled: true,
            onSelect: () => management?.navigate(() => setPanel({ kind: 'none' })),
          },
        ]}
        actions={
          <ConsoleHelp
            topic={{
              id: 'platform-onboarding',
              title: CONSOLE.platformTitle,
              steps: [
                CONSOLE.platformIntro,
                CONSOLE.platformFormIntro,
                CONSOLE.platformVerifyHint,
                CONSOLE.platformModulesHelper,
                CONSOLE.platformCloseConfirm,
              ],
            }}
          />
        }
      >
        <DemoBanner />
        <div className="platform-content" data-testid="platform-console">
          <ConsolePageHeader title={CONSOLE.platformTitle} />
          <AdminManagementFeedback />
          {listFailed && list.state === 'ready' ? (
            <div role="alert" className="platform-read-warning">
              <p>
                {t('platformLoadFailed', locale)} {t('staleWarning', locale)}
              </p>
              <Button variant="secondary" size="sm" onClick={() => void load()}>
                {t('retry', locale)}
              </Button>
            </div>
          ) : null}
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

          <div className="platform-columns">
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
                    management?.navigate(() => setPanel({ kind: 'new' }));
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
                  management?.navigate(() => setPanel({ kind: 'workspace', id }));
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
                  onLocated={(id) => setPanel({ kind: 'workspace', id })}
                  onCancel={() => {
                    management?.navigate(() => setPanel({ kind: 'none' }));
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
        </div>
      </ConsoleWorkspaceFrame>
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
function GuardedButton({ reason, children, ...rest }) {
  const management = useAdminManagement();
  const locale = useLocale();
  const blocked = management?.busy
    ? t('manageSaving', locale)
    : [...(management?.drafts.values() ?? [])].some((d) => d.conflict)
      ? t('manageServerChanged', locale)
      : reason;
  return blocked === null ? (
    <Button {...rest}>{children}</Button>
  ) : (
    <Button {...rest} disabled disabledReason={blocked}>
      {children}
    </Button>
  );
}

function StateChip({ lifecycle }) {
  const locale = useLocale();
  // A11Y-03: the state is a word, and the tone only repeats it.
  return <Chip tone={STATE_TONE[lifecycle]}>{t(STATE_NAME[lifecycle], locale)}</Chip>;
}

function WorkspaceList({ list, now, selected, onSelect, onRetry }) {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

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

      <Input
        label={locale === 'bn' ? 'নাম, কোড বা জেলা দিয়ে খুঁজুন' : 'Find by name, code or district'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        data-testid="platform-search"
      />
      <div className="platform-filters">
        {['all', 'ready_for_review', 'attention', 'setup', 'active', 'suspended', 'closed'].map(
          (value) => (
            <FilterChip
              key={value}
              selected={filter === value}
              data-testid={`platform-filter-${value}`}
              onToggle={() => setFilter(value)}
            >
              {value === 'all'
                ? locale === 'bn'
                  ? 'সব প্রতিষ্ঠান'
                  : 'All organisations'
                : value === 'attention'
                  ? locale === 'bn'
                    ? 'নজর প্রয়োজন'
                    : 'Needs attention'
                  : t(STATE_NAME[value], locale)}
            </FilterChip>
          ),
        )}
      </div>
      <ul className="flex flex-col gap-2" data-testid="platform-list">
        {list.items
          .filter(
            (item) =>
              (filter === 'all' || filter === 'attention'
                ? filter === 'all' || item.attention.length > 0
                : item.lifecycle === filter) &&
              [item.nameBn, item.nameEn, item.code ?? '', item.district]
                .join(' ')
                .toLocaleLowerCase()
                .includes(query.trim().toLocaleLowerCase()),
          )
          .map((item) => {
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
                    <span className="flex flex-wrap items-center gap-2">
                      {/* `FR-ONB-10`: an application is a workspace like any
                  other, and the list says that it was one. */}
                      {item.selfRegistered === true ? (
                        <span data-testid="platform-self-registered">
                          <Chip tone="neutral">{t('platformSelfRegistered', locale)}</Chip>
                        </span>
                      ) : null}
                      {/* An agreement somebody has to act on is said in the
                  list; trial and active are the ordinary states and
                  are read on the workspace (`FR-SUP-04`). */}
                      {item.agreement.state === 'overdue' || item.agreement.state === 'ended' ? (
                        <span data-testid="platform-row-agreement">
                          <Chip tone="caution">
                            {t(
                              item.agreement.state === 'overdue'
                                ? 'platformAgreementChipOverdue'
                                : 'platformAgreementChipEnded',
                              locale,
                            )}
                          </Chip>
                        </span>
                      ) : null}
                      {/* `FR-SUP-06`: which hospital is stale or failing, said
                  where every hospital is in view. */}
                      {item.attention.map((entry) => (
                        <span key={entry} data-testid={`platform-row-attention-${entry}`}>
                          <Chip tone="caution">{t(ATTENTION_NAME[entry], locale)}</Chip>
                        </span>
                      ))}
                      <StateChip lifecycle={item.lifecycle} />
                    </span>
                  </span>
                  <span className="text-body-sm text-ink-secondary">
                    {[
                      facilityKindName(item.kind, locale),
                      districtName(item.district, locale),
                      item.code === null
                        ? null
                        : format('platformCode', locale, { code: item.code }),
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
                  {/* `FR-SUP-06`, the stale-data offenders: said as an age on
                  every row that has one, so the worst can be read against
                  the rest, and not as a flag that is on everywhere. */}
                  {item.stalest === null ? null : (
                    <span
                      className="text-caption text-ink-muted"
                      data-testid="platform-row-stalest"
                    >
                      {format('platformRowStalest', locale, {
                        figure: t(FIGURE_NAME[item.stalest.figure], locale),
                        age: formatAge(item.stalest.ageMinutes, locale, numerals),
                      })}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
      </ul>
    </div>
  );
}

/** What a refusal is, as a sentence. */
function failureLine(failure, locale) {
  switch (failure.kind) {
    case 'offline':
      return t('platformOffline', locale);
    case 'duplicate_code':
      return t('platformDuplicateCode', locale);
    case 'note_required':
      return t('platformNoteRequired', locale);
    case 'changed':
      return t('platformChanged', locale);
    case 'domain_taken':
      return t('platformDomainTaken', locale);
    case 'domain_is_the_platforms':
      return t('platformDomainIsOurs', locale);
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

function WorkspacePanel({ token, hospitalId, online, onChanged }) {
  const locale = useLocale();
  const numerals = numeralsFor(locale);

  const [detail, setDetail] = useState(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState(null);
  const [sure, setSure] = useState(false);
  const [tab, setTab] = useState('readiness');
  const management = useAdminManagement();
  const readSequence = useRef(0);
  usePlatformDraft(
    'decision',
    t('platformActionsTitle', locale),
    [reviewField(t('platformNoteLabel', locale), '', note)],
    () => {
      setNote('');
      setSure(false);
    },
  );

  const read = useCallback(async () => {
    const request = ++readSequence.current;
    try {
      const next = await platformApi.detail(token, hospitalId);
      if (request !== readSequence.current) return;
      setDetail(next);
      setFailed(false);
    } catch {
      if (request !== readSequence.current) return;
      setFailed(true);
    }
  }, [token, hospitalId]);

  useEffect(() => {
    void read();
  }, [read]);

  if (failed && detail === null) {
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

  const settle = async (key, call) => {
    if (
      busy !== null ||
      !online ||
      management?.busy ||
      [...(management?.drafts.values() ?? [])].some((d) => d.conflict)
    )
      return false;
    const fields = management?.drafts.get(key)?.fields;
    if (
      !(await management?.confirm({
        title:
          key === 'modules'
            ? t('platformModulesSave', locale)
            : key === 'domain'
              ? t('platformDomainSave', locale)
              : key === 'agreement'
                ? t('platformAgreementSave', locale)
                : key.length > 20
                  ? t('platformVerify', locale)
                  : t(ACTS.find((a) => a.action === key)?.label ?? 'platformActionsTitle', locale),
        scope: localName(locale, detail.nameBn, detail.nameEn),
        note:
          key.length > 20
            ? t('platformVerifyHint', locale)
            : key === 'close'
              ? t('platformCloseConfirm', locale)
              : note.trim() || t('manageReviewNote', locale),
        ...(fields === undefined ? {} : { fields }),
      }))
    )
      return false;
    setBusy(key);
    management?.setBusy(true);
    setProblem(null);
    try {
      const result = await call();
      if (result.ok) {
        setDetail(result.value);
        setNote('');
        setSure(false);
        onChanged();
        return true;
      }
      setProblem(failureLine(result.failure, locale));
      if (
        result.failure.kind === 'changed' ||
        result.failure.kind === 'offline' ||
        result.failure.kind === 'failed'
      ) {
        await read();
        onChanged();
      }
      return false;
    } catch {
      setProblem(t('platformActionFailed', locale));
      await read();
      onChanged();
      return false;
    } finally {
      setBusy(null);
      management?.setBusy(false);
    }
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
                facilityKindName(detail.kind, locale),
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

        <div className="platform-workspace-tabs" aria-label={t('platformTitle', locale)}>
          {[
            ['readiness', 'প্রস্তুতি ও সিদ্ধান্ত', 'Readiness & decision'],
            ['services', 'সেবা ও ঠিকানা', 'Services & address'],
            ['access', 'প্রশাসনিক অ্যাক্সেস', 'Administrator access'],
            ['health', 'অবস্থা ও ইতিহাস', 'Health & history'],
          ].map(([id, bn, en]) => (
            <button
              key={id}
              type="button"
              aria-pressed={tab === id}
              data-testid={`platform-section-${id}`}
              onClick={() => setTab(id ?? 'readiness')}
            >
              {locale === 'bn' ? bn : en}
            </button>
          ))}
        </div>
        {failed ? (
          <div role="alert" className="platform-read-warning">
            <p>
              {t('platformLoadFailed', locale)} {t('staleWarning', locale)}
            </p>
            <Button variant="secondary" onClick={() => void read()}>
              {t('retry', locale)}
            </Button>
          </div>
        ) : null}
        {/* The same checklist the hospital sees, over the same counts. */}
        <section hidden={tab !== 'readiness'} className="flex flex-col gap-2">
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
                      : item.advised
                        ? t('settingsCheckAdvised', locale)
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

        <section hidden={tab !== 'readiness'} className="flex flex-col gap-2">
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
                          void settle(doctor.doctorId, () =>
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

        <section hidden={tab !== 'access'} className="flex flex-col gap-1">
          <h3 className="text-body-md font-semibold">{t('platformAdmins', locale)}</h3>
          <ul className="text-body-sm text-ink-secondary">
            {detail.administrators.map((admin) => (
              <li key={admin.email}>
                {[
                  admin.fullName,
                  admin.email,
                  admin.phone == null ? null : formatPhone(admin.phone),
                ]
                  .filter((part) => part !== null)
                  .join(' · ')}
              </li>
            ))}
          </ul>
          {/* What an applying hospital said of itself, for the person who
            rings it before approving (`FR-ONB-09`, `FR-ONB-10`). */}
          {detail.selfRegistered === true ? (
            <p className="text-body-sm text-ink-secondary" data-testid="platform-applied">
              {format('platformAppliedLine', locale, {
                phone: detail.phone == null ? '—' : formatPhone(detail.phone),
                registration: detail.registrationNo ?? '—',
              })}
            </p>
          ) : null}
        </section>

        <div hidden={tab !== 'access'}>
          <Agreement
            detail={detail}
            online={online}
            busy={busy === 'agreement'}
            onSet={(state, note) => {
              return settle('agreement', () =>
                platformApi.setAgreement(token, hospitalId, state, note),
              );
            }}
          />
        </div>

        <div hidden={tab !== 'health'}>
          <Health detail={detail} />
        </div>

        <div hidden={tab !== 'services'}>
          <Modules
            detail={detail}
            online={online}
            busy={busy === 'modules'}
            onSet={(off) => {
              return settle('modules', () => platformApi.setModules(token, hospitalId, off));
            }}
          />
        </div>

        <div hidden={tab !== 'services'}>
          <PortalAddress
            detail={detail}
            online={online}
            busy={busy === 'domain'}
            onSet={(domain) => {
              return settle('domain', () => platformApi.setDomain(token, hospitalId, domain));
            }}
          />
        </div>

        <div hidden={tab !== 'health'}>
          <AuditTrail
            token={token}
            hospitalId={hospitalId}
            online={online}
            revision={detail.health.asOf}
          />
        </div>

        <section
          hidden={tab !== 'readiness'}
          className="flex flex-col gap-3 border-t border-line pt-4"
        >
          <h3 className="text-body-md font-semibold">{t('platformActionsTitle', locale)}</h3>

          {/* While it is setting up the next move is the hospital's; the one
            thing the platform can do is close a workspace that should not
            go on, which is how an application is declined (`FR-ONB-10`). */}
          {offered.length === 0 || detail.lifecycle === 'setup' ? (
            <p className="text-body-sm text-ink-secondary" data-testid="platform-no-actions">
              {t(
                detail.lifecycle === 'closed' ? 'platformClosedLine' : 'platformNoActions',
                locale,
              )}
            </p>
          ) : null}
          {detail.lifecycle === 'setup' && offered.length > 0 ? (
            <p className="text-body-sm text-ink-secondary" data-testid="platform-decline-line">
              {t('platformDeclineLine', locale)}
            </p>
          ) : null}

          {offered.length === 0 ? null : (
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
                        void settle(act.action, () =>
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
        </section>
        {problem === null ? null : (
          <p role="alert" className="text-body-sm text-warn-700" data-testid="platform-problem">
            {problem}
          </p>
        )}
      </div>
    </Card>
  );
}

/**
 * Where a hospital's agreement stands, and what it has used (`FR-SUP-04`, the
 * state half; `FRM-B12-AGREEMENT`, `TXT-B12-USAGE`).
 *
 * One of four words and a note for whoever reads it next. It is a record:
 * saving it switches nothing at the hospital, and the line under the title
 * says so, because the person here should not think "ended" unlisted anybody.
 * Taking a hospital out of the network is suspending it, below. No plan and
 * no amount has a field, here or on the server.
 *
 * The usage is three counts with when they were counted, set as plain lines
 * and not as tiles: they are for reading beside the agreement, not a
 * dashboard. Counts of activity, never a row of it (`FR-ONB-08`).
 */
function Agreement({ detail, online, busy, onSet }) {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const now = useNow();
  const [state, setState] = useState(detail.agreement.state);
  const [note, setNote] = useState(detail.agreement.note ?? '');

  const saveDraft = usePlatformDraft(
    'agreement',
    t('platformAgreementTitle', locale),
    [
      reviewField(t('platformAgreementTitle', locale), detail.agreement.state, state),
      reviewField(t('platformAgreementNoteLabel', locale), detail.agreement.note ?? '', note),
    ],
    () => {
      setState(detail.agreement.state);
      setNote(detail.agreement.note ?? '');
    },
  );

  const typed = note.trim();
  const same = state === detail.agreement.state && typed === (detail.agreement.note ?? '');
  const reason = !online
    ? t('platformOffline', locale)
    : typed !== '' && typed.length < 3
      ? t('platformAgreementNoteShort', locale)
      : same
        ? t('platformAgreementSame', locale)
        : null;

  const days = formatNumber(30, numerals);
  const usage = [
    {
      key: 'serials',
      label: format('platformUsageSerials', locale, { days }),
      count: detail.usage.serialsTaken30d,
    },
    {
      key: 'chambers',
      label: format('platformUsageChambers', locale, { days }),
      count: detail.usage.chambersHeld30d,
    },
    {
      key: 'messages',
      label: t('platformUsageMessages', locale),
      count: detail.usage.messagesSentThisMonth,
    },
  ];

  return (
    <section
      className="flex flex-col gap-3 border-t border-line pt-4"
      data-testid="platform-agreement"
      data-agreement={detail.agreement.state}
    >
      <h3 className="text-body-md font-semibold">{t('platformAgreementTitle', locale)}</h3>
      <p className="text-body-sm text-ink-secondary">{t('platformAgreementHelper', locale)}</p>
      <p className="text-body-sm text-ink-secondary" data-testid="platform-agreement-recorded">
        {detail.agreement.changedAt === null
          ? t('platformAgreementNeverSet', locale)
          : format('platformAgreementSetAt', locale, {
              state: t(AGREEMENT_NAME[detail.agreement.state], locale),
              when: formatDateTime(detail.agreement.changedAt, numerals),
            })}
      </p>

      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (reason === null && !busy)
            void saveDraft(() => onSet(state, typed === '' ? null : typed));
        }}
      >
        <div className="flex flex-wrap gap-2">
          {AGREEMENT_STATES.map((option) => (
            <FilterChip
              key={option}
              selected={state === option}
              data-testid={`platform-agreement-${option}`}
              onToggle={() => {
                setState(option);
              }}
            >
              {t(AGREEMENT_NAME[option], locale)}
            </FilterChip>
          ))}
        </div>
        <Input
          label={t('platformAgreementNoteLabel', locale)}
          helper={t('platformAgreementNoteHelper', locale)}
          density="console"
          value={note}
          maxLength={500}
          data-testid="platform-agreement-note"
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
        <div>
          <GuardedButton
            type="submit"
            size="sm"
            loading={busy}
            reason={reason}
            data-testid="platform-agreement-save"
          >
            {t('platformAgreementSave', locale)}
          </GuardedButton>
        </div>
      </form>

      <div className="flex flex-col gap-2" data-testid="platform-usage">
        <h4 className="text-body-sm font-semibold">{t('platformUsageTitle', locale)}</h4>
        {/* A count beside its label, not across the panel from it. */}
        <dl className="grid w-fit grid-cols-2 gap-x-6 gap-y-1 text-body-sm">
          {usage.map((line) => (
            <Fragment key={line.key}>
              <dt className="text-ink-secondary">{line.label}</dt>
              <dd className="text-right tabular-nums" data-testid={`platform-usage-${line.key}`}>
                {formatNumber(line.count, numerals)}
              </dd>
            </Fragment>
          ))}
        </dl>
        <p className="text-caption text-ink-muted">{t('platformUsageHelper', locale)}</p>
        <FreshnessLine
          asOf={new Date(detail.usage.asOf)}
          now={now}
          labels={{
            justNow: t('updatedJustNow', locale),
            ago: t('updatedAgo', locale),
            never: t('platformListAge', locale),
            stale: t('staleWarning', locale),
          }}
          formatMinutes={(value) => formatAge(value, locale, numerals)}
        />
      </div>
    </section>
  );
}

/**
 * How a hospital is doing (`FR-SUP-06`, `TXT-B12-HEALTH`).
 *
 * Three plain blocks: how old each figure it publishes is, what became of a
 * week's messages, and how much of its counters' work arrived late. A figure
 * is stale here by the hospital's own threshold, the one a patient's screen
 * uses, and the line under the figures says so. Late work is explained and
 * never drawn as a fault: a counter that kept working offline did its job.
 *
 * Organisations and counts (`FR-ONB-08`): nothing here is about a person.
 */
function Health({ detail }) {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const now = useNow();
  const { health } = detail;
  const days = formatNumber(HEALTH_WINDOW_DAYS, numerals);
  const percent = deliveryPercent(health.messages);

  const messages = [
    { key: 'sent', label: t('platformHealthSent', locale), count: health.messages.sent },
    { key: 'failed', label: t('platformHealthFailed', locale), count: health.messages.failed },
    { key: 'held', label: t('platformHealthHeld', locale), count: health.messages.held },
    { key: 'waiting', label: t('platformHealthWaiting', locale), count: health.messages.waiting },
  ];

  const slowestMinutes = Math.floor(health.sync.slowestSeconds / 60);

  return (
    <section
      className="flex flex-col gap-4 border-t border-line pt-4"
      data-testid="platform-health"
      data-attention={health.attention.join(' ')}
    >
      <div className="flex flex-col gap-2">
        <h3 className="text-body-md font-semibold">{t('platformHealthTitle', locale)}</h3>
        {health.attention.length === 0 ? (
          <p className="text-body-sm text-ink-secondary" data-testid="platform-health-fine">
            {t('platformHealthFine', locale)}
          </p>
        ) : (
          <p className="flex flex-wrap gap-2">
            {health.attention.map((entry) => (
              <Chip key={entry} tone="caution">
                {t(ATTENTION_NAME[entry], locale)}
              </Chip>
            ))}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2" data-testid="platform-health-figures">
        <h4 className="text-body-sm font-semibold">{t('platformHealthFigures', locale)}</h4>
        {health.figures.length === 0 ? (
          <p className="text-body-sm text-ink-secondary">
            {t('platformHealthFiguresNone', locale)}
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-1 text-body-sm">
              {health.figures.map((figure) => (
                <li
                  key={figure.figure}
                  className="flex flex-wrap items-center gap-2"
                  data-testid={`platform-health-figure-${figure.figure}`}
                  data-stale={figure.stale ? 'true' : 'false'}
                >
                  <span className="text-ink-secondary">
                    {t(FIGURE_NAME[figure.figure], locale)}
                  </span>
                  {/* A11Y-03: the state is a word; the tone only repeats it. */}
                  {!figure.shared ? (
                    <Chip tone="neutral">{t('platformHealthNotShared', locale)}</Chip>
                  ) : figure.ageMinutes === null ? (
                    <Chip tone="caution">{t('platformHealthNever', locale)}</Chip>
                  ) : (
                    <>
                      <Chip tone={figure.stale ? 'caution' : 'positive'}>
                        {t(figure.stale ? 'platformHealthStale' : 'platformHealthFresh', locale)}
                      </Chip>
                      <span>
                        {figure.ageMinutes === 0
                          ? t('updatedJustNow', locale)
                          : format('platformHealthAge', locale, {
                              age: formatAge(figure.ageMinutes, locale, numerals),
                            })}
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-caption text-ink-muted">
              {format('platformHealthThreshold', locale, {
                age: formatAge(health.staleAfterMinutes, locale, numerals),
              })}
            </p>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2" data-testid="platform-health-messages">
        <h4 className="text-body-sm font-semibold">
          {format('platformHealthMessages', locale, { days })}
        </h4>
        <dl className="grid w-fit grid-cols-2 gap-x-6 gap-y-1 text-body-sm">
          {messages.map((line) => (
            <Fragment key={line.key}>
              <dt className="text-ink-secondary">{line.label}</dt>
              <dd className="text-right tabular-nums" data-testid={`platform-health-${line.key}`}>
                {formatNumber(line.count, numerals)}
              </dd>
            </Fragment>
          ))}
        </dl>
        <p className="text-caption text-ink-muted">
          {percent === null
            ? t('platformHealthNoMessages', locale)
            : format('platformHealthDelivery', locale, {
                percent: formatNumber(percent, numerals),
              })}{' '}
          {t('platformHealthHeldHelper', locale)}
        </p>
      </div>

      <div className="flex flex-col gap-2" data-testid="platform-health-sync">
        <h4 className="text-body-sm font-semibold">
          {format('platformHealthSync', locale, { days })}
        </h4>
        {health.sync.lateActions === 0 ? (
          <p className="text-body-sm text-ink-secondary">{t('platformHealthNoLate', locale)}</p>
        ) : (
          <dl className="grid w-fit grid-cols-2 gap-x-6 gap-y-1 text-body-sm">
            <dt className="text-ink-secondary">{t('platformHealthLateCount', locale)}</dt>
            <dd className="text-right tabular-nums" data-testid="platform-health-late">
              {formatNumber(health.sync.lateActions, numerals)}
            </dd>
            <dt className="text-ink-secondary">{t('platformHealthLateSlowest', locale)}</dt>
            <dd className="text-right">
              {slowestMinutes === 0
                ? t('platformHealthUnderMinute', locale)
                : formatAge(slowestMinutes, locale, numerals)}
            </dd>
            {health.sync.lastLateAt === null ? null : (
              <>
                <dt className="text-ink-secondary">{t('platformHealthLateLast', locale)}</dt>
                <dd className="text-right">{formatDateTime(health.sync.lastLateAt, numerals)}</dd>
              </>
            )}
          </dl>
        )}
        <p className="text-caption text-ink-muted">{t('platformHealthSyncHelper', locale)}</p>
      </div>

      <FreshnessLine
        asOf={new Date(health.asOf)}
        now={now}
        labels={{
          justNow: t('updatedJustNow', locale),
          ago: t('updatedAgo', locale),
          never: t('platformListAge', locale),
          stale: t('staleWarning', locale),
        }}
        formatMinutes={(value) => formatAge(value, locale, numerals)}
      />
    </section>
  );
}

/** How many of the trail's lines are drawn before "show more". */
const TRAIL_FIRST = 8;

/**
 * What was done to the organisation (`FR-ONB-07`, `LIST-B12-TRAIL`).
 *
 * Asked for, not loaded with the workspace: most visits to a workspace are to
 * answer a review, and the trail is for the day somebody asks "who switched
 * that off". Each line is what was done, when, by whom, and whether they were
 * the hospital's or the platform's. Nothing done for a patient is in it.
 *
 * The four states (`GR-03`): the shape of three lines while it loads; a
 * sentence when nothing has been changed; a sentence and a retry when it
 * could not be read; offline, the button is off with the reason.
 */
function AuditTrail({ token, hospitalId, online, revision }) {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const now = useNow();
  const [view, setView] = useState({ state: 'closed' });
  const open = view.state !== 'closed';

  const read = useCallback(async () => {
    try {
      const trail = await platformApi.trail(token, hospitalId);
      setView((held) => ({ state: 'ready', trail, all: held.state === 'ready' && held.all }));
    } catch {
      setView({ state: 'failed' });
    }
  }, [token, hospitalId]);

  // Another workspace: its trail is not this one's.
  useEffect(() => {
    setView({ state: 'closed' });
  }, [hospitalId]);

  // The workspace was changed here: what is on show is now a line short.
  // Only `revision` brings this about; whether the trail is open is read at
  // that moment and not followed, or opening it would read it twice.
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (openRef.current) void read();
  }, [revision, read]);

  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4" data-testid="platform-trail">
      <h3 className="text-body-md font-semibold">{t('platformTrailTitle', locale)}</h3>
      <p className="text-body-sm text-ink-secondary">{t('platformTrailHelper', locale)}</p>

      {view.state === 'closed' ? (
        <div>
          <GuardedButton
            variant="secondary"
            size="sm"
            reason={online ? null : t('platformOffline', locale)}
            data-testid="platform-trail-show"
            onClick={() => {
              setView({ state: 'loading' });
              void read();
            }}
          >
            {t('platformTrailShow', locale)}
          </GuardedButton>
        </div>
      ) : null}

      {view.state === 'loading' ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <div className="h-10 rounded-sm bg-sunken" />
          <div className="h-10 rounded-sm bg-sunken" />
          <div className="h-10 rounded-sm bg-sunken" />
        </div>
      ) : null}

      {view.state === 'failed' ? (
        <div role="alert" className="flex flex-col gap-2">
          <p className="text-body-sm">{t('platformTrailFailed', locale)}</p>
          <div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setView({ state: 'loading' });
                void read();
              }}
            >
              {t('retry', locale)}
            </Button>
          </div>
        </div>
      ) : null}

      {view.state === 'ready' ? (
        view.trail.entries.length === 0 ? (
          <p className="text-body-sm text-ink-secondary" data-testid="platform-trail-empty">
            {t('platformTrailEmpty', locale)}
          </p>
        ) : (
          <>
            <ol className="flex flex-col gap-2" data-testid="platform-trail-list">
              {(view.all ? view.trail.entries : view.trail.entries.slice(0, TRAIL_FIRST)).map(
                (entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-col gap-0.5 rounded-sm border border-line px-3 py-2"
                    data-testid="platform-trail-entry"
                    data-change={entry.change}
                  >
                    <span className="text-body-sm">{auditChangeName(entry.change, locale)}</span>
                    <span className="text-caption text-ink-muted">
                      {[
                        formatDateTime(entry.at, numerals),
                        entry.actorName ?? t('platformTrailUnknownActor', locale),
                        t(
                          entry.byPlatform ? 'platformTrailByPlatform' : 'platformTrailByHospital',
                          locale,
                        ),
                      ].join(' · ')}
                    </span>
                  </li>
                ),
              )}
            </ol>
            {!view.all && view.trail.entries.length > TRAIL_FIRST ? (
              <div>
                <Button
                  variant="quiet"
                  size="sm"
                  data-testid="platform-trail-more"
                  onClick={() => {
                    setView({ state: 'ready', trail: view.trail, all: true });
                  }}
                >
                  {t('platformTrailMore', locale)}
                </Button>
              </div>
            ) : null}
            <FreshnessLine
              asOf={new Date(view.trail.asOf)}
              now={now}
              labels={{
                justNow: t('updatedJustNow', locale),
                ago: t('updatedAgo', locale),
                never: t('platformListAge', locale),
                stale: t('staleWarning', locale),
              }}
              formatMinutes={(value) => formatAge(value, locale, numerals)}
            />
          </>
        )
      ) : null}
    </section>
  );
}

/**
 * The modules a hospital runs (`FR-BRD-11`, `FR-SUP-03`, `FRM-B12-MODULES`).
 *
 * Each module is a switch; what is saved is the whole set. The doctor's
 * console works a chamber's queue, so switching serials off switches it off
 * with them, here, where it can be seen, and not as a refusal afterwards.
 * Nothing the hospital holds is deleted by a switch.
 */
function Modules({ detail, online, busy, onSet }) {
  const locale = useLocale();
  const [off, setOff] = useState(detail.modulesOff);

  const saveDraft = usePlatformDraft(
    'modules',
    t('platformModulesTitle', locale),
    [
      reviewField(
        t('platformModulesTitle', locale),
        [...detail.modulesOff].sort(),
        [...off].sort(),
      ),
    ],
    () => setOff(detail.modulesOff),
  );

  const toggle = (module) => {
    setOff((current) => {
      if (current.includes(module)) {
        // Back on. The doctor's console needs serials, so serials come with it.
        const next = current.filter((entry) => entry !== module);
        return module === 'doctor' ? next.filter((entry) => entry !== 'queue') : next;
      }
      const next = [...current, module];
      return module === 'queue' && !next.includes('doctor') ? [...next, 'doctor'] : next;
    });
  };

  const same =
    off.length === detail.modulesOff.length &&
    off.every((entry) => detail.modulesOff.includes(entry));
  const reason = !online
    ? t('platformOffline', locale)
    : same
      ? t('platformModulesSame', locale)
      : null;

  return (
    <section
      className="flex flex-col gap-3 border-t border-line pt-4"
      data-testid="platform-modules"
    >
      <h3 className="text-body-md font-semibold">{t('platformModulesTitle', locale)}</h3>
      <p className="text-body-sm text-ink-secondary">{t('platformModulesHelper', locale)}</p>
      <div className="flex flex-wrap gap-2">
        {HOSPITAL_MODULES.map((module) => (
          <FilterChip
            key={module}
            selected={!off.includes(module)}
            data-testid={`platform-module-${module}`}
            onToggle={() => {
              toggle(module);
            }}
          >
            {t(MODULE_KEY[module], locale)}
          </FilterChip>
        ))}
      </div>
      <div>
        <GuardedButton
          size="sm"
          loading={busy}
          reason={reason}
          data-testid="platform-modules-save"
          onClick={() => {
            void saveDraft(() => onSet(off));
          }}
        >
          {t('platformModulesSave', locale)}
        </GuardedButton>
      </div>
    </section>
  );
}

/**
 * Where a hospital's portal is, and the one part of that the platform
 * records: a domain the hospital itself owns (`FR-BRD-07`, `FRM-B12-DOMAIN`).
 *
 * The address under the platform's domain needs nothing done: it is the
 * hospital's code. The hospital's own domain is typed here once the hospital
 * has pointed it at the platform; from then on the whole deployment answers
 * for it, which is why it is the platform's to record and not the hospital's.
 */
function PortalAddress({ detail, online, busy, onSet }) {
  const locale = useLocale();
  const [domain, setDomain] = useState(detail.portalDomain ?? '');

  const saveDraft = usePlatformDraft(
    'domain',
    t('platformPortalTitle', locale),
    [reviewField(t('platformDomainLabel', locale), detail.portalDomain ?? '', domain)],
    () => setDomain(detail.portalDomain ?? ''),
  );

  const typed = domain.trim().toLowerCase();
  const reason = !online
    ? t('platformOffline', locale)
    : typed === ''
      ? t('platformDomainNeed', locale)
      : typed === (detail.portalDomain ?? '')
        ? t('platformDomainSame', locale)
        : null;

  return (
    <section
      className="flex flex-col gap-3 border-t border-line pt-4"
      data-testid="platform-portal"
    >
      <h3 className="text-body-md font-semibold">{t('platformPortalTitle', locale)}</h3>

      {detail.portal.platform === null ? (
        <p className="text-body-sm text-ink-secondary" data-testid="platform-portal-none">
          {t('platformPortalNoDomain', locale)}
        </p>
      ) : (
        <p className="text-body-sm text-ink-secondary">
          {t('platformPortalAt', locale)}
          {': '}
          <span className="font-mono text-ink" data-testid="platform-portal-address">
            {detail.portal.platform}
          </span>
        </p>
      )}

      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (reason === null && !busy) void saveDraft(() => onSet(typed));
        }}
      >
        <Input
          label={t('platformDomainLabel', locale)}
          helper={t('platformDomainHelper', locale)}
          density="console"
          value={domain}
          data-testid="platform-domain-input"
          onChange={(event) => {
            setDomain(event.target.value);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <GuardedButton
            type="submit"
            size="sm"
            loading={busy}
            reason={reason}
            data-testid="platform-domain-save"
          >
            {t('platformDomainSave', locale)}
          </GuardedButton>
          {detail.portalDomain === null ? null : (
            <GuardedButton
              variant="secondary"
              size="sm"
              loading={busy}
              reason={online ? null : t('platformOffline', locale)}
              data-testid="platform-domain-remove"
              onClick={() => {
                void saveDraft(() => onSet(null));
              }}
            >
              {t('platformDomainRemove', locale)}
            </GuardedButton>
          )}
        </div>
      </form>
    </section>
  );
}

function NewWorkspaceForm({ token, online, onCancel, onLocated, onCreated }) {
  const locale = useLocale();
  const [code, setCode] = useState('');
  const [nameBn, setNameBn] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [kind, setKind] = useState('hospital');
  const [division, setDivision] = useState('Dhaka');
  const [district, setDistrict] = useState('');
  const [registrationNo, setRegistrationNo] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [uncertain, setUncertain] = useState(false);
  const management = useAdminManagement();
  const fields = [
    reviewField(t('platformFieldCode', locale), '', code),
    reviewField(t('platformFieldNameBn', locale), '', nameBn),
    reviewField(t('platformFieldNameEn', locale), '', nameEn),
    reviewField(t('platformFieldKind', locale), 'hospital', kind),
    reviewField(t('platformFieldDivision', locale), 'Dhaka', division),
    reviewField(t('platformFieldDistrict', locale), '', district),
    reviewField(t('platformFieldRegistration', locale), '', registrationNo),
    reviewField(t('platformFieldAdminName', locale), '', adminName),
    reviewField(t('platformFieldAdminEmail', locale), '', adminEmail),
  ];
  usePlatformDraft('create', t('platformFormTitle', locale), fields, () => {
    setCode('');
    setNameBn('');
    setNameEn('');
    setKind('hospital');
    setDivision('Dhaka');
    setDistrict('');
    setRegistrationNo('');
    setAdminName('');
    setAdminEmail('');
  });

  const codeOk = /^[A-Za-z0-9][A-Za-z0-9-]{1,15}$/.test(code.trim());
  const ready =
    codeOk &&
    nameBn.trim() !== '' &&
    nameEn.trim() !== '' &&
    district.trim().length >= 2 &&
    adminName.trim() !== '' &&
    adminEmail.includes('@');

  const submit = (event) => {
    event.preventDefault();
    if (!ready || !online || busy || uncertain) return;
    const body = {
      code: code.trim(),
      nameBn: nameBn.trim(),
      nameEn: nameEn.trim(),
      kind,
      division,
      district: district.trim(),
      ...(registrationNo.trim() === '' ? {} : { registrationNo: registrationNo.trim() }),
      adminName: adminName.trim(),
      adminEmail: adminEmail.trim(),
    };
    void (async () => {
      if (
        !(await management?.confirm({
          title: t('platformCreate', locale),
          scope: body.code,
          note: t('platformFormIntro', locale),
          fields,
        }))
      )
        return;
      setBusy(true);
      management?.setBusy(true);
      setProblem(null);
      try {
        const result = await platformApi.create(token, body);
        if (result.ok) onCreated(result.value);
        else {
          setProblem(failureLine(result.failure, locale));
          if (result.failure.kind === 'failed' || result.failure.kind === 'offline')
            setUncertain(true);
        }
      } catch {
        setProblem(t('platformActionFailed', locale));
        setUncertain(true);
      } finally {
        setBusy(false);
        management?.setBusy(false);
      }
    })();
  };

  const reason = !online
    ? t('platformOffline', locale)
    : uncertain
      ? t('manageReconcile', locale)
      : ready
        ? null
        : t('platformInvalid', locale);

  return (
    <Card data-testid="platform-new-form">
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <ol className="platform-guide">
          <li>1. {t('platformFieldNameBn', locale)}</li>
          <li>2. {t('platformFieldAdminName', locale)}</li>
          <li>3. {t('manageReview', locale)}</li>
        </ol>
        <fieldset className="flex flex-col gap-4" disabled={busy || uncertain}>
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
        </fieldset>
        {uncertain ? (
          <div role="alert" data-testid="platform-create-uncertain">
            <p>
              {locale === 'bn'
                ? 'উত্তর নিশ্চিত নয়। আবার তৈরির আগে সার্ভারে কোডটি যাচাই করুন। পাসওয়ার্ড পুনরুদ্ধার করা যাবে না।'
                : 'The answer is uncertain. Check this code on the server before creating again. The one-time password cannot be recovered here.'}
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                void platformApi
                  .list(token)
                  .then((items) => {
                    const existing = items.find(
                      (item) => item.code?.toUpperCase() === code.trim().toUpperCase(),
                    );
                    if (existing !== undefined) onLocated(existing.id);
                    else {
                      setUncertain(false);
                      setProblem(null);
                    }
                  })
                  .catch(() => setProblem(t('platformLoadFailed', locale)));
              }}
              data-testid="platform-create-reconcile"
            >
              {t('retry', locale)}
            </Button>
          </div>
        ) : null}
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
function CreatedCard({ created, onDone }) {
  const locale = useLocale();
  const [handed, setHanded] = useState(false);
  usePlatformDraft(
    'handover',
    t('platformTempPassword', locale),
    [reviewField(t('platformTempPassword', locale), true, handed)],
    () => setHanded(true),
  );
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
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={handed}
            onChange={(e) => setHanded(e.target.checked)}
            data-testid="platform-password-handed"
          />
          {locale === 'bn'
            ? 'নিরাপদে প্রশাসককে পাসওয়ার্ড দিয়েছি'
            : 'I have handed the password to the administrator securely'}
        </label>
        <div>
          <Button
            variant="secondary"
            {...(!handed
              ? { disabled: true, disabledReason: t('platformTempPassword', locale) }
              : {})}
            data-testid="platform-created-done"
            onClick={onDone}
          >
            {t('platformCreatedDone', locale)}
          </Button>
        </div>
      </div>
    </Card>
  );
}
