'use client';

/**
 * The ER console's four decisions that need more than one tap (`S-B-07`):
 *
 *   - **Walk-in** — somebody who came through the door, not the app. Only the
 *     problem is required; a desk at 3 a.m. writes down what it knows.
 *   - **Decline** — `BTN-B07-DECLINE` "requires reason → immediately opens
 *     refer-out search for that capability" (`FR-EMG-02`). Sending a referral
 *     is step 16; what opens here is the search, ranked from this hospital,
 *     with each ER's number to call.
 *   - **Admit** — `BTN-B07-ADMIT`: which kind of bed, then the ward.
 *   - **Discharge** — a consequence named, the safe option on the left
 *     (`GR-01`).
 */

import { useEffect, useState, type ReactNode } from 'react';

import {
  EMERGENCY_PROBLEMS,
  normaliseBdMobile,
  type BedKind,
  type EmergencyCaseView,
  type EmergencyProblem,
  type Sex,
  type TriageColor,
} from '@platform/domain';
import {
  bedKindName,
  format,
  formatNumber,
  formatPhone,
  problemName,
  t,
  triageName,
  type Locale,
  numeralsFor,
  localName,
} from '@platform/i18n';
import { Button, Chip, FilterChip, Input, Sheet, SheetActions } from '@platform/ui';

import type { WalkInInput } from '@/hooks/useEmergencyConsole';
import type { SuggestedHospital } from '@/lib/emergency';

// ---------------------------------------------------------------------------
// Walk-in (POST /emergency/cases)
// ---------------------------------------------------------------------------

export function WalkInSheet({
  open,
  locale,
  onOpenChange,
  onSave,
}: {
  readonly open: boolean;
  readonly locale: Locale;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSave: (input: WalkInInput) => void;
}): ReactNode {
  const [problem, setProblem] = useState<EmergencyProblem | null>(null);
  const [triage, setTriage] = useState<TriageColor | null>(null);
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<Sex | null>(null);
  const [phone, setPhone] = useState('');
  const [tried, setTried] = useState(false);

  // Each walk-in starts blank; the last person's answers are not the next's.
  useEffect(() => {
    if (!open) return;
    setProblem(null);
    setTriage(null);
    setAge('');
    setSex(null);
    setPhone('');
    setTried(false);
  }, [open]);

  const ageYears = age.trim() === '' ? null : /^\d{1,3}$/.test(age.trim()) ? Number(age) : NaN;
  const phoneStored = phone.trim() === '' ? null : normaliseBdMobile(phone);
  const errors = {
    problem: problem === null ? t('erWalkInProblem', locale) : undefined,
    age:
      ageYears !== null && (Number.isNaN(ageYears) || ageYears > 130)
        ? t('admitAgeError', locale)
        : undefined,
    phone: phone.trim() !== '' && phoneStored === null ? t('admitPhoneError', locale) : undefined,
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      variant="modal"
      title={t('erWalkInTitle', locale)}
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        data-testid="er-walkin-form"
        onSubmit={(event) => {
          event.preventDefault();
          setTried(true);
          if (problem === null || errors.age !== undefined || errors.phone !== undefined) return;
          onSave({
            problem,
            triage,
            phone: phoneStored,
            ageYears: ageYears === null || Number.isNaN(ageYears) ? null : ageYears,
            sex,
          });
          onOpenChange(false);
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="font-ui text-caption text-ink-muted">
            {t('erWalkInProblem', locale)}
          </legend>
          <div className="flex flex-wrap gap-2">
            {EMERGENCY_PROBLEMS.map((value) => (
              <FilterChip
                key={value}
                selected={problem === value}
                onToggle={() => {
                  setProblem(value);
                }}
              >
                {problemName(value, locale)}
              </FilterChip>
            ))}
          </div>
          {tried && errors.problem !== undefined ? (
            <p role="alert" className="font-ui text-caption text-alert-700">
              {errors.problem}
            </p>
          ) : null}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="font-ui text-caption text-ink-muted">
            {t('erWalkInTriage', locale)}
          </legend>
          <div className="flex gap-2">
            {(['red', 'yellow', 'green'] as const).map((colour) => (
              <Button
                key={colour}
                type="button"
                size="sm"
                variant={triage === colour ? 'primary' : 'secondary'}
                aria-pressed={triage === colour}
                onClick={() => {
                  setTriage(triage === colour ? null : colour);
                }}
              >
                {triageName(colour, locale)}
              </Button>
            ))}
          </div>
        </fieldset>

        <Input
          label={t('erWalkInAge', locale)}
          kind="number"
          density="console"
          value={age}
          onChange={(event) => {
            setAge(event.target.value);
          }}
          {...(tried && errors.age !== undefined ? { error: errors.age } : {})}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="font-ui text-caption text-ink-muted">{t('admitSex', locale)}</legend>
          <div className="flex gap-2">
            {(['male', 'female', 'other'] as const).map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={sex === value ? 'primary' : 'secondary'}
                aria-pressed={sex === value}
                onClick={() => {
                  setSex(sex === value ? null : value);
                }}
              >
                {t(
                  value === 'male' ? 'sexMale' : value === 'female' ? 'sexFemale' : 'sexOther',
                  locale,
                )}
              </Button>
            ))}
          </div>
        </fieldset>

        <Input
          label={t('erWalkInPhone', locale)}
          kind="phone"
          density="console"
          value={phone}
          onChange={(event) => {
            setPhone(event.target.value);
          }}
          {...(tried && errors.phone !== undefined ? { error: errors.phone } : {})}
        />

        <SheetActions>
          <Button type="submit" data-testid="er-walkin-save">
            {t('erWalkInSave', locale)}
          </Button>
          <Button
            type="button"
            variant="quiet"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t('goBack', locale)}
          </Button>
        </SheetActions>
      </form>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Decline (BTN-B07-DECLINE, FR-EMG-02)
// ---------------------------------------------------------------------------

export function DeclineSheet({
  entry,
  locale,
  connected,
  onClose,
  onDecline,
  fetchSuggestions,
}: {
  /** The alert being declined; null when the sheet is closed. */
  readonly entry: EmergencyCaseView | null;
  readonly locale: Locale;
  readonly connected: boolean;
  readonly onClose: () => void;
  readonly onDecline: (entry: EmergencyCaseView, reason: string) => void;
  readonly fetchSuggestions: (problem: EmergencyProblem) => Promise<readonly SuggestedHospital[]>;
}): ReactNode {
  const numerals = numeralsFor(locale);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [suggestions, setSuggestions] = useState<readonly SuggestedHospital[] | null>(null);
  const [suggestionsFailed, setSuggestionsFailed] = useState(false);

  useEffect(() => {
    if (entry === null) return;
    setReason('');
    setTried(false);
    setDeclined(false);
    setSuggestions(null);
    setSuggestionsFailed(false);
  }, [entry]);

  if (entry === null) return null;

  const blank = reason.trim() === '';

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      variant="modal"
      dismissible={!declined}
      title={declined ? t('erSuggestTitle', locale) : t('erDeclineTitle', locale)}
      description={declined ? t('erSuggestHint', locale) : t('erDeclineConsequence', locale)}
    >
      {declined ? (
        <div className="flex flex-col gap-3" data-testid="er-suggestions">
          {suggestions === null ? (
            suggestionsFailed ? (
              <p className="font-ui text-body-sm text-ink-secondary">{t('loadFailed', locale)}</p>
            ) : (
              <div className="h-16 rounded-sm bg-sunken" aria-busy="true" />
            )
          ) : capable(suggestions).length === 0 ? (
            <p className="font-ui text-body-sm text-ink-secondary">{t('erSuggestEmpty', locale)}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {capable(suggestions).map((hospital) => (
                <li
                  key={hospital.hospitalId}
                  className="flex items-center justify-between gap-3 rounded-sm bg-sunken p-3 font-ui"
                >
                  <div className="min-w-0">
                    <p className="text-body-md text-ink">
                      {localName(locale, hospital.nameBn, hospital.nameEn)}
                    </p>
                    <p className="text-caption tabular-nums text-ink-muted">
                      {hospital.distanceKm === null
                        ? ''
                        : `${format('erDistanceKm', locale, { km: formatNumber(hospital.distanceKm, numerals) })} · `}
                      {format('erLoad', locale, {
                        count: formatNumber(hospital.erLoad, numerals),
                      })}
                      {hospital.freshness.stale ? ` · ${t('staleWarning', locale)}` : ''}
                    </p>
                  </div>
                  {hospital.emergencyPhone === null ? null : (
                    <a
                      href={`tel:${hospital.emergencyPhone}`}
                      className="flex min-h-touch shrink-0 items-center rounded-sm px-2 text-body-sm text-brand-700 underline"
                    >
                      {formatPhone(hospital.emergencyPhone)}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
          <SheetActions>
            <Button variant="secondary" onClick={onClose} data-testid="er-suggestions-close">
              {t('closePanel', locale)}
            </Button>
          </SheetActions>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setTried(true);
            if (blank) return;
            onDecline(entry, reason.trim());
            setDeclined(true);
            // The refer-out search for that capability, ranked from here. It
            // needs the connection; offline, the decline is still queued.
            if (!connected) {
              setSuggestionsFailed(true);
              return;
            }
            void fetchSuggestions(entry.problem)
              .then((found) => {
                setSuggestions(found);
              })
              .catch(() => {
                setSuggestionsFailed(true);
              });
          }}
        >
          <p className="font-ui text-body-md text-ink">
            <Chip tone="alert">{problemName(entry.problem, locale)}</Chip>
          </p>
          <Input
            label={t('erDeclineReasonLabel', locale)}
            density="console"
            value={reason}
            data-testid="er-decline-reason"
            onChange={(event) => {
              setReason(event.target.value);
            }}
            {...(tried && blank ? { error: t('erDeclineTitle', locale) } : {})}
          />
          <SheetActions destructive>
            <Button type="submit" variant="danger-quiet" data-testid="er-decline-confirm">
              {t('erDeclineConfirm', locale)}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('goBack', locale)}
            </Button>
          </SheetActions>
        </form>
      )}
    </Sheet>
  );
}

/**
 * `FR-EMG-07`: "search other hospitals filtered by required capability". A
 * hospital that cannot treat this is not a suggestion, however near.
 */
function capable(found: readonly SuggestedHospital[]): readonly SuggestedHospital[] {
  return found.filter((hospital) => hospital.hasCapability !== false);
}

// ---------------------------------------------------------------------------
// Admit (BTN-B07-ADMIT)
// ---------------------------------------------------------------------------

export function AdmitSheet({
  entry,
  bedKinds,
  locale,
  onClose,
  onHandoff,
}: {
  readonly entry: EmergencyCaseView | null;
  readonly bedKinds: readonly BedKind[];
  readonly locale: Locale;
  readonly onClose: () => void;
  readonly onHandoff: (entry: EmergencyCaseView, bedKind: BedKind) => void;
}): ReactNode {
  if (entry === null) return null;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      variant="modal"
      title={t('erAdmitTitle', locale)}
      description={t('erAdmitHint', locale)}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2" data-testid="er-admit-kinds">
          {bedKinds.map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant="secondary"
              data-testid={`er-admit-kind-${kind}`}
              onClick={() => {
                onHandoff(entry, kind);
                onClose();
              }}
            >
              {bedKindName(kind, locale)}
            </Button>
          ))}
        </div>
        <SheetActions>
          <Button variant="quiet" onClick={onClose}>
            {t('goBack', locale)}
          </Button>
        </SheetActions>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Discharge — GR-01: the consequence named, the safe option on the left
// ---------------------------------------------------------------------------

export function DischargeSheet({
  entry,
  locale,
  onClose,
  onDischarge,
}: {
  readonly entry: EmergencyCaseView | null;
  readonly locale: Locale;
  readonly onClose: () => void;
  readonly onDischarge: (entry: EmergencyCaseView) => void;
}): ReactNode {
  if (entry === null) return null;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      variant="modal"
      dismissible={false}
      title={format('erDischargeConfirm', locale, {
        token: entry.tokenLabel ?? t('erTokenPending', locale),
      })}
    >
      <SheetActions destructive>
        <Button
          variant="danger-quiet"
          data-testid="er-discharge-confirm"
          onClick={() => {
            onDischarge(entry);
            onClose();
          }}
        >
          {t('erDischarge', locale)}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {t('goBack', locale)}
        </Button>
      </SheetActions>
    </Sheet>
  );
}
