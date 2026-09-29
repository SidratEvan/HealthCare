'use client';

/**
 * Phone first, then the person (`S-B-03`, `MOD-B02-WALKIN`, pilot step 23,
 * `FR-REC-20`).
 *
 * The receptionist types the number the patient says; everybody registered
 * under it is listed — a household shares one phone — and the one standing
 * there is chosen with one tap. Nobody under it, or somebody new, is four
 * fields: name, age, sex, and the number already typed. "Register a new
 * patient in under 30 seconds" is the budget this is built to.
 *
 * Shared by the walk-in modal on `S-B-02` and the registration screen, so the
 * two cannot drift into two ways of finding the same person.
 */

import { useState, type FormEvent, type ReactNode } from 'react';

import {
  format,
  formatNumber,
  numeralsFor,
  t,
  toLatinDigits,
  type ConsoleKey,
} from '@platform/i18n';
import { Button, Card, Chip, FilterChip, Input, useLocale } from '@platform/ui';

import {
  counterPhone,
  findByPhone,
  registerPatient,
  type CounterFailure,
  type CounterPatient,
} from '@/lib/registration';

const SEX_KEY: Readonly<Record<CounterPatient['sex'], ConsoleKey>> = {
  male: 'sexMale',
  female: 'sexFemale',
  other: 'sexOther',
};

export const FAILURE_KEY: Readonly<Record<CounterFailure, ConsoleKey>> = {
  offline: 'walkInOffline',
  phone: 'counterPhoneInvalid',
  refused: 'counterRefused',
  failed: 'counterFailed',
};

export interface ChosenPatient {
  readonly patientId: string;
  readonly fullName: string;
}

export function PatientFinder({
  online,
  onChosen,
}: {
  readonly online: boolean;
  readonly onChosen: (patient: ChosenPatient) => void;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const [typed, setTyped] = useState('');
  const [searched, setSearched] = useState<string | null>(null);
  const [found, setFound] = useState<readonly CounterPatient[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ConsoleKey | null>(null);

  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<CounterPatient['sex'] | null>(null);

  const phone = counterPhone(typed);
  const ageYears = /^\d{1,3}$/.test(toLatinDigits(age).trim())
    ? Number(toLatinDigits(age).trim())
    : null;
  const newReady =
    searched !== null && name.trim() !== '' && ageYears !== null && ageYears <= 130 && sex !== null;
  const offlineReason = online ? null : t('walkInOffline', locale);

  async function search(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (phone === null) {
      setError('counterPhoneInvalid');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await findByPhone(phone);
    setBusy(false);
    if (!result.ok) {
      setError(FAILURE_KEY[result.failure]);
      return;
    }
    setSearched(phone);
    setFound(result.value);
  }

  async function register(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!newReady || searched === null || ageYears === null || sex === null) return;
    setBusy(true);
    setError(null);
    const fullName = name.trim();
    const result = await registerPatient({ phone: searched, fullName, ageYears, sex });
    setBusy(false);
    if (!result.ok) {
      setError(FAILURE_KEY[result.failure]);
      return;
    }
    onChosen({ patientId: result.value, fullName });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="patient-finder">
      <form
        className="flex flex-wrap items-end gap-3"
        noValidate
        onSubmit={(event) => void search(event)}
      >
        <div className="min-w-56 flex-1">
          <Input
            label={t('counterPhone', locale)}
            kind="phone"
            density="console"
            value={typed}
            autoFocus
            data-testid="finder-phone"
            onChange={(event) => {
              setTyped(event.target.value);
              setSearched(null);
              setFound(null);
            }}
          />
        </div>
        {offlineReason === null ? (
          <Button type="submit" variant="secondary" loading={busy} data-testid="finder-search">
            {t('counterFind', locale)}
          </Button>
        ) : (
          <Button
            type="submit"
            variant="secondary"
            disabled
            disabledReason={offlineReason}
            data-testid="finder-search"
          >
            {t('counterFind', locale)}
          </Button>
        )}
      </form>

      {error === null ? null : (
        <p role="alert" className="text-body-sm text-alert-700" data-testid="finder-error">
          {t(error, locale)}
        </p>
      )}

      {found === null ? null : found.length === 0 ? (
        <p className="text-body-sm text-ink-secondary" data-testid="finder-none">
          {t('counterNoneFound', locale)}
        </p>
      ) : (
        <div className="flex flex-col gap-2" data-testid="finder-results">
          <p className="text-body-sm text-ink-secondary">{t('counterFound', locale)}</p>
          {found.map((patient) => (
            <Card key={patient.patientId}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-body-md font-semibold">{patient.fullName}</p>
                  <p className="text-body-sm text-ink-muted">
                    {patient.ageYears === null
                      ? t(SEX_KEY[patient.sex], locale)
                      : `${format('counterAgeYears', locale, { age: formatNumber(patient.ageYears, numerals) })} · ${t(SEX_KEY[patient.sex], locale)}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {patient.owner === 'account' ? (
                    <Chip tone="positive">{t('counterAccount', locale)}</Chip>
                  ) : null}
                  <Button
                    variant="primary"
                    aria-label={format('counterChooseNamed', locale, { name: patient.fullName })}
                    data-testid={`finder-choose-${patient.patientId}`}
                    onClick={() => {
                      onChosen({ patientId: patient.patientId, fullName: patient.fullName });
                    }}
                  >
                    {t('counterChoose', locale)}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {searched === null ? null : (
        <form
          className="flex flex-col gap-3 rounded-md bg-sunken p-4"
          noValidate
          onSubmit={(event) => void register(event)}
          data-testid="finder-new"
        >
          <p className="text-body-md font-semibold">{t('counterNewPatient', locale)}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              label={t('counterName', locale)}
              density="console"
              required
              value={name}
              data-testid="finder-name"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            <Input
              label={t('counterAge', locale)}
              kind="number"
              density="console"
              required
              value={age}
              data-testid="finder-age"
              onChange={(event) => {
                setAge(event.target.value);
              }}
            />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-body-sm text-ink-secondary">
              {t('counterSex', locale)}
            </legend>
            <div className="flex flex-wrap gap-2">
              {(['female', 'male', 'other'] as const).map((value) => (
                <FilterChip
                  key={value}
                  selected={sex === value}
                  onToggle={() => {
                    setSex(value);
                  }}
                >
                  {t(SEX_KEY[value], locale)}
                </FilterChip>
              ))}
            </div>
          </fieldset>
          {offlineReason !== null ? (
            <Button
              type="submit"
              disabled
              disabledReason={offlineReason}
              data-testid="finder-register"
            >
              {t('counterRegister', locale)}
            </Button>
          ) : newReady ? (
            <Button type="submit" loading={busy} data-testid="finder-register">
              {t('counterRegister', locale)}
            </Button>
          ) : (
            <Button
              type="submit"
              disabled
              disabledReason={t('counterNeedFields', locale)}
              data-testid="finder-register"
            >
              {t('counterRegister', locale)}
            </Button>
          )}
        </form>
      )}
    </div>
  );
}
