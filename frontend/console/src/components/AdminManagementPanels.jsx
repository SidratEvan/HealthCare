'use client';

/** Supported V1 administration editors, composed by the five-section workspace.
 * Each editor retains its existing schema/API operation and its own draft.
 * FR-ADM-11, FR-SUP-01/02, GR-03. Writes require authoritative read-back. */

import { useState, useCallback, useEffect } from 'react';

import {
  BED_KINDS,
  CAPABILITY_KINDS,
  FACILITY_ROLES,
  missingForReview,
  profileBody,
  rulesBody,
  setupChecklist,
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
} from '@platform/i18n';
import { Button, Card, Chip, FilterChip, FreshnessLine, Input, useLocale } from '@platform/ui';

import { AdminDoctorIdentity } from '@/components/AdminDoctorIdentity';
import {
  useManagementDraft,
  useAdminManagement,
  reviewField,
} from '@/components/AdminManagementContext';
import { DeskSettings } from '@/components/DeskSettings';
import { HospitalFace } from '@/components/HospitalFace';
import {
  DepartmentRow,
  IdentityForm,
  WardBeds,
  WardEditor,
} from '@/components/SettingsCorrections';
import {
  expandBedLabels,
  loadMonthOfMessages,
  settingsApi,
  signedInStaffId,
  takaToPoisha,
} from '@/lib/settings';

/** A module's name, as the settings and the platform's screen say it. */
export const MODULE_KEY = {
  queue: 'moduleQueue',
  doctor: 'moduleDoctor',
  beds: 'moduleBeds',
  emergency: 'moduleEmergency',
  lab: 'moduleLab',
  pharmacy: 'modulePharmacy',
  dashboard: 'moduleDashboard',
  import: 'moduleImport',
};

const ROLE_KEY = {
  receptionist: 'roleReceptionist',
  doctor: 'roleDoctor',
  ward: 'roleWard',
  emergency: 'roleEmergency',
  lab: 'roleLab',
  pharmacy: 'rolePharmacy',
  hospital_admin: 'roleHospitalAdmin',
};

/** ISO weekday (1 = Monday) to the dashboard's day names (0 = Sunday). */
const WEEKDAY_KEY = {
  1: 'adminWeekday1',
  2: 'adminWeekday2',
  3: 'adminWeekday3',
  4: 'adminWeekday4',
  5: 'adminWeekday5',
  6: 'adminWeekday6',
  7: 'adminWeekday0',
};

/** Saturday first: the working week in Bangladesh. */
const WEEK_ORDER = [6, 7, 1, 2, 3, 4, 5];

const CHECK_LABEL = {
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

const MISSING_NAME = {
  departments: 'settingsItemDepartments',
  doctors: 'settingsItemDoctors',
  schedules: 'settingsItemSchedules',
  staff: 'settingsItemStaff',
};

const STATE_LINE = {
  setup: 'settingsStateSetup',
  ready_for_review: 'settingsStateReview',
  active: 'settingsLiveNow',
  suspended: 'settingsStateSuspended',
  closed: 'settingsStateClosed',
};

export function SetupStatus({ snapshot, offline, run }) {
  const locale = useLocale();
  const num = (value) => formatNumber(value, numeralsFor(locale));
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

export function ProfileTab({ snapshot, offline, run: baseRun, section = 'profile' }) {
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
  const run = useManagementDraft(
    'profile',
    t('manageProfile', locale),
    [
      reviewField(t('settingsNameBn', locale), hospital.nameBn, nameBn),
      reviewField(t('settingsNameEn', locale), hospital.nameEn, nameEn),
      reviewField(t('settingsPhone', locale), hospital.phone ?? '', phone),
      reviewField(
        t('settingsEmergencyPhone', locale),
        hospital.emergencyPhone ?? '',
        emergencyPhone,
      ),
      reviewField(t('settingsAddressBn', locale), hospital.addressBn ?? '', addressBn),
      reviewField(t('settingsAddressEn', locale), hospital.addressEn ?? '', addressEn),
      reviewField(t('settingsThana', locale), hospital.thana ?? '', thana),
      reviewField(t('settingsLat', locale), hospital.lat === null ? '' : String(hospital.lat), lat),
      reviewField(t('settingsLng', locale), hospital.lng === null ? '' : String(hospital.lng), lng),
    ],
    baseRun,
    () => {
      setNameBn(hospital.nameBn);
      setNameEn(hospital.nameEn);
      setPhone(hospital.phone ?? '');
      setEmergencyPhone(hospital.emergencyPhone ?? '');
      setAddressBn(hospital.addressBn ?? '');
      setAddressEn(hospital.addressEn ?? '');
      setThana(hospital.thana ?? '');
      setLat(hospital.lat === null ? '' : String(hospital.lat));
      setLng(hospital.lng === null ? '' : String(hospital.lng));
    },
  );

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
  const runRules = useManagementDraft(
    'rules',
    t('manageRules', locale),
    [
      reviewField(
        t('settingsGracePatients', locale),
        String(rules.noShowGracePatients),
        gracePatients,
      ),
      reviewField(
        t('settingsGraceMinutes', locale),
        String(rules.noShowGraceMinutes),
        graceMinutes,
      ),
      reviewField(
        t('settingsReinsertAfter', locale),
        String(rules.lateReinsertAfter),
        reinsertAfter,
      ),
      reviewField(
        t('settingsStaleMinutes', locale),
        String(rules.staleThresholdMinutes),
        staleMinutes,
      ),
      reviewField(
        t('settingsSmsBudget', locale),
        rules.smsBudgetMonthly === null ? '' : String(rules.smsBudgetMonthly),
        smsBudget,
      ),
      reviewField(
        t('settingsPaymentHold', locale),
        String(rules.paymentHoldMinutes ?? 15),
        holdMinutes,
      ),
      reviewField(t('settingsPrepayRequired', locale), rules.prepayRequired === true, paysFirst),
      reviewField(t('settingsNoShowPrepay', locale), rules.noShowPrepay === true, noShowPrepay),
      reviewField(
        t('settingsNoShowWindow', locale),
        String(rules.noShowWindowDays ?? 90),
        windowDays,
      ),
      reviewField(
        t('settingsArrivalWindows', locale),
        rules.arrivalWindows === true,
        arrivalWindows,
      ),
    ],
    baseRun,
    () => {
      setGracePatients(String(rules.noShowGracePatients));
      setGraceMinutes(String(rules.noShowGraceMinutes));
      setReinsertAfter(String(rules.lateReinsertAfter));
      setStaleMinutes(String(rules.staleThresholdMinutes));
      setSmsBudget(rules.smsBudgetMonthly === null ? '' : String(rules.smsBudgetMonthly));
      setHoldMinutes(String(rules.paymentHoldMinutes ?? 15));
      setPaysFirst(rules.prepayRequired === true);
      setNoShowPrepay(rules.noShowPrepay === true);
      setWindowDays(String(rules.noShowWindowDays ?? 90));
      setArrivalWindows(rules.arrivalWindows === true);
    },
  );

  const coordinates = coordinatesOf(lat, lng);
  const profilePayload = {
    nameBn: nameBn.trim(),
    nameEn: nameEn.trim(),
    phone: blankToNull(toLatinDigits(phone)),
    emergencyPhone: blankToNull(toLatinDigits(emergencyPhone)),
    addressBn: blankToNull(addressBn),
    addressEn: blankToNull(addressEn),
    thana: blankToNull(thana),
    coordinates,
  };
  const profileCheck = profileBody.safeParse(profilePayload);
  const profileReady = profileCheck.success;
  const profileError = (field) =>
    !profileCheck.success && profileCheck.error.issues.some((issue) => issue.path[0] === field)
      ? { error: t('manageInvalid', locale) }
      : {};

  function saveProfile(event) {
    event.preventDefault();
    if (!profileReady || coordinates === 'invalid' || busy || offline) return;
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
  const rulesPayload = {
    noShowGracePatients: ruleValues[0],
    noShowGraceMinutes: ruleValues[1],
    lateReinsertAfter: ruleValues[2],
    staleThresholdMinutes: ruleValues[3],
    smsBudgetMonthly: budget,
    arrivalWindows,
    ...(paysOnline
      ? {
          paymentHoldMinutes: hold,
          prepayRequired: paysFirst,
          noShowPrepay,
          noShowWindowDays: days,
        }
      : {}),
  };
  const rulesCheck = rulesBody.safeParse(rulesPayload);
  const rulesReady = rulesCheck.success;
  const rulesError = (field) =>
    !rulesCheck.success && rulesCheck.error.issues.some((issue) => issue.path[0] === field)
      ? { error: t('manageInvalid', locale) }
      : {};

  function saveRules(event) {
    event.preventDefault();
    const [patients, minutes, reinsert, stale] = ruleValues;
    if (patients == null || minutes == null || reinsert == null || stale == null) return;
    if (!rulesReady || rulesBusy || offline) return;
    setRulesBusy(true);
    void runRules(
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
      {section === 'profile' ? (
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={saveProfile}
          data-testid="settings-profile"
        >
          <h2 className="text-title-md">{t('settingsProfileHeading', locale)}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label={t('settingsNameBn', locale)}
              {...profileError('nameBn')}
              value={nameBn}
              onValue={setNameBn}
              required
            />
            <Field
              label={t('settingsNameEn', locale)}
              {...profileError('nameEn')}
              value={nameEn}
              onValue={setNameEn}
              required
            />
            <Field
              label={t('settingsPhone', locale)}
              {...profileError('phone')}
              kind="phone"
              helper={t('settingsPhoneHelper', locale)}
              value={phone}
              onValue={setPhone}
            />
            <Field
              label={t('settingsEmergencyPhone', locale)}
              {...profileError('emergencyPhone')}
              kind="phone"
              helper={t('settingsPhoneHelper', locale)}
              value={emergencyPhone}
              onValue={setEmergencyPhone}
            />
            <Field
              label={t('settingsAddressBn', locale)}
              {...profileError('addressBn')}
              value={addressBn}
              onValue={setAddressBn}
            />
            <Field
              label={t('settingsAddressEn', locale)}
              {...profileError('addressEn')}
              value={addressEn}
              onValue={setAddressEn}
            />
            <Field
              {...profileError('thana')}
              label={t('settingsThana', locale)}
              value={thana}
              onValue={setThana}
            />
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
      ) : null}

      {/* What it was registered as: its own to correct until review is asked for. */}
      {section === 'identity' ? (
        <IdentityForm snapshot={snapshot} offline={offline} run={baseRun} />
      ) : null}

      {/* What patients see of it: its words, its logo, its colour (`FR-BRD-06`). */}
      {section === 'face' ? (
        <HospitalFace snapshot={snapshot} offline={offline} run={baseRun} />
      ) : null}

      {section === 'rules' ? (
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
              {...rulesError('noShowGracePatients')}
              kind="number"
              value={gracePatients}
              onValue={setGracePatients}
            />
            <Field
              label={t('settingsGraceMinutes', locale)}
              {...rulesError('noShowGraceMinutes')}
              kind="number"
              value={graceMinutes}
              onValue={setGraceMinutes}
            />
            <Field
              label={t('settingsReinsertAfter', locale)}
              {...rulesError('lateReinsertAfter')}
              kind="number"
              value={reinsertAfter}
              onValue={setReinsertAfter}
            />
            <Field
              label={t('settingsStaleMinutes', locale)}
              {...rulesError('staleThresholdMinutes')}
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
              {...rulesError('smsBudgetMonthly')}
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
      ) : null}

      {/* What became of this month's SMS, beside the cap that limits them (`FR-NOT-06`). */}
      {section === 'sms' ? <MonthOfSms cap={rules.smsBudgetMonthly} offline={offline} /> : null}
    </>
  );
}

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
function MonthOfSms({ cap, offline }) {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const [view, setView] = useState({ state: 'loading' });
  const [now, setNow] = useState(() => new Date());

  const read = useCallback(async () => {
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

  const num = (value) => formatNumber(value, numerals);

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

export function DepartmentsTab({ snapshot, offline, run: baseRun }) {
  const locale = useLocale();
  const [nameBn, setNameBn] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const run = useManagementDraft(
    'department-add',
    t('settingsAddDepartment', locale),
    [
      reviewField(t('settingsNameBn', locale), '', nameBn),
      reviewField(t('settingsNameEn', locale), '', nameEn),
      reviewField(t('settingsDepartmentCode', locale), '', code),
    ],
    baseRun,
    () => {
      setNameBn('');
      setNameEn('');
      setCode('');
    },
  );

  const ready =
    nameBn.trim() !== '' &&
    nameEn.trim() !== '' &&
    /^[A-Za-z][A-Za-z0-9-]{1,11}$/.test(code.trim());

  function add(event) {
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
              run={baseRun}
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

export function DoctorsTab(props) {
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

export function AddDoctor({ snapshot, offline, run: baseRun }) {
  const locale = useLocale();
  const [nameBn, setNameBn] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [bmdc, setBmdc] = useState('');
  const [degrees, setDegrees] = useState('');
  const [departmentId, setDepartmentId] = useState(snapshot.departments[0]?.id ?? null);
  const [fee, setFee] = useState('');
  const [room, setRoom] = useState('');
  const [busy, setBusy] = useState(false);
  const run = useManagementDraft(
    'doctor-add',
    t('settingsAddDoctor', locale),
    [
      reviewField(t('settingsNameBn', locale), '', nameBn),
      reviewField(t('settingsNameEn', locale), '', nameEn),
      reviewField(t('settingsBmdc', locale), '', bmdc),
      reviewField(t('settingsDegrees', locale), '', degrees),
      reviewField(t('settingsFee', locale), '', fee),
      reviewField(t('settingsRoom', locale), '', room),
      reviewField(
        t('settingsDepartment', locale),
        snapshot.departments[0]?.id ?? null,
        departmentId,
      ),
    ],
    baseRun,
    () => {
      setNameBn('');
      setNameEn('');
      setBmdc('');
      setDegrees('');
      setFee('');
      setRoom('');
      setDepartmentId(snapshot.departments[0]?.id ?? null);
    },
  );

  const feePoisha = takaToPoisha(toLatinDigits(fee));
  const bmdcNumber = toLatinDigits(bmdc).trim();
  const ready =
    nameBn.trim() !== '' &&
    nameEn.trim() !== '' &&
    /^[A-Za-z]{0,6}-?\d{1,7}$/.test(bmdcNumber) &&
    departmentId !== null &&
    feePoisha !== null;

  function add(event) {
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
          setDepartmentId(snapshot.departments[0]?.id ?? null);
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

export function DoctorCard({ doctor, snapshot, offline, run: baseRun }) {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const [fee, setFee] = useState(String(doctor.feePoisha / 100));
  const [room, setRoom] = useState(doctor.room ?? '');
  const [busy, setBusy] = useState(false);
  const run = useManagementDraft(
    `doctor-${doctor.doctorHospitalId}`,
    localName(locale, doctor.nameBn, doctor.nameEn),
    [
      reviewField(t('settingsFee', locale), String(doctor.feePoisha / 100), fee),
      reviewField(t('settingsRoom', locale), doctor.room ?? '', room),
    ],
    baseRun,
    () => {
      setFee(String(doctor.feePoisha / 100));
      setRoom(doctor.room ?? '');
    },
  );

  const department = snapshot.departments.find((entry) => entry.id === doctor.departmentId);
  const schedules = snapshot.templates.filter(
    (entry) => entry.doctorHospitalId === doctor.doctorHospitalId,
  );
  const feePoisha = takaToPoisha(toLatinDigits(fee));

  function saveFee(event) {
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
                {
                  title: t('manageChange', locale),
                  scope: localName(locale, doctor.nameBn, doctor.nameEn),
                  note: t('manageDoctorConsequence', locale),
                  fields: [
                    reviewField(t('manageActive', locale), doctor.isActive, !doctor.isActive),
                  ],
                },
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

      <AdminDoctorIdentity doctor={doctor} offline={offline} run={baseRun} />
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
                    {
                      title: t('settingsRemoveSchedule', locale),
                      scope: localName(locale, doctor.nameBn, doctor.nameEn),
                      note: t('manageScheduleConsequence', locale),
                      fields: [
                        reviewField(
                          t('settingsSchedules', locale),
                          `${t(WEEKDAY_KEY[schedule.weekday] ?? 'adminWeekday1', locale)} ${clockText(schedule.startTime, locale)}?${clockText(schedule.endTime, locale)}`,
                          '—',
                        ),
                      ],
                    },
                  );
                }}
              >
                {t('settingsRemoveSchedule', locale)}
              </SaveButton>
            </li>
          ))}
        </ul>
      )}
      <AddSchedule doctorHospitalId={doctor.doctorHospitalId} offline={offline} run={baseRun} />
    </Card>
  );
}

function AddSchedule({ doctorHospitalId, offline, run: baseRun }) {
  const locale = useLocale();
  const [weekday, setWeekday] = useState(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [capacity, setCapacity] = useState('');
  const [busy, setBusy] = useState(false);
  const run = useManagementDraft(
    `schedule-add-${doctorHospitalId}`,
    t('settingsSchedules', locale),
    [
      reviewField(t('settingsSchedules', locale), null, weekday),
      reviewField(t('settingsStart', locale), '', start),
      reviewField(t('settingsEnd', locale), '', end),
      reviewField(t('settingsCapacity', locale), '', capacity),
    ],
    baseRun,
    () => {
      setWeekday(null);
      setStart('');
      setEnd('');
      setCapacity('');
    },
  );

  const startTime = clockOf(start);
  const endTime = clockOf(end);
  const limit = capacity.trim() === '' ? null : wholeNumber(capacity);
  const ready =
    weekday !== null &&
    startTime !== null &&
    endTime !== null &&
    endTime > startTime &&
    (capacity.trim() === '' || (limit !== null && limit > 0));

  function add(event) {
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
          setWeekday(null);
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

export function BedsTab(props) {
  const locale = useLocale();
  const { snapshot, offline, run: baseRun } = props;
  const [nameBn, setNameBn] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [floor, setFloor] = useState('');
  const [kind, setKind] = useState('general');
  const [busy, setBusy] = useState(false);
  const run = useManagementDraft(
    'ward-add',
    t('settingsAddWard', locale),
    [
      reviewField(t('settingsNameBn', locale), '', nameBn),
      reviewField(t('settingsNameEn', locale), '', nameEn),
      reviewField(t('settingsFloor', locale), '', floor),
      reviewField(t('settingsBedKind', locale), 'general', kind),
    ],
    baseRun,
    () => {
      setNameBn('');
      setNameEn('');
      setFloor('');
      setKind('general');
    },
  );

  const floorNumber = wholeNumber(floor);
  const ready =
    nameBn.trim() !== '' && nameEn.trim() !== '' && floorNumber !== null && floorNumber <= 60;

  function add(event) {
    event.preventDefault();
    if (!ready || floorNumber === null || busy || offline) return;
    setBusy(true);
    void run(
      () =>
        settingsApi.addWard({
          nameBn: nameBn.trim(),
          nameEn: nameEn.trim(),
          floor: floorNumber,
          kind,
        }),
      () => t('settingsSaved', locale),
    )
      .then((saved) => {
        if (saved) {
          setNameBn('');
          setNameEn('');
          setFloor('');
          setKind('general');
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
            <WardCard key={ward.id} ward={ward} offline={offline} run={baseRun} />
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

function WardCard({ ward, offline, run: baseRun }) {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const [labels, setLabels] = useState('');
  const [kind, setKind] = useState(ward.kind);
  const [nightly, setNightly] = useState('');
  const [busy, setBusy] = useState(false);
  const run = useManagementDraft(
    `beds-add-${ward.id}`,
    localName(locale, ward.nameBn, ward.nameEn),
    [
      reviewField(t('settingsBedLabels', locale), '', labels),
      reviewField(t('settingsNightly', locale), '', nightly),
      reviewField(t('settingsBedKind', locale), ward.kind, kind),
    ],
    baseRun,
    () => {
      setLabels('');
      setNightly('');
      setKind(ward.kind);
    },
  );

  const expanded = labels.trim() === '' ? null : expandBedLabels(toLatinDigits(labels));
  const nightlyPoisha = takaToPoisha(toLatinDigits(nightly));
  const ready = expanded !== null && nightlyPoisha !== null;

  function add(event) {
    event.preventDefault();
    if (expanded === null || nightlyPoisha === null || busy || offline) return;
    setBusy(true);
    void run(
      () =>
        settingsApi.addBeds({
          wardId: ward.id,
          labels: expanded,
          kind,
          nightlyPoisha,
        }),
      (value) =>
        format('settingsBedsAdded', locale, { count: formatNumber(value.bedIds.length, numerals) }),
    )
      .then((saved) => {
        if (saved) {
          setLabels('');
          setNightly('');
          setKind(ward.kind);
        }
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
      <WardEditor ward={ward} offline={offline} run={baseRun} />
      {/* A bed is chosen to change its number or charge, or to take away one
            the ward never brought into service. */}
      <WardBeds ward={ward} offline={offline} run={baseRun} />

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

function BedKindChoice({ value, onChoose }) {
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

export function CapabilitiesTab({ snapshot, offline, run: baseRun, now }) {
  const locale = useLocale();
  const [chosen, setChosen] = useState(
    () => new Set(snapshot.capabilities.map((entry) => entry.kind)),
  );
  const [busy, setBusy] = useState(false);
  const run = useManagementDraft(
    'capabilities',
    t('settingsTabCapabilities', locale),
    [
      reviewField(
        t('settingsTabCapabilities', locale),
        snapshot.capabilities.map((entry) => entry.kind).sort(),
        [...chosen].sort(),
      ),
    ],
    baseRun,
    () => {
      setChosen(new Set(snapshot.capabilities.map((entry) => entry.kind)));
    },
  );

  function save() {
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
              <span className="text-body-md">{capabilityName(entry.kind, locale)}</span>
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

export function StaffTab({ snapshot, offline, run: baseRun, memberId }) {
  const locale = useLocale();
  const me = signedInStaffId();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [staffCode, setStaffCode] = useState('');
  const [roles, setRoles] = useState(() => new Set(['receptionist']));
  const [busy, setBusy] = useState(false);
  const run = useManagementDraft(
    'staff-add',
    t('settingsAddStaff', locale),
    [
      reviewField(t('settingsStaffName', locale), '', fullName),
      reviewField(t('settingsStaffEmail', locale), '', email),
      reviewField(t('settingsStaffCode', locale), '', staffCode),
      reviewField(t('settingsSaveRoles', locale), ['receptionist'], [...roles].sort()),
    ],
    baseRun,
    () => {
      setFullName('');
      setEmail('');
      setStaffCode('');
      setRoles(new Set(['receptionist']));
    },
  );

  /** Shown once, for the administrator to hand over; gone on the next tab switch or reload. */
  const [handover, setHandover] = useState(null);
  const ready = fullName.trim() !== '' && email.includes('@') && roles.size > 0;

  function add(event) {
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
          setRoles(new Set(['receptionist']));
        }
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <>
      {/* FRM-B11-DESKS (FR-REC-32, plan R4): the reception desks and their doctors. */}
      {memberId === undefined ? (
        <DeskSettings snapshot={snapshot} offline={offline} run={baseRun} />
      ) : null}

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
        {snapshot.staff
          .filter((member) => memberId === undefined || member.id === memberId)
          .map((member) => (
            <StaffCard
              key={member.id}
              member={member}
              self={member.id === me}
              offline={offline}
              run={baseRun}
              onPassword={(password) => {
                setHandover({ name: member.fullName, password });
              }}
            />
          ))}
      </div>

      {memberId === undefined || memberId === 'add' ? (
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
            <Field
              label={t('settingsStaffCode', locale)}
              value={staffCode}
              onValue={setStaffCode}
            />
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
      ) : null}
    </>
  );
}

function StaffCard({ member, self, offline, run: baseRun, onPassword }) {
  const locale = useLocale();
  const held = new Set(member.roles.filter(isFacilityRole));
  const [roles, setRoles] = useState(() => held);
  const run = useManagementDraft(
    `staff-${member.id}`,
    member.fullName,
    [
      reviewField(t('settingsSaveRoles', locale), [...held].sort(), [...roles].sort(), (value) =>
        Array.isArray(value)
          ? value
              .filter(isFacilityRole)
              .map((role) => t(ROLE_KEY[role], locale))
              .join(', ')
          : '',
      ),
    ],
    baseRun,
    () => {
      setRoles(new Set(member.roles.filter(isFacilityRole)));
    },
  );

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
                {
                  title: t('settingsSaveRoles', locale),
                  scope: member.fullName,
                  note: t('manageStaffConsequence', locale),
                },
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
                  {
                    title: t('settingsResetPassword', locale),
                    scope: member.fullName,
                    note: t('manageStaffConsequence', locale),
                    fields: [],
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
                    {
                      title: t('settingsResetTwoFactor', locale),
                      scope: member.fullName,
                      note: t('manageStaffConsequence', locale),
                      fields: [reviewField(t('settingsStaffTwoFactorOn', locale), true, false)],
                    },
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
                  {
                    title: t(
                      member.isActive ? 'settingsDeactivateStaff' : 'settingsActivateStaff',
                      locale,
                    ),
                    scope: member.fullName,
                    note: t('manageStaffConsequence', locale),
                    fields: [
                      reviewField(t('manageActive', locale), member.isActive, !member.isActive),
                    ],
                  },
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

function RoleChoice({ value, onChange }) {
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

function Field({ label, value, onValue, kind = 'text', helper, error, required = false }) {
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

function ChoiceRow({ label, children }) {
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
}) {
  const locale = useLocale();
  const management = useAdminManagement();
  const conflict = [...(management?.drafts.values() ?? [])].some((draft) => draft.conflict);
  const reason = management?.readFailed
    ? t('loadFailed', locale)
    : management?.busy
      ? t('manageSaving', locale)
      : conflict
        ? t('manageServerChanged', locale)
        : offline
          ? t('settingsSaveOffline', locale)
          : ready
            ? null
            : t('settingsNeedFields', locale);
  const common = {
    variant,
    type: submit ? 'submit' : 'button',
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

function Empty({ text, testId }) {
  return (
    <Card data-testid={testId}>
      <p className="text-body-md text-ink-secondary">{text}</p>
    </Card>
  );
}

/** The shape of the screen, not a spinner (`GR-03`). */
export function failureText(failure, locale) {
  switch (failure.kind) {
    case 'offline':
      return t('settingsSaveOffline', locale);
    case 'invalid':
      return t('settingsInvalid', locale);
    case 'failed':
      return t('settingsSaveFailed', locale);
    case 'duplicate': {
      const byField = {
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
      const byReason = {
        desk_changed: 'manageDeskChanged',
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

function blankToNull(value) {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function wholeNumber(value) {
  const text = toLatinDigits(value).trim();
  return /^\d{1,7}$/.test(text) ? Number(text) : null;
}

/** `17:00`, `9:30`, `৯:৩০` to `HH:MM`; null when it is not a time of day. */
function clockOf(value) {
  const match = /^(\d{1,2})[:.](\d{2})$/.exec(toLatinDigits(value).trim());
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function clockText(value, locale) {
  return numeralsFor(locale) === 'bengali' ? toBengaliDigits(value) : value;
}

/** Both or neither (`hospitals_coords_paired`). */
function coordinatesOf(lat, lng) {
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

function kindName(kind, locale) {
  return bedKindName(kind, locale);
}

function isFacilityRole(role) {
  return FACILITY_ROLES.includes(role);
}
