'use client';

/**
 * The two halves of `S-B-07`'s middle: the alerts (`CARD-B07-<caseId>`) and
 * the triage list (`TBL-B07-TRIAGE`).
 *
 * Neither names anybody. A case is its problem, its colour, an age and a sex
 * if given, and a token once it is here. The one identifying thing — the
 * number a family left — is fetched when "ফোন করুন" is tapped, and that read
 * is audited on the server (`DB-P7`).
 */

import { Fragment, useState, type ReactNode } from 'react';

import {
  expectedArrival,
  isOpenReferral,
  type EmergencyCaseView,
  type ReferralView,
  type TriageColor,
} from '@platform/domain';
import {
  bedKindName,
  format,
  formatClock,
  formatNumber,
  formatPhone,
  problemName,
  t,
  triageName,
  type Locale,
  numeralsFor,
} from '@platform/i18n';
import { Button, Chip, type ChipTone } from '@platform/ui';

import { ReferralLine } from '@/components/ErReferrals';

import type { CaseCommand } from '@/hooks/useEmergencyConsole';

const TRIAGE_TONE: Record<TriageColor, ChipTone> = {
  red: 'alert',
  yellow: 'caution',
  green: 'positive',
};

/** A triage colour, always as a word inside its colour (never colour alone). */
export function TriageChip({
  triage,
  locale,
}: {
  readonly triage: TriageColor | null;
  readonly locale: Locale;
}): ReactNode {
  return triage === null ? (
    <Chip tone="neutral">{t('erUntriaged', locale)}</Chip>
  ) : (
    <Chip tone={TRIAGE_TONE[triage]}>{triageName(triage, locale)}</Chip>
  );
}

/** "34 বছর · পুরুষ", or that nobody said. A case, or a referral's summary of one. */
export function whoLine(
  entry: Pick<EmergencyCaseView, 'ageYears' | 'sex'>,
  locale: Locale,
): string {
  const sex =
    entry.sex === null
      ? null
      : t(
          entry.sex === 'male' ? 'sexMale' : entry.sex === 'female' ? 'sexFemale' : 'sexOther',
          locale,
        );
  if (entry.ageYears === null && sex === null) return t('erNoDetails', locale);
  if (entry.ageYears === null) return sex ?? '';
  const age = format('ageYears', locale, {
    age: formatNumber(entry.ageYears, numeralsFor(locale)),
  });
  return sex === null ? age : `${age} · ${sex}`;
}

/**
 * The family's number, fetched on purpose and shown with a `tel:` link.
 *
 * Two steps rather than a number printed on every card: a screen a whole ER
 * can see is not where a stranger's phone number should sit by default.
 */
export function CallButton({
  entry,
  locale,
  connected,
  fetchPhone,
}: {
  readonly entry: EmergencyCaseView;
  readonly locale: Locale;
  readonly connected: boolean;
  readonly fetchPhone: (caseId: string) => Promise<string | null>;
}): ReactNode {
  const [phone, setPhone] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!entry.hasPhone) {
    return <span className="text-caption text-ink-muted">{t('erNoPhone', locale)}</span>;
  }

  if (phone !== null) {
    return (
      <a
        href={`tel:${phone}`}
        data-testid={`er-phone-${entry.id}`}
        className="flex min-h-touch items-center rounded-sm px-2 font-ui text-body-sm text-brand-700 underline"
      >
        {formatPhone(phone)}
      </a>
    );
  }

  return (
    <div className="flex flex-col">
      <Button
        size="sm"
        variant="quiet"
        loading={busy}
        data-testid={`er-call-${entry.id}`}
        {...(connected
          ? {}
          : { disabled: true as const, disabledReason: t('erCallFailed', locale) })}
        onClick={() => {
          setBusy(true);
          setFailed(false);
          void fetchPhone(entry.id)
            .then((found) => {
              setPhone(found);
            })
            .catch(() => {
              setFailed(true);
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        {t('erCall', locale)}
      </Button>
      {failed ? (
        <span role="alert" className="text-caption text-alert-700">
          {t('erCallFailed', locale)}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CARD-B07-<caseId>
// ---------------------------------------------------------------------------

export function InboundCard({
  entry,
  isNew,
  pending,
  locale,
  connected,
  onCommand,
  onDecline,
  onSeen,
  fetchPhone,
}: {
  readonly entry: EmergencyCaseView;
  readonly isNew: boolean;
  readonly pending: boolean;
  readonly locale: Locale;
  readonly connected: boolean;
  readonly onCommand: (command: CaseCommand) => void;
  readonly onDecline: () => void;
  readonly onSeen: () => void;
  readonly fetchPhone: (caseId: string) => Promise<string | null>;
}): ReactNode {
  const numerals = numeralsFor(locale);
  const arrival = expectedArrival(entry);
  const acknowledged = entry.state === 'acknowledged';

  return (
    <article
      data-testid={`er-inbound-${entry.id}`}
      data-state={entry.state}
      data-new={isNew ? 'true' : 'false'}
      // The visual half of "audible + visual": an unanswered alert is the
      // emergency colour until somebody answers it (`FR-EMG-01`).
      className={
        acknowledged
          ? 'flex flex-col gap-3 rounded-md border border-line bg-surface p-4 font-ui'
          : 'flex flex-col gap-3 rounded-md border-2 border-alert-600 bg-alert-100 p-4 font-ui'
      }
      onPointerDown={onSeen}
      onFocus={onSeen}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-reading text-title-md text-ink">
            {problemName(entry.problem, locale)}
            {isNew ? (
              <span className="ml-2 align-middle">
                <Chip tone="alert">{t('erNewAlert', locale)}</Chip>
              </span>
            ) : null}
          </p>
          <p className="text-body-sm text-ink-secondary">{whoLine(entry, locale)}</p>
        </div>
        <p className="text-right text-body-sm tabular-nums text-ink" data-testid="er-arrival">
          {arrival === null
            ? t('erNoEta', locale)
            : format('erArrivesAt', locale, { time: formatClock(arrival, numerals) })}
        </p>
      </div>

      {acknowledged ? (
        <p className="text-body-sm text-brand-700" data-testid="er-prepared">
          {t('erPrepared', locale)}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {acknowledged ? null : (
          <Button
            size="sm"
            variant="emergency"
            data-testid={`er-prepare-${entry.id}`}
            onClick={() => {
              onSeen();
              onCommand({ action: 'acknowledge' });
            }}
          >
            {t('erPrepare', locale)}
          </Button>
        )}
        <Button
          size="sm"
          variant={acknowledged ? 'primary' : 'secondary'}
          data-testid={`er-accept-${entry.id}`}
          onClick={() => {
            onSeen();
            onCommand({ action: 'accept' });
          }}
        >
          {t('erAccept', locale)}
        </Button>
        <Button
          size="sm"
          variant="quiet"
          data-testid={`er-decline-${entry.id}`}
          onClick={() => {
            onSeen();
            onDecline();
          }}
        >
          {t('erDecline', locale)}
        </Button>
        <CallButton entry={entry} locale={locale} connected={connected} fetchPhone={fetchPhone} />
        {pending ? (
          <span className="text-caption text-ink-muted">{t('bedPendingSync', locale)}</span>
        ) : null}
      </div>
      <p className="text-caption text-ink-muted">{t('erAcceptHint', locale)}</p>
    </article>
  );
}

// ---------------------------------------------------------------------------
// TBL-B07-TRIAGE
// ---------------------------------------------------------------------------

/**
 * A case with a referral open is held (`cases.ts`): another ER is deciding
 * about this person or getting ready for them, so it is not handed to the
 * ward or sent home until the referral is withdrawn. The buttons say so rather
 * than disappearing.
 */
export function TriageTable({
  cases,
  pendingCaseIds,
  locale,
  connected,
  onCommand,
  onAdmit,
  onDischarge,
  fetchPhone,
  referralOf,
  pendingReferralIds,
  onRefer,
  onCancelReferral,
}: {
  readonly cases: readonly EmergencyCaseView[];
  readonly pendingCaseIds: ReadonlySet<string>;
  readonly locale: Locale;
  readonly connected: boolean;
  readonly onCommand: (caseId: string, command: CaseCommand) => void;
  readonly onAdmit: (entry: EmergencyCaseView) => void;
  readonly onDischarge: (entry: EmergencyCaseView) => void;
  readonly fetchPhone: (caseId: string) => Promise<string | null>;
  /** The latest referral this ER sent for a case, if any (`FR-EMG-08`). */
  readonly referralOf: (caseId: string) => ReferralView | null;
  readonly pendingReferralIds: ReadonlySet<string>;
  /** `BTN-B07-REFER`. */
  readonly onRefer: (entry: EmergencyCaseView) => void;
  /** `BTN-B07-REFER-CANCEL`. */
  readonly onCancelReferral: (referral: ReferralView) => void;
}): ReactNode {
  const numerals = numeralsFor(locale);
  const held = { disabled: true as const, disabledReason: t('erReferralHeld', locale) };
  return (
    <table className="w-full border-collapse font-ui text-body-sm" data-testid="er-triage">
      <thead>
        <tr className="text-left text-caption text-ink-muted">
          <th className="px-2 py-2 font-normal">{t('erColToken', locale)}</th>
          <th className="px-2 py-2 font-normal">{t('erColProblem', locale)}</th>
          <th className="px-2 py-2 font-normal">{t('erColPatient', locale)}</th>
          <th className="px-2 py-2 font-normal">{t('erColArrived', locale)}</th>
          <th className="px-2 py-2 font-normal">{t('erColTriage', locale)}</th>
          <th className="px-2 py-2 font-normal">
            <span className="sr-only">{t('erColActions', locale)}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {cases.map((entry) => {
          const pending = pendingCaseIds.has(entry.id);
          const referral = referralOf(entry.id);
          const open = referral !== null && isOpenReferral(referral.state);
          return (
            <Fragment key={entry.id}>
              <tr
                className="border-t border-line align-top"
                data-testid={`er-row-${entry.id}`}
                data-triage={entry.triage ?? 'none'}
              >
                <td className="px-2 py-3 tabular-nums text-ink" data-testid="er-token">
                  {entry.tokenLabel ?? t('erTokenPending', locale)}
                  {pending ? (
                    <span className="block text-caption text-ink-muted">
                      {t('bedPendingSync', locale)}
                    </span>
                  ) : null}
                </td>
                <td className="px-2 py-3 text-ink">{problemName(entry.problem, locale)}</td>
                <td className="px-2 py-3 text-ink-secondary">
                  {whoLine(entry, locale)}
                  <div>
                    <CallButton
                      entry={entry}
                      locale={locale}
                      connected={connected}
                      fetchPhone={fetchPhone}
                    />
                  </div>
                </td>
                <td className="px-2 py-3 tabular-nums text-ink-secondary">
                  {entry.arrivedAt === null ? '' : formatClock(entry.arrivedAt, numerals)}
                </td>
                <td className="px-2 py-3">
                  <TriageChip triage={entry.triage} locale={locale} />
                  {/* BTN-B07-TRIAGE-<c>: one tap per colour. */}
                  <div
                    className="mt-2 flex gap-1"
                    role="group"
                    aria-label={t('erColTriage', locale)}
                  >
                    {(['red', 'yellow', 'green'] as const).map((colour) => (
                      <Button
                        key={colour}
                        size="sm"
                        variant={entry.triage === colour ? 'primary' : 'secondary'}
                        aria-pressed={entry.triage === colour}
                        data-testid={`er-triage-${colour}-${entry.id}`}
                        onClick={() => {
                          onCommand(entry.id, { action: 'triage', triage: colour });
                        }}
                      >
                        {triageName(colour, locale)}
                      </Button>
                    ))}
                  </div>
                </td>
                <td className="px-2 py-3">
                  <div className="flex flex-col items-start gap-1">
                    {entry.admitBedKind === null ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        data-testid={`er-admit-${entry.id}`}
                        {...(open ? held : {})}
                        onClick={() => {
                          onAdmit(entry);
                        }}
                      >
                        {t('erAdmit', locale)}
                      </Button>
                    ) : (
                      <span className="text-caption text-brand-700" data-testid="er-handed-off">
                        {format('erHandedOff', locale, {
                          kind: bedKindName(entry.admitBedKind, locale),
                        })}
                      </span>
                    )}
                    {open ? null : (
                      <Button
                        size="sm"
                        variant="secondary"
                        data-testid={`er-refer-${entry.id}`}
                        onClick={() => {
                          onRefer(entry);
                        }}
                      >
                        {t('erRefer', locale)}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="quiet"
                      data-testid={`er-discharge-${entry.id}`}
                      {...(open ? held : {})}
                      onClick={() => {
                        onDischarge(entry);
                      }}
                    >
                      {t('erDischarge', locale)}
                    </Button>
                  </div>
                </td>
              </tr>
              {/* Where this ER's referral of the person has got to (FR-EMG-08). A
                withdrawn one is not news on the row; today's list keeps it. */}
              {referral === null || referral.state === 'cancelled' ? null : (
                <tr className="align-top">
                  <td colSpan={6} className="px-2 pb-3">
                    <ReferralLine
                      referral={referral}
                      pending={pendingReferralIds.has(referral.id)}
                      locale={locale}
                      onCancel={onCancelReferral}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
