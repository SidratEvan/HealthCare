'use client';

/**
 * The Profile tab — sign in with a phone (`S-A-03`, `S-A-04`), claim what the
 * number holds (`S-A-20`), and the account's profiles with their records
 * (pilot step 25, `FR-PAT-01`, `FR-PAT-04`, `FR-GST-09`).
 *
 * Signing in is never required: booking, the live serial and emergency all
 * work without it (`FR-GST-01`). This is where a person who booked as a guest,
 * or whose hospital imported them, gathers it all under one account.
 *
 * ## The four states (`GR-03`)
 *
 * Loading the account's profiles shows their shape; a failure says so with a
 * retry; an account with nothing yet says what fills it; offline, the code
 * cannot be sent and the button says why.
 */

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';

import {
  formatPatient,
  formatDateTime,
  formatNumber,
  localName,
  numeralsFor,
  tp,
  type PatientKey,
} from '@platform/i18n';
import { Button, Card, Input, OtpInput, useLocale } from '@platform/ui';

import { BrandLogo } from '@/components/BrandLogo';
import {
  ChevronIcon,
  GlobeIcon,
  LogoutIcon,
  ProfileIcon,
  SerialIcon,
  ShieldIcon,
} from '@/components/icons';
import { LanguageToggle } from '@/components/LanguageToggle';
import { TabScreen } from '@/components/TabScreen';
import { useDeployment } from '@/hooks/useDeployment';
import { useOnline } from '@/hooks/useOnline';
import {
  claimAll,
  claimable,
  profiles as loadProfiles,
  readAccount,
  recordsOf,
  requestCode,
  signOut,
  verifyCode,
  type AccountFailure,
  type ClaimableProfile,
  type Profile,
} from '@/lib/account';
import { doctorName } from '@/lib/doctor';

import type { VisitRecord } from '@/lib/types';

type Stage = 'phone' | 'code' | 'claim' | 'account';

function failureKey(failure: AccountFailure): PatientKey {
  switch (failure.kind) {
    case 'offline':
      return 'accountOffline';
    case 'phone':
      return 'accountPhoneInvalid';
    case 'rate':
      return 'accountTooMany';
    case 'locked':
      return 'accountLocked';
    case 'wrong':
      return 'accountCodeWrong';
    case 'expired':
      return 'accountCodeExpired';
    case 'signedOut':
      return 'accountSignedOut';
    case 'failed':
      return 'accountFailed';
  }
}

export default function Page(): ReactNode {
  const locale = useLocale();
  const online = useOnline();
  const [stage, setStage] = useState<Stage | null>(null);
  const [phone, setPhone] = useState('');
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<PatientKey | null>(null);
  const [wrong, setWrong] = useState(false);

  // Which stage to open on: the account if this device already holds one.
  useEffect(() => {
    setStage(readAccount() === null ? 'phone' : 'account');
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  async function send(event?: FormEvent<HTMLFormElement>): Promise<void> {
    event?.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const result = await requestCode(phone);
    setBusy(false);
    if (!result.ok) {
      setProblem(failureKey(result.failure));
      return;
    }
    setDemoCode(result.value.demoCode);
    setResendAt(Date.now() + result.value.resendAfterSeconds * 1000);
    setStage('code');
  }

  async function verify(code: string): Promise<void> {
    setBusy(true);
    setProblem(null);
    setWrong(false);
    const result = await verifyCode(phone, code);
    setBusy(false);
    if (!result.ok) {
      setWrong(result.failure.kind === 'wrong');
      setProblem(failureKey(result.failure));
      return;
    }
    setStage(result.value.claimable > 0 ? 'claim' : 'account');
  }

  if (stage === null) {
    return (
      <TabScreen title={tp('moreTitle', locale)}>
        <div className="h-40 rounded-md bg-sunken" aria-busy="true" />
      </TabScreen>
    );
  }

  const waitSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));

  return (
    <TabScreen title={tp('moreTitle', locale)}>
      {stage === 'phone' ? (
        <form
          className="flex flex-col gap-4 rounded-md border border-line bg-surface p-4 shadow-1"
          noValidate
          onSubmit={(event) => void send(event)}
          data-testid="signin-phone"
        >
          <div className="flex items-center gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-pill bg-brand-100 text-brand-600">
              <ProfileIcon size={24} />
            </span>
            <p className="text-title-sm font-bold">{tp('moreSignInTitle', locale)}</p>
          </div>
          <p className="text-body-md text-ink-secondary">{tp('accountIntro', locale)}</p>
          <Input
            label={tp('mobileNumber', locale)}
            kind="phone"
            value={phone}
            autoComplete="tel"
            data-testid="signin-phone-input"
            onChange={(event) => {
              setPhone(event.target.value);
            }}
          />
          {online ? (
            <Button type="submit" size="lg" loading={busy} data-testid="signin-send">
              {tp('accountSendCode', locale)}
            </Button>
          ) : (
            <Button
              type="submit"
              size="lg"
              disabled
              disabledReason={tp('accountOffline', locale)}
              data-testid="signin-send"
            >
              {tp('accountSendCode', locale)}
            </Button>
          )}
        </form>
      ) : null}

      {stage === 'code' ? (
        <div
          className="flex flex-col gap-4 rounded-md border border-line bg-surface p-4 shadow-1"
          data-testid="signin-code"
        >
          <p className="text-body-md text-ink-secondary">
            {formatPatient('accountCodeSent', locale, { phone })}
          </p>
          <OtpInput
            label={tp('accountCode', locale)}
            invalid={wrong}
            disabled={busy}
            onComplete={(code) => {
              void verify(code);
            }}
          />
          {demoCode === null ? null : (
            <p
              className="rounded-sm bg-warn-100 px-3 py-2 text-body-sm text-warn-700"
              data-testid="signin-demo-code"
            >
              {formatPatient('accountDemoCode', locale, { code: demoCode })}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            {waitSeconds > 0 ? (
              <Button
                variant="secondary"
                disabled
                disabledReason={formatPatient('accountResendIn', locale, {
                  seconds: formatNumber(waitSeconds, numeralsFor(locale)),
                })}
              >
                {formatPatient('accountResendIn', locale, {
                  seconds: formatNumber(waitSeconds, numeralsFor(locale)),
                })}
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => void send()} data-testid="signin-resend">
                {tp('accountResend', locale)}
              </Button>
            )}
            <Button
              variant="quiet"
              onClick={() => {
                setStage('phone');
                setProblem(null);
              }}
            >
              {tp('accountChangeNumber', locale)}
            </Button>
          </div>
        </div>
      ) : null}

      {problem === null ? null : (
        <p role="alert" className="text-body-md text-alert-700" data-testid="signin-problem">
          {tp(problem, locale)}
        </p>
      )}

      {stage === 'claim' ? (
        <Claim
          onDone={() => {
            setStage('account');
          }}
        />
      ) : null}

      {stage === 'account' ? (
        <Account
          onSignedOut={() => {
            setPhone('');
            setStage('phone');
          }}
        />
      ) : null}

      <Menu />

      {stage === 'account' ? (
        <SignOutRow
          onSignedOut={() => {
            setPhone('');
            setStage('phone');
          }}
        />
      ) : null}

      <BrandFoot />
    </TabScreen>
  );
}

/**
 * The আরও menu (`S-A-19`, FRONTEND.md §0.5): only what works. Language, and
 * the way to the record sharing that lives with the records. Help and the
 * hospital link (`BTN-A19-HELP`, `BTN-A19-FORHOSPITAL`) are not built, so
 * they are not offered.
 */
function Menu(): ReactNode {
  const locale = useLocale();
  return (
    <section aria-labelledby="more-settings" className="flex flex-col gap-2">
      <h2 id="more-settings" className="text-body-sm font-semibold text-ink-muted">
        {tp('moreSettingsTitle', locale)}
      </h2>
      <ul className="divide-y divide-line rounded-md border border-line bg-surface shadow-1">
        <li className="flex min-h-[56px] items-center gap-3 px-4 py-2">
          <span className="text-brand-600">
            <GlobeIcon size={22} />
          </span>
          <span className="flex-1 text-body-md font-medium">{tp('language', locale)}</span>
          <LanguageToggle />
        </li>
        <li>
          <a
            href="/serials"
            className="flex min-h-[56px] items-center gap-3 px-4 text-body-md font-medium"
          >
            <span className="text-brand-600">
              <SerialIcon size={22} />
            </span>
            <span className="flex-1">{tp('moreMySerials', locale)}</span>
            <span className="text-ink-muted">
              <ChevronIcon size={18} />
            </span>
          </a>
        </li>
        <li>
          <a
            href="/records"
            className="flex min-h-[56px] items-center gap-3 px-4 text-body-md font-medium"
          >
            <span className="text-brand-600">
              <ShieldIcon size={22} />
            </span>
            <span className="flex-1">{tp('moreRecordsSharing', locale)}</span>
            <span className="text-ink-muted">
              <ChevronIcon size={18} />
            </span>
          </a>
        </li>
      </ul>
    </section>
  );
}

/** Sign-out: its own row, beneath the menu, never beside something else. */
function SignOutRow({ onSignedOut }: { readonly onSignedOut: () => void }): ReactNode {
  const locale = useLocale();
  return (
    <button
      type="button"
      onClick={() => {
        void signOut().then(onSignedOut);
      }}
      data-testid="account-sign-out"
      className="flex min-h-[56px] items-center gap-3 rounded-md border border-line bg-surface px-4 text-left text-body-md font-medium text-ink-secondary shadow-1"
    >
      <span className="text-ink-muted">
        <LogoutIcon size={22} />
      </span>
      {tp('accountSignOut', locale)}
    </button>
  );
}

/** The official logo at the foot of the screen (FRONTEND.md §0.5), and the version. */
function BrandFoot(): ReactNode {
  const locale = useLocale();
  const demo = useDeployment()?.demo === true;
  const scope = useDeployment()?.scope ?? null;
  // Inside a hospital's own app the network's logo would be the wrong one.
  if (scope !== null) return null;
  return (
    <div className="flex flex-col items-center gap-1 pt-2">
      <BrandLogo height={52} />
      <p className="text-caption text-ink-muted">
        {tp(demo ? 'appVersionDemo' : 'appVersion', locale)}
      </p>
    </div>
  );
}

/** `S-A-20`: what the number holds, taken over in one step (`FR-GST-09`). */
function Claim({ onDone }: { readonly onDone: () => void }): ReactNode {
  const locale = useLocale();
  const [list, setList] = useState<readonly ClaimableProfile[] | null>(null);
  const [problem, setProblem] = useState<PatientKey | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void claimable().then((result) => {
      if (result.ok) setList(result.value);
      else setProblem(failureKey(result.failure));
    });
  }, []);

  async function confirm(): Promise<void> {
    setBusy(true);
    const result = await claimAll();
    setBusy(false);
    if (!result.ok) {
      setProblem(failureKey(result.failure));
      return;
    }
    onDone();
  }

  return (
    <section className="flex flex-col gap-4" data-testid="claim">
      <h2 className="text-title-md font-bold">{tp('claimTitle', locale)}</h2>
      <p className="text-body-md text-ink-secondary">{tp('claimIntro', locale)}</p>
      {list === null && problem === null ? (
        <div className="h-24 rounded-md bg-sunken" aria-busy="true" />
      ) : null}
      {list?.map((entry) => (
        <Card elevated key={entry.patientId}>
          <p className="text-body-lg font-semibold">{entry.fullName}</p>
          <p className="text-body-sm text-ink-muted">
            {formatPatient('claimCounts', locale, {
              bookings: formatNumber(entry.bookings, numeralsFor(locale)),
              visits: formatNumber(entry.visits, numeralsFor(locale)),
            })}
            {entry.hospitalNameBn === null
              ? null
              : ` · ${formatPatient('claimHeldBy', locale, { hospital: localName(locale, entry.hospitalNameBn, entry.hospitalNameEn) })}`}
          </p>
        </Card>
      ))}
      {problem === null ? null : (
        <p role="alert" className="text-body-md text-alert-700">
          {tp(problem, locale)}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button size="lg" loading={busy} onClick={() => void confirm()} data-testid="claim-confirm">
          {tp('claimConfirm', locale)}
        </Button>
        <Button variant="quiet" onClick={onDone}>
          {tp('claimLater', locale)}
        </Button>
      </div>
    </section>
  );
}

/** The account's profiles, each with its records. */
function Account({ onSignedOut }: { readonly onSignedOut: () => void }): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const [list, setList] = useState<readonly Profile[] | null>(null);
  const [records, setRecords] = useState<ReadonlyMap<string, readonly VisitRecord[]>>(new Map());
  const [problem, setProblem] = useState<PatientKey | null>(null);
  const account = readAccount();

  const load = useCallback(async () => {
    setProblem(null);
    const result = await loadProfiles();
    if (!result.ok) {
      if (result.failure.kind === 'signedOut') {
        onSignedOut();
        return;
      }
      setProblem(failureKey(result.failure));
      return;
    }
    setList(result.value);
    const next = new Map<string, readonly VisitRecord[]>();
    for (const profile of result.value) {
      const visits = await recordsOf(profile.patientId);
      if (visits.ok) next.set(profile.patientId, visits.value);
    }
    setRecords(next);
  }, [onSignedOut]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="flex flex-col gap-4" data-testid="account">
      <div className="flex items-center gap-4 rounded-md border border-line bg-surface p-4 shadow-1">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-pill bg-brand-100 text-brand-600">
          <ProfileIcon size={28} />
        </span>
        <div className="min-w-0">
          <p className="text-body-sm text-ink-muted">{tp('accountSignedInAs', locale)}</p>
          <p className="text-title-sm font-bold tabular-nums" data-testid="account-phone">
            {account?.phone ?? ''}
          </p>
          {list === null || list.length === 0 ? null : (
            <p className="text-body-sm text-ink-secondary">
              {tp('moreProfileCount', locale).replace(
                '{count}',
                formatNumber(list.length, numerals),
              )}
            </p>
          )}
        </div>
      </div>

      <h2 className="-mb-2 text-body-sm font-semibold text-ink-muted">
        {tp('moreProfilesTitle', locale)}
      </h2>

      {problem !== null ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-md bg-alert-100 p-4">
          <p className="text-body-md text-alert-700">{tp(problem, locale)}</p>
          <Button variant="secondary" onClick={() => void load()}>
            {tp('tryAgain', locale)}
          </Button>
        </div>
      ) : list === null ? (
        <div className="h-32 rounded-md bg-sunken" aria-busy="true" data-testid="account-loading" />
      ) : list.length === 0 ? (
        <Card elevated data-testid="account-empty">
          <p className="text-body-md text-ink-secondary">{tp('accountNoProfiles', locale)}</p>
        </Card>
      ) : (
        list.map((profile) => (
          <Card elevated key={profile.patientId} data-testid={`profile-${profile.patientId}`}>
            <p className="text-body-lg font-semibold">{profile.fullName}</p>
            <p className="text-body-sm text-ink-muted">
              {formatPatient('claimCounts', locale, {
                bookings: formatNumber(profile.bookings, numerals),
                visits: formatNumber(profile.visits, numerals),
              })}
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {(records.get(profile.patientId) ?? []).map((visit) => (
                <li
                  key={visit.id}
                  className="rounded-sm bg-sunken px-3 py-2"
                  data-testid="account-visit"
                >
                  <p className="text-body-md">
                    {visit.diagnosisText ?? tp('accountNoDiagnosis', locale)}
                  </p>
                  <p className="text-caption text-ink-muted">
                    {doctorName(locale, visit.doctorNameBn, visit.doctorNameEn)} ·{' '}
                    {localName(locale, visit.hospitalNameBn, visit.hospitalNameEn)} ·{' '}
                    {formatDateTime(visit.visitedAt, numerals)}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </section>
  );
}
