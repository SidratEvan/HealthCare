'use client';

/**
 * `S-A-11` — Bed search (`FR-PAT-50`, `FR-PAT-51`, `FR-PAT-52`).
 *
 * "Search beds by type… Each bed type shows count free, nightly price, and
 * freshness. A patient may request a bed."
 *
 * ## Honest in three ways
 *
 * **Every count says how old it is.** The figure is the ward's last
 * confirmation, not the moment this screen was opened, and past the
 * threshold it says so in a sentence that tells the family what to do about
 * it — call before you drive (`FR-OFF-04`, `PRD.md` §3.2).
 *
 * **"None free" is a result, not an absence.** A hospital with the kind of bed
 * asked for and none free stays in the list, below the ones with beds, so a
 * family does not conclude it has no ICU at all.
 *
 * **A request is not a reservation.** The sheet says so before it is sent.
 * Only the ward's hold reserves a bed, and the family is told when it does.
 *
 * ## Why it re-reads instead of listening
 *
 * The live board room is staff-only (BACKEND.md §6) and a socket opened by
 * nobody in particular is a door this version does not have. So the list is
 * read again every half-minute while the screen is visible and whenever it
 * becomes visible again. The published figure changes the instant a ward acts
 * (`FR-BED-02`); this screen sees it within thirty seconds, with the age of
 * every number on it.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { BED_KINDS, bedFigure, normaliseBdMobile, timestamp, type BedKind } from '@platform/domain';
import {
  bedKindName,
  districtName,
  formatNumber,
  formatTaka,
  tp,
  formatAge,
  numeralsFor,
  localName,
} from '@platform/i18n';
import { Button, Card, FilterChip, FreshnessLine, Input, Sheet, useLocale } from '@platform/ui';

import { GuestCodeCard } from '@/components/GuestCodeCard';
import { HospitalIcon } from '@/components/icons';
import { NotShared, withholds } from '@/components/NotShared';
import { TabScreen } from '@/components/TabScreen';
import { useGuestPhoneProof } from '@/hooks/useGuestPhoneProof';
import { useNow } from '@/hooks/useNow';
import { useOnline } from '@/hooks/useOnline';
import { hospitalsWithBeds, requestBed } from '@/lib/api';
import { rememberBedRequest, savedBedRequests, type SavedBedRequest } from '@/lib/bedRequests';

import type { HospitalCard, Loadable } from '@/lib/types';

/** How often the list is re-read while visible. */
const REFRESH_MS = 30_000;

/** `hospital_settings.stale_threshold_minutes`' default (`FR-OFF-04`). */
const STALE_AFTER_MINUTES = 10;

export default function Page(): ReactNode {
  const locale = useLocale();
  const now = useNow(15_000);
  const online = useOnline();
  const [kind, setKind] = useState<BedKind>('general');
  const [list, setList] = useState<Loadable<HospitalCard>>({ state: 'loading' });
  const [asking, setAsking] = useState<HospitalCard | null>(null);
  const [mine, setMine] = useState<readonly SavedBedRequest[]>([]);

  // `?kind=icu` opens on that kind: the emergency screen and the SMS link both
  // arrive here already knowing what the family needs.
  useEffect(() => {
    const asked = new URLSearchParams(globalThis.location.search).get('kind');
    if (asked !== null && (BED_KINDS as readonly string[]).includes(asked)) {
      setKind(asked as BedKind);
    }
    setMine(savedBedRequests());
  }, []);

  const load = useCallback(async (which: BedKind) => {
    try {
      const result = await hospitalsWithBeds(which);
      setList({ state: 'ready', ...result });
    } catch {
      // A list already on screen stays, ageing honestly under the offline
      // banner; only a list that never arrived is a failure.
      setList((current) => (current.state === 'ready' ? current : { state: 'failed' }));
    }
  }, []);

  useEffect(() => {
    setList({ state: 'loading' });
    void load(kind);

    const timer = setInterval(() => {
      if (globalThis.document?.visibilityState === 'visible') void load(kind);
    }, REFRESH_MS);
    const onVisible = (): void => {
      if (globalThis.document?.visibilityState === 'visible') void load(kind);
    };
    globalThis.document?.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      globalThis.document?.removeEventListener('visibilitychange', onVisible);
    };
  }, [kind, load]);

  return (
    <TabScreen title={tp('bedsScreenTitle', locale)} back={{ fallback: '/' }}>
      <div className="flex flex-col gap-4" data-testid="bed-search">
        {mine.length === 0 ? null : (
          <section className="flex flex-col gap-2" aria-labelledby="my-requests">
            <h2 id="my-requests" className="text-title-sm font-bold">
              {tp('yourRequests', locale)}
            </h2>
            {mine.map((request) => (
              <a
                key={request.requestId}
                href={`/beds/request?t=${encodeURIComponent(request.token)}`}
                data-testid={`my-request-${request.requestId}`}
                className="flex min-h-touch items-center justify-between rounded-md border border-line bg-surface px-4 text-body-md"
              >
                <span>
                  {localName(locale, request.hospitalNameBn, request.hospitalNameEn)} ·{' '}
                  {bedKindName(request.bedKind, locale)}
                </span>
                <span className="text-brand-600">{tp('requestStatus', locale)}</span>
              </a>
            ))}
          </section>
        )}

        {/* CHIP-A11-<type> */}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-body-md text-ink-secondary">
            {tp('bedsChooseKind', locale)}
          </legend>
          {/* One row that scrolls sideways, as on the approved board. */}
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [-webkit-mask-image:linear-gradient(90deg,black_85%,transparent)] [mask-image:linear-gradient(90deg,black_85%,transparent)]">
            {BED_KINDS.map((candidate) => (
              <span key={candidate} className="shrink-0 whitespace-nowrap">
                <FilterChip
                  selected={candidate === kind}
                  onToggle={() => {
                    setKind(candidate);
                  }}
                >
                  {bedKindName(candidate, locale)}
                </FilterChip>
              </span>
            ))}
          </div>
        </fieldset>

        <p className="text-caption text-ink-muted">{tp('bedsHowItWorks', locale)}</p>

        {!online && list.state === 'ready' ? (
          <p
            role="status"
            data-testid="beds-offline"
            className="rounded-sm bg-warn-100 px-3 py-2 text-body-sm text-warn-700"
          >
            {tp('bedsOfflineCached', locale)}
          </p>
        ) : null}

        <Results
          list={list}
          kind={kind}
          now={now}
          onRetry={() => {
            setList({ state: 'loading' });
            void load(kind);
          }}
          onRequest={setAsking}
        />
      </div>

      {asking === null ? null : (
        <RequestSheet
          hospital={asking}
          kind={kind}
          onClose={() => {
            setAsking(null);
          }}
        />
      )}
    </TabScreen>
  );
}

function Results({
  list,
  kind,
  now,
  onRetry,
  onRequest,
}: {
  readonly list: Loadable<HospitalCard>;
  readonly kind: BedKind;
  readonly now: Date;
  readonly onRetry: () => void;
  readonly onRequest: (hospital: HospitalCard) => void;
}): ReactNode {
  const locale = useLocale();
  const ordered = useMemo(() => {
    if (list.state !== 'ready') return [];
    // Fresh and free first, then free but unconfirmed, then none free — a
    // stale "two free" is not ranked above a fresh "one free" (`FR-PAT-45`).
    const rank = (hospital: HospitalCard): number => {
      const entry = hospital.beds?.byKind.find((row) => row.kind === kind);
      if (entry === undefined || entry.free === 0) return 2;
      return isStale(entry.asOf, now) ? 1 : 0;
    };
    return [...list.items].sort(
      (a, b) =>
        rank(a) - rank(b) ||
        localName(locale, a.nameBn, a.nameEn).localeCompare(
          localName(locale, b.nameBn, b.nameEn),
          locale,
        ),
    );
  }, [list, kind, now, locale]);

  // GR-03: loading, failed and empty are three different sentences.
  if (list.state === 'loading') {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" data-testid="beds-loading">
        <div className="h-28 rounded-md bg-sunken" />
        <div className="h-28 rounded-md bg-sunken" />
      </div>
    );
  }

  if (list.state === 'failed') {
    return (
      <div className="flex flex-col gap-3" role="alert" data-testid="beds-failed">
        <p className="text-body-md text-ink-secondary">{tp('listFailed', locale)}</p>
        <Button variant="secondary" onClick={onRetry}>
          {tp('tryAgain', locale)}
        </Button>
      </div>
    );
  }

  if (ordered.length === 0) {
    return (
      <div className="flex flex-col gap-2" data-testid="beds-empty">
        <p className="text-body-md text-ink-secondary">{tp('bedsNoHospitals', locale)}</p>
        <p className="text-body-sm text-ink-muted">{tp('bedsNoHospitalsHint', locale)}</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {ordered.map((hospital) => (
        <li key={hospital.id}>
          <HospitalBedCard hospital={hospital} kind={kind} now={now} onRequest={onRequest} />
        </li>
      ))}
    </ul>
  );
}

/** `CARD-A11-<id>`: free count, nightly price, freshness. */
function HospitalBedCard({
  hospital,
  kind,
  now,
  onRequest,
}: {
  readonly hospital: HospitalCard;
  readonly kind: BedKind;
  readonly now: Date;
  readonly onRequest: (hospital: HospitalCard) => void;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const entry = hospital.beds?.byKind.find((row) => row.kind === kind);
  if (entry === undefined) {
    // It has this kind of bed and keeps the count (FR-NET-04). The card says
    // so and still takes a request, which is how a family finds out.
    if (!withholds(hospital, 'beds')) return null;
    return (
      <Card elevated>
        <div
          className="flex flex-col gap-2"
          data-testid={`bed-card-${hospital.id}`}
          data-shared="false"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-brand-600">
              <HospitalIcon size={22} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-title-sm font-bold">
                {localName(locale, hospital.nameBn, hospital.nameEn)}
              </p>
              <p className="text-body-sm text-ink-muted">
                {hospital.thana === null
                  ? hospital.district
                  : `${hospital.thana}, ${hospital.district}`}
              </p>
            </div>
          </div>
          <div>
            <NotShared figure="beds" />
          </div>
          <p className="text-body-sm text-ink-secondary">{tp('bedsNotSharedHint', locale)}</p>
          <Button
            variant="secondary"
            data-testid={`request-bed-${hospital.id}`}
            onClick={() => {
              onRequest(hospital);
            }}
          >
            {tp('requestBed', locale)}
          </Button>
        </div>
      </Card>
    );
  }

  const stale = isStale(entry.asOf, now);
  // A count only while it is fresh (owner, 8 October; `FR-PAT-14`, `FR-PAT-51`).
  const figure = bedFigure(
    entry.free,
    entry.asOf === null ? null : timestamp(entry.asOf),
    timestamp(now.toISOString()),
    STALE_AFTER_MINUTES,
  );
  const freeNow = figure.kind === 'count' && figure.free > 0;
  const price =
    entry.nightlyMinPoisha === null
      ? null
      : entry.nightlyMinPoisha === entry.nightlyMaxPoisha
        ? tp('bedsNightly', locale).replace('{price}', formatTaka(entry.nightlyMinPoisha, numerals))
        : tp('bedsNightlyRange', locale)
            .replace('{min}', formatTaka(entry.nightlyMinPoisha, numerals))
            .replace(
              '{max}',
              formatTaka(entry.nightlyMaxPoisha ?? entry.nightlyMinPoisha, numerals),
            );

  return (
    <Card elevated tone={freeNow ? 'brand' : 'default'}>
      <div
        className="flex flex-col gap-2"
        data-testid={`bed-card-${hospital.id}`}
        data-figure={figure.kind}
        data-free={figure.kind === 'count' ? figure.free : undefined}
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-brand-600">
            <HospitalIcon size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-title-sm font-bold">
              {localName(locale, hospital.nameBn, hospital.nameEn)}
            </p>
            <p className="text-body-sm text-ink-muted">
              {/* The thana is held in English only; in Bangla the district is
                  said in Bangla rather than mixing scripts in one line. */}
              {locale === 'en' && hospital.thana !== null
                ? `${hospital.thana}, ${hospital.district}`
                : districtName(hospital.district, locale)}
            </p>
          </div>
        </div>

        <p className="flex flex-wrap items-baseline gap-x-2" data-testid="bed-card-free">
          {figure.kind === 'count' ? (
            <>
              <span
                className={`text-title-lg font-extrabold tabular-nums ${
                  freeNow ? 'text-brand-600' : 'text-ink-muted'
                }`}
              >
                {figure.free > 0
                  ? tp('bedsFree', locale).replace('{free}', formatNumber(figure.free, numerals))
                  : tp('bedsNoneFree', locale)}
              </span>
              <span className="text-body-sm text-ink-muted">
                {tp('bedsOfTotal', locale).replace('{total}', formatNumber(entry.total, numerals))}
              </span>
            </>
          ) : (
            <span className="text-title-sm font-bold text-ink-secondary">
              {tp('bedsUnknown', locale)}
            </span>
          )}
        </p>

        {price === null ? null : <p className="text-body-sm text-ink-secondary">{price}</p>}

        <FreshnessLine
          asOf={entry.asOf === null ? null : new Date(entry.asOf)}
          now={now}
          staleAfterMinutes={STALE_AFTER_MINUTES}
          labels={{
            justNow: tp('updatedJustNow', locale),
            ago: tp('updatedAgo', locale),
            never: tp('updatedNever', locale),
            stale: tp('staleWarning', locale),
          }}
          formatMinutes={(value) => formatAge(value, locale, numerals)}
        />

        {stale ? (
          <p className="text-body-sm text-warn-700" data-testid="bed-card-stale">
            {tp('bedsStaleCaution', locale)}
          </p>
        ) : null}

        <Button
          variant={freeNow ? 'primary' : 'secondary'}
          data-testid={`request-bed-${hospital.id}`}
          onClick={() => {
            onRequest(hospital);
          }}
        >
          {tp('requestBed', locale)}
        </Button>
      </div>
    </Card>
  );
}

/** `MOD-A11-REQUEST`: "patient profile, expected arrival, condition note". */
function RequestSheet({
  hospital,
  kind,
  onClose,
}: {
  readonly hospital: HospitalCard;
  readonly kind: BedKind;
  readonly onClose: () => void;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<'male' | 'female' | 'other' | null>(null);
  const [arrivalMinutes, setArrivalMinutes] = useState<number | null>(60);
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // One key per send attempt, reused across its retries (`APP_FLOW.md` A4).
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const stored = normaliseBdMobile(phone);
  const ageYears = /^\d{1,3}$/.test(age.trim()) ? Number(age.trim()) : null;
  const complete = name.trim().length >= 2 && stored !== null && ageYears !== null && sex !== null;

  // `FR-GST-03` names a bed request among what proves the phone first.
  const {
    pending: phoneCheck,
    codeWrong,
    begin: beginPhoneCheck,
    prove: provePhone,
  } = useGuestPhoneProof();

  async function file(guestToken: string | null): Promise<void> {
    if (stored === null || ageYears === null || sex === null) return;

    const created = await requestBed({
      hospitalId: hospital.id,
      bedKind: kind,
      patient: { name: name.trim(), phone: stored, ageYears, sex },
      expectedArrivalAt:
        arrivalMinutes === null
          ? null
          : new Date(Date.now() + arrivalMinutes * 60_000).toISOString(),
      note: note.trim() === '' ? null : note.trim(),
      idempotencyKey,
      guestToken,
    });

    rememberBedRequest({
      requestId: created.request.id,
      token: created.token,
      hospitalNameBn: hospital.nameBn,
      hospitalNameEn: hospital.nameEn,
      bedKind: kind,
      savedAt: new Date().toISOString(),
    });

    globalThis.location.assign(`/beds/request?t=${encodeURIComponent(created.token)}`);
  }

  function failed(error: unknown): void {
    const code = (error as { code?: string }).code;
    setFailure(
      code === 'AUTH_OTP_INVALID'
        ? tp('accountCodeWrong', locale)
        : code === 'AUTH_LOCKED'
          ? tp('accountLocked', locale)
          : tp('requestFailed', locale),
    );
  }

  async function send(): Promise<void> {
    setTried(true);
    if (!complete || stored === null || ageYears === null || sex === null) return;

    setSending(true);
    setFailure(null);
    try {
      const start = await beginPhoneCheck(stored, name.trim());
      if (start.ready) await file(start.guestToken);
    } catch (error) {
      failed(error);
    } finally {
      setSending(false);
    }
  }

  async function proveCode(code: string): Promise<void> {
    if (stored === null) return;

    setSending(true);
    setFailure(null);
    try {
      await file(await provePhone(stored, name.trim(), code));
    } catch (error) {
      failed(error);
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={tp('requestTitle', locale)
        .replace('{hospital}', localName(locale, hospital.nameBn, hospital.nameEn))
        .replace('{kind}', bedKindName(kind, locale))}
      description={tp('requestNotAHold', locale)}
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        data-testid="bed-request-sheet"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <Input
          label={tp('patientName', locale)}
          value={name}
          data-testid="request-name"
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <Input
          label={tp('mobileNumber', locale)}
          kind="phone"
          value={phone}
          helper={tp('requestMobileHelper', locale)}
          data-testid="request-phone"
          onChange={(event) => {
            setPhone(event.target.value);
          }}
          {...(tried && stored === null ? { error: tp('mobileInvalid', locale) } : {})}
        />
        <Input
          label={tp('age', locale)}
          kind="number"
          value={age}
          data-testid="request-age"
          onChange={(event) => {
            setAge(event.target.value);
          }}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="text-body-md text-ink-secondary">{tp('sex', locale)}</legend>
          <div className="flex gap-2">
            {(['male', 'female', 'other'] as const).map((value) => (
              <FilterChip
                key={value}
                selected={sex === value}
                onToggle={() => {
                  setSex(value);
                }}
              >
                {tp(value, locale)}
              </FilterChip>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-body-md text-ink-secondary">
            {tp('requestArrival', locale)}
          </legend>
          <div className="flex flex-wrap gap-2">
            {[30, 60, 120].map((minutes) => (
              <FilterChip
                key={minutes}
                selected={arrivalMinutes === minutes}
                onToggle={() => {
                  setArrivalMinutes(minutes);
                }}
              >
                {tp('requestArrivalIn', locale).replace(
                  '{minutes}',
                  formatNumber(minutes, numerals),
                )}
              </FilterChip>
            ))}
          </div>
        </fieldset>

        <Input
          label={tp('requestNote', locale)}
          value={note}
          data-testid="request-note"
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />

        {tried && !complete ? (
          <p className="text-body-sm text-alert-700" role="alert">
            {tp('requestFillAll', locale)}
          </p>
        ) : null}
        {phoneCheck === null ? null : (
          <GuestCodeCard
            phone={phone}
            demoCode={phoneCheck.demoCode}
            invalid={codeWrong}
            disabled={sending}
            onComplete={(code) => {
              void proveCode(code);
            }}
          />
        )}
        {failure === null ? null : (
          <p className="text-body-sm text-alert-700" role="alert" data-testid="request-failed">
            {failure}
          </p>
        )}

        <Button type="submit" size="lg" loading={sending} data-testid="request-send">
          {tp('requestSend', locale)}
        </Button>
      </form>
    </Sheet>
  );
}

function isStale(asOf: string | null, now: Date): boolean {
  if (asOf === null) return true;
  return now.getTime() - Date.parse(asOf) >= STALE_AFTER_MINUTES * 60_000;
}
