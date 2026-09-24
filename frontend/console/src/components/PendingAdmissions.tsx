'use client';

/**
 * `LIST-B06-PENDING` — "from ER and from app bed requests; accept → admit
 * flow; decline → notifies patient" (`APP_FLOW.md` B3, `FR-BED-07`).
 *
 * Two halves. **From the ER** (step 15, `BTN-B07-ADMIT`): a case the ER
 * handed over, named by its token and problem — the ER took no name, so
 * choosing a bed opens that bed's admit form with the case chosen, and the
 * ward takes the name there. **From the app**: each request can be:
 *
 *   - **held** — a real bed of the kind asked for is reserved for a set time,
 *     and the family is told by SMS when it runs out;
 *   - **admitted** — the family is here: into the held bed, or into a bed
 *     chosen now;
 *   - **declined** — after a confirmation that names who will be told
 *     (`GR-01`), and the family is told.
 *
 * All three need a connection. Answering is telling a family something, and
 * a "your bed is held" text queued on a disconnected ward computer is a
 * promise nobody has made yet.
 */

import { useState, type ReactNode } from 'react';

import { HOLD_MINUTE_CHOICES, canApply, type BedView, type Timestamp } from '@platform/domain';
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
import { Button, Chip } from '@platform/ui';

import type { PendingHandoff, PendingRequest } from '@/lib/beds';

export interface PendingAdmissionsProps {
  readonly requests: readonly PendingRequest[] | null;
  /** The ER half (`FR-BED-07`). */
  readonly handoffs: readonly PendingHandoff[] | null;
  /** A bed was chosen for an ER case: open that bed's admit form with it. */
  readonly onAdmitHandoff: (caseId: string, bedId: string) => void;
  readonly failed: boolean;
  readonly connected: boolean;
  readonly beds: readonly BedView[];
  readonly locale: Locale;
  readonly now: Date;
  readonly onRespond: (requestId: string, body: Record<string, unknown>) => Promise<void>;
  readonly onAnswered: () => void;
  readonly onProblem: (message: string) => void;
}

export function PendingAdmissions(props: PendingAdmissionsProps): ReactNode {
  const { requests, locale, connected } = props;

  return (
    <section
      aria-labelledby="pending-title"
      data-testid="pending-admissions"
      className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4"
    >
      <h2 id="pending-title" className="font-ui text-title-sm text-ink">
        {t('pendingTitle', locale)}
      </h2>

      {!connected ? (
        <p className="font-ui text-body-sm text-ink-secondary">
          {t('pendingNeedsConnection', locale)}
        </p>
      ) : null}

      {(props.handoffs ?? []).length === 0 ? null : (
        <ul className="flex flex-col gap-3" data-testid="pending-handoffs">
          {(props.handoffs ?? []).map((handoff) => (
            <li key={handoff.caseId}>
              <HandoffCard {...props} handoff={handoff} />
            </li>
          ))}
        </ul>
      )}

      {requests === null ? (
        props.failed ? (
          <p className="font-ui text-body-sm text-ink-secondary">{t('loadFailed', locale)}</p>
        ) : (
          <div className="h-16 rounded-sm bg-sunken" aria-busy="true" />
        )
      ) : requests.length === 0 && (props.handoffs ?? []).length === 0 ? (
        <div>
          <p className="font-ui text-body-sm text-ink-secondary" data-testid="pending-empty">
            {t('pendingEmpty', locale)}
          </p>
          {/* D1: a console empty state says what to do. */}
          <p className="font-ui text-caption text-ink-muted">{t('pendingEmptyHint', locale)}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {requests.map((request) => (
            <li key={request.id}>
              <RequestCard {...props} request={request} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One case from the ER (`BTN-B07-ADMIT`). Names nobody: its token, its
 * problem, its colour, the kind of bed the ER asked for and since when.
 */
function HandoffCard({
  handoff,
  beds,
  locale,
  now,
  onAdmitHandoff,
}: PendingAdmissionsProps & { readonly handoff: PendingHandoff }): ReactNode {
  const numerals = numeralsFor(locale);
  const [choosing, setChoosing] = useState(false);
  const at = now.toISOString() as Timestamp;

  // Free beds of the kind the ER asked for first, then any other free bed:
  // the ward decides, and a CCU patient in an HDU bed tonight is its call.
  const admittable = beds
    .filter((bed) => canApply(bed, 'admit', at, { bedRequestId: null }).ok)
    .sort((a, b) => Number(b.kind === handoff.bedKind) - Number(a.kind === handoff.bedKind));

  return (
    <article
      className="flex flex-col gap-2 rounded-sm border border-alert-600 bg-alert-100 p-3 font-ui"
      data-testid={`handoff-${handoff.caseId}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-body-md tabular-nums text-ink">
            {handoff.tokenLabel ?? ''} · {problemName(handoff.problem, locale)}
          </p>
          <p className="text-caption tabular-nums text-ink-muted">
            {handoff.ageYears === null
              ? ''
              : format('ageYears', locale, { age: formatNumber(handoff.ageYears, numerals) })}
            {handoff.triage === null ? '' : ` · ${triageName(handoff.triage, locale)}`}
          </p>
        </div>
        <Chip tone="alert">
          {format('pendingErFor', locale, { kind: bedKindName(handoff.bedKind, locale) })}
        </Chip>
      </div>
      <p className="text-caption text-ink-secondary">
        {t('pendingFromEr', locale)} ·{' '}
        {format('pendingErSince', locale, { time: formatClock(handoff.requestedAt, numerals) })}
      </p>

      {choosing ? (
        <BedChoice
          beds={admittable}
          prompt={t('transferChoose', locale)}
          empty={t('noFreeBed', locale)}
          locale={locale}
          testPrefix={`handoff-bed-${handoff.caseId}`}
          onChoose={(bed) => {
            setChoosing(false);
            onAdmitHandoff(handoff.caseId, bed.id);
          }}
          onCancel={() => {
            setChoosing(false);
          }}
        />
      ) : (
        <div>
          <Button
            size="sm"
            data-testid={`admit-handoff-${handoff.caseId}`}
            onClick={() => {
              setChoosing(true);
            }}
          >
            {t('pendingErAdmit', locale)}
          </Button>
        </div>
      )}
    </article>
  );
}

type Step =
  | { readonly kind: 'idle' }
  | { readonly kind: 'hold'; readonly bedId: string | null }
  | {
      readonly kind: 'admit';
    }
  | { readonly kind: 'decline' };

function RequestCard({
  request,
  beds,
  locale,
  now,
  connected,
  onRespond,
  onAnswered,
  onProblem,
}: PendingAdmissionsProps & { readonly request: PendingRequest }): ReactNode {
  const numerals = numeralsFor(locale);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const at = now.toISOString() as Timestamp;

  const offline = connected
    ? {}
    : { disabled: true as const, disabledReason: t('pendingNeedsConnection', locale) };

  async function answer(body: Record<string, unknown>): Promise<void> {
    setBusy(true);
    try {
      await onRespond(request.id, body);
      setStep({ kind: 'idle' });
      onAnswered();
    } catch {
      onProblem(t('pendingAnswerFailed', locale));
    } finally {
      setBusy(false);
    }
  }

  // Beds the family could be given: of the kind asked for when holding, of
  // that kind first and then any when admitting a family already at the desk.
  const holdable = beds.filter(
    (bed) => bed.kind === request.bedKind && canApply(bed, 'reserve', at, { holdMinutes: 60 }).ok,
  );
  const admittable = beds
    .filter((bed) => canApply(bed, 'admit', at, { bedRequestId: request.id }).ok)
    .sort((a, b) => Number(b.kind === request.bedKind) - Number(a.kind === request.bedKind));

  const sex =
    request.patientSex === 'male'
      ? 'sexMale'
      : request.patientSex === 'female'
        ? 'sexFemale'
        : 'sexOther';

  return (
    <article
      className="flex flex-col gap-2 rounded-sm bg-sunken p-3 font-ui"
      data-testid={`pending-${request.id}`}
      data-state={request.state}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-body-md text-ink">{request.patientName}</p>
          <p className="text-caption tabular-nums text-ink-muted">
            {request.patientAgeYears === null
              ? t(sex, locale)
              : `${format('ageYears', locale, { age: formatNumber(request.patientAgeYears, numerals) })} · ${t(sex, locale)}`}
            {request.contactPhone === null ? '' : ` · ${formatPhone(request.contactPhone)}`}
          </p>
        </div>
        <Chip tone={request.state === 'held' ? 'positive' : 'neutral'}>
          {bedKindName(request.bedKind, locale)}
        </Chip>
      </div>

      <p className="text-caption text-ink-secondary">
        {t('pendingFromApp', locale)}
        {request.expectedArrivalAt === null
          ? ''
          : ` · ${format('pendingArrives', locale, { time: formatClock(request.expectedArrivalAt, numerals) })}`}
      </p>

      {request.note === null || request.note === '' ? null : (
        <p className="text-body-sm text-ink">{request.note}</p>
      )}

      {request.state === 'held' && request.holdExpiresAt !== null ? (
        <p className="text-body-sm text-brand-700" data-testid="pending-held">
          {format('pendingHeld', locale, {
            bed: request.heldBedLabel ?? '',
            time: formatClock(request.holdExpiresAt, numerals),
          })}
        </p>
      ) : null}

      {step.kind === 'idle' ? (
        <div className="flex flex-wrap gap-2">
          {request.state === 'requested' ? (
            <Button
              size="sm"
              data-testid={`hold-${request.id}`}
              {...offline}
              onClick={() => {
                setStep({ kind: 'hold', bedId: null });
              }}
            >
              {t('pendingHold', locale)}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant={request.state === 'held' ? 'primary' : 'secondary'}
            data-testid={`admit-${request.id}`}
            {...offline}
            onClick={() => {
              if (request.state === 'held') void answer({ action: 'confirm', bedId: null });
              else setStep({ kind: 'admit' });
            }}
          >
            {t('admit', locale)}
          </Button>
          <Button
            size="sm"
            variant="quiet"
            data-testid={`decline-${request.id}`}
            {...offline}
            onClick={() => {
              setStep({ kind: 'decline' });
            }}
          >
            {t('pendingDecline', locale)}
          </Button>
        </div>
      ) : null}

      {step.kind === 'hold' && step.bedId === null ? (
        <BedChoice
          beds={holdable}
          prompt={format('pendingHoldChoose', locale, {
            kind: bedKindName(request.bedKind, locale),
          })}
          empty={t('pendingNoBedOfKind', locale)}
          locale={locale}
          testPrefix={`hold-bed-${request.id}`}
          onChoose={(bed) => {
            setStep({ kind: 'hold', bedId: bed.id });
          }}
          onCancel={() => {
            setStep({ kind: 'idle' });
          }}
        />
      ) : null}

      {step.kind === 'hold' && step.bedId !== null ? (
        <div className="flex flex-wrap gap-2">
          {HOLD_MINUTE_CHOICES.map((minutes) => (
            <Button
              key={minutes}
              size="sm"
              variant="secondary"
              loading={busy}
              data-testid={`hold-for-${String(minutes)}`}
              onClick={() => {
                void answer({ action: 'hold', bedId: step.bedId, minutes });
              }}
            >
              {format('holdFor', locale, { minutes: formatNumber(minutes, numerals) })}
            </Button>
          ))}
          <Button
            size="sm"
            variant="quiet"
            onClick={() => {
              setStep({ kind: 'idle' });
            }}
          >
            {t('goBack', locale)}
          </Button>
        </div>
      ) : null}

      {step.kind === 'admit' ? (
        <BedChoice
          beds={admittable}
          prompt={t('transferChoose', locale)}
          empty={t('noFreeBed', locale)}
          locale={locale}
          testPrefix={`admit-bed-${request.id}`}
          onChoose={(bed) => {
            void answer({ action: 'confirm', bedId: bed.id });
          }}
          onCancel={() => {
            setStep({ kind: 'idle' });
          }}
        />
      ) : null}

      {step.kind === 'decline' ? (
        <div className="flex flex-col gap-2 rounded-sm border border-line-strong p-2">
          <p className="text-body-sm text-ink">
            {format('pendingDeclineConsequence', locale, { name: request.patientName })}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={busy}
              data-testid={`confirm-decline-${request.id}`}
              onClick={() => {
                void answer({ action: 'decline' });
              }}
            >
              {t('pendingDecline', locale)}
            </Button>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                setStep({ kind: 'idle' });
              }}
            >
              {t('goBack', locale)}
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function BedChoice({
  beds,
  prompt,
  empty,
  locale,
  testPrefix,
  onChoose,
  onCancel,
}: {
  readonly beds: readonly BedView[];
  readonly prompt: string;
  readonly empty: string;
  readonly locale: Locale;
  readonly testPrefix: string;
  readonly onChoose: (bed: BedView) => void;
  readonly onCancel: () => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption text-ink-muted">{prompt}</p>
      {beds.length === 0 ? (
        <p className="text-body-sm text-ink-secondary">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {beds.map((bed) => (
            <Button
              key={bed.id}
              size="sm"
              variant="secondary"
              data-testid={`${testPrefix}-${bed.label}`}
              onClick={() => {
                onChoose(bed);
              }}
            >
              {bed.label} · {bedKindName(bed.kind, locale)}
            </Button>
          ))}
        </div>
      )}
      <Button size="sm" variant="quiet" onClick={onCancel}>
        {t('goBack', locale)}
      </Button>
    </div>
  );
}
