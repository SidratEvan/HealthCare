'use client';

/**
 * `S-A-07s` Search (`APP_FLOW.md` A3, `FR-PAT-16`–`18`).
 *
 * The screen the product's whole case rests on: a person says what they need
 * and sees which participating hospitals can provide it now. A need is one of
 * the three things hospitals publish live — a specialty, a kind of bed, an
 * emergency capability — or a name, of a doctor or a hospital.
 *
 * ## One card, and the line on it depends on what was asked
 *
 * Somebody looking for an ICU is not helped by how many cardiologists are
 * sitting. So a hospital's card leads with the figure that answers the
 * question: doctors and open serials for a specialty, free beds of that kind
 * for a bed, the capability and when it was confirmed for a capability. Every
 * one of them carries its age (`FR-PAT-14`), and a count nobody has confirmed
 * is said to be unconfirmed rather than shown as a number (`PRD.md` §3.2).
 *
 * ## Needs are offered, text is matched
 *
 * The chips are the needs the data holds; nothing else can be chosen
 * (`FR-PAT-18`). Typing matches names, and offers a need when what is typed
 * starts one of its names. The same table decides both here and on the server
 * (`@platform/domain` `search/needs`), so the chip a person is offered and the
 * way the API reads the same word cannot disagree.
 *
 * ## The four states (`GR-03`)
 *
 * Loading shows the shape of a result. Nothing found says so, and says it
 * differently for a name and for a need. A failed search offers to try again
 * and never borrows the empty state's words. Offline says a search needs a
 * connection, and leaves the chips where they are.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  SEARCH_BED_KINDS,
  SEARCH_CAPABILITIES,
  SPECIALTIES,
  needKey,
  parseNeed,
  suggestNeeds,
  confirmedTallyOfKind,
  type SearchNeed,
} from '@platform/domain';
import {
  bedKindName,
  capabilityName,
  districtName,
  formatAge,
  formatNumber,
  formatTaka,
  localName,
  numeralsFor,
  tp,
} from '@platform/i18n';
import type { Locale } from '@platform/i18n';
import { Button, Card, Chip, FreshnessLine, Input, useLocale } from '@platform/ui';

import { HospitalBeds } from '@/components/HospitalBeds';
import { ChevronIcon, HospitalIcon, StethoscopeIcon } from '@/components/icons';
import { TabScreen } from '@/components/TabScreen';
import { useDeployment } from '@/hooks/useDeployment';
import { useNow } from '@/hooks/useNow';
import { useOnline } from '@/hooks/useOnline';
import { searchNetwork, type SearchAnswer } from '@/lib/api';

import type { DoctorCard, HospitalCard } from '@/lib/types';
import type { ReactNode } from 'react';

type Results =
  | { readonly state: 'idle' }
  | { readonly state: 'loading' }
  | { readonly state: 'failed' }
  | { readonly state: 'ready'; readonly answer: SearchAnswer };

/** How long typing rests before the search is sent. */
const TYPING_PAUSE_MS = 300;

/** A need in the language on screen. */
function needName(need: SearchNeed, locale: Locale): string {
  switch (need.kind) {
    case 'specialty': {
      const specialty = SPECIALTIES.find((entry) => entry.code === need.code);
      return specialty === undefined
        ? need.code
        : localName(locale, specialty.nameBn, specialty.nameEn);
    }
    case 'bed':
      return bedKindName(need.bedKind, locale);
    case 'capability':
      return capabilityName(need.capability, locale);
  }
}

export default function SearchPage(): ReactNode {
  const locale = useLocale();
  const online = useOnline();
  const now = useNow();
  const scope = useDeployment()?.scope ?? null;

  const [text, setText] = useState('');
  const [need, setNeed] = useState<SearchNeed | null>(null);
  const [results, setResults] = useState<Results>({ state: 'idle' });
  /** False until the address has been read, so the first search is the right one. */
  const [ready, setReady] = useState(false);
  const latest = useRef(0);

  // Read after mount: the server has no `location`.
  useEffect(() => {
    const params = new URLSearchParams(globalThis.location.search);
    setText(params.get('q') ?? '');
    setNeed(parseNeed(params.get('need') ?? ''));
    setReady(true);
  }, []);

  const run = useCallback((query: { readonly q: string; readonly need: SearchNeed | null }) => {
    const ticket = ++latest.current;
    setResults({ state: 'loading' });

    void searchNetwork({ q: query.q, need: query.need === null ? null : needKey(query.need) })
      .then((answer) => {
        // A slower, older answer must not replace a newer one.
        if (ticket === latest.current) setResults({ state: 'ready', answer });
      })
      .catch(() => {
        if (ticket === latest.current) setResults({ state: 'failed' });
      });
  }, []);

  // Search when what is asked changes: at once for a chip, after a pause for
  // typing. The address follows, so a result can be reloaded and sent on.
  useEffect(() => {
    if (!ready) return;

    const params = new URLSearchParams();
    if (text.trim() !== '') params.set('q', text.trim());
    if (need !== null) params.set('need', needKey(need));
    const suffix = params.toString();
    globalThis.history.replaceState(null, '', suffix === '' ? '/search' : `/search?${suffix}`);

    if (!online) return;

    const timer = globalThis.setTimeout(
      () => {
        run({ q: text.trim(), need });
      },
      text.trim() === '' ? 0 : TYPING_PAUSE_MS,
    );
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [ready, text, need, online, run]);

  const offered = need === null ? suggestNeeds(text) : [];
  const asking = need !== null || text.trim() !== '';

  return (
    <TabScreen title={tp('searchPrompt', locale)}>
      <p className="-mt-3 text-body-md text-ink-secondary" data-testid="search-intro">
        {scope === null
          ? tp('searchIntro', locale)
          : tp('scopedIntro', locale).replace(
              '{hospital}',
              localName(locale, scope.nameBn, scope.nameEn),
            )}
      </p>

      <Input
        label={tp('searchLabel', locale)}
        helper={tp('searchHelper', locale)}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        // The screen exists to be typed into; a person who came from the
        // field on Home should not have to tap a second time.
        autoFocus
        autoComplete="off"
        enterKeyHint="search"
        data-testid="search-input"
      />

      {/* GR-03: offline. The chips stay; the search itself needs the network. */}
      {online ? null : (
        <p
          role="status"
          data-testid="search-offline"
          className="rounded-sm bg-alert-100 px-3 py-2 text-body-md text-alert-700"
        >
          {tp('searchOffline', locale)}
        </p>
      )}

      {need === null ? null : (
        <div className="flex flex-wrap items-center gap-2" data-testid="search-need">
          <span className="rounded-pill bg-brand-600 px-4 py-2 text-body-md font-semibold text-white">
            {needName(need, locale)}
          </span>
          <button
            type="button"
            onClick={() => {
              setNeed(null);
            }}
            data-testid="search-need-clear"
            className="min-h-touch rounded-pill border border-line-strong px-4 text-body-md text-ink"
          >
            {tp('searchClearNeed', locale)}
          </button>
        </div>
      )}

      {/* While typing: the needs this text could be the start of. */}
      {offered.length === 0 ? null : (
        <NeedRow
          needs={offered}
          onChoose={(chosen) => {
            setNeed(chosen);
            setText('');
          }}
          testId="search-suggestions"
        />
      )}

      {asking ? null : (
        <NeedGroups
          onChoose={(chosen) => {
            setNeed(chosen);
          }}
        />
      )}

      <ResultList
        results={results}
        need={need}
        text={text.trim()}
        now={now}
        onRetry={() => {
          run({ q: text.trim(), need });
        }}
      />
    </TabScreen>
  );
}

/** A row of need buttons. */
function NeedRow({
  needs,
  onChoose,
  testId,
}: {
  readonly needs: readonly SearchNeed[];
  readonly onChoose: (need: SearchNeed) => void;
  readonly testId?: string;
}): ReactNode {
  const locale = useLocale();
  return (
    <ul className="flex flex-wrap gap-2" data-testid={testId}>
      {needs.map((need) => (
        <li key={needKey(need)}>
          <button
            type="button"
            onClick={() => {
              onChoose(need);
            }}
            data-testid={`need-${needKey(need)}`}
            className="min-h-touch rounded-pill border border-line-strong bg-surface px-4 text-body-md text-ink"
          >
            {needName(need, locale)}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Every need the network can be asked for, in the three groups a person thinks
 * in: somebody to see, somewhere to be admitted, something only some hospitals
 * can treat.
 */
function NeedGroups({ onChoose }: { readonly onChoose: (need: SearchNeed) => void }): ReactNode {
  const locale = useLocale();
  const groups: readonly { readonly title: string; readonly needs: readonly SearchNeed[] }[] = [
    {
      title: tp('seeADoctor', locale),
      needs: SPECIALTIES.map((entry) => ({ kind: 'specialty', code: entry.code })),
    },
    {
      title: tp('searchGroupBeds', locale),
      needs: SEARCH_BED_KINDS.map((bedKind) => ({ kind: 'bed', bedKind })),
    },
    {
      title: tp('searchGroupCare', locale),
      needs: SEARCH_CAPABILITIES.map((capability) => ({ kind: 'capability', capability })),
    },
  ];

  return (
    <div className="flex flex-col gap-4" data-testid="search-needs">
      {groups.map((group) => (
        <section key={group.title} className="flex flex-col gap-2">
          <h2 className="text-title-sm">{group.title}</h2>
          <NeedRow needs={group.needs} onChoose={onChoose} />
        </section>
      ))}
    </div>
  );
}

function ResultList({
  results,
  need,
  text,
  now,
  onRetry,
}: {
  readonly results: Results;
  readonly need: SearchNeed | null;
  readonly text: string;
  readonly now: Date;
  readonly onRetry: () => void;
}): ReactNode {
  const locale = useLocale();

  if (results.state === 'idle') return null;

  if (results.state === 'loading') {
    // GR-03 loading: the shape of the answer, never a spinner.
    return (
      <div className="flex flex-col gap-3" aria-busy="true" data-testid="search-loading">
        <div className="h-28 rounded-md bg-sunken" />
        <div className="h-28 rounded-md bg-sunken" />
      </div>
    );
  }

  if (results.state === 'failed') {
    return (
      <div
        role="alert"
        data-testid="search-failed"
        className="flex flex-col gap-3 rounded-md border border-line bg-surface p-5"
      >
        <p className="text-body-md text-ink">{tp('searchFailed', locale)}</p>
        <Button variant="secondary" onClick={onRetry}>
          {tp('searchRetry', locale)}
        </Button>
      </div>
    );
  }

  const { answer } = results;
  // The need the server answered for: the one chosen, or the one the text
  // names ("ICU" typed is an ICU search).
  const shown = answer.need;

  if (answer.hospitals.length === 0 && answer.doctors.length === 0) {
    return (
      <p
        data-testid="search-empty"
        className="rounded-md border border-line bg-surface p-5 text-body-md text-ink-secondary"
      >
        {shown !== null && text === ''
          ? tp('searchNoneForNeed', locale).replace('{need}', needName(shown, locale))
          : tp('searchNoneForText', locale).replace('{text}', text)}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5" data-testid="search-results">
      {answer.hospitals.length === 0 ? null : (
        <section className="flex flex-col gap-3">
          <h2 className="font-reading text-title-md">
            {shown === null
              ? need === null && text === ''
                ? tp('searchAllHospitals', locale)
                : tp('searchHospitals', locale)
              : tp('searchHospitalsWith', locale).replace('{need}', needName(shown, locale))}
          </h2>

          {/* FR-PAT-14: who is sitting and what is open are live, so the list
              says when it was read. Beds and capabilities carry their own. */}
          <Age asOf={answer.asOf} now={now} />

          <ul className="flex flex-col gap-3">
            {answer.hospitals.map((hospital) => (
              <li key={hospital.id}>
                <HospitalResult hospital={hospital} need={shown} now={now} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {answer.doctors.length === 0 ? null : (
        <section className="flex flex-col gap-3">
          <h2 className="font-reading text-title-md">{tp('searchDoctors', locale)}</h2>
          <ul className="flex flex-col gap-3">
            {answer.doctors.map((doctor) => (
              <li key={doctor.id}>
                <DoctorResult doctor={doctor} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Age({ asOf, now }: { readonly asOf: string | null; readonly now: Date }): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  return (
    <FreshnessLine
      asOf={asOf === null ? null : new Date(asOf)}
      now={now}
      labels={{
        justNow: tp('updatedJustNow', locale),
        ago: tp('updatedAgo', locale),
        never: tp('updatedNever', locale),
        stale: tp('staleWarning', locale),
      }}
      formatMinutes={(value) => formatAge(value, locale, numerals)}
    />
  );
}

/**
 * One hospital, with the figure that answers what was asked and the one step
 * that follows from it.
 */
function HospitalResult({
  hospital,
  need,
  now,
}: {
  readonly hospital: HospitalCard;
  readonly need: SearchNeed | null;
  readonly now: Date;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);

  const tally = need?.kind === 'bed' ? confirmedTallyOfKind(hospital.beds, need.bedKind) : null;

  // Where the card leads: the next step for this need, at this hospital.
  const href =
    need?.kind === 'bed'
      ? `/beds?kind=${need.bedKind}`
      : need?.kind === 'specialty'
        ? `/book?specialty=${need.code}&hospital=${hospital.id}`
        : `/book?hospital=${hospital.id}`;
  const action =
    need?.kind === 'bed' ? tp('searchSeeBeds', locale) : tp('searchSeeDoctors', locale);

  const callNumber = hospital.emergencyPhone ?? hospital.phone ?? null;

  return (
    <Card tone={hospital.sittingNow > 0 && need?.kind !== 'bed' ? 'brand' : 'default'}>
      <div className="flex flex-col gap-3" data-testid={`result-hospital-${hospital.id}`}>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-brand-600">
            <HospitalIcon size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-title-sm">{localName(locale, hospital.nameBn, hospital.nameEn)}</p>
            <p className="text-body-sm text-ink-muted">
              {(locale === 'en' ? hospital.addressEn : hospital.addressBn) ??
                districtName(hospital.district, locale)}
            </p>
          </div>
        </div>

        {/* The answer to what was asked, first. */}
        {need?.kind === 'bed' ? (
          <div className="flex flex-col gap-1" data-testid="result-need-line">
            {tally === null ? (
              <Chip tone="neutral">
                {tp('searchBedUnconfirmed', locale).replace(
                  '{kind}',
                  bedKindName(need.bedKind, locale),
                )}
              </Chip>
            ) : (
              <Chip tone={tally.free > 0 ? 'positive' : 'neutral'}>
                {tp('searchBedFree', locale)
                  .replace('{kind}', bedKindName(need.bedKind, locale))
                  .replace('{free}', formatNumber(tally.free, numerals))
                  .replace('{total}', formatNumber(tally.total, numerals))}
              </Chip>
            )}
            <Age asOf={tally?.asOf ?? null} now={now} />
          </div>
        ) : null}

        {need?.kind === 'capability' ? (
          <div className="flex flex-col gap-1" data-testid="result-need-line">
            <Chip tone="positive">
              {tp('searchHasCapability', locale).replace(
                '{capability}',
                capabilityName(need.capability, locale),
              )}
            </Chip>
            <Age asOf={hospital.capabilityAsOf} now={now} />
          </div>
        ) : null}

        {need?.kind === 'bed' ? null : (
          <div className="flex flex-wrap items-center gap-2" data-testid="result-chamber-line">
            {hospital.doctorCount === null ? null : (
              <Chip tone="neutral">
                {tp('doctorsHere', locale).replace(
                  '{count}',
                  formatNumber(hospital.doctorCount, numerals),
                )}
              </Chip>
            )}
            {/* A11Y-03: the state is a sentence, not a colour. */}
            <Chip tone={hospital.sittingNow > 0 ? 'positive' : 'neutral'}>
              {hospital.sittingNow > 0
                ? tp('sittingNowCount', locale).replace(
                    '{count}',
                    formatNumber(hospital.sittingNow, numerals),
                  )
                : tp('nobodySittingNow', locale)}
            </Chip>
            <Chip tone={hospital.openSerialsToday > 0 ? 'positive' : 'neutral'}>
              {hospital.openSerialsToday > 0
                ? tp('serialsOpenToday', locale).replace(
                    '{count}',
                    formatNumber(hospital.openSerialsToday, numerals),
                  )
                : tp('searchNoOpenSerials', locale)}
            </Chip>
          </div>
        )}

        {/* FR-PAT-14: free beds and ICU, with their own age — except on a bed
            search, where the kind asked for is already the line above. */}
        {need?.kind === 'bed' ? null : <HospitalBeds beds={hospital.beds} now={now} />}

        <div className="flex flex-wrap gap-2">
          <a
            href={href}
            data-testid={`result-open-${hospital.id}`}
            className="flex min-h-touch flex-1 items-center justify-center gap-1 rounded-md bg-brand-600 px-4 text-body-lg font-semibold text-white"
          >
            {action}
            <ChevronIcon size={18} />
          </a>

          {/* A capability is an emergency's question, so the number to ring is
              on the card rather than a tap away. */}
          {need?.kind === 'capability' && callNumber !== null ? (
            <a
              href={`tel:${callNumber}`}
              data-testid={`result-call-${hospital.id}`}
              className="flex min-h-touch flex-1 items-center justify-center rounded-md border border-alert-600 px-4 text-body-lg font-semibold text-alert-700"
            >
              {tp('searchCall', locale)}
            </a>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/** A doctor, and each place they can be booked at. */
function DoctorResult({ doctor }: { readonly doctor: DoctorCard }): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);

  return (
    <Card>
      <div className="flex flex-col gap-3" data-testid={`result-doctor-${doctor.id}`}>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-brand-600">
            <StethoscopeIcon size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-title-sm">{localName(locale, doctor.nameBn, doctor.nameEn)}</p>
            {doctor.degrees === null ? null : (
              <p className="text-body-sm text-ink-muted">{doctor.degrees}</p>
            )}
          </div>
        </div>

        <ul className="flex flex-col gap-2">
          {doctor.chambers.map((chamber) => {
            const specialty = SPECIALTIES.find((entry) => entry.code === chamber.departmentCode);
            return (
              <li key={`${chamber.hospitalId}-${chamber.departmentCode}`}>
                <a
                  href={`/book?specialty=${chamber.departmentCode}&hospital=${chamber.hospitalId}&doctor=${doctor.id}`}
                  data-testid={`result-chamber-${doctor.id}-${chamber.hospitalId}`}
                  className="flex min-h-touch items-center justify-between gap-3 rounded-sm border border-line bg-surface px-4 py-3"
                >
                  <span className="min-w-0">
                    <span className="block text-body-md font-semibold">
                      {localName(locale, chamber.hospitalNameBn, chamber.hospitalNameEn)}
                    </span>
                    <span className="block text-body-sm text-ink-secondary">
                      {[
                        specialty === undefined
                          ? null
                          : localName(locale, specialty.nameBn, specialty.nameEn),
                        tp('searchFee', locale).replace(
                          '{fee}',
                          formatTaka(chamber.feePoisha, numerals),
                        ),
                      ]
                        .filter((part) => part !== null)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="shrink-0 text-body-md font-semibold text-brand-700">
                    {tp('bookHere', locale)}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}
