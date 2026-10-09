'use client';

/**
 * `S-B-11` Hospital settings (pilot step 22, `APP_FLOW.md` B6, `FR-SUP-01`,
 * `FR-ADM-11`, `FR-SUP-02`).
 *
 * What a hospital administrator uses to set up a facility that has no seed
 * data: its details and queue rules, departments, doctors and their weekly
 * chambers, wards and beds, the emergency services it offers, and the staff
 * who sign in. The tabs run in the order the onboarding wizard in B6 lists —
 * facility, departments, doctors, chambers, beds, capabilities, staff — and
 * the card above them says what is set up and whether patients can see the
 * facility yet, with the one button that publishes it.
 *
 * ## Online only, and honest about it
 *
 * Nothing here is queued offline (see `lib/settings.ts`). With the network
 * gone the screen keeps what it last read, its freshness line ages, and
 * every save is disabled with the reason written on it (`GR-03`).
 *
 * ## After every save, the server's answer
 *
 * A save reloads the snapshot rather than patching local state, so what is
 * on screen is always what the server holds — including what it did on its
 * own, like the chambers a new schedule made.
 */

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { retryDelayMs } from '@platform/client';
import {
  BED_KINDS,
  CAPABILITY_KINDS,
  FACILITY_ROLES,
  isHospitalModule,
  missingForReview,
  setupChecklist,
  type ChecklistItemKey,
  type FacilityRole,
  type HospitalModule,
  type OrgLifecycle,
} from '@platform/domain';
import {
  bedKindName,
  capabilityName,
  format,
  formatAge,
  formatNumber,
  formatTaka,
  localName,
  numeralsFor,
  t,
  toBengaliDigits,
  toLatinDigits,
  type BedKindName,
  type CapabilityName,
  type ConsoleKey,
  type Locale,
} from '@platform/i18n';
import {
  Button,
  Card,
  Chip,
  FilterChip,
  FreshnessLine,
  Input,
  ToastProvider,
  useLocale,
  useToast,
} from '@platform/ui';

import { ConsoleLanguageSwitch } from '@/components/ConsoleLanguageSwitch';
import { DemoBanner } from '@/components/DemoBanner';
import { DeskSettings } from '@/components/DeskSettings';
import { HospitalFace } from '@/components/HospitalFace';
import {
  DepartmentRow,
  IdentityForm,
  WardBeds,
  WardEditor,
} from '@/components/SettingsCorrections';
import { WorkspaceBrandMark } from '@/components/WorkspaceBrandMark';
import {
  expandBedLabels,
  loadMonthOfMessages,
  loadSetup,
  settingsApi,
  signedInStaffId,
  takaToPoisha,
  type MonthOfMessages,
  type SaveFailure,
  type Saved,
  type SettingsDoctor,
  type SettingsStaff,
  type SettingsWard,
  type SetupSnapshot,
} from '@/lib/settings';

type Tab = 'profile' | 'departments' | 'doctors' | 'beds' | 'capabilities' | 'staff';

const TABS: readonly { readonly id: Tab; readonly key: ConsoleKey }[] = [
  { id: 'profile', key: 'settingsTabProfile' },
  { id: 'departments', key: 'settingsTabDepartments' },
  { id: 'doctors', key: 'settingsTabDoctors' },
  { id: 'beds', key: 'settingsTabBeds' },
  { id: 'capabilities', key: 'settingsTabCapabilities' },
  { id: 'staff', key: 'settingsTabStaff' },
];

/** A module's name, as the settings and the platform's screen say it. */
export const MODULE_KEY: Readonly<Record<HospitalModule, ConsoleKey>> = {
  queue: 'moduleQueue',
  doctor: 'moduleDoctor',
  beds: 'moduleBeds',
  emergency: 'moduleEmergency',
  lab: 'moduleLab',
  pharmacy: 'modulePharmacy',
  dashboard: 'moduleDashboard',
  import: 'moduleImport',
};

const ROLE_KEY: Readonly<Record<FacilityRole, ConsoleKey>> = {
  receptionist: 'roleReceptionist',
  doctor: 'roleDoctor',
  ward: 'roleWard',
  emergency: 'roleEmergency',
  lab: 'roleLab',
  pharmacy: 'rolePharmacy',
  hospital_admin: 'roleHospitalAdmin',
};

/** ISO weekday (1 = Monday) to the dashboard's day names (0 = Sunday). */
const WEEKDAY_KEY: Readonly<Record<number, ConsoleKey>> = {
  1: 'adminWeekday1',
  2: 'adminWeekday2',
  3: 'adminWeekday3',
  4: 'adminWeekday4',
  5: 'adminWeekday5',
  6: 'adminWeekday6',
  7: 'adminWeekday0',
};

/** Saturday first: the working week in Bangladesh. */
const WEEK_ORDER = [6, 7, 1, 2, 3, 4, 5] as const;

type LoadState = 'loading' | 'ready' | 'error' | 'offline';

/** Runs a save, says how it went, and reloads. Resolves true when it saved. */
type Run = <T>(call: () => Promise<Saved<T>>, success: (value: T) => string) => Promise<boolean>;

interface TabProps {
  readonly snapshot: SetupSnapshot;
  readonly offline: boolean;
  readonly run: Run;
}

export function HospitalSettings(): ReactNode {
  return (
    <ToastProvider placement="console">
      <SettingsScreen />
    </ToastProvider>
  );
}

function SettingsScreen(): ReactNode {
  const locale = useLocale();
  const { show } = useToast();
  const [snapshot, setSnapshot] = useState<SetupSnapshot | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [tab, setTab] = useState<Tab>('profile');
  const [now, setNow] = useState(() => new Date());
  /** Reads in a row that could not reach the server; spaces out the next one. */
  const [unreached, setUnreached] = useState(0);

  const reload = useCallback(async () => {
    const answer = await loadSetup();
    if (answer === 'offline' || answer === 'error') {
      // What was on screen stays there, with its age.
      setState(answer);
      if (answer === 'offline') setUnreached((count) => count + 1);
      return;
    }
    setSnapshot(answer);
    setLoadedAt(new Date(answer.serverTs));
    setUnreached(0);
    setState('ready');
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // The connection going says so at once, before anybody presses a save that
  // cannot work; its return reads the settings again, since somebody else may
  // have changed them meanwhile.
  useEffect(() => {
    const lost = (): void => {
      setState((current) => (current === 'ready' || current === 'error' ? 'offline' : current));
    };
    const back = (): void => {
      void reload();
    };
    globalThis.addEventListener('offline', lost);
    globalThis.addEventListener('online', back);
    return () => {
      globalThis.removeEventListener('offline', lost);
      globalThis.removeEventListener('online', back);
    };
  }, [reload]);

  // "Online" is the browser's word for a network being attached, not for the
  // server being reachable: a router still dialling, a phone changing towers.
  // One read on that announcement can fail, and the screen used to say offline
  // from then until somebody reloaded it. So while it says offline and the
  // browser says there is a network, it reads again, with the outbox's backoff
  // (GR-03). With no network at all there is nothing to try; `back` starts it.
  useEffect(() => {
    if (state !== 'offline' || !globalThis.navigator.onLine) return undefined;
    const timer = setTimeout(() => {
      void reload();
    }, retryDelayMs(unreached));
    return () => {
      clearTimeout(timer);
    };
  }, [state, unreached, reload]);

  // The freshness line has to age with nothing else happening.
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 30_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const run: Run = useCallback(
    async (call, success) => {
      const outcome = await call();
      if (!outcome.ok) {
        if (outcome.failure.kind === 'offline') setState('offline');
        show({ title: failureText(outcome.failure, locale), tone: 'alert' });
        return false;
      }
      show({ title: success(outcome.value), tone: 'positive' });
      await reload();
      return true;
    },
    [locale, reload, show],
  );

  if (snapshot === null) {
    if (state === 'loading') return <SettingsSkeleton />;
    return (
      <Shell snapshot={null}>
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-md bg-alert-100 p-4"
          data-testid={state === 'offline' ? 'settings-offline' : 'settings-error'}
        >
          <p className="text-body-md text-alert-700">
            {t(state === 'offline' ? 'settingsOffline' : 'settingsLoadFailed', locale)}
          </p>
          <Button variant="secondary" onClick={() => void reload()} data-testid="settings-retry">
            {t('retry', locale)}
          </Button>
        </div>
      </Shell>
    );
  }

  const offline = state === 'offline';
  const props: TabProps = { snapshot, offline, run };

  // A module this hospital does not run has no tab here (`FR-BRD-11`): its
  // wards and beds, and what it can treat in an emergency.
  const modulesOff = snapshot.hospital.modulesOff;
  const tabs = TABS.filter(
    (entry) =>
      !(entry.id === 'beds' && modulesOff.includes('beds')) &&
      !(entry.id === 'capabilities' && modulesOff.includes('emergency')),
  );

  return (
    <Shell snapshot={snapshot}>
      {offline ? (
        <p
          role="status"
          className="rounded-sm bg-warn-100 px-3 py-2 text-body-sm text-warn-700"
          data-testid="settings-offline-banner"
        >
          {t('settingsOfflineStale', locale)}
        </p>
      ) : null}
      {state === 'error' ? (
        <p role="alert" className="rounded-sm bg-alert-100 px-3 py-2 text-body-sm text-alert-700">
          {t('settingsLoadFailed', locale)}
        </p>
      ) : null}

      <FreshnessLine
        asOf={loadedAt}
        now={now}
        labels={{
          justNow: t('updatedJustNow', locale),
          ago: t('updatedAgo', locale),
          never: t('adminNeverRecorded', locale),
          stale: t('staleWarning', locale),
        }}
        formatMinutes={(value) => formatAge(value, locale, numeralsFor(locale))}
      />

      <SetupStatus {...props} />

      {modulesOff.length === 0 ? null : (
        <p className="text-body-sm text-ink-secondary" data-testid="settings-modules-off">
          {format('settingsModulesOff', locale, {
            modules: modulesOff
              .map((module) => (isHospitalModule(module) ? t(MODULE_KEY[module], locale) : module))
              .join(', '),
          })}
        </p>
      )}

      <Tabs tabs={tabs} selected={tab} onSelect={setTab} />

      <div
        role="tabpanel"
        id={`settings-panel-${tab}`}
        aria-labelledby={`settings-tab-${tab}`}
        className="flex flex-col gap-6"
      >
        {tab === 'profile' ? <ProfileTab {...props} /> : null}
        {tab === 'departments' ? <DepartmentsTab {...props} /> : null}
        {tab === 'doctors' ? <DoctorsTab {...props} /> : null}
        {tab === 'beds' ? <BedsTab {...props} /> : null}
        {tab === 'capabilities' ? <CapabilitiesTab {...props} now={now} /> : null}
        {tab === 'staff' ? <StaffTab {...props} /> : null}
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// The frame, the status card and the tabs
// ---------------------------------------------------------------------------

function Shell({
  snapshot,
  children,
}: {
  readonly snapshot: SetupSnapshot | null;
  readonly children: ReactNode;
}): ReactNode {
  const locale = useLocale();
  const hospital = snapshot?.hospital ?? null;

  return (
    <div className="min-h-screen">
      {/* FR-DEM-07: the demo says what it is, on screen, permanently. */}
      <DemoBanner />

      <main className="mx-auto flex max-w-6xl flex-col gap-5 p-6" data-testid="hospital-settings">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex flex-col gap-2">
            {/* FR-BRD-12 (plan K4): the hospital's own, powered by MedLiveBD. */}
            <WorkspaceBrandMark locale={locale} />
            <h1 className="text-title-lg">{t('settingsTitle', locale)}</h1>
            {hospital === null ? null : (
              <p className="text-body-sm text-ink-muted">
                {localName(locale, hospital.nameBn, hospital.nameEn)}
                {hospital.code === null
                  ? null
                  : ` · ${format('settingsHospitalCode', locale, { code: hospital.code })}`}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <ConsoleLanguageSwitch className="" />
            {hospital?.modulesOff.includes('dashboard') === true ? null : (
              <a
                href="/?view=admin"
                className="flex min-h-touch items-center rounded-sm px-3 text-body-sm text-brand-600 hover:bg-brand-100"
                data-testid="settings-back"
              >
                {t('settingsBackToDashboard', locale)}
              </a>
            )}
            {hospital?.modulesOff.includes('import') === true ? null : (
              <a
                href="/?view=imports"
                className="flex min-h-touch items-center rounded-sm px-3 text-body-sm text-brand-600 hover:bg-brand-100"
                data-testid="settings-open-import"
              >
                {t('importOpen', locale)}
              </a>
            )}
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}

/** The count line each checklist item is shown as. */
const CHECK_LABEL: Readonly<Record<ChecklistItemKey, ConsoleKey>> = {
  departments: 'settingsCountDepartments',
  doctors: 'settingsCountDoctors',
  schedules: 'settingsCountSchedules',
  staff: 'settingsCountStaff',
  // Plan D2: what a patient needs to reach the place. A yes or a no, so the
  // line has no number in it.
  contact: 'settingsCountContact',
  location: 'settingsCountLocation',
  emergency_services: 'settingsCountEmergency',
  beds: 'settingsCountBeds',
  verified_doctors: 'settingsCountVerified',
};

/** What to call a missing item in the sentence that names what to add. */
const MISSING_NAME: Readonly<Partial<Record<ChecklistItemKey, ConsoleKey>>> = {
  departments: 'settingsItemDepartments',
  doctors: 'settingsItemDoctors',
  schedules: 'settingsItemSchedules',
  staff: 'settingsItemStaff',
};

const STATE_LINE: Readonly<Record<OrgLifecycle, ConsoleKey>> = {
  setup: 'settingsStateSetup',
  ready_for_review: 'settingsStateReview',
  active: 'settingsLiveNow',
  suspended: 'settingsStateSuspended',
  closed: 'settingsStateClosed',
};

/**
 * Where the workspace stands, and what it still needs (`FR-ONB-02`–`04`).
 *
 * A hospital does not publish itself. Its administrator fills in what the
 * checklist names and asks for review; a platform administrator approves, or
 * sends it back with a note that is shown here. So this card is the state in
 * a sentence, the note if there is one, the checklist, and one button.
 *
 * The checklist is `setupChecklist` from `shared/domain`, over counts the
 * server made when it was asked: the same function the API refuses by, so the
 * button and the server cannot disagree about what is missing.
 */
function SetupStatus({ snapshot, offline, run }: TabProps): ReactNode {
  const locale = useLocale();
  const num = (value: number): string => formatNumber(value, numeralsFor(locale));
  const [busy, setBusy] = useState(false);

  const { lifecycle, reviewNote } = snapshot.hospital;
  const items = setupChecklist(snapshot.counts);
  const missing = missingForReview(snapshot.counts);
  const settingUp = lifecycle === 'setup';
  const showChecklist = settingUp || lifecycle === 'ready_for_review';

  return (
    <Card
      tone={
        lifecycle === 'active' ? 'brand' : lifecycle === 'ready_for_review' ? 'default' : 'warn'
      }
      data-testid="settings-status"
      data-lifecycle={lifecycle}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p
          className="text-body-md font-semibold"
          data-testid={lifecycle === 'active' ? 'settings-live' : 'settings-not-live'}
        >
          {t(STATE_LINE[lifecycle], locale)}
        </p>
        {settingUp ? (
          <SaveButton
            offline={offline}
            busy={busy}
            ready={missing.length === 0}
            testId="settings-request-review"
            onClick={() => {
              setBusy(true);
              void run(settingsApi.requestReview, () =>
                t('settingsReviewRequested', locale),
              ).finally(() => {
                setBusy(false);
              });
            }}
          >
            {t('settingsRequestReview', locale)}
          </SaveButton>
        ) : null}
      </div>

      {/* Why it came back, or why it is suspended: written for this reader. */}
      {reviewNote === null || lifecycle === 'active' ? null : (
        <p
          className="mt-2 rounded-sm bg-surface px-3 py-2 text-body-md text-ink"
          data-testid="settings-review-note"
        >
          {format('settingsReviewNote', locale, { note: reviewNote })}
        </p>
      )}

      {showChecklist ? (
        <div className="mt-3 flex flex-col gap-2" data-testid="settings-checklist">
          <p className="text-body-sm font-semibold text-ink">
            {t('settingsChecklistTitle', locale)}
          </p>
          <ul className="flex flex-col gap-1">
            {items.map((item) => (
              <li
                key={item.key}
                className="flex flex-wrap items-center gap-2 text-body-sm"
                data-testid={`settings-check-${item.key}`}
                data-done={item.done ? 'true' : 'false'}
              >
                {/* A11Y-03: the state is a word beside the count, never a
                    colour or a tick alone. */}
                <Chip tone={item.done ? 'positive' : item.required ? 'caution' : 'neutral'}>
                  {item.done
                    ? t('settingsCheckDone', locale)
                    : item.key === 'verified_doctors'
                      ? t('settingsCheckByPlatform', locale)
                      : item.required
                        ? t('settingsCheckMissing', locale)
                        : item.advised
                          ? t('settingsCheckAdvised', locale)
                          : t('settingsCheckOptional', locale)}
                </Chip>
                <span className="text-ink-secondary">
                  {format(CHECK_LABEL[item.key], locale, { count: num(item.count) })}
                </span>
              </li>
            ))}
          </ul>

          {/* Not asked for before review, and said plainly what a patient
              loses without them (plan D2). */}
          {items.some((item) => item.advised && !item.done) ? (
            <p className="text-body-sm text-ink-secondary" data-testid="settings-advised">
              {t('settingsAdvisedLine', locale)}
            </p>
          ) : null}

          {settingUp && missing.length > 0 ? (
            <p className="text-body-sm text-warn-700" data-testid="settings-missing">
              {format('settingsMissingLine', locale, {
                items: missing
                  .map((key) => {
                    const name = MISSING_NAME[key];
                    return name === undefined ? key : t(name, locale);
                  })
                  .join(', '),
              })}
            </p>
          ) : null}

          {settingUp ? (
            <p className="text-caption text-ink-muted">{t('settingsWays', locale)}</p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function Tabs({
  tabs,
  selected,
  onSelect,
}: {
  readonly tabs: typeof TABS;
  readonly selected: Tab;
  readonly onSelect: (tab: Tab) => void;
}): ReactNode {
  const locale = useLocale();
  return (
    <div
      role="tablist"
      aria-label={t('settingsTitle', locale)}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        const index = tabs.findIndex((entry) => entry.id === selected);
        const next =
          tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
        if (next === undefined) return;
        onSelect(next.id);
        globalThis.document.getElementById(`settings-tab-${next.id}`)?.focus();
      }}
      className="flex flex-wrap gap-1 border-b border-line pb-2"
    >
      {tabs.map((entry) => {
        const active = entry.id === selected;
        return (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`settings-tab-${entry.id}`}
            aria-selected={active}
            aria-controls={`settings-panel-${entry.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => {
              onSelect(entry.id);
            }}
            data-testid={`settings-tab-${entry.id}`}
            className="flex min-h-touch items-center rounded-sm px-3 text-body-md text-ink-secondary hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 aria-selected:bg-brand-100 aria-selected:font-semibold aria-selected:text-ink"
          >
            {t(entry.key, locale)}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Facility details and queue rules
// ---------------------------------------------------------------------------

function ProfileTab({ snapshot, offline, run }: TabProps): ReactNode {
  const locale = useLocale();
  const hospital = snapshot.hospital;
  const [nameBn, setNameBn] = useState(hospital.nameBn);
  const [nameEn, setNameEn] = useState(hospital.nameEn);
  const [phone, setPhone] = useState(hospital.phone ?? '');
  const [emergencyPhone, setEmergencyPhone] = useState(hospital.emergencyPhone ?? '');
  const [addressBn, setAddressBn] = useState(hospital.addressBn ?? '');
  const [addressEn, setAddressEn] = useState(hospital.addressEn ?? '');
  const [thana, setThana] = useState(hospital.thana ?? '');
  const [lat, setLat] = useState(hospital.lat === null ? '' : String(hospital.lat));
  const [lng, setLng] = useState(hospital.lng === null ? '' : String(hospital.lng));
  const [busy, setBusy] = useState(false);

  const rules = snapshot.rules;
  const [gracePatients, setGracePatients] = useState(String(rules.noShowGracePatients));
  const [graceMinutes, setGraceMinutes] = useState(String(rules.noShowGraceMinutes));
  const [reinsertAfter, setReinsertAfter] = useState(String(rules.lateReinsertAfter));
  const [staleMinutes, setStaleMinutes] = useState(String(rules.staleThresholdMinutes));
  const [smsBudget, setSmsBudget] = useState(
    rules.smsBudgetMonthly === null ? '' : String(rules.smsBudgetMonthly),
  );
  const [holdMinutes, setHoldMinutes] = useState(String(rules.paymentHoldMinutes ?? 15));
  // FR-PAY-02, FR-GST-14 (plan F3): both off until the hospital turns them on.
  const [paysFirst, setPaysFirst] = useState(rules.prepayRequired === true);
  const [noShowPrepay, setNoShowPrepay] = useState(rules.noShowPrepay === true);
  const [windowDays, setWindowDays] = useState(String(rules.noShowWindowDays ?? 90));
  // FR-PAT-28 (plan R1): a preferred arrival hour offered at booking; off by default.
  const [arrivalWindows, setArrivalWindows] = useState(rules.arrivalWindows === true);
  // The payment hold means something only where payment is taken online.
  const paysOnline = snapshot.onlinePayments === true;
  const [rulesBusy, setRulesBusy] = useState(false);

  const coordinates = coordinatesOf(lat, lng);
  const profileReady = nameBn.trim() !== '' && nameEn.trim() !== '' && coordinates !== 'invalid';

  function saveProfile(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!profileReady || busy || offline) return;
    setBusy(true);
    void run(
      () =>
        settingsApi.profile({
          nameBn: nameBn.trim(),
          nameEn: nameEn.trim(),
          phone: blankToNull(toLatinDigits(phone)),
          emergencyPhone: blankToNull(toLatinDigits(emergencyPhone)),
          addressBn: blankToNull(addressBn),
          addressEn: blankToNull(addressEn),
          thana: blankToNull(thana),
          coordinates,
        }),
      () => t('settingsSaved', locale),
    ).finally(() => {
      setBusy(false);
    });
  }

  const ruleValues = [gracePatients, graceMinutes, reinsertAfter, staleMinutes].map(wholeNumber);
  const budget = smsBudget.trim() === '' ? null : wholeNumber(smsBudget);
  const hold = wholeNumber(holdMinutes);
  const holdValid = !paysOnline || (hold !== null && hold >= 5 && hold <= 60);
  const days = wholeNumber(windowDays);
  const windowValid = !paysOnline || !noShowPrepay || (days !== null && days >= 7 && days <= 365);
  const rulesReady =
    ruleValues.every((value) => value !== null) &&
    (smsBudget.trim() === '' || budget !== null) &&
    holdValid &&
    windowValid;

  function saveRules(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const [patients, minutes, reinsert, stale] = ruleValues;
    if (patients == null || minutes == null || reinsert == null || stale == null) return;
    if (rulesBusy || offline) return;
    setRulesBusy(true);
    void run(
      () =>
        settingsApi.rules({
          noShowGracePatients: patients,
          noShowGraceMinutes: minutes,
          lateReinsertAfter: reinsert,
          staleThresholdMinutes: stale,
          smsBudgetMonthly: budget,
          arrivalWindows,
          ...(paysOnline && hold !== null ? { paymentHoldMinutes: hold } : {}),
          ...(paysOnline
            ? {
                prepayRequired: paysFirst,
                noShowPrepay,
                ...(days !== null && days >= 7 && days <= 365 ? { noShowWindowDays: days } : {}),
              }
            : {}),
        }),
      () => t('settingsSaved', locale),
    ).finally(() => {
      setRulesBusy(false);
    });
  }

  return (
    <>
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={saveProfile}
        data-testid="settings-profile"
      >
        <h2 className="text-title-md">{t('settingsProfileHeading', locale)}</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('settingsNameBn', locale)} value={nameBn} onValue={setNameBn} required />
          <Field label={t('settingsNameEn', locale)} value={nameEn} onValue={setNameEn} required />
          <Field
            label={t('settingsPhone', locale)}
            kind="phone"
            helper={t('settingsPhoneHelper', locale)}
            value={phone}
            onValue={setPhone}
          />
          <Field
            label={t('settingsEmergencyPhone', locale)}
            kind="phone"
            helper={t('settingsPhoneHelper', locale)}
            value={emergencyPhone}
            onValue={setEmergencyPhone}
          />
          <Field label={t('settingsAddressBn', locale)} value={addressBn} onValue={setAddressBn} />
          <Field label={t('settingsAddressEn', locale)} value={addressEn} onValue={setAddressEn} />
          <Field label={t('settingsThana', locale)} value={thana} onValue={setThana} />
          <div className="grid grid-cols-2 gap-4">
            <Field
              label={t('settingsLat', locale)}
              kind="number"
              value={lat}
              onValue={setLat}
              {...(coordinates === 'invalid' ? { error: t('settingsCoordsHelper', locale) } : {})}
            />
            <Field label={t('settingsLng', locale)} kind="number" value={lng} onValue={setLng} />
          </div>
        </div>
        <p className="text-caption text-ink-muted">{t('settingsCoordsHelper', locale)}</p>
        <SaveButton
          submit
          offline={offline}
          busy={busy}
          ready={profileReady}
          testId="settings-save-profile"
        >
          {t('settingsSaveProfile', locale)}
        </SaveButton>
      </form>

      {/* What it was registered as: its own to correct until review is asked for. */}
      <IdentityForm snapshot={snapshot} offline={offline} run={run} />

      {/* What patients see of it: its words, its logo, its colour (`FR-BRD-06`). */}
      <HospitalFace snapshot={snapshot} offline={offline} run={run} />

      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={saveRules}
        data-testid="settings-rules"
      >
        <h2 className="text-title-md">{t('settingsRulesHeading', locale)}</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label={t('settingsGracePatients', locale)}
            kind="number"
            value={gracePatients}
            onValue={setGracePatients}
          />
          <Field
            label={t('settingsGraceMinutes', locale)}
            kind="number"
            value={graceMinutes}
            onValue={setGraceMinutes}
          />
          <Field
            label={t('settingsReinsertAfter', locale)}
            kind="number"
            value={reinsertAfter}
            onValue={setReinsertAfter}
          />
          <Field
            label={t('settingsStaleMinutes', locale)}
            kind="number"
            value={staleMinutes}
            onValue={setStaleMinutes}
          />
          {paysOnline ? (
            <Field
              label={t('settingsPaymentHold', locale)}
              kind="number"
              helper={t('settingsPaymentHoldHelper', locale)}
              value={holdMinutes}
              onValue={setHoldMinutes}
              {...(holdValid ? {} : { error: t('settingsPaymentHoldHelper', locale) })}
            />
          ) : null}
          <label className="flex items-center gap-2 text-body-md md:col-span-2">
            <input
              type="checkbox"
              checked={arrivalWindows}
              onChange={(event) => {
                setArrivalWindows(event.target.checked);
              }}
              data-testid="settings-arrival-windows"
            />
            {t('settingsArrivalWindows', locale)}
          </label>
          {paysOnline ? (
            <div className="flex flex-col gap-2 md:col-span-2" data-testid="settings-prepay">
              <label className="flex items-center gap-2 text-body-md">
                <input
                  type="checkbox"
                  checked={paysFirst}
                  onChange={(event) => {
                    setPaysFirst(event.target.checked);
                  }}
                  data-testid="settings-prepay-required"
                />
                {t('settingsPrepayRequired', locale)}
              </label>
              <label className="flex items-center gap-2 text-body-md">
                <input
                  type="checkbox"
                  checked={noShowPrepay}
                  onChange={(event) => {
                    setNoShowPrepay(event.target.checked);
                  }}
                  data-testid="settings-noshow-prepay"
                />
                {t('settingsNoShowPrepay', locale)}
              </label>
              {noShowPrepay ? (
                <Field
                  label={t('settingsNoShowWindow', locale)}
                  kind="number"
                  value={windowDays}
                  onValue={setWindowDays}
                  {...(windowValid ? {} : { error: t('settingsNoShowWindowHelper', locale) })}
                />
              ) : null}
            </div>
          ) : null}
          <Field
            label={t('settingsSmsBudget', locale)}
            kind="number"
            helper={t('settingsCapacityHelper', locale)}
            value={smsBudget}
            onValue={setSmsBudget}
          />
        </div>
        <p className="text-caption text-ink-muted">{t('settingsRulesHelper', locale)}</p>
        <SaveButton
          submit
          offline={offline}
          busy={rulesBusy}
          ready={rulesReady}
          testId="settings-save-rules"
        >
          {t('settingsSaveRules', locale)}
        </SaveButton>
      </form>

      {/* What became of this month's SMS, beside the cap that limits them (`FR-NOT-06`). */}
      <MonthOfSms cap={rules.smsBudgetMonthly} offline={offline} />
    </>
  );
}

type MonthState =
  | { readonly state: 'loading' }
  | { readonly state: 'failed' }
  | { readonly state: 'ready'; readonly month: MonthOfMessages };

/**
 * This month's SMS by what became of them (`FR-NOT-06`: "budget caps and
 * delivery reporting"; `TXT-B11-SMS`).
 *
 * Under the cap, because the first line is what the cap is held against.
 * Plain lines, not tiles. Where the provider reports no delivery the line
 * says so and shows no number: nought would read as "none arrived", and
 * nobody knows that (`PRD.md` §3.2).
 *
 * The four states (`GR-03`): the shape of the lines while it loads; a
 * sentence and a retry when it could not be read; offline, what was last
 * read stays with its age, and a first read that never arrived says so.
 */
function MonthOfSms({
  cap,
  offline,
}: {
  readonly cap: number | null;
  readonly offline: boolean;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const [view, setView] = useState<MonthState>({ state: 'loading' });
  const [now, setNow] = useState(() => new Date());

  const read = useCallback(async (): Promise<void> => {
    const loaded = await loadMonthOfMessages();
    setNow(new Date());
    // Offline with something already on screen: it stays, and its age says so.
    setView((held) =>
      typeof loaded === 'string'
        ? held.state === 'ready'
          ? held
          : { state: 'failed' }
        : { state: 'ready', month: loaded },
    );
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  useEffect(() => {
    const timer = globalThis.setInterval(() => {
      setNow(new Date());
    }, 30_000);
    return () => {
      globalThis.clearInterval(timer);
    };
  }, []);

  const num = (value: number): string => formatNumber(value, numerals);

  return (
    <section className="flex flex-col gap-3" data-testid="settings-sms-month">
      <h2 className="text-title-md">{t('settingsSmsMonthHeading', locale)}</h2>

      {view.state === 'loading' ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <div className="h-5 w-64 rounded-sm bg-sunken" />
          <div className="h-5 w-56 rounded-sm bg-sunken" />
          <div className="h-5 w-48 rounded-sm bg-sunken" />
        </div>
      ) : null}

      {view.state === 'failed' ? (
        <div role="alert" className="flex flex-col gap-2">
          <p className="text-body-sm">
            {t(offline ? 'settingsSmsMonthOffline' : 'settingsSmsMonthFailed', locale)}
          </p>
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
        <>
          <dl className="grid w-fit grid-cols-2 gap-x-6 gap-y-1 text-body-sm">
            <dt className="text-ink-secondary">{t('settingsSmsSent', locale)}</dt>
            <dd className="text-right tabular-nums" data-testid="settings-sms-sent">
              {cap === null
                ? num(view.month.sent)
                : format('settingsSmsOfCap', locale, {
                    sent: num(view.month.sent),
                    cap: num(cap),
                  })}
            </dd>
            <dt className="text-ink-secondary">{t('settingsSmsDelivered', locale)}</dt>
            <dd
              className="text-right tabular-nums"
              data-testid="settings-sms-delivered"
              data-known={view.month.reportsDelivery ? 'true' : 'false'}
            >
              {view.month.reportsDelivery
                ? num(view.month.delivered)
                : t('settingsSmsDeliveryUnknown', locale)}
            </dd>
            <dt className="text-ink-secondary">{t('settingsSmsFailed', locale)}</dt>
            <dd className="text-right tabular-nums" data-testid="settings-sms-failed">
              {num(view.month.failed)}
            </dd>
            <dt className="text-ink-secondary">{t('settingsSmsHeld', locale)}</dt>
            <dd className="text-right tabular-nums" data-testid="settings-sms-held">
              {num(view.month.held)}
            </dd>
            <dt className="text-ink-secondary">{t('settingsSmsWaiting', locale)}</dt>
            <dd className="text-right tabular-nums" data-testid="settings-sms-waiting">
              {num(view.month.waiting)}
            </dd>
          </dl>
          <p className="text-caption text-ink-muted">{t('settingsSmsMonthHelper', locale)}</p>
          <FreshnessLine
            asOf={new Date(view.month.asOf)}
            now={now}
            labels={{
              justNow: t('updatedJustNow', locale),
              ago: t('updatedAgo', locale),
              never: t('adminNeverRecorded', locale),
              stale: t('staleWarning', locale),
            }}
            formatMinutes={(value) => formatAge(value, locale, numerals)}
          />
        </>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

function DepartmentsTab({ snapshot, offline, run }: TabProps): ReactNode {
  const locale = useLocale();
  const [nameBn, setNameBn] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const ready =
    nameBn.trim() !== '' &&
    nameEn.trim() !== '' &&
    /^[A-Za-z][A-Za-z0-9-]{1,11}$/.test(code.trim());

  function add(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!ready || busy || offline) return;
    setBusy(true);
    void run(
      () =>
        settingsApi.addDepartment({
          nameBn: nameBn.trim(),
          nameEn: nameEn.trim(),
          code: code.trim().toUpperCase(),
        }),
      () => t('settingsSaved', locale),
    )
      .then((saved) => {
        if (saved) {
          setNameBn('');
          setNameEn('');
          setCode('');
        }
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <>
      {snapshot.departments.length === 0 ? (
        <Empty text={t('settingsDepartmentsEmpty', locale)} testId="settings-departments-empty" />
      ) : (
        <ul
          className="flex flex-col divide-y divide-line rounded-md bg-surface"
          data-testid="settings-departments"
        >
          {snapshot.departments.map((department) => (
            <DepartmentRow
              key={department.id}
              department={department}
              doctorsListed={
                snapshot.doctors.filter((doctor) => doctor.departmentId === department.id).length
              }
              offline={offline}
              run={run}
            />
          ))}
        </ul>
      )}

      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={add}
        data-testid="settings-add-department"
      >
        <h2 className="text-title-md">{t('settingsAddDepartment', locale)}</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={t('settingsNameBn', locale)} value={nameBn} onValue={setNameBn} required />
          <Field label={t('settingsNameEn', locale)} value={nameEn} onValue={setNameEn} required />
          <Field
            label={t('settingsDepartmentCode', locale)}
            helper={t('settingsDepartmentCodeHelper', locale)}
            value={code}
            onValue={setCode}
            required
          />
        </div>
        <SaveButton
          submit
          offline={offline}
          busy={busy}
          ready={ready}
          testId="settings-add-department-submit"
        >
          {t('settingsAddDepartment', locale)}
        </SaveButton>
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------
// Doctors and their weekly chambers
// ---------------------------------------------------------------------------

function DoctorsTab(props: TabProps): ReactNode {
  const locale = useLocale();
  const { snapshot } = props;

  return (
    <>
      {snapshot.doctors.length === 0 ? (
        <Empty text={t('settingsDoctorsEmpty', locale)} testId="settings-doctors-empty" />
      ) : (
        <div className="flex flex-col gap-4" data-testid="settings-doctors">
          {snapshot.doctors.map((doctor) => (
            <DoctorCard key={doctor.doctorHospitalId} doctor={doctor} {...props} />
          ))}
        </div>
      )}
      {snapshot.departments.length === 0 ? null : <AddDoctor {...props} />}
    </>
  );
}

function AddDoctor({ snapshot, offline, run }: TabProps): ReactNode {
  const locale = useLocale();
  const [nameBn, setNameBn] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [bmdc, setBmdc] = useState('');
  const [degrees, setDegrees] = useState('');
  const [departmentId, setDepartmentId] = useState<string | null>(
    snapshot.departments[0]?.id ?? null,
  );
  const [fee, setFee] = useState('');
  const [room, setRoom] = useState('');
  const [busy, setBusy] = useState(false);

  const feePoisha = takaToPoisha(toLatinDigits(fee));
  const bmdcNumber = toLatinDigits(bmdc).trim();
  const ready =
    nameBn.trim() !== '' &&
    nameEn.trim() !== '' &&
    /^[A-Za-z]{0,6}-?\d{1,7}$/.test(bmdcNumber) &&
    departmentId !== null &&
    feePoisha !== null;

  function add(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!ready || departmentId === null || feePoisha === null || busy || offline) return;
    setBusy(true);
    void run(
      () =>
        settingsApi.addDoctor({
          nameBn: nameBn.trim(),
          nameEn: nameEn.trim(),
          bmdcNumber: bmdcNumber.toUpperCase(),
          degrees: blankToNull(degrees),
          departmentId,
          feePoisha,
          room: blankToNull(room),
        }),
      (value) => t(value.linkedExisting ? 'settingsDoctorLinked' : 'settingsSaved', locale),
    )
      .then((saved) => {
        if (saved) {
          setNameBn('');
          setNameEn('');
          setBmdc('');
          setDegrees('');
          setFee('');
          setRoom('');
        }
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={add}
      data-testid="settings-add-doctor"
    >
      <h2 className="text-title-md">{t('settingsAddDoctor', locale)}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t('settingsNameBn', locale)} value={nameBn} onValue={setNameBn} required />
        <Field label={t('settingsNameEn', locale)} value={nameEn} onValue={setNameEn} required />
        <Field label={t('settingsBmdc', locale)} value={bmdc} onValue={setBmdc} required />
        <Field label={t('settingsDegrees', locale)} value={degrees} onValue={setDegrees} />
        <Field
          label={t('settingsFee', locale)}
          kind="number"
          value={fee}
          onValue={setFee}
          required
        />
        <Field label={t('settingsRoom', locale)} value={room} onValue={setRoom} />
      </div>
      <ChoiceRow label={t('settingsDepartment', locale)}>
        {snapshot.departments.map((department) => (
          <FilterChip
            key={department.id}
            selected={departmentId === department.id}
            onToggle={() => {
              setDepartmentId(department.id);
            }}
          >
            {localName(locale, department.nameBn, department.nameEn)}
          </FilterChip>
        ))}
      </ChoiceRow>
      <SaveButton
        submit
        offline={offline}
        busy={busy}
        ready={ready}
        testId="settings-add-doctor-submit"
      >
        {t('settingsAddDoctor', locale)}
      </SaveButton>
    </form>
  );
}

function DoctorCard({
  doctor,
  snapshot,
  offline,
  run,
}: TabProps & { readonly doctor: SettingsDoctor }): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const [fee, setFee] = useState(String(doctor.feePoisha / 100));
  const [room, setRoom] = useState(doctor.room ?? '');
  const [busy, setBusy] = useState(false);
  const department = snapshot.departments.find((entry) => entry.id === doctor.departmentId);
  const schedules = snapshot.templates.filter(
    (entry) => entry.doctorHospitalId === doctor.doctorHospitalId,
  );
  const feePoisha = takaToPoisha(toLatinDigits(fee));

  function saveFee(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (feePoisha === null || busy || offline) return;
    setBusy(true);
    void run(
      () =>
        settingsApi.updateDoctor(doctor.doctorHospitalId, { feePoisha, room: blankToNull(room) }),
      () => t('settingsSaved', locale),
    ).finally(() => {
      setBusy(false);
    });
  }

  return (
    <Card data-testid={`settings-doctor-${doctor.doctorHospitalId}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-title-sm">{localName(locale, doctor.nameBn, doctor.nameEn)}</h3>
          <p className="text-body-sm text-ink-muted">
            {doctor.bmdcNumber}
            {department === undefined
              ? null
              : ` · ${localName(locale, department.nameBn, department.nameEn)}`}
            {` · ${formatTaka(doctor.feePoisha, numerals)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={doctor.verified ? 'positive' : 'caution'}>
            {t(doctor.verified ? 'settingsVerified' : 'settingsUnverified', locale)}
          </Chip>
          {doctor.isActive ? null : <Chip tone="neutral">{t('settingsInactive', locale)}</Chip>}
          <SaveButton
            variant="secondary"
            offline={offline}
            busy={false}
            testId={`settings-doctor-active-${doctor.doctorHospitalId}`}
            onClick={() => {
              void run(
                () =>
                  settingsApi.updateDoctor(doctor.doctorHospitalId, { isActive: !doctor.isActive }),
                () => t('settingsSaved', locale),
              );
            }}
          >
            {t(doctor.isActive ? 'settingsDeactivateDoctor' : 'settingsActivateDoctor', locale)}
          </SaveButton>
        </div>
      </div>

      <form className="mt-4 flex flex-wrap items-end gap-3" noValidate onSubmit={saveFee}>
        <div className="w-40">
          <Field label={t('settingsFee', locale)} kind="number" value={fee} onValue={setFee} />
        </div>
        <div className="w-40">
          <Field label={t('settingsRoom', locale)} value={room} onValue={setRoom} />
        </div>
        <SaveButton
          submit
          variant="secondary"
          offline={offline}
          busy={busy}
          ready={feePoisha !== null}
          testId={`settings-doctor-fee-${doctor.doctorHospitalId}`}
        >
          {t('settingsSaveFee', locale)}
        </SaveButton>
      </form>
      <p className="mt-1 text-caption text-ink-muted">{t('settingsFeeHelper', locale)}</p>

      <h4 className="mt-5 text-body-md font-semibold">{t('settingsSchedules', locale)}</h4>
      {schedules.length === 0 ? (
        <p className="text-body-sm text-ink-muted">{t('settingsNoSchedules', locale)}</p>
      ) : (
        <ul
          className="mt-2 flex flex-col gap-2"
          data-testid={`settings-schedules-${doctor.doctorHospitalId}`}
        >
          {schedules.map((schedule) => (
            <li key={schedule.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-body-md">
                {format('settingsScheduleLine', locale, {
                  day: t(WEEKDAY_KEY[schedule.weekday] ?? 'adminWeekday1', locale),
                  start: clockText(schedule.startTime, locale),
                  end: clockText(schedule.endTime, locale),
                })}
                {schedule.capacity === null
                  ? null
                  : ` · ${format('settingsCapacityLine', locale, { count: formatNumber(schedule.capacity, numerals) })}`}
              </span>
              <SaveButton
                variant="quiet"
                offline={offline}
                busy={false}
                testId={`settings-remove-schedule-${schedule.id}`}
                onClick={() => {
                  void run(
                    () => settingsApi.removeSchedule(schedule.id),
                    (value) =>
                      value.bookedChambersKept === 0
                        ? t('settingsScheduleRemoved', locale)
                        : format('settingsScheduleKept', locale, {
                            count: formatNumber(value.bookedChambersKept, numerals),
                          }),
                  );
                }}
              >
                {t('settingsRemoveSchedule', locale)}
              </SaveButton>
            </li>
          ))}
        </ul>
      )}
      <AddSchedule doctorHospitalId={doctor.doctorHospitalId} offline={offline} run={run} />
    </Card>
  );
}

function AddSchedule({
  doctorHospitalId,
  offline,
  run,
}: {
  readonly doctorHospitalId: string;
  readonly offline: boolean;
  readonly run: Run;
}): ReactNode {
  const locale = useLocale();
  const [weekday, setWeekday] = useState<number | null>(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [capacity, setCapacity] = useState('');
  const [busy, setBusy] = useState(false);

  const startTime = clockOf(start);
  const endTime = clockOf(end);
  const limit = capacity.trim() === '' ? null : wholeNumber(capacity);
  const ready =
    weekday !== null &&
    startTime !== null &&
    endTime !== null &&
    endTime > startTime &&
    (capacity.trim() === '' || (limit !== null && limit > 0));

  function add(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!ready || weekday === null || startTime === null || endTime === null || busy || offline)
      return;
    setBusy(true);
    void run(
      () =>
        settingsApi.addSchedule({ doctorHospitalId, weekday, startTime, endTime, capacity: limit }),
      (value) =>
        format('settingsScheduleAdded', locale, {
          count: formatNumber(value.sessionsCreated, numeralsFor(locale)),
        }),
    )
      .then((saved) => {
        if (saved) {
          setStart('');
          setEnd('');
          setCapacity('');
        }
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <form
      className="mt-4 flex flex-col gap-3 rounded-md bg-sunken p-4"
      noValidate
      onSubmit={add}
      data-testid={`settings-add-schedule-${doctorHospitalId}`}
    >
      <ChoiceRow label={t('settingsAddSchedule', locale)}>
        {WEEK_ORDER.map((day) => (
          <FilterChip
            key={day}
            selected={weekday === day}
            onToggle={() => {
              setWeekday(day);
            }}
          >
            {t(WEEKDAY_KEY[day] ?? 'adminWeekday1', locale)}
          </FilterChip>
        ))}
      </ChoiceRow>
      <div className="grid gap-3 md:grid-cols-3">
        <Field
          label={t('settingsStart', locale)}
          helper={t('settingsTimeHelper', locale)}
          value={start}
          onValue={setStart}
        />
        <Field
          label={t('settingsEnd', locale)}
          helper={t('settingsTimeHelper', locale)}
          value={end}
          onValue={setEnd}
        />
        <Field
          label={t('settingsCapacity', locale)}
          kind="number"
          helper={t('settingsCapacityHelper', locale)}
          value={capacity}
          onValue={setCapacity}
        />
      </div>
      <SaveButton
        submit
        offline={offline}
        busy={busy}
        ready={ready}
        testId={`settings-add-schedule-submit-${doctorHospitalId}`}
      >
        {t('settingsAddSchedule', locale)}
      </SaveButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Wards and beds
// ---------------------------------------------------------------------------

function BedsTab(props: TabProps): ReactNode {
  const locale = useLocale();
  const { snapshot, offline, run } = props;
  const [nameBn, setNameBn] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [floor, setFloor] = useState('');
  const [kind, setKind] = useState<string>('general');
  const [busy, setBusy] = useState(false);
  const floorNumber = wholeNumber(floor);
  const ready =
    nameBn.trim() !== '' && nameEn.trim() !== '' && floorNumber !== null && floorNumber <= 60;

  function add(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!ready || floorNumber === null || busy || offline) return;
    setBusy(true);
    void run(
      () =>
        settingsApi.addWard({
          nameBn: nameBn.trim(),
          nameEn: nameEn.trim(),
          floor: floorNumber,
          kind: kind as (typeof BED_KINDS)[number],
        }),
      () => t('settingsSaved', locale),
    )
      .then((saved) => {
        if (saved) {
          setNameBn('');
          setNameEn('');
          setFloor('');
        }
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <>
      {snapshot.wards.length === 0 ? (
        <Empty text={t('settingsWardsEmpty', locale)} testId="settings-wards-empty" />
      ) : (
        <div className="flex flex-col gap-4" data-testid="settings-wards">
          {snapshot.wards.map((ward) => (
            <WardCard key={ward.id} ward={ward} offline={offline} run={run} />
          ))}
        </div>
      )}

      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={add}
        data-testid="settings-add-ward"
      >
        <h2 className="text-title-md">{t('settingsAddWard', locale)}</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={t('settingsNameBn', locale)} value={nameBn} onValue={setNameBn} required />
          <Field label={t('settingsNameEn', locale)} value={nameEn} onValue={setNameEn} required />
          <Field
            label={t('settingsFloor', locale)}
            kind="number"
            value={floor}
            onValue={setFloor}
            required
          />
        </div>
        <BedKindChoice value={kind} onChoose={setKind} />
        <SaveButton
          submit
          offline={offline}
          busy={busy}
          ready={ready}
          testId="settings-add-ward-submit"
        >
          {t('settingsAddWard', locale)}
        </SaveButton>
      </form>
    </>
  );
}

function WardCard({
  ward,
  offline,
  run,
}: {
  readonly ward: SettingsWard;
  readonly offline: boolean;
  readonly run: Run;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const [labels, setLabels] = useState('');
  const [kind, setKind] = useState(ward.kind);
  const [nightly, setNightly] = useState('');
  const [busy, setBusy] = useState(false);
  const expanded = labels.trim() === '' ? null : expandBedLabels(toLatinDigits(labels));
  const nightlyPoisha = takaToPoisha(toLatinDigits(nightly));
  const ready = expanded !== null && nightlyPoisha !== null;

  function add(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (expanded === null || nightlyPoisha === null || busy || offline) return;
    setBusy(true);
    void run(
      () =>
        settingsApi.addBeds({
          wardId: ward.id,
          labels: expanded,
          kind: kind as (typeof BED_KINDS)[number],
          nightlyPoisha,
        }),
      (value) =>
        format('settingsBedsAdded', locale, { count: formatNumber(value.bedIds.length, numerals) }),
    )
      .then((saved) => {
        if (saved) setLabels('');
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <Card data-testid={`settings-ward-${ward.id}`}>
      <h3 className="text-title-sm">{localName(locale, ward.nameBn, ward.nameEn)}</h3>
      <p className="text-body-sm text-ink-muted">
        {format('settingsWardLine', locale, {
          floor: formatNumber(ward.floor, numerals),
          count: formatNumber(ward.beds.length, numerals),
        })}
        {` · ${kindName(ward.kind, locale)}`}
      </p>
      {/* Plan D2: its names and floor, and its removal while it is empty. */}
      <WardEditor ward={ward} offline={offline} run={run} />
      {/* A bed is chosen to change its number or charge, or to take away one
          the ward never brought into service. */}
      <WardBeds ward={ward} offline={offline} run={run} />

      <form className="mt-4 flex flex-col gap-3 rounded-md bg-sunken p-4" noValidate onSubmit={add}>
        <div className="grid gap-3 md:grid-cols-2">
          <Field
            label={t('settingsBedLabels', locale)}
            helper={t('settingsBedLabelsHelper', locale)}
            value={labels}
            onValue={setLabels}
            {...(labels.trim() !== '' && expanded === null
              ? { error: t('settingsBedLabelsInvalid', locale) }
              : {})}
          />
          <Field
            label={t('settingsNightly', locale)}
            kind="number"
            value={nightly}
            onValue={setNightly}
          />
        </div>
        <BedKindChoice value={kind} onChoose={setKind} />
        <SaveButton
          submit
          offline={offline}
          busy={busy}
          ready={ready}
          testId={`settings-add-beds-${ward.id}`}
        >
          {t('settingsAddBeds', locale)}
        </SaveButton>
      </form>
    </Card>
  );
}

function BedKindChoice({
  value,
  onChoose,
}: {
  readonly value: string;
  readonly onChoose: (kind: string) => void;
}): ReactNode {
  const locale = useLocale();
  return (
    <ChoiceRow label={t('settingsBedKind', locale)}>
      {BED_KINDS.map((kind) => (
        <FilterChip
          key={kind}
          selected={value === kind}
          onToggle={() => {
            onChoose(kind);
          }}
        >
          {kindName(kind, locale)}
        </FilterChip>
      ))}
    </ChoiceRow>
  );
}

// ---------------------------------------------------------------------------
// Emergency services offered (FR-EMG-05)
// ---------------------------------------------------------------------------

function CapabilitiesTab({
  snapshot,
  offline,
  run,
  now,
}: TabProps & { readonly now: Date }): ReactNode {
  const locale = useLocale();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(
    () => new Set(snapshot.capabilities.map((entry) => entry.kind)),
  );
  const [busy, setBusy] = useState(false);

  function save(): void {
    if (busy || offline) return;
    setBusy(true);
    void run(
      () => settingsApi.capabilities(CAPABILITY_KINDS.filter((kind) => chosen.has(kind))),
      () => t('settingsSaved', locale),
    ).finally(() => {
      setBusy(false);
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="settings-capabilities">
      <p className="text-body-md text-ink-secondary">{t('settingsCapabilitiesHelper', locale)}</p>
      <div className="flex flex-wrap gap-2">
        {CAPABILITY_KINDS.map((kind) => (
          <FilterChip
            key={kind}
            selected={chosen.has(kind)}
            onToggle={() => {
              setChosen((current) => {
                const next = new Set(current);
                if (next.has(kind)) next.delete(kind);
                else next.add(kind);
                return next;
              });
            }}
          >
            {capabilityName(kind, locale)}
          </FilterChip>
        ))}
      </div>
      <SaveButton offline={offline} busy={busy} testId="settings-save-capabilities" onClick={save}>
        {t('settingsSaveCapabilities', locale)}
      </SaveButton>

      {snapshot.capabilities.length === 0 ? null : (
        <ul className="flex flex-col divide-y divide-line rounded-md bg-surface">
          {snapshot.capabilities.map((entry) => (
            <li
              key={entry.kind}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <span className="text-body-md">
                {capabilityName(entry.kind as CapabilityName, locale)}
              </span>
              <span className="flex flex-col items-end gap-1">
                <Chip tone={entry.isAvailable ? 'positive' : 'neutral'}>
                  {t(
                    entry.isAvailable
                      ? 'settingsCapabilityAvailable'
                      : 'settingsCapabilityUnavailable',
                    locale,
                  )}
                </Chip>
                <FreshnessLine
                  asOf={new Date(entry.updatedAt)}
                  now={now}
                  staleAfterMinutes={24 * 60}
                  labels={{
                    justNow: t('updatedJustNow', locale),
                    ago: t('updatedAgo', locale),
                    never: t('adminNeverRecorded', locale),
                    stale: t('staleWarning', locale),
                  }}
                  formatMinutes={(value) => formatAge(value, locale, numeralsFor(locale))}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Staff accounts (FR-ADM-11, FR-SUP-01, FR-SEC-06)
// ---------------------------------------------------------------------------

function StaffTab({ snapshot, offline, run }: TabProps): ReactNode {
  const locale = useLocale();
  const me = signedInStaffId();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [staffCode, setStaffCode] = useState('');
  const [roles, setRoles] = useState<ReadonlySet<FacilityRole>>(() => new Set(['receptionist']));
  const [busy, setBusy] = useState(false);
  /** Shown once, for the administrator to hand over; gone on the next tab switch or reload. */
  const [handover, setHandover] = useState<{
    readonly name: string;
    readonly password: string;
  } | null>(null);
  const ready = fullName.trim() !== '' && email.includes('@') && roles.size > 0;

  function add(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!ready || busy || offline) return;
    setBusy(true);
    const name = fullName.trim();
    void run(
      () =>
        settingsApi.addStaff({
          fullName: name,
          email: email.trim(),
          staffCode: blankToNull(staffCode),
          roles: FACILITY_ROLES.filter((role) => roles.has(role)),
        }),
      (value) => {
        setHandover({ name, password: value.temporaryPassword });
        return t('settingsSaved', locale);
      },
    )
      .then((saved) => {
        if (saved) {
          setFullName('');
          setEmail('');
          setStaffCode('');
        }
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <>
      {/* FRM-B11-DESKS (FR-REC-32, plan R4): the reception desks and their doctors. */}
      <DeskSettings snapshot={snapshot} offline={offline} run={run} />

      {handover === null ? null : (
        <Card tone="brand" data-testid="settings-temp-password">
          <p className="text-body-sm">
            {format('settingsTempPasswordFor', locale, { name: handover.name })}
          </p>
          <p className="mt-1 font-mono text-title-md" data-testid="settings-temp-password-value">
            {handover.password}
          </p>
          <p className="mt-2 text-caption text-ink-secondary">
            {t('settingsTempPasswordNote', locale)}
          </p>
          <div className="mt-3">
            <Button
              variant="secondary"
              onClick={() => {
                setHandover(null);
              }}
            >
              {t('settingsTempPasswordDone', locale)}
            </Button>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-3" data-testid="settings-staff">
        {snapshot.staff.map((member) => (
          <StaffCard
            key={member.id}
            member={member}
            self={member.id === me}
            offline={offline}
            run={run}
            onPassword={(password) => {
              setHandover({ name: member.fullName, password });
            }}
          />
        ))}
      </div>

      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={add}
        data-testid="settings-add-staff"
      >
        <h2 className="text-title-md">{t('settingsAddStaff', locale)}</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Field
            label={t('settingsStaffName', locale)}
            value={fullName}
            onValue={setFullName}
            required
          />
          <Field
            label={t('settingsStaffEmail', locale)}
            kind="email"
            value={email}
            onValue={setEmail}
            required
          />
          <Field label={t('settingsStaffCode', locale)} value={staffCode} onValue={setStaffCode} />
        </div>
        <RoleChoice value={roles} onChange={setRoles} />
        <SaveButton
          submit
          offline={offline}
          busy={busy}
          ready={ready}
          testId="settings-add-staff-submit"
        >
          {t('settingsAddStaff', locale)}
        </SaveButton>
      </form>
    </>
  );
}

function StaffCard({
  member,
  self,
  offline,
  run,
  onPassword,
}: {
  readonly member: SettingsStaff;
  readonly self: boolean;
  readonly offline: boolean;
  readonly run: Run;
  readonly onPassword: (password: string) => void;
}): ReactNode {
  const locale = useLocale();
  const held = new Set(member.roles.filter(isFacilityRole));
  const [roles, setRoles] = useState<ReadonlySet<FacilityRole>>(() => held);
  const changed = roles.size !== held.size || [...roles].some((role) => !held.has(role));

  return (
    <Card data-testid={`settings-staff-${member.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-title-sm">{member.fullName}</h3>
          <p className="text-body-sm text-ink-muted">
            {member.email}
            {member.staffCode === null ? null : ` · ${member.staffCode}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {self ? <Chip tone="positive">{t('settingsStaffYou', locale)}</Chip> : null}
          {member.isActive ? null : <Chip tone="alert">{t('settingsStaffInactive', locale)}</Chip>}
          {member.mustChangePassword ? (
            <Chip tone="caution">{t('settingsStaffMustChange', locale)}</Chip>
          ) : null}
          {member.twoFactorEnabled ? (
            <Chip tone="positive">{t('settingsStaffTwoFactorOn', locale)}</Chip>
          ) : member.roles.includes('hospital_admin') ? (
            // An administrator without it signs in to the setup and nothing
            // else (FR-SEC-10); the chip says why they may not be at work yet.
            <Chip tone="caution">{t('settingsStaffTwoFactorMissing', locale)}</Chip>
          ) : null}
        </div>
      </div>

      <div className="mt-3">
        <RoleChoice value={roles} onChange={setRoles} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {changed ? (
          <SaveButton
            variant="secondary"
            offline={offline}
            busy={false}
            ready={roles.size > 0}
            testId={`settings-staff-roles-${member.id}`}
            onClick={() => {
              void run(
                () =>
                  settingsApi.updateStaff(member.id, {
                    roles: FACILITY_ROLES.filter((role) => roles.has(role)),
                  }),
                () => t('settingsSaved', locale),
              );
            }}
          >
            {t('settingsSaveRoles', locale)}
          </SaveButton>
        ) : null}
        {self ? null : (
          <>
            <SaveButton
              variant="secondary"
              offline={offline}
              busy={false}
              testId={`settings-staff-reset-${member.id}`}
              onClick={() => {
                void run(
                  () => settingsApi.resetPassword(member.id),
                  (value) => {
                    onPassword(value.temporaryPassword);
                    return t('settingsSaved', locale);
                  },
                );
              }}
            >
              {t('settingsResetPassword', locale)}
            </SaveButton>
            {member.twoFactorEnabled ? (
              <SaveButton
                variant="secondary"
                offline={offline}
                busy={false}
                testId={`settings-staff-reset-2fa-${member.id}`}
                onClick={() => {
                  void run(
                    () => settingsApi.resetTwoFactor(member.id),
                    () => t('settingsSaved', locale),
                  );
                }}
              >
                {t('settingsResetTwoFactor', locale)}
              </SaveButton>
            ) : null}
            <SaveButton
              variant="quiet"
              offline={offline}
              busy={false}
              testId={`settings-staff-active-${member.id}`}
              onClick={() => {
                void run(
                  () => settingsApi.updateStaff(member.id, { isActive: !member.isActive }),
                  () => t('settingsSaved', locale),
                );
              }}
            >
              {t(member.isActive ? 'settingsDeactivateStaff' : 'settingsActivateStaff', locale)}
            </SaveButton>
          </>
        )}
      </div>
    </Card>
  );
}

function RoleChoice({
  value,
  onChange,
}: {
  readonly value: ReadonlySet<FacilityRole>;
  readonly onChange: (roles: ReadonlySet<FacilityRole>) => void;
}): ReactNode {
  const locale = useLocale();
  return (
    <ChoiceRow label={t('settingsStaffRoles', locale)}>
      {FACILITY_ROLES.map((role) => (
        <FilterChip
          key={role}
          selected={value.has(role)}
          onToggle={() => {
            const next = new Set(value);
            if (next.has(role)) next.delete(role);
            else next.add(role);
            onChange(next);
          }}
        >
          {t(ROLE_KEY[role], locale)}
        </FilterChip>
      ))}
    </ChoiceRow>
  );
}

// ---------------------------------------------------------------------------
// Small parts
// ---------------------------------------------------------------------------

function Field({
  label,
  value,
  onValue,
  kind = 'text',
  helper,
  error,
  required = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly onValue: (value: string) => void;
  readonly kind?: 'text' | 'number' | 'phone' | 'email';
  readonly helper?: string;
  readonly error?: string;
  readonly required?: boolean;
}): ReactNode {
  return (
    <Input
      label={label}
      kind={kind}
      density="console"
      value={value}
      required={required}
      {...(helper === undefined ? {} : { helper })}
      {...(error === undefined ? {} : { error })}
      onChange={(event) => {
        onValue(event.target.value);
      }}
    />
  );
}

function ChoiceRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-body-sm text-ink-secondary">{label}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

/**
 * A save that says why it cannot be pressed (§5.1): offline, or a form not
 * yet filled in.
 */
function SaveButton({
  children,
  offline,
  busy,
  ready = true,
  submit = false,
  variant = 'primary',
  testId,
  onClick,
}: {
  readonly children: ReactNode;
  readonly offline: boolean;
  readonly busy: boolean;
  readonly ready?: boolean;
  readonly submit?: boolean;
  readonly variant?: 'primary' | 'secondary' | 'quiet';
  readonly testId: string;
  readonly onClick?: () => void;
}): ReactNode {
  const locale = useLocale();
  const reason = offline
    ? t('settingsSaveOffline', locale)
    : ready
      ? null
      : t('settingsNeedFields', locale);
  const common = {
    variant,
    type: submit ? ('submit' as const) : ('button' as const),
    'data-testid': testId,
  };
  if (reason !== null) {
    return (
      <Button {...common} disabled disabledReason={reason}>
        {children}
      </Button>
    );
  }
  return (
    <Button {...common} loading={busy} {...(onClick === undefined ? {} : { onClick })}>
      {children}
    </Button>
  );
}

function Empty({ text, testId }: { readonly text: string; readonly testId: string }): ReactNode {
  return (
    <Card data-testid={testId}>
      <p className="text-body-md text-ink-secondary">{text}</p>
    </Card>
  );
}

/** The shape of the screen, not a spinner (`GR-03`). */
function SettingsSkeleton(): ReactNode {
  return (
    <Shell snapshot={null}>
      <div className="flex flex-col gap-4" aria-busy="true" data-testid="settings-loading">
        <div className="h-24 rounded-md bg-sunken" />
        <div className="h-11 w-96 max-w-full rounded-md bg-sunken" />
        <div className="h-80 rounded-md bg-sunken" />
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Reading what was typed
// ---------------------------------------------------------------------------

function failureText(failure: SaveFailure, locale: Locale): string {
  switch (failure.kind) {
    case 'offline':
      return t('settingsSaveOffline', locale);
    case 'invalid':
      return t('settingsInvalid', locale);
    case 'failed':
      return t('settingsSaveFailed', locale);
    case 'duplicate': {
      const byField: Readonly<Record<string, ConsoleKey>> = {
        code: 'settingsDuplicateCode',
        bmdcNumber: 'settingsDuplicateBmdc',
        schedule: 'settingsDuplicateSchedule',
        email: 'settingsDuplicateEmail',
        staffCode: 'settingsDuplicateStaffCode',
        nameEn: 'settingsDuplicateWardName',
      };
      if (failure.field === 'label') {
        return format('settingsDuplicateLabel', locale, {
          labels: (failure.labels ?? []).join(', '),
        });
      }
      return t(byField[failure.field] ?? 'settingsSaveFailed', locale);
    }
    case 'notAllowed': {
      const byReason: Readonly<Record<string, ConsoleKey>> = {
        own_access: 'settingsNotAllowedOwnAccess',
        own_password: 'settingsNotAllowedOwnPassword',
        own_two_factor: 'settingsNotAllowedOwnTwoFactor',
        doctor_verified: 'settingsNotAllowedVerified',
        doctor_shared: 'settingsNotAllowedShared',
        nothing_to_publish: 'settingsNotAllowedNothing',
        brand_unreadable: 'settingsBrandUnreadable',
        // Plan D2: the server refuses these whatever the screen offered.
        identity_after_review: 'settingsNotAllowedIdentity',
        department_has_doctors: 'settingsNotAllowedDepartmentInUse',
        ward_has_beds: 'settingsNotAllowedWardHasBeds',
        bed_in_use: 'settingsNotAllowedBedInUse',
      };
      return t(byReason[failure.reason] ?? 'settingsSaveFailed', locale);
    }
  }
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function wholeNumber(value: string): number | null {
  const text = toLatinDigits(value).trim();
  return /^\d{1,7}$/.test(text) ? Number(text) : null;
}

/** `17:00`, `9:30`, `৯:৩০` to `HH:MM`; null when it is not a time of day. */
function clockOf(value: string): string | null {
  const match = /^(\d{1,2})[:.](\d{2})$/.exec(toLatinDigits(value).trim());
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function clockText(value: string, locale: Locale): string {
  return numeralsFor(locale) === 'bengali' ? toBengaliDigits(value) : value;
}

/** Both or neither (`hospitals_coords_paired`). */
function coordinatesOf(lat: string, lng: string): { lat: number; lng: number } | null | 'invalid' {
  const a = toLatinDigits(lat).trim();
  const b = toLatinDigits(lng).trim();
  if (a === '' && b === '') return null;
  const latValue = Number(a);
  const lngValue = Number(b);
  if (a === '' || b === '' || !Number.isFinite(latValue) || !Number.isFinite(lngValue))
    return 'invalid';
  if (latValue < 20 || latValue > 27 || lngValue < 87.5 || lngValue > 93) return 'invalid';
  return { lat: latValue, lng: lngValue };
}

function kindName(kind: string, locale: Locale): string {
  return bedKindName(kind as BedKindName, locale);
}

function isFacilityRole(role: string): role is FacilityRole {
  return (FACILITY_ROLES as readonly string[]).includes(role);
}
