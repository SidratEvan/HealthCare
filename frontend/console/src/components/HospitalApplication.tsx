'use client';

/**
 * `S-B-00a` A hospital applies by itself (`FR-ONB-09`, `FR-ONB-10`; plan D1;
 * `APP_FLOW.md` B0 `FRM-B00A-APPLY`).
 *
 * Public: nobody is signed in, because the hospital has no account yet. The
 * form asks for what identifies the facility and for the person who will be
 * its first administrator, with a password of their own.
 *
 * ## What it says before anything is sent, and after
 *
 * That applying publishes nothing. The workspace it makes is setting up: the
 * hospital is in no list and in no search until its administrator has filled
 * it in and asked for review, and a person at the platform has approved it
 * (`FR-ONB-04`). The screen says so at the top and again on the answer, with
 * the steps in order, because "I applied and nothing happened" is the
 * question this form would otherwise produce.
 *
 * ## The four states (`GR-03`)
 *
 * There is nothing to load and nothing to be empty: the form is the screen.
 * Offline, the form stays filled and the button says why it cannot be
 * pressed. A refusal says which of the reasons it was, and keeps what was
 * typed. A form whose answer was lost is sent again with the same key, so it
 * is answered with the workspace the first one made.
 *
 * The password is held in this component's state and nowhere else: it is not
 * written to storage, and it is cleared the moment the answer arrives.
 *
 * ## On a demonstration
 *
 * The form works, because showing it work is what a demonstration is for,
 * and it says in its own words that real details do not belong in it
 * (`FR-DEM-07`, `FR-SEC-08`).
 */

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';

import {
  APPLICATION_PASSWORD_MIN,
  APPLICABLE_FACILITY_KINDS,
  facilityPhoneFrom,
  mobileFrom,
} from '@platform/domain';
import {
  DIVISION_NAMES,
  divisionName,
  facilityKindName,
  format,
  formatNumber,
  numeralsFor,
  t,
  type ConsoleKey,
} from '@platform/i18n';
import { Button, Card, FilterChip, Input, useLocale } from '@platform/ui';

import { ConsoleLanguageSwitch } from '@/components/ConsoleLanguageSwitch';
import { DemoBanner } from '@/components/DemoBanner';
import { sendApplication, type ApplicationOutcome } from '@/lib/application';
import { useIsDemonstration } from '@/lib/deployment';

type Refusal = Extract<ApplicationOutcome, { ok: false }>['reason'];

const REFUSAL_KEY: Readonly<Record<Refusal, ConsoleKey>> = {
  offline: 'applyOffline',
  paused: 'applyPaused',
  too_many: 'applyTooMany',
  invalid: 'applyInvalid',
  weak_password: 'applyPasswordShort',
  failed: 'applyFailed',
};

function newKey(): string {
  return globalThis.crypto.randomUUID();
}

export function HospitalApplication(): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const demonstration = useIsDemonstration();

  const [nameBn, setNameBn] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [kind, setKind] = useState<(typeof APPLICABLE_FACILITY_KINDS)[number]>('hospital');
  const [division, setDivision] = useState<string>('Dhaka');
  const [district, setDistrict] = useState('');
  const [phone, setPhone] = useState('');
  const [registrationNo, setRegistrationNo] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminMobile, setAdminMobile] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');

  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [online, setOnline] = useState(true);
  const [done, setDone] = useState<{ code: string; adminEmail: string } | null>(null);
  // One key for this form: a retry of it is the same application.
  const [key, setKey] = useState<string | null>(null);

  useEffect(() => {
    const update = (): void => {
      setOnline(globalThis.navigator?.onLine !== false);
    };
    update();
    globalThis.addEventListener('online', update);
    globalThis.addEventListener('offline', update);
    return () => {
      globalThis.removeEventListener('online', update);
      globalThis.removeEventListener('offline', update);
    };
  }, []);

  const facilityPhone = useMemo(() => facilityPhoneFrom(phone), [phone]);
  const mobile = useMemo(() => mobileFrom(adminMobile), [adminMobile]);

  // What is wrong with each field, said under it once something was typed.
  const phoneProblem = phone.trim() !== '' && facilityPhone === null;
  const mobileProblem = adminMobile.trim() !== '' && mobile === null;
  const emailProblem =
    adminEmail.trim() !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail.trim());
  const passwordShort = password !== '' && [...password].length < APPLICATION_PASSWORD_MIN;
  const passwordsDiffer = again !== '' && again !== password;

  const ready =
    nameBn.trim().length >= 2 &&
    nameEn.trim().length >= 2 &&
    district.trim().length >= 2 &&
    registrationNo.trim().length >= 2 &&
    adminName.trim().length >= 2 &&
    adminEmail.trim() !== '' &&
    !emailProblem &&
    facilityPhone !== null &&
    mobile !== null &&
    [...password].length >= APPLICATION_PASSWORD_MIN &&
    again === password;

  // Anything changed after a refusal is a new thing to say about it.
  function edited(): void {
    if (refusal !== null) setRefusal(null);
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy || !ready || !online || facilityPhone === null || mobile === null) return;
    const sendKey = key ?? newKey();
    setKey(sendKey);
    setBusy(true);
    setRefusal(null);
    void sendApplication(
      {
        nameBn: nameBn.trim(),
        nameEn: nameEn.trim(),
        kind,
        division,
        district: district.trim(),
        phone: facilityPhone,
        registrationNo: registrationNo.trim(),
        adminName: adminName.trim(),
        adminEmail: adminEmail.trim().toLowerCase(),
        adminMobile: mobile,
        password,
      },
      sendKey,
    )
      .then((outcome) => {
        if (outcome.ok) {
          setPassword('');
          setAgain('');
          setDone({ code: outcome.code, adminEmail: outcome.adminEmail });
          return;
        }
        // A form the server read and refused is a different form once it is
        // corrected; one that never arrived is the same one, sent again.
        if (outcome.reason !== 'offline' && outcome.reason !== 'failed') setKey(null);
        setRefusal(outcome.reason);
      })
      .finally(() => {
        setBusy(false);
      });
  }

  const reason = !online ? t('applyOffline', locale) : ready ? null : t('applyNeedsFields', locale);

  return (
    <div className="min-h-screen">
      <header className="bg-brand-700 text-ink-inverse">
        <div className="mx-auto flex max-w-[1040px] items-center gap-4 px-8 py-8">
          <h1 className="font-reading text-title-lg">{t('applyTitle', locale)}</h1>
          <ConsoleLanguageSwitch />
        </div>
      </header>
      <DemoBanner />

      {done === null ? (
        <main className="mx-auto flex max-w-[760px] flex-col gap-6 p-8" data-testid="apply-form">
          <div className="flex flex-col gap-2">
            <p className="text-body-md text-ink-secondary">{t('applyIntro', locale)}</p>
            {/* Said before anything is typed: applying publishes nothing. */}
            <p
              className="rounded-sm bg-sunken px-3 py-2 text-body-sm text-ink-secondary"
              data-testid="apply-nothing-public"
            >
              {t('applyNothingPublic', locale)}
            </p>
            {demonstration ? (
              <p
                className="rounded-sm bg-warn-100 px-3 py-2 text-body-sm text-warn-700"
                data-testid="apply-demo-note"
              >
                {t('applyDemoNote', locale)}
              </p>
            ) : null}
          </div>

          {online ? null : (
            <p
              role="status"
              className="rounded-sm bg-warn-100 px-3 py-2 text-body-sm text-warn-700"
              data-testid="apply-offline"
            >
              {t('applyOffline', locale)}
            </p>
          )}

          <form className="flex flex-col gap-6" noValidate onSubmit={submit}>
            <Card>
              <div className="flex flex-col gap-4">
                <h2 className="text-title-md">{t('applyFacility', locale)}</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <Input
                    density="console"
                    label={t('platformFieldNameBn', locale)}
                    value={nameBn}
                    data-testid="apply-name-bn"
                    onChange={(event) => {
                      setNameBn(event.target.value);
                      edited();
                    }}
                  />
                  <Input
                    density="console"
                    label={t('platformFieldNameEn', locale)}
                    value={nameEn}
                    data-testid="apply-name-en"
                    onChange={(event) => {
                      setNameEn(event.target.value);
                      edited();
                    }}
                  />
                </div>

                <fieldset className="flex flex-col gap-2">
                  <legend className="text-body-sm font-semibold">
                    {t('platformFieldKind', locale)}
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {APPLICABLE_FACILITY_KINDS.map((candidate) => (
                      <FilterChip
                        key={candidate}
                        selected={kind === candidate}
                        data-testid={`apply-kind-${candidate}`}
                        onToggle={() => {
                          setKind(candidate);
                          edited();
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
                        data-testid={`apply-division-${candidate}`}
                        onToggle={() => {
                          setDivision(candidate);
                          edited();
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
                    data-testid="apply-district"
                    onChange={(event) => {
                      setDistrict(event.target.value);
                      edited();
                    }}
                  />
                  <Input
                    density="console"
                    kind="phone"
                    label={t('applyPhone', locale)}
                    helper={t('applyPhoneHelp', locale)}
                    {...(phoneProblem ? { error: t('applyPhoneWrong', locale) } : {})}
                    value={phone}
                    data-testid="apply-phone"
                    onChange={(event) => {
                      setPhone(event.target.value);
                      edited();
                    }}
                  />
                  <Input
                    density="console"
                    label={t('platformFieldRegistration', locale)}
                    helper={t('applyRegistrationHelp', locale)}
                    value={registrationNo}
                    data-testid="apply-registration"
                    onChange={(event) => {
                      setRegistrationNo(event.target.value);
                      edited();
                    }}
                  />
                </div>
              </div>
            </Card>

            <Card>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <h2 className="text-title-md">{t('applyAdmin', locale)}</h2>
                  <p className="text-body-sm text-ink-secondary">{t('applyAdminHelp', locale)}</p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Input
                    density="console"
                    label={t('platformFieldAdminName', locale)}
                    autoComplete="name"
                    value={adminName}
                    data-testid="apply-admin-name"
                    onChange={(event) => {
                      setAdminName(event.target.value);
                      edited();
                    }}
                  />
                  <Input
                    density="console"
                    kind="email"
                    label={t('platformFieldAdminEmail', locale)}
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    {...(emailProblem ? { error: t('applyEmailWrong', locale) } : {})}
                    value={adminEmail}
                    data-testid="apply-admin-email"
                    onChange={(event) => {
                      setAdminEmail(event.target.value);
                      edited();
                    }}
                  />
                  <Input
                    density="console"
                    kind="phone"
                    label={t('applyMobile', locale)}
                    helper={t('applyMobileHelp', locale)}
                    autoComplete="tel"
                    {...(mobileProblem ? { error: t('applyMobileWrong', locale) } : {})}
                    value={adminMobile}
                    data-testid="apply-admin-mobile"
                    onChange={(event) => {
                      setAdminMobile(event.target.value);
                      edited();
                    }}
                  />
                  <span />
                  <Input
                    density="console"
                    kind="password"
                    label={t('applyPassword', locale)}
                    helper={format('applyPasswordHelp', locale, {
                      count: formatNumber(APPLICATION_PASSWORD_MIN, numerals),
                    })}
                    autoComplete="new-password"
                    {...(passwordShort ? { error: t('applyPasswordShort', locale) } : {})}
                    value={password}
                    data-testid="apply-password"
                    onChange={(event) => {
                      setPassword(event.target.value);
                      edited();
                    }}
                  />
                  <Input
                    density="console"
                    kind="password"
                    label={t('applyPasswordAgain', locale)}
                    autoComplete="new-password"
                    {...(passwordsDiffer ? { error: t('applyPasswordsDiffer', locale) } : {})}
                    value={again}
                    data-testid="apply-password-again"
                    onChange={(event) => {
                      setAgain(event.target.value);
                      edited();
                    }}
                  />
                </div>
              </div>
            </Card>

            {refusal === null ? null : (
              <p
                role="alert"
                className="rounded-sm bg-alert-100 px-3 py-2 text-body-sm text-alert-700"
                data-testid="apply-refused"
                data-reason={refusal}
              >
                {t(REFUSAL_KEY[refusal], locale)}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-4">
              <Button
                type="submit"
                {...(reason === null ? {} : { disabled: true, disabledReason: reason })}
                loading={busy}
                data-testid="apply-submit"
              >
                {busy ? t('applySubmitting', locale) : t('applySubmit', locale)}
              </Button>
              <a href="/?login=1" className="text-body-sm underline" data-testid="apply-login-link">
                {t('applyHaveAccount', locale)}
              </a>
            </div>
          </form>
        </main>
      ) : (
        <main className="mx-auto flex max-w-[760px] flex-col gap-6 p-8" data-testid="apply-done">
          <Card tone="brand">
            <div className="flex flex-col gap-3">
              <h2 className="text-title-md">{t('applyDoneTitle', locale)}</h2>
              <p className="text-body-md">{t('applyDoneLine', locale)}</p>
              <dl className="grid gap-2 text-body-md md:grid-cols-2">
                <div>
                  <dt className="text-body-sm text-ink-secondary">{t('applyDoneCode', locale)}</dt>
                  <dd className="font-semibold" data-testid="apply-done-code">
                    {done.code}
                  </dd>
                </div>
                <div>
                  <dt className="text-body-sm text-ink-secondary">{t('applyDoneEmail', locale)}</dt>
                  <dd className="font-semibold" data-testid="apply-done-email">
                    {done.adminEmail}
                  </dd>
                </div>
              </dl>
            </div>
          </Card>

          <section className="flex flex-col gap-2">
            <h2 className="text-title-sm">{t('applyNextTitle', locale)}</h2>
            <ol className="flex list-decimal flex-col gap-1 pl-6 text-body-md text-ink-secondary">
              <li>{t('applyNextSignIn', locale)}</li>
              <li>{t('applyNextTwoStep', locale)}</li>
              <li>{t('applyNextSetUp', locale)}</li>
              <li>{t('applyNextReview', locale)}</li>
            </ol>
            <p className="text-body-sm text-ink-secondary" data-testid="apply-done-not-public">
              {t('applyNothingPublic', locale)}
            </p>
          </section>

          <div>
            <a
              href="/?login=1"
              className="inline-flex min-h-touch items-center rounded-sm bg-brand-600 px-5 text-body-md font-semibold text-ink-inverse"
              data-testid="apply-done-login"
            >
              {t('applyDoneSignIn', locale)}
            </a>
          </div>
        </main>
      )}
    </div>
  );
}
