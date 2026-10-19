'use client';

/** Phone/person confirmation with stale-response and retry protection
 * (FR-REC-20, FR-GST-13). Shared by Registration and positioned walk-ins.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { CONSOLE, format, formatNumber, numeralsFor, t, toLatinDigits } from '@platform/i18n';
import { Button, Chip, ConsoleAction, FilterChip, Input, useLocale } from '@platform/ui';

import { counterPhone, findByPhone, registerPatient } from '@/lib/registration';
import '@platform/ui/console-registration.css';

const SEX_KEY = {
  male: 'sexMale',
  female: 'sexFemale',
  other: 'sexOther',
};
export const FAILURE_KEY = {
  offline: 'walkInOffline',
  phone: 'counterPhoneInvalid',
  demoPhone: 'counterDemoPhone',
  refused: 'counterRefused',
  failed: 'counterFailed',
  uncertain: 'regUncertain',
  access: 'regAccess',
};
const nameKey = (name) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
export function PatientFinder({ online, onChosen, onDirty, onProgress }) {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const [typed, setTyped] = useState('');
  const [searched, setSearched] = useState(null);
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [unresolved, setUnresolved] = useState(false);
  const [error, setError] = useState(null);
  const [candidate, setCandidate] = useState(null);
  const [reused, setReused] = useState(false);
  const [ambiguousReceipt, setAmbiguousReceipt] = useState(false);
  const [newForm, setNewForm] = useState(false);
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState(null);
  const [touched, setTouched] = useState({ name: false, age: false, sex: false, phone: false });
  const version = useRef(0);
  const lookupInFlight = useRef(null);
  const lastAutomatic = useRef(null);
  const writing = useRef(false);
  const original = useRef(null);
  const phone = counterPhone(typed);
  const ageYears = /^\d{1,3}$/.test(toLatinDigits(age).trim())
    ? Number(toLatinDigits(age).trim())
    : null;
  const validName = name.trim().length > 0 && name.trim().length <= 120;
  const validAge = ageYears !== null && ageYears <= 130;
  const nameTaken = (found ?? []).some((person) => nameKey(person.fullName) === nameKey(name));
  const dirty = typed !== '' || name !== '' || age !== '' || sex !== null;
  useEffect(() => onDirty?.(dirty, unresolved || creating), [dirty, unresolved, creating, onDirty]);
  useEffect(() => onProgress?.(searched !== null), [searched, onProgress]);
  useEffect(
    () => () => {
      version.current += 1;
    },
    [],
  );
  const lookup = useCallback(
    async (number) => {
      if (!online || writing.current || lookupInFlight.current === number) return;
      const request = ++version.current;
      lookupInFlight.current = number;
      lastAutomatic.current = number;
      setBusy(true);
      setError(null);
      const result = await findByPhone(number);
      if (request !== version.current) return;
      lookupInFlight.current = null;
      setBusy(false);
      if (!result.ok) {
        setError(FAILURE_KEY[result.failure]);
        return;
      }
      setSearched(number);
      setFound(result.value);
      setCandidate(null);
      setNewForm(result.value.length === 0);
      setReused(false);
      setAmbiguousReceipt(false);
    },
    [online],
  );
  useEffect(() => {
    if (phone === null || !online || unresolved || creating || lastAutomatic.current === phone)
      return;
    const timer = globalThis.setTimeout(() => {
      if (lastAutomatic.current !== phone) void lookup(phone);
    }, 350);
    return () => globalThis.clearTimeout(timer);
  }, [phone, online, lookup, unresolved, creating]);
  function choose(person, origin, number = searched) {
    if (number === null) return;
    onChosen({
      patientId: person.patientId,
      fullName: person.fullName,
      ageYears: person.ageYears,
      sex: person.sex,
      phone: number,
      origin,
    });
  }
  async function register(event) {
    event.preventDefault();
    setTouched({ name: true, age: true, sex: true, phone: true });
    if (
      !online ||
      writing.current ||
      (!unresolved &&
        (!validName ||
          !validAge ||
          sex === null ||
          searched !== phone ||
          searched === null ||
          nameTaken))
    )
      return;
    if (!unresolved) {
      if (searched === null || ageYears === null || sex === null) return;
      const body = { phone: searched, fullName: name.trim(), ageYears, sex };
      if (JSON.stringify(original.current?.body) !== JSON.stringify(body))
        original.current = { key: crypto.randomUUID(), body };
    }
    const saved = original.current;
    if (saved === null) return;
    writing.current = true;
    setCreating(true);
    setError(null);
    const result = await registerPatient(saved.body, saved.key);
    writing.current = false;
    setCreating(false);
    if (!result.ok) {
      setError(FAILURE_KEY[result.failure]);
      setUnresolved(unresolved || result.failure === 'uncertain');
      return;
    }
    setUnresolved(false);
    setSearched(result.value.phone);
    if (result.value.created) {
      choose(result.value.patient, 'new', result.value.phone);
      return;
    }
    setCandidate(result.value.patient);
    setReused(true);
    setAmbiguousReceipt(result.value.ambiguous);
  }
  const indistinguishable =
    candidate !== null &&
    (ambiguousReceipt ||
      (found ?? []).filter(
        (person) =>
          nameKey(person.fullName) === nameKey(candidate.fullName) &&
          person.ageYears === candidate.ageYears &&
          person.sex === candidate.sex,
      ).length > 1);
  return (
    <div className="cf-patient-finder cf-stack" data-testid="patient-finder">
      <section className="cf-reg-panel">
        <h2>
          <span className="cf-reg-number">1</span>
          {t('regStepPhone', locale)}
        </h2>
        <form
          className="cf-reg-phone"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setTouched((old) => ({ ...old, phone: true }));
            if (phone === null) setError('counterPhoneInvalid');
            else void lookup(phone);
          }}
        >
          <Input
            label={t('counterPhone', locale)}
            helper={t('regAutoSearch', locale)}
            kind="phone"
            density="console"
            value={typed}
            required
            autoFocus
            readOnly={creating || unresolved}
            {...(touched.phone && phone === null
              ? { error: t('counterPhoneInvalid', locale) }
              : {})}
            data-testid="finder-phone"
            onBlur={() => setTouched((old) => ({ ...old, phone: true }))}
            onChange={(event) => {
              setTyped(event.target.value);
              if (phone !== null && counterPhone(event.target.value) === phone) return;
              version.current += 1;
              lookupInFlight.current = null;
              lastAutomatic.current = null;
              setBusy(false);
              setSearched(null);
              setFound(null);
              setCandidate(null);
              setNewForm(false);
              setError(null);
            }}
          />
          <Button
            type="submit"
            variant="secondary"
            loading={busy}
            {...(!online || creating || unresolved
              ? {
                  disabled: true,
                  disabledReason: t(unresolved ? 'regUncertain' : 'walkInOffline', locale),
                }
              : {})}
            data-testid="finder-search"
          >
            {t('counterFind', locale)}
          </Button>
        </form>
      </section>
      {error === null ? null : (
        <p role="alert" className="cf-feedback cf-tone-alert" data-testid="finder-error">
          {t(error, locale)}
        </p>
      )}
      {searched === null ? null : (
        <section className="cf-reg-panel cf-stack">
          <h2>
            <span className="cf-reg-number">2</span>
            {t('regStepPatient', locale)}
          </h2>
          <p className="cf-secondary">{t('regIdentityCheck', locale)}</p>
          {candidate !== null ? (
            <div className="cf-reg-selected cf-stack" data-testid="finder-identity">
              {reused ? <p>{t('regReused', locale)}</p> : null}
              <strong>{candidate.fullName}</strong>
              <p>
                {candidate.ageYears === null
                  ? '—'
                  : format('counterAgeYears', locale, {
                      age: formatNumber(candidate.ageYears, numerals),
                    })}{' '}
                · {t(SEX_KEY[candidate.sex], locale)} · {searched}
              </p>
              {indistinguishable ? (
                <p role="alert">{t('regAmbiguous', locale)}</p>
              ) : (
                <ConsoleAction
                  label={CONSOLE.regConfirmPatient}
                  data-testid="finder-confirm-patient"
                  onClick={() => choose(candidate, 'existing')}
                />
              )}
              <ConsoleAction
                label={CONSOLE.counterChangePatient}
                variant="secondary"
                onClick={() => {
                  setCandidate(null);
                  setAmbiguousReceipt(false);
                }}
              />
            </div>
          ) : (
            <>
              {found?.length === 0 ? (
                <p data-testid="finder-none">{t('counterNoneFound', locale)}</p>
              ) : (
                <div className="cf-stack" data-testid="finder-results">
                  <p>{t('counterFound', locale)}</p>
                  {(found ?? []).map((person) => (
                    <div className="cf-reg-person" key={person.patientId}>
                      <div>
                        <strong>{person.fullName}</strong>
                        <p className="cf-secondary">
                          {person.ageYears === null
                            ? '—'
                            : format('counterAgeYears', locale, {
                                age: formatNumber(person.ageYears, numerals),
                              })}{' '}
                          · {t(SEX_KEY[person.sex], locale)}
                        </p>
                        {person.owner === 'account' ? (
                          <Chip tone="positive">{t('counterAccount', locale)}</Chip>
                        ) : null}
                      </div>
                      <Button
                        aria-label={format('counterChooseNamed', locale, { name: person.fullName })}
                        data-testid={`finder-choose-${person.patientId}`}
                        {...(creating || unresolved
                          ? { disabled: true, disabledReason: t('regPending', locale) }
                          : {})}
                        onClick={() => {
                          setCandidate(person);
                          setReused(false);
                        }}
                      >
                        {t('counterChoose', locale)}
                      </Button>
                    </div>
                  ))}
                  {!newForm ? (
                    <ConsoleAction
                      label={CONSOLE.regNotListed}
                      variant="secondary"
                      onClick={() => setNewForm(true)}
                    />
                  ) : null}
                </div>
              )}
              {!newForm ? null : (
                <form
                  className="cf-reg-new cf-stack"
                  noValidate
                  onSubmit={(event) => void register(event)}
                  data-testid="finder-new"
                >
                  <h3>{t('counterNewPatient', locale)}</h3>
                  <Input
                    label={t('counterName', locale)}
                    required
                    density="console"
                    value={name}
                    maxLength={120}
                    readOnly={creating || unresolved}
                    data-testid="finder-name"
                    onChange={(event) => setName(event.target.value)}
                    onBlur={() => setTouched((old) => ({ ...old, name: true }))}
                    {...(touched.name && !validName ? { error: t('regNameError', locale) } : {})}
                  />
                  <Input
                    label={t('counterAge', locale)}
                    required
                    kind="number"
                    density="console"
                    value={age}
                    readOnly={creating || unresolved}
                    data-testid="finder-age"
                    onChange={(event) => setAge(event.target.value)}
                    onBlur={() => setTouched((old) => ({ ...old, age: true }))}
                    {...(touched.age && !validAge ? { error: t('regAgeError', locale) } : {})}
                  />
                  <fieldset disabled={creating || unresolved}>
                    <legend>{t('counterSex', locale)} *</legend>
                    <div className="cf-reg-actions">
                      {['female', 'male', 'other'].map((value) => (
                        <FilterChip
                          key={value}
                          selected={sex === value}
                          onToggle={() => setSex(value)}
                        >
                          {t(SEX_KEY[value], locale)}
                        </FilterChip>
                      ))}
                    </div>
                    {touched.sex && sex === null ? (
                      <p role="alert">{t('regSexError', locale)}</p>
                    ) : null}
                  </fieldset>
                  {nameTaken ? (
                    <p
                      role="alert"
                      className="cf-feedback cf-tone-caution"
                      data-testid="finder-duplicate"
                    >
                      {t('regNameTaken', locale)}
                    </p>
                  ) : null}
                  <Button
                    type="submit"
                    loading={creating}
                    {...(!online || nameTaken
                      ? {
                          disabled: true,
                          disabledReason: t(nameTaken ? 'regNameTaken' : 'walkInOffline', locale),
                        }
                      : {})}
                    data-testid="finder-register"
                  >
                    {t(unresolved ? 'regRetrySame' : 'counterRegister', locale)}
                  </Button>
                </form>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
