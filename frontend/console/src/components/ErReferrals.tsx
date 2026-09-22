'use client';

/**
 * Referrals on the ER console (`S-B-07`, `FR-EMG-07..09`).
 *
 *   - **`ReferSheet`** — `BTN-B07-REFER`: the refer-out search for somebody on
 *     the triage list, ranked from this hospital on what the case needs, and
 *     `BTN-B07-REFER-SEND-<hospitalId>` to send the summary.
 *   - **`IncomingReferrals`** — `LIST-B07-IN`: what other ERs are asking this
 *     one, with accept and decline, and the arrival once accepted.
 *   - **`ReferralLine`** — where the sending ER's own referral has got to, on
 *     the case's triage row, with `BTN-B07-REFER-CANCEL`.
 *   - **`ReferralsToday`** — every referral today, each with its timeline
 *     (`FR-EMG-08`: "the full timeline is recorded").
 *   - The two confirmations `GR-01` requires: declining a referral and
 *     withdrawing one. Each names its consequence; the safe option is on the
 *     left.
 *
 * Nothing here names anybody. A referral is a problem, a colour, an age and a
 * sex, and a note the sender was asked not to put a name in.
 */

import { useEffect, useState, type ReactNode } from 'react';

import {
  BED_KINDS,
  asksForSomething,
  defaultNeed,
  incomingOrder,
  isOpenReferral,
  referralCandidates,
  referralTimeline,
  REFERRAL_NOTE_MAX,
  type BedKind,
  type CapabilityKind,
  type EmergencyCaseView,
  type EmergencyNeed,
  type EmergencyProblem,
  type ReferralParty,
  type ReferralStep,
  type ReferralView,
} from '@platform/domain';
import {
  bedKindName,
  capabilityName,
  format,
  formatClock,
  formatNumber,
  formatPhone,
  problemName,
  t,
  type Locale,
} from '@platform/i18n';
import { Button, Chip, FilterChip, FreshnessLine, Input, Sheet, SheetActions } from '@platform/ui';

import { TriageChip, whoLine } from '@/components/ErCases';
import { NUMERALS } from '@/lib/bedCopy';

import type { SuggestedHospital } from '@/lib/emergency';

/**
 * What a referral may ask for. `FR-EMG-05`'s six, and the two the schema adds
 * that an ER refers for — a cath lab, an isolation room. A blood bank and an
 * ambulance are services, not a place to send somebody.
 */
const REFERRAL_CAPABILITIES: readonly CapabilityKind[] = [
  'burn_unit',
  'cardiac',
  'cath_lab',
  'stroke',
  'dialysis',
  'nicu',
  'trauma_ot',
  'isolation',
];

interface FreshnessCopy {
  readonly justNow: string;
  readonly ago: string;
  readonly never: string;
  readonly stale: string;
}

const STEP_KEY: Record<ReferralStep, Parameters<typeof format>[0]> = {
  sent: 'refStepSent',
  seen: 'refStepSeen',
  accepted: 'refStepAccepted',
  declined: 'refStepDeclined',
  arrived: 'refStepArrived',
  cancelled: 'refStepCancelled',
};

/** "বার্ন ইউনিট · বার্ন বেড" — what a referral asks for, in words. */
export function needLine(
  need: {
    readonly requiredCapability: CapabilityKind | null;
    readonly requiredBedKind: BedKind | null;
  },
  locale: Locale,
): string {
  const parts: string[] = [];
  if (need.requiredCapability !== null) parts.push(capabilityName(need.requiredCapability, locale));
  if (need.requiredBedKind !== null) {
    parts.push(format('erNeedBed', locale, { kind: bedKindName(need.requiredBedKind, locale) }));
  }
  return parts.join(' · ');
}

/** `FR-EMG-08`'s timeline, as one line: "পাঠানো 10:40 · দেখেছে 10:42 · রাজি 10:45". */
export function ReferralTimeline({
  referral,
  locale,
}: {
  readonly referral: ReferralView;
  readonly locale: Locale;
}): ReactNode {
  return (
    <ol
      className="flex flex-wrap gap-x-3 gap-y-1 text-caption tabular-nums text-ink-muted"
      data-testid={`er-referral-timeline-${referral.id}`}
      aria-label={t('erReferralsTodayTitle', locale)}
    >
      {referralTimeline(referral).map((entry) => (
        <li key={entry.step} data-step={entry.step}>
          {format(STEP_KEY[entry.step], locale, { time: formatClock(entry.at, NUMERALS) })}
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// BTN-B07-REFER and BTN-B07-REFER-SEND-<hospitalId> (FR-EMG-07, FR-EMG-08)
// ---------------------------------------------------------------------------

export function ReferSheet({
  entry,
  locale,
  connected,
  now,
  freshness,
  minutes,
  fetchResults,
  onSend,
  onClose,
}: {
  /** The case being referred; null when the sheet is closed. */
  readonly entry: EmergencyCaseView | null;
  readonly locale: Locale;
  readonly connected: boolean;
  readonly now: Date;
  readonly freshness: FreshnessCopy;
  readonly minutes: (value: number) => string;
  readonly fetchResults: (
    problem: EmergencyProblem,
    need: EmergencyNeed,
  ) => Promise<readonly SuggestedHospital[]>;
  readonly onSend: (input: {
    readonly entry: EmergencyCaseView;
    readonly to: ReferralParty;
    readonly need: EmergencyNeed;
    readonly note: string | null;
  }) => void;
  readonly onClose: () => void;
}): ReactNode {
  const [need, setNeed] = useState<EmergencyNeed>({ capability: null, bedKind: null });
  const [results, setResults] = useState<readonly SuggestedHospital[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [chosen, setChosen] = useState<SuggestedHospital | null>(null);
  const [note, setNote] = useState('');

  // Each case starts from its own problem's need, with nothing chosen.
  useEffect(() => {
    if (entry === null) return;
    setNeed(defaultNeed(entry.problem));
    setChosen(null);
    setNote('');
  }, [entry]);

  // The search is re-asked whenever the need changes. It needs the network:
  // other hospitals' figures are not something this console holds.
  useEffect(() => {
    if (entry === null || !connected || !asksForSomething(need)) {
      setResults(null);
      return;
    }
    let live = true;
    setResults(null);
    setFailed(false);
    fetchResults(entry.problem, need)
      .then((found) => {
        if (live) setResults(found);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [entry, need, connected, fetchResults, attempt]);

  if (entry === null) return null;

  const token = entry.tokenLabel ?? t('erTokenPending', locale);
  const { candidates, withoutCapability, withoutBeds } = referralCandidates(results ?? []);

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      variant="modal"
      title={
        chosen === null
          ? format('erReferTitle', locale, { token })
          : format('erReferConfirm', locale, { hospital: chosen.nameBn })
      }
      description={
        chosen === null
          ? t('erReferNeedHint', locale)
          : format('erReferConsequence', locale, { hospital: chosen.nameBn })
      }
    >
      <div className="flex flex-col gap-4 font-ui" data-testid="er-refer-sheet">
        <p className="flex flex-wrap items-center gap-2 text-body-sm text-ink-secondary">
          <Chip tone="alert">{problemName(entry.problem, locale)}</Chip>
          <TriageChip triage={entry.triage} locale={locale} />
          <span>{whoLine(entry, locale)}</span>
        </p>

        {chosen === null ? (
          <>
            <fieldset className="flex flex-col gap-2" data-testid="er-refer-capabilities">
              <legend className="text-caption text-ink-muted">
                {t('erReferCapability', locale)}
              </legend>
              <div className="flex flex-wrap gap-2">
                {REFERRAL_CAPABILITIES.map((kind) => (
                  <FilterChip
                    key={kind}
                    selected={need.capability === kind}
                    onToggle={() => {
                      setNeed({ ...need, capability: need.capability === kind ? null : kind });
                    }}
                  >
                    {capabilityName(kind, locale)}
                  </FilterChip>
                ))}
              </div>
            </fieldset>
            <fieldset className="flex flex-col gap-2" data-testid="er-refer-bedkinds">
              <legend className="text-caption text-ink-muted">{t('erReferBedKind', locale)}</legend>
              <div className="flex flex-wrap gap-2">
                {BED_KINDS.map((kind) => (
                  <FilterChip
                    key={kind}
                    selected={need.bedKind === kind}
                    onToggle={() => {
                      setNeed({ ...need, bedKind: need.bedKind === kind ? null : kind });
                    }}
                  >
                    {bedKindName(kind, locale)}
                  </FilterChip>
                ))}
              </div>
            </fieldset>

            <section
              aria-live="polite"
              className="flex flex-col gap-2"
              data-testid="er-refer-results"
            >
              <h3 className="text-body-sm font-semibold text-ink">{t('erReferResults', locale)}</h3>
              {!asksForSomething(need) ? (
                <p className="text-body-sm text-ink-secondary">{t('erReferNeedMissing', locale)}</p>
              ) : !connected ? (
                <p className="text-body-sm text-warn-700" data-testid="er-refer-offline">
                  {t('erReferNeedsConnection', locale)}
                </p>
              ) : failed ? (
                <div className="flex flex-col items-start gap-2">
                  <p role="alert" className="text-body-sm text-ink-secondary">
                    {t('loadFailed', locale)}
                  </p>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setAttempt((value) => value + 1);
                    }}
                  >
                    {t('retry', locale)}
                  </Button>
                </div>
              ) : results === null ? (
                <div className="h-24 rounded-sm bg-sunken" aria-busy="true" />
              ) : candidates.length === 0 ? (
                <p className="text-body-sm text-ink-secondary" data-testid="er-refer-empty">
                  {t('erReferEmpty', locale)}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {candidates.map((hospital) => (
                    <li
                      key={hospital.hospitalId}
                      data-testid={`er-refer-result-${hospital.hospitalId}`}
                      className="flex items-start justify-between gap-3 rounded-sm bg-sunken p-3"
                    >
                      <div className="min-w-0">
                        <p className="text-body-md text-ink">{hospital.nameBn}</p>
                        <p className="text-caption tabular-nums text-ink-secondary">
                          {[
                            hospital.distanceKm === null
                              ? null
                              : format('erDistanceKm', locale, {
                                  km: formatNumber(hospital.distanceKm, NUMERALS),
                                }),
                            hospital.travelMinutes === null
                              ? null
                              : format('erReferTravel', locale, {
                                  minutes: formatNumber(hospital.travelMinutes, NUMERALS),
                                }),
                            hospital.freeBeds === null
                              ? null
                              : format('erReferFreeBeds', locale, {
                                  count: formatNumber(hospital.freeBeds, NUMERALS),
                                }),
                            format('erLoad', locale, {
                              count: formatNumber(hospital.erLoad, NUMERALS),
                            }),
                          ]
                            .filter((part): part is string => part !== null)
                            .join(' · ')}
                        </p>
                        {/* FR-EMG-07: "with freshness shown" — every figure's age. */}
                        <FreshnessLine
                          asOf={
                            hospital.freshness.asOf === null
                              ? null
                              : new Date(hospital.freshness.asOf)
                          }
                          now={now}
                          staleAfterMinutes={hospital.staleAfterMinutes}
                          labels={freshness}
                          formatMinutes={minutes}
                        />
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Button
                          size="sm"
                          data-testid={`er-refer-send-${hospital.hospitalId}`}
                          onClick={() => {
                            setChosen(hospital);
                          }}
                        >
                          {t('erReferSend', locale)}
                        </Button>
                        {hospital.emergencyPhone === null ? null : (
                          <a
                            href={`tel:${hospital.emergencyPhone}`}
                            className="flex min-h-touch items-center px-2 text-caption text-brand-700 underline"
                          >
                            {formatPhone(hospital.emergencyPhone)}
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {/* What was passed over, and why — only the halves that happened. */}
              {results !== null && withoutCapability + withoutBeds > 0 ? (
                <p className="text-caption text-ink-muted" data-testid="er-refer-excluded">
                  {format('erReferExcluded', locale, {
                    reasons: [
                      withoutCapability === 0
                        ? null
                        : format('erReferExcludedCapability', locale, {
                            count: formatNumber(withoutCapability, NUMERALS),
                          }),
                      withoutBeds === 0
                        ? null
                        : format('erReferExcludedBeds', locale, {
                            count: formatNumber(withoutBeds, NUMERALS),
                          }),
                    ]
                      .filter((part): part is string => part !== null)
                      .join(', '),
                  })}
                </p>
              ) : null}
            </section>

            <SheetActions>
              <Button variant="quiet" onClick={onClose}>
                {t('goBack', locale)}
              </Button>
            </SheetActions>
          </>
        ) : (
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = note.trim();
              onSend({
                entry,
                to: {
                  hospitalId: chosen.hospitalId,
                  nameBn: chosen.nameBn,
                  nameEn: chosen.nameEn,
                  phone: chosen.emergencyPhone,
                },
                need,
                note: trimmed === '' ? null : trimmed,
              });
              onClose();
            }}
          >
            <p className="text-body-sm text-ink">
              {format('erIncomingAsks', locale, {
                need: needLine(
                  { requiredCapability: need.capability, requiredBedKind: need.bedKind },
                  locale,
                ),
              })}
            </p>
            <Input
              label={t('erReferNote', locale)}
              helper={t('erReferNoteHint', locale)}
              density="console"
              value={note}
              maxLength={REFERRAL_NOTE_MAX}
              data-testid="er-refer-note"
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
            <SheetActions>
              <Button type="submit" data-testid="er-refer-confirm">
                {t('erReferSend', locale)}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setChosen(null);
                }}
              >
                {t('goBack', locale)}
              </Button>
            </SheetActions>
          </form>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// LIST-B07-IN (FR-EMG-09)
// ---------------------------------------------------------------------------

export function IncomingReferrals({
  referrals,
  hospitalId,
  newIds,
  pendingIds,
  locale,
  onSeen,
  onAccept,
  onDecline,
  onArrive,
}: {
  readonly referrals: readonly ReferralView[];
  readonly hospitalId: string;
  readonly newIds: ReadonlySet<string>;
  readonly pendingIds: ReadonlySet<string>;
  readonly locale: Locale;
  readonly onSeen: (referralId: string) => void;
  readonly onAccept: (referral: ReferralView) => void;
  readonly onDecline: (referral: ReferralView) => void;
  readonly onArrive: (referral: ReferralView) => void;
}): ReactNode {
  const open = incomingOrder(
    referrals.filter((entry) => entry.to.hospitalId === hospitalId && isOpenReferral(entry.state)),
  );

  if (open.length === 0) {
    return (
      <div data-testid="er-incoming-empty">
        <p className="text-body-md text-ink-secondary">{t('erIncomingEmpty', locale)}</p>
        <p className="text-caption text-ink-muted">{t('erIncomingEmptyHint', locale)}</p>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
      {open.map((referral) => {
        const isNew = newIds.has(referral.id);
        const accepted = referral.state === 'accepted';
        return (
          <li key={referral.id}>
            <article
              data-testid={`er-incoming-${referral.id}`}
              data-state={referral.state}
              data-new={isNew ? 'true' : 'false'}
              // Unanswered, it is the emergency colour, as an alert is: a person
              // is waiting in another ER on this answer.
              className={
                accepted
                  ? 'flex flex-col gap-3 rounded-md border border-line bg-surface p-4 font-ui'
                  : 'flex flex-col gap-3 rounded-md border-2 border-alert-600 bg-alert-100 p-4 font-ui'
              }
              onPointerDown={() => {
                onSeen(referral.id);
              }}
              onFocus={() => {
                onSeen(referral.id);
              }}
            >
              <div>
                <p className="font-reading text-title-md text-ink">
                  {format('erIncomingFrom', locale, { hospital: referral.from.nameBn })}
                  {isNew ? (
                    <span className="ml-2 align-middle">
                      <Chip tone="alert">{t('erNewAlert', locale)}</Chip>
                    </span>
                  ) : null}
                </p>
                <p className="text-body-sm text-ink">
                  {format('erIncomingAsks', locale, { need: needLine(referral, locale) })}
                </p>
              </div>

              <p className="flex flex-wrap items-center gap-2 text-body-sm text-ink-secondary">
                <Chip tone="alert">{problemName(referral.summary.problem, locale)}</Chip>
                <TriageChip triage={referral.summary.triage} locale={locale} />
                <span>{whoLine(referral.summary, locale)}</span>
              </p>
              {referral.summary.note === null ? null : (
                <p className="text-body-sm text-ink" data-testid="er-incoming-note">
                  {referral.summary.note}
                </p>
              )}
              <ReferralTimeline referral={referral} locale={locale} />

              <div className="flex flex-wrap items-center gap-2">
                {accepted ? (
                  <Button
                    size="sm"
                    data-testid={`er-incoming-arrived-${referral.id}`}
                    onClick={() => {
                      onArrive(referral);
                    }}
                  >
                    {t('erIncomingArrived', locale)}
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="emergency"
                      data-testid={`er-incoming-accept-${referral.id}`}
                      onClick={() => {
                        onAccept(referral);
                      }}
                    >
                      {t('erIncomingAccept', locale)}
                    </Button>
                    <Button
                      size="sm"
                      variant="quiet"
                      data-testid={`er-incoming-decline-${referral.id}`}
                      onClick={() => {
                        onDecline(referral);
                      }}
                    >
                      {t('erIncomingDecline', locale)}
                    </Button>
                  </>
                )}
                {/* The sending ER's desk, to talk it through before answering. */}
                {referral.from.phone === null ? null : (
                  <a
                    href={`tel:${referral.from.phone}`}
                    title={formatPhone(referral.from.phone)}
                    className="flex min-h-touch items-center rounded-sm px-2 text-body-sm text-brand-700 underline"
                  >
                    {t('erCall', locale)}
                  </a>
                )}
                {pendingIds.has(referral.id) ? (
                  <span className="text-caption text-ink-muted">{t('bedPendingSync', locale)}</span>
                ) : null}
              </div>
              {accepted ? (
                <p className="text-caption text-ink-muted">
                  {format('erIncomingArrivedHint', locale, { hospital: referral.from.nameBn })}
                </p>
              ) : null}
            </article>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// The sending ER's own referral, on the case's triage row
// ---------------------------------------------------------------------------

/**
 * The latest referral this ER sent for a case, or null. An open one holds the
 * case; a declined one is shown until another is sent, so the coordinator
 * knows to try elsewhere.
 */
export function latestReferralOf(
  referrals: readonly ReferralView[],
  caseId: string,
  hospitalId: string,
): ReferralView | null {
  let latest: ReferralView | null = null;
  for (const referral of referrals) {
    if (referral.emergencyCaseId !== caseId || referral.from.hospitalId !== hospitalId) continue;
    if (latest === null || referral.sentAt > latest.sentAt) latest = referral;
  }
  return latest;
}

export function ReferralLine({
  referral,
  pending,
  locale,
  onCancel,
}: {
  readonly referral: ReferralView;
  readonly pending: boolean;
  readonly locale: Locale;
  readonly onCancel: (referral: ReferralView) => void;
}): ReactNode {
  const open = isOpenReferral(referral.state);
  return (
    <div
      className="flex flex-wrap items-start justify-between gap-3 rounded-sm bg-sunken px-3 py-2 font-ui"
      data-testid={`er-referral-${referral.emergencyCaseId ?? referral.id}`}
      data-state={referral.state}
    >
      <div className="min-w-0">
        <p className="text-body-sm text-ink">
          {referral.state === 'declined'
            ? format('erReferralDeclinedBy', locale, {
                hospital: referral.to.nameBn,
                reason: referral.declineReason ?? '',
              })
            : format('erReferralTo', locale, { hospital: referral.to.nameBn })}
        </p>
        {referral.state === 'accepted' ? (
          <p className="text-caption text-brand-700">
            {format('erReferralOnTheWay', locale, { hospital: referral.to.nameBn })}
          </p>
        ) : null}
        <ReferralTimeline referral={referral} locale={locale} />
        {pending ? (
          <span className="text-caption text-ink-muted">{t('bedPendingSync', locale)}</span>
        ) : null}
      </div>
      {open ? (
        <Button
          size="sm"
          variant="quiet"
          data-testid={`er-refer-cancel-${referral.emergencyCaseId ?? referral.id}`}
          onClick={() => {
            onCancel(referral);
          }}
        >
          {t('erReferralCancel', locale)}
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Today's referrals, each with its timeline (FR-EMG-08)
// ---------------------------------------------------------------------------

export function ReferralsToday({
  referrals,
  hospitalId,
  locale,
}: {
  readonly referrals: readonly ReferralView[];
  readonly hospitalId: string;
  readonly locale: Locale;
}): ReactNode {
  const today = [...referrals].sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1));
  return (
    <section
      aria-labelledby="er-referrals-today-title"
      data-testid="er-referrals-today"
      className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4 font-ui"
    >
      <h2 id="er-referrals-today-title" className="text-title-sm text-ink">
        {t('erReferralsTodayTitle', locale)}
      </h2>
      {today.length === 0 ? (
        <p className="text-body-sm text-ink-secondary">{t('erReferralsTodayEmpty', locale)}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {today.map((referral) => {
            const outgoing = referral.from.hospitalId === hospitalId;
            return (
              <li
                key={referral.id}
                data-testid={`er-today-${referral.id}`}
                data-state={referral.state}
                className="flex flex-col gap-1 border-t border-line pt-2 first:border-t-0 first:pt-0"
              >
                <p className="text-body-sm text-ink">
                  {outgoing
                    ? format('erReferralOut', locale, { hospital: referral.to.nameBn })
                    : format('erReferralIn', locale, { hospital: referral.from.nameBn })}
                </p>
                <p className="text-caption text-ink-secondary">
                  {[
                    problemName(referral.summary.problem, locale),
                    needLine(referral, locale),
                    referral.arrivedTokenLabel,
                  ]
                    .filter((part): part is string => part !== null && part !== '')
                    .join(' · ')}
                </p>
                <ReferralTimeline referral={referral} locale={locale} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// GR-01: declining a referral, withdrawing one
// ---------------------------------------------------------------------------

export function ReferralDeclineSheet({
  referral,
  locale,
  onClose,
  onDecline,
}: {
  readonly referral: ReferralView | null;
  readonly locale: Locale;
  readonly onClose: () => void;
  readonly onDecline: (referral: ReferralView, reason: string) => void;
}): ReactNode {
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);

  useEffect(() => {
    setReason('');
    setTried(false);
  }, [referral]);

  if (referral === null) return null;
  const blank = reason.trim() === '';

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      variant="modal"
      title={t('erDeclineTitle', locale)}
      description={format('erIncomingDeclineConsequence', locale, {
        hospital: referral.from.nameBn,
      })}
    >
      <form
        className="flex flex-col gap-4 font-ui"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setTried(true);
          if (blank) return;
          onDecline(referral, reason.trim());
          onClose();
        }}
      >
        <Input
          label={t('erDeclineReasonLabel', locale)}
          density="console"
          value={reason}
          maxLength={300}
          data-testid="er-incoming-decline-reason"
          onChange={(event) => {
            setReason(event.target.value);
          }}
          {...(tried && blank ? { error: t('erDeclineTitle', locale) } : {})}
        />
        <SheetActions destructive>
          <Button type="submit" variant="danger-quiet" data-testid="er-incoming-decline-confirm">
            {t('erDeclineConfirm', locale)}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('goBack', locale)}
          </Button>
        </SheetActions>
      </form>
    </Sheet>
  );
}

export function ReferralCancelSheet({
  referral,
  locale,
  onClose,
  onCancel,
}: {
  readonly referral: ReferralView | null;
  readonly locale: Locale;
  readonly onClose: () => void;
  readonly onCancel: (referral: ReferralView) => void;
}): ReactNode {
  if (referral === null) return null;
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      variant="modal"
      dismissible={false}
      title={format('erReferralCancelConfirm', locale, { hospital: referral.to.nameBn })}
      description={format('erReferralCancelConsequence', locale, {
        hospital: referral.to.nameBn,
      })}
    >
      <SheetActions destructive>
        <Button
          variant="danger-quiet"
          data-testid="er-refer-cancel-confirm"
          onClick={() => {
            onCancel(referral);
            onClose();
          }}
        >
          {t('erReferralCancel', locale)}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {t('goBack', locale)}
        </Button>
      </SheetActions>
    </Sheet>
  );
}
