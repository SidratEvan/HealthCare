'use client';

/**
 * `S-A-07s` Search (`APP_FLOW.md` A3, `FR-PAT-16`–`18`), the খুঁজুন tab.
 *
 * The screen the product's whole case rests on: a person says what they need
 * and sees which participating hospitals can provide it now. A need is one of
 * the three things hospitals publish live — a specialty, a kind of bed, an
 * emergency capability — or a name, of a doctor or a hospital.
 *
 * ## Visual Direction 2 (FRONTEND.md §0.5, 2026-10-07)
 *
 * Titled ডাক্তার খুঁজুন. On arrival the eight specialties are one row of chips
 * first, then beds and special care. When an answer holds both doctors and
 * hospitals, a two-way switch shows one list at a time: doctors first for a
 * specialty or a name, hospitals first for a bed or a capability. A doctor is
 * a letter avatar, never a photo, and carries no rating.
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
import { Button, Chip, FreshnessLine, useLocale } from '@platform/ui';

import { HospitalBeds } from '@/components/HospitalBeds';
import { HospitalMark } from '@/components/HospitalMark';
import { ChevronIcon, CloseIcon, HospitalIcon, PhoneIcon, SearchIcon } from '@/components/icons';
import { Monogram } from '@/components/Monogram';
import { NotShared, withholds } from '@/components/NotShared';
import { Segmented } from '@/components/Segmented';
import { EmptyState, FailedState, OfflineNotice, Panel, SkeletonCards } from '@/components/States';
import { TabScreen } from '@/components/TabScreen';
import { useDeployment } from '@/hooks/useDeployment';
import { useNow } from '@/hooks/useNow';
import { useOnline } from '@/hooks/useOnline';
import { searchNetwork, type SearchAnswer } from '@/lib/api';
import { doctorName } from '@/lib/doctor';

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

  // The title says what this screen is for; a bed is not a doctor.
  const title =
    need?.kind === 'bed'
      ? tp('bedsTitle', locale)
      : need?.kind === 'capability'
        ? tp('searchPrompt', locale)
        : tp('homeFindDoctor', locale);

  return (
    <TabScreen title={title}>
      {/* Inside a hospital's own app the screen says whose it is (FR-PAT-19). */}
      {scope === null ? null : (
        <p className="-mt-2 text-body-md text-ink-secondary" data-testid="search-intro">
          {tp('scopedIntro', locale).replace(
            '{hospital}',
            localName(locale, scope.nameBn, scope.nameEn),
          )}
        </p>
      )}

      <label className="flex min-h-[56px] items-center gap-3 rounded-md border border-line bg-surface px-4 shadow-1 focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-100">
        <span className="text-brand-600">
          <SearchIcon size={22} />
        </span>
        <span className="sr-only">{tp('searchFieldLabel', locale)}</span>
        <input
          type="search"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
          placeholder={tp(scope === null ? 'homeSearchField' : 'scopedSearch', locale)}
          // The screen exists to be typed into; a person who came from the
          // field on Home should not have to tap a second time.
          autoFocus
          autoComplete="off"
          enterKeyHint="search"
          data-testid="search-input"
          className="h-[54px] min-w-0 flex-1 bg-transparent text-body-md text-ink outline-none placeholder:text-ink-muted"
        />
      </label>

      {/* GR-03: offline. The chips stay; the search itself needs the network. */}
      {online ? null : (
        <OfflineNotice testId="search-offline">{tp('searchOffline', locale)}</OfflineNotice>
      )}

      {need === null ? null : (
        <div className="flex flex-wrap items-center gap-2" data-testid="search-need">
          <span className="inline-flex min-h-[40px] items-center gap-1 rounded-pill bg-brand-600 pr-1 pl-4 text-body-sm font-semibold text-white">
            {needName(need, locale)}
            <button
              type="button"
              onClick={() => {
                setNeed(null);
              }}
              data-testid="search-need-clear"
              aria-label={tp('searchClearNeedLabel', locale).replace(
                '{need}',
                needName(need, locale),
              )}
              className="flex size-8 items-center justify-center rounded-pill hover:bg-brand-700"
            >
              <CloseIcon size={16} />
            </button>
          </span>
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
          wrap
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

/**
 * A row of need chips. One line that scrolls sideways, as on the approved
 * board, so a group never pushes the results down the screen; `wrap` for the
 * suggestions, which are few.
 */
function NeedRow({
  needs,
  onChoose,
  testId,
  wrap = false,
}: {
  readonly needs: readonly SearchNeed[];
  readonly onChoose: (need: SearchNeed) => void;
  readonly testId?: string;
  readonly wrap?: boolean;
}): ReactNode {
  const locale = useLocale();
  return (
    <ul
      className={
        wrap
          ? 'flex flex-wrap gap-2'
          : '-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [-webkit-mask-image:linear-gradient(90deg,black_85%,transparent)] [mask-image:linear-gradient(90deg,black_85%,transparent)]'
      }
      data-testid={testId}
    >
      {needs.map((need) => (
        <li key={needKey(need)} className="shrink-0">
          <button
            type="button"
            onClick={() => {
              onChoose(need);
            }}
            data-testid={`need-${needKey(need)}`}
            className="min-h-[40px] rounded-pill border border-line-strong bg-surface px-4 text-body-sm font-semibold whitespace-nowrap text-ink-secondary hover:border-brand-600 hover:text-brand-700"
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
 * can treat. Specialties first: this is the doctor screen.
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
          <h2 className="text-body-sm font-semibold text-ink-muted">{group.title}</h2>
          <NeedRow needs={group.needs} onChoose={onChoose} />
        </section>
      ))}
    </div>
  );
}

type View = 'doctors' | 'hospitals';

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
  const numerals = numeralsFor(locale);
  const [chosen, setChosen] = useState<View | null>(null);

  // A new question starts on its own default view.
  const asked = `${need === null ? '' : needKey(need)}|${text}`;
  const [lastAsked, setLastAsked] = useState(asked);
  if (asked !== lastAsked) {
    setLastAsked(asked);
    setChosen(null);
  }

  if (results.state === 'idle') return null;

  if (results.state === 'loading') {
    // GR-03 loading: the shape of the answer, never a spinner.
    return <SkeletonCards count={2} testId="search-loading" />;
  }

  if (results.state === 'failed') {
    return (
      <FailedState
        testId="search-failed"
        action={
          <Button variant="secondary" onClick={onRetry}>
            {tp('searchRetry', locale)}
          </Button>
        }
      >
        {tp('searchFailed', locale)}
      </FailedState>
    );
  }

  const { answer } = results;
  // The need the server answered for: the one chosen, or the one the text
  // names ("ICU" typed is an ICU search).
  const shown = answer.need;

  if (answer.hospitals.length === 0 && answer.doctors.length === 0) {
    return (
      <EmptyState testId="search-empty" icon={<SearchIcon size={24} />}>
        {shown !== null && text === ''
          ? tp('searchNoneForNeed', locale).replace('{need}', needName(shown, locale))
          : tp('searchNoneForText', locale).replace('{text}', text)}
      </EmptyState>
    );
  }

  const both = answer.hospitals.length > 0 && answer.doctors.length > 0;
  // Doctors first for a specialty or a name; hospitals for a bed or a
  // capability, where the hospital is the answer.
  const preferred: View =
    shown === null
      ? text === ''
        ? 'hospitals'
        : 'doctors'
      : shown.kind === 'specialty'
        ? 'doctors'
        : 'hospitals';
  const view: View = both
    ? (chosen ?? preferred)
    : answer.doctors.length > 0
      ? 'doctors'
      : 'hospitals';

  return (
    <div className="flex flex-col gap-4" data-testid="search-results">
      {both ? (
        <Segmented<View>
          label={tp('searchResultKinds', locale)}
          value={view}
          onChange={setChosen}
          options={[
            {
              value: 'doctors',
              label: tp('searchTabDoctors', locale).replace(
                '{count}',
                formatNumber(answer.doctors.length, numerals),
              ),
              testId: 'search-tab-doctors',
              controls: 'search-panel-doctors',
            },
            {
              value: 'hospitals',
              label: tp('searchTabHospitals', locale).replace(
                '{count}',
                formatNumber(answer.hospitals.length, numerals),
              ),
              testId: 'search-tab-hospitals',
              controls: 'search-panel-hospitals',
            },
          ]}
        />
      ) : null}

      {view === 'hospitals' ? (
        <section
          id="search-panel-hospitals"
          role={both ? 'tabpanel' : undefined}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 className="text-title-sm font-bold">
              {shown === null
                ? need === null && text === ''
                  ? tp('searchAllHospitals', locale)
                  : tp('searchHospitals', locale)
                : tp('searchHospitalsWith', locale).replace('{need}', needName(shown, locale))}
            </h2>
            {/* FR-PAT-14: who is sitting and what is open are live, so the list
                says when it was read. Beds and capabilities carry their own. */}
            <Age asOf={answer.asOf} now={now} />
          </div>

          <ul className="flex flex-col gap-3">
            {answer.hospitals.map((hospital) => (
              <li key={hospital.id}>
                <HospitalResult hospital={hospital} need={shown} now={now} />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section
          id="search-panel-doctors"
          role={both ? 'tabpanel' : undefined}
          className="flex flex-col gap-3"
        >
          <h2 className="sr-only">{tp('searchDoctors', locale)}</h2>
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
  // It has beds and keeps the figure: said as that, not as "unconfirmed"
  // and never as none (FR-NET-04).
  const bedsWithheld = withholds(hospital, 'beds');

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
    <Panel className="p-4">
      <div className="flex flex-col gap-3" data-testid={`result-hospital-${hospital.id}`}>
        <div className="flex items-start gap-3">
          <HospitalMark hospitalId={hospital.id} logoVersion={hospital.logoVersion} />
          <div className="min-w-0 flex-1">
            <p className="text-title-sm font-bold">
              {localName(locale, hospital.nameBn, hospital.nameEn)}
            </p>
            <p className="text-body-sm text-ink-muted">
              {(locale === 'en' ? hospital.addressEn : hospital.addressBn) ??
                districtName(hospital.district, locale)}
            </p>
          </div>
        </div>

        {/* The answer to what was asked, first. */}
        {need?.kind === 'bed' ? (
          <div className="flex flex-col gap-1" data-testid="result-need-line">
            {bedsWithheld ? (
              <NotShared figure="beds" />
            ) : tally === null ? (
              <Chip tone="caution">
                {tp('searchBedUnconfirmed', locale).replace(
                  '{kind}',
                  bedKindName(need.bedKind, locale),
                )}
              </Chip>
            ) : (
              <p className="flex items-baseline gap-1.5">
                <span
                  className={`text-title-lg font-extrabold tabular-nums ${
                    tally.free > 0 ? 'text-brand-600' : 'text-ink-muted'
                  }`}
                >
                  {formatNumber(tally.free, numerals)}
                </span>
                <span className="text-body-sm text-ink-secondary">
                  {tp('searchBedFree', locale)
                    .replace('{kind}', bedKindName(need.bedKind, locale))
                    .replace('{free}', formatNumber(tally.free, numerals))
                    .replace('{total}', formatNumber(tally.total, numerals))}
                </span>
              </p>
            )}
            {/* No age under a figure that is not there. */}
            {bedsWithheld ? null : <Age asOf={tally?.asOf ?? null} now={now} />}
          </div>
        ) : null}

        {need?.kind === 'capability' ? (
          <div className="flex flex-col gap-1" data-testid="result-need-line">
            <span className="self-start">
              <Chip tone="positive">
                {tp('searchHasCapability', locale).replace(
                  '{capability}',
                  capabilityName(need.capability, locale),
                )}
              </Chip>
            </span>
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
            {/* A11Y-03: the state is a sentence, not a colour. Both figures
                are one decision of the hospital's (FR-NET-04): where it keeps
                them the line says so once, and neither reads as none. */}
            {hospital.sittingNow === null || hospital.openSerialsToday === null ? (
              withholds(hospital, 'serials') ? (
                <NotShared figure="serials" />
              ) : null
            ) : (
              <>
                <Chip tone={hospital.sittingNow > 0 ? 'positive' : 'neutral'}>
                  {hospital.sittingNow > 0
                    ? tp('sittingNowCount', locale).replace(
                        '{count}',
                        formatNumber(hospital.sittingNow, numerals),
                      )
                    : tp('nobodySittingNow', locale)}
                </Chip>
                <Chip tone="neutral">
                  {hospital.openSerialsToday > 0
                    ? tp('serialsOpenToday', locale).replace(
                        '{count}',
                        formatNumber(hospital.openSerialsToday, numerals),
                      )
                    : tp('searchNoOpenSerials', locale)}
                </Chip>
              </>
            )}
          </div>
        )}

        {/* FR-PAT-14: free beds and ICU, with their own age — except on a bed
            search, where the kind asked for is already the line above. */}
        {need?.kind === 'bed' ? null : (
          <HospitalBeds beds={hospital.beds} notShared={bedsWithheld} now={now} />
        )}

        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <a
            href={href}
            data-testid={`result-open-${hospital.id}`}
            className="flex min-h-touch flex-1 items-center justify-center gap-1 rounded-sm bg-brand-600 px-4 text-body-md font-bold text-white"
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
              className="flex min-h-touch flex-1 items-center justify-center gap-2 rounded-sm border border-alert-600 bg-surface px-4 text-body-md font-bold text-alert-700"
            >
              <PhoneIcon size={18} />
              {tp('searchCall', locale)}
            </a>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

/**
 * A doctor: a letter avatar, the name and degrees, and each place they can be
 * booked at with its fee and a way to book there. No photograph and no rating
 * (FRONTEND.md §0.5): the network holds neither, and neither is invented.
 */
function DoctorResult({ doctor }: { readonly doctor: DoctorCard }): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);

  return (
    <Panel className="p-4">
      <div className="flex flex-col gap-3" data-testid={`result-doctor-${doctor.id}`}>
        <div className="flex items-start gap-3">
          <Monogram name={localName(locale, doctor.nameBn, doctor.nameEn)} />
          <div className="min-w-0 flex-1">
            <p className="text-title-sm font-bold">
              {doctorName(locale, doctor.nameBn, doctor.nameEn)}
            </p>
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
                  className="flex min-h-touch items-center justify-between gap-3 border-t border-line pt-3"
                >
                  <span className="flex min-w-0 items-start gap-2">
                    <span className="mt-0.5 text-ink-muted">
                      <HospitalIcon size={16} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-body-sm font-semibold text-ink">
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
                  </span>
                  <span className="flex min-h-[40px] shrink-0 items-center rounded-sm bg-brand-600 px-4 text-body-sm font-bold text-white">
                    {tp('bookHere', locale)}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </Panel>
  );
}
