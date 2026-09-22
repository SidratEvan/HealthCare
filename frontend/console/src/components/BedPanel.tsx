'use client';

/**
 * The bed panel — what a tile opens onto (`APP_FLOW.md` B3, `BTN-B06-BED-<bedId>`).
 *
 * Every control B3 lists for one bed lives here, offered only in the states
 * the domain allows, so the panel never shows a button whose press the server
 * would refuse: `ভর্তি করুন`, `ছাড়পত্র`, `স্থানান্তর`, `সংরক্ষিত রাখুন`,
 * `সেবার বাইরে`, `SEL-B06-EXPDIS`, and the cleaning and restore steps that
 * finish the state machine.
 *
 * ## "Two taps at most" (`FR-BED-02`)
 *
 * Counted from the open panel. A hold is one tap on its duration. A discharge
 * is the action and then its confirmation — the confirmation `GR-01` requires,
 * naming the consequence rather than asking "are you sure". A transfer is the
 * target bed and then its confirmation. An admit is a form, because a person
 * has to be named; admitting a waiting request is one tap on the request.
 *
 * ## The patient's name
 *
 * Fetched when an occupied bed is opened, and only then, because that read is
 * audited (`DB-P7`). The tile never shows it. Offline, the panel says the name
 * will show when the connection returns rather than showing a cached one.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  HOLD_MINUTE_CHOICES,
  canApply,
  canReceiveTransfer,
  normaliseBdMobile,
  type BedView,
  type DhakaDate,
  type Timestamp,
} from '@platform/domain';
import {
  bedKindName,
  format,
  formatClock,
  formatDateTime,
  formatNumber,
  formatTaka,
  problemName,
  t,
  type Locale,
} from '@platform/i18n';
import { Button, Chip, Input } from '@platform/ui';

import { NUMERALS, shownState, stateLabel } from '@/lib/bedCopy';

import type { BedBoard } from '@/hooks/useBedBoard';
import type { PanelResponse, PendingHandoff, PendingRequest } from '@/lib/beds';

type Mode = 'view' | 'admit' | 'discharge' | 'transfer' | 'oos';

export interface BedPanelProps {
  readonly bed: BedView;
  readonly wardName: string;
  readonly wardNames: ReadonlyMap<string, string>;
  readonly beds: readonly BedView[];
  readonly requests: readonly PendingRequest[] | null;
  /** Cases the ER handed over (`BTN-B07-ADMIT`, `FR-BED-07`). */
  readonly handoffs: readonly PendingHandoff[] | null;
  /**
   * Opens the panel straight into the admit form with this ER case chosen —
   * what `LIST-B06-PENDING`'s "বেডে ভর্তি করুন" does after a bed is picked.
   */
  readonly admitCaseId?: string | null;
  readonly locale: Locale;
  readonly now: Date;
  readonly today: DhakaDate;
  readonly connected: boolean;
  readonly pending: boolean;
  readonly board: BedBoard;
  readonly onClose: () => void;
  /** Called with a sentence when something the ward did was not done. */
  readonly onProblem: (message: string) => void;
}

export function BedPanel(props: BedPanelProps): ReactNode {
  const { bed, locale, now, connected, board, onClose } = props;
  const [mode, setMode] = useState<Mode>(
    props.admitCaseId === undefined || props.admitCaseId === null ? 'view' : 'admit',
  );
  const state = shownState(bed, now);
  const at = now.toISOString() as Timestamp;

  // A11Y-05: Esc closes the panel, or backs out of a step within it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (mode === 'view') onClose();
      else setMode('view');
    };
    globalThis.addEventListener?.('keydown', onKey);
    return () => {
      globalThis.removeEventListener?.('keydown', onKey);
    };
  }, [mode, onClose]);

  const heldRequest =
    bed.heldForRequestId === null
      ? null
      : (props.requests?.find((request) => request.id === bed.heldForRequestId) ?? null);

  const act = useCallback(
    async (
      route: string,
      body: Record<string, unknown>,
      change: Parameters<BedBoard['act']>[0]['change'],
    ) => {
      await board.act({ bedId: bed.id, route, body, change });
      setMode('view');
    },
    [board, bed.id],
  );

  const allowed = (action: Parameters<typeof canApply>[1], context = {}): boolean =>
    canApply(bed, action, at, context).ok;

  return (
    <section
      aria-labelledby="bed-panel-title"
      data-testid="bed-panel"
      data-bed-id={bed.id}
      className="flex flex-col gap-4 rounded-md border border-line bg-surface p-4"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="bed-panel-title" className="font-ui text-title-lg tabular-nums text-ink">
            {bed.label}
          </h2>
          <p className="font-ui text-body-sm text-ink-muted">
            {bedKindName(bed.kind, locale)} · {props.wardName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Chip tone={state === 'free' ? 'positive' : 'neutral'}>{stateLabel(state, locale)}</Chip>
          <Button variant="quiet" size="sm" onClick={onClose}>
            {t('closePanel', locale)}
          </Button>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-2 font-ui text-body-sm">
        <Fact label={t('factNightly', locale)} value={formatTaka(bed.nightlyPoisha, NUMERALS)} />
        <Fact label={t('factSince', locale)} value={formatDateTime(bed.stateChangedAt, NUMERALS)} />
        {bed.lastCleanedAt === null ? null : (
          <Fact
            label={t('factLastCleaned', locale)}
            value={formatDateTime(bed.lastCleanedAt, NUMERALS)}
          />
        )}
        {state === 'reserved' && bed.reservedUntil !== null ? (
          <Fact
            label={t('factHeldUntil', locale)}
            value={format('bedUntil', locale, { time: formatClock(bed.reservedUntil, NUMERALS) })}
          />
        ) : null}
      </dl>

      {props.pending ? (
        <p className="font-ui text-caption text-ink-secondary" data-testid="bed-pending">
          {t('bedPendingSync', locale)}
        </p>
      ) : null}

      {state === 'occupied' ? (
        <Occupant bed={bed} connected={connected} locale={locale} board={board} />
      ) : null}

      {state === 'out_of_service' && bed.oosReason !== null ? (
        <p className="rounded-sm bg-sunken px-3 py-2 font-ui text-body-sm text-ink">
          {bed.oosReason}
        </p>
      ) : null}

      {state === 'reserved' && bed.heldForRequestId !== null ? (
        <p className="rounded-sm bg-brand-100 px-3 py-2 font-ui text-body-sm text-brand-700">
          {heldRequest === null
            ? t('bedHeldForRequest', locale)
            : format('admitHeldRequest', locale, { name: heldRequest.patientName })}
        </p>
      ) : null}

      {mode === 'view' ? (
        <div className="flex flex-wrap gap-2" data-testid="bed-actions">
          {state === 'reserved' && bed.heldForRequestId !== null ? (
            <Button
              data-testid="action-admit-held"
              {...(connected
                ? {}
                : { disabled: true as const, disabledReason: t('pendingNeedsConnection', locale) })}
              onClick={() => {
                void board
                  .respond(bed.heldForRequestId ?? '', { action: 'confirm', bedId: bed.id })
                  .catch(() => {
                    props.onProblem(t('pendingAnswerFailed', locale));
                  });
              }}
            >
              {t('admit', locale)}
            </Button>
          ) : null}

          {allowed('admit', { bedRequestId: null }) ? (
            <Button data-testid="action-admit" onClick={() => setMode('admit')}>
              {t('admit', locale)}
            </Button>
          ) : null}

          {allowed('discharge') ? (
            <Button data-testid="action-discharge" onClick={() => setMode('discharge')}>
              {t('discharge', locale)}
            </Button>
          ) : null}

          {allowed('transfer') ? (
            <Button
              variant="secondary"
              data-testid="action-transfer"
              onClick={() => setMode('transfer')}
            >
              {t('transfer', locale)}
            </Button>
          ) : null}

          {allowed('clean_done') ? (
            <Button
              data-testid="action-clean-done"
              onClick={() => {
                void act('clean-done', {}, { action: 'clean_done' });
              }}
            >
              {t('cleanDone', locale)}
            </Button>
          ) : null}

          {allowed('clean_start') ? (
            <Button
              variant="secondary"
              data-testid="action-clean-start"
              onClick={() => {
                void act('clean-start', {}, { action: 'clean_start' });
              }}
            >
              {t('cleanStart', locale)}
            </Button>
          ) : null}

          {allowed('release') && bed.heldForRequestId === null ? (
            <Button
              variant="secondary"
              data-testid="action-release"
              onClick={() => {
                void act('release', {}, { action: 'release' });
              }}
            >
              {t('release', locale)}
            </Button>
          ) : null}

          {state === 'free' || state === 'cleaning' ? (
            <Button variant="secondary" data-testid="action-oos" onClick={() => setMode('oos')}>
              {t('outOfService', locale)}
            </Button>
          ) : null}

          {allowed('restore') ? (
            <Button
              data-testid="action-restore"
              onClick={() => {
                void act('restore', {}, { action: 'restore' });
              }}
            >
              {t('restore', locale)}
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* `BTN-B06-RESERVE`: one tap on the duration is the whole hold. */}
      {mode === 'view' && allowed('reserve', { holdMinutes: 60 }) ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="font-ui text-caption text-ink-muted">{t('reserve', locale)}</legend>
          <div className="flex flex-wrap gap-2">
            {HOLD_MINUTE_CHOICES.map((minutes) => (
              <Button
                key={minutes}
                variant="secondary"
                size="sm"
                data-testid={`action-reserve-${String(minutes)}`}
                onClick={() => {
                  void act('reserve', { minutes }, { action: 'reserve', holdMinutes: minutes });
                }}
              >
                {format('holdFor', locale, { minutes: formatNumber(minutes, NUMERALS) })}
              </Button>
            ))}
          </div>
        </fieldset>
      ) : null}

      {mode === 'view' && state === 'occupied' ? (
        <DischargeForecast bed={bed} today={props.today} locale={locale} onSave={act} />
      ) : null}

      {mode === 'admit' ? (
        <AdmitForm
          bed={bed}
          locale={locale}
          connected={connected}
          requests={(props.requests ?? []).filter((request) => request.state === 'requested')}
          handoffs={props.handoffs ?? []}
          initialHandoffId={props.admitCaseId ?? null}
          onCancel={() => setMode('view')}
          onAdmitDesk={(patient, expectedDischargeDate, emergencyCaseId) =>
            act(
              'admit',
              { patient, expectedDischargeDate, emergencyCaseId },
              { action: 'admit', bedRequestId: null },
            )
          }
          onAdmitRequest={async (requestId) => {
            try {
              await board.respond(requestId, { action: 'confirm', bedId: bed.id });
              setMode('view');
            } catch {
              props.onProblem(t('pendingAnswerFailed', locale));
            }
          }}
        />
      ) : null}

      {mode === 'discharge' ? (
        <Confirm
          consequence={format('dischargeConsequence', locale, { bed: bed.label })}
          confirmLabel={t('discharge', locale)}
          cancelLabel={t('goBack', locale)}
          testId="confirm-discharge"
          onConfirm={() => {
            void act('discharge', {}, { action: 'discharge' });
          }}
          onCancel={() => setMode('view')}
        />
      ) : null}

      {mode === 'transfer' ? (
        <TransferChooser
          bed={bed}
          beds={props.beds}
          wardNames={props.wardNames}
          locale={locale}
          now={at}
          onCancel={() => setMode('view')}
          onTransfer={(target) => {
            void act(
              'transfer',
              { toBedId: target.id },
              { action: 'transfer', toBedId: target.id },
            );
          }}
        />
      ) : null}

      {mode === 'oos' ? (
        <OutOfServiceForm
          locale={locale}
          onCancel={() => setMode('view')}
          onConfirm={(reason) => {
            void act('oos', { reason }, { action: 'oos', reason });
          }}
        />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------

function Fact({ label, value }: { readonly label: string; readonly value: string }): ReactNode {
  return (
    <div>
      <dt className="text-caption text-ink-muted">{label}</dt>
      <dd className="tabular-nums text-ink">{value}</dd>
    </div>
  );
}

/** Who is in the bed. Fetched on open, audited by the server, never cached. */
function Occupant({
  bed,
  connected,
  locale,
  board,
}: {
  readonly bed: BedView;
  readonly connected: boolean;
  readonly locale: Locale;
  readonly board: BedBoard;
}): ReactNode {
  const [occupant, setOccupant] = useState<PanelResponse['occupant'] | 'loading' | 'failed'>(
    'loading',
  );

  // An admit still in the outbox has no admission on the server to read.
  const provisional = bed.admissionId === null || bed.admissionId.startsWith('pending:');

  useEffect(() => {
    if (!connected || provisional) return undefined;
    let cancelled = false;
    setOccupant('loading');
    board.api
      .panel(bed.id)
      .then((response) => {
        if (!cancelled) setOccupant(response.occupant);
      })
      .catch(() => {
        if (!cancelled) setOccupant('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [bed.id, bed.admissionId, connected, provisional, board.api]);

  if (!connected || provisional) {
    return (
      <p className="rounded-sm bg-sunken px-3 py-2 font-ui text-body-sm text-ink-secondary">
        {t('occupantOffline', locale)}
      </p>
    );
  }

  if (occupant === 'loading') {
    return <div className="h-16 rounded-sm bg-sunken" aria-busy="true" />;
  }
  if (occupant === 'failed' || occupant === null) {
    return <p className="font-ui text-body-sm text-ink-secondary">{t('loadFailed', locale)}</p>;
  }

  const sex =
    occupant.sex === 'male' ? 'sexMale' : occupant.sex === 'female' ? 'sexFemale' : 'sexOther';

  return (
    <div className="rounded-sm bg-sunken px-3 py-2 font-ui" data-testid="occupant">
      <p className="text-caption text-ink-muted">{t('occupant', locale)}</p>
      <p className="text-body-md text-ink">{occupant.fullName}</p>
      <p className="text-body-sm tabular-nums text-ink-secondary">
        {occupant.ageYears === null
          ? t(sex, locale)
          : `${format('ageYears', locale, { age: formatNumber(occupant.ageYears, NUMERALS) })} · ${t(sex, locale)}`}{' '}
        ·{' '}
        {format('occupantAdmitted', locale, {
          time: formatDateTime(occupant.admittedAt, NUMERALS),
        })}
      </p>
      <p className="mt-1 text-caption text-ink-muted">{t('occupantViewLogged', locale)}</p>
    </div>
  );
}

/** `SEL-B06-EXPDIS` (`FR-BED-04`): a date, today or later. */
function DischargeForecast({
  bed,
  today,
  locale,
  onSave,
}: {
  readonly bed: BedView;
  readonly today: DhakaDate;
  readonly locale: Locale;
  readonly onSave: (route: string, body: Record<string, unknown>, change: null) => Promise<void>;
}): ReactNode {
  const [date, setDate] = useState<string>(bed.expectedDischargeDate ?? '');

  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave('expected-discharge', { date: date === '' ? null : date }, null);
      }}
    >
      <label className="flex flex-1 flex-col gap-1 font-ui text-caption text-ink-muted">
        {t('expectedDischarge', locale)}
        <input
          type="date"
          min={today}
          value={date}
          data-testid="expected-discharge"
          onChange={(event) => {
            setDate(event.target.value);
          }}
          className="min-h-touch rounded-sm border border-line-strong bg-surface px-3 text-body-md text-ink"
        />
      </label>
      <Button variant="secondary" size="sm" type="submit" data-testid="save-forecast">
        {t('saveForecast', locale)}
      </Button>
    </form>
  );
}

/** `BTN-B06-ADMIT`: "patient search or from pending list". */
function AdmitForm({
  bed,
  locale,
  connected,
  requests,
  handoffs,
  initialHandoffId,
  onCancel,
  onAdmitDesk,
  onAdmitRequest,
}: {
  readonly bed: BedView;
  readonly locale: Locale;
  readonly connected: boolean;
  readonly requests: readonly PendingRequest[];
  readonly handoffs: readonly PendingHandoff[];
  readonly initialHandoffId: string | null;
  readonly onCancel: () => void;
  readonly onAdmitDesk: (
    patient: { name: string; phone: string; ageYears: number; sex: 'male' | 'female' | 'other' },
    expectedDischargeDate: string | null,
    emergencyCaseId: string | null,
  ) => Promise<void>;
  readonly onAdmitRequest: (requestId: string) => Promise<void>;
}): ReactNode {
  const initial = handoffs.find((handoff) => handoff.caseId === initialHandoffId) ?? null;

  // An ER case is admitted through this same form: the ER took no name, so
  // the ward takes it here (`BTN-B07-ADMIT`, `FR-BED-07`). Choosing one fills
  // in what the ER did record — age and sex — and nothing it did not.
  const [fromEr, setFromEr] = useState<PendingHandoff | null>(initial);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [age, setAge] = useState(
    initial?.ageYears === null || initial === null ? '' : String(initial.ageYears),
  );
  const [sex, setSex] = useState<'male' | 'female' | 'other' | null>(initial?.sex ?? null);
  const [tried, setTried] = useState(false);

  const phoneStored = normaliseBdMobile(phone);
  const ageYears = /^\d{1,3}$/.test(age.trim()) ? Number(age.trim()) : null;
  const errors = {
    name: name.trim().length < 2 ? t('admitNameError', locale) : undefined,
    phone: phoneStored === null ? t('admitPhoneError', locale) : undefined,
    age: ageYears === null || ageYears > 130 ? t('admitAgeError', locale) : undefined,
    sex: sex === null ? t('admitSexError', locale) : undefined,
  };
  const valid = Object.values(errors).every((error) => error === undefined);

  // Requests for this kind first: the family asked for exactly this.
  const ordered = [...requests].sort(
    (a, b) => Number(b.bedKind === bed.kind) - Number(a.bedKind === bed.kind),
  );

  return (
    <div className="flex flex-col gap-4" data-testid="admit-form">
      <h3 className="font-ui text-title-sm text-ink">{t('admitHeading', locale)}</h3>

      {handoffs.length > 0 ? (
        <section className="flex flex-col gap-2" data-testid="admit-from-er">
          <p className="font-ui text-caption text-ink-muted">{t('pendingFromEr', locale)}</p>
          <div className="flex flex-wrap gap-2">
            {handoffs.map((handoff) => (
              <Button
                key={handoff.caseId}
                variant={fromEr?.caseId === handoff.caseId ? 'primary' : 'secondary'}
                size="sm"
                aria-pressed={fromEr?.caseId === handoff.caseId}
                data-testid={`admit-er-${handoff.caseId}`}
                onClick={() => {
                  const chosen = fromEr?.caseId === handoff.caseId ? null : handoff;
                  setFromEr(chosen);
                  if (chosen !== null) {
                    setAge(chosen.ageYears === null ? '' : String(chosen.ageYears));
                    setSex(chosen.sex);
                  }
                }}
              >
                {handoff.tokenLabel ?? ''} · {problemName(handoff.problem, locale)} ·{' '}
                {bedKindName(handoff.bedKind, locale)}
              </Button>
            ))}
          </div>
          {fromEr === null ? null : (
            <p className="font-ui text-caption text-ink-secondary">
              {t('pendingErNameHint', locale)}
            </p>
          )}
        </section>
      ) : null}

      {ordered.length > 0 && connected && fromEr === null ? (
        <section className="flex flex-col gap-2">
          <p className="font-ui text-caption text-ink-muted">{t('admitFromRequest', locale)}</p>
          {ordered.map((request) => (
            <Button
              key={request.id}
              variant="secondary"
              size="sm"
              data-testid={`admit-request-${request.id}`}
              onClick={() => {
                void onAdmitRequest(request.id);
              }}
            >
              {request.patientName} · {bedKindName(request.bedKind, locale)}
            </Button>
          ))}
        </section>
      ) : null}

      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setTried(true);
          if (!valid || phoneStored === null || ageYears === null || sex === null) return;
          void onAdmitDesk(
            { name: name.trim(), phone: phoneStored, ageYears, sex },
            null,
            fromEr?.caseId ?? null,
          );
        }}
      >
        <Input
          label={t('admitName', locale)}
          density="console"
          value={name}
          data-testid="admit-name"
          onChange={(event) => {
            setName(event.target.value);
          }}
          {...(tried && errors.name !== undefined ? { error: errors.name } : {})}
        />
        <Input
          label={t('admitPhone', locale)}
          kind="phone"
          density="console"
          value={phone}
          data-testid="admit-phone"
          onChange={(event) => {
            setPhone(event.target.value);
          }}
          {...(tried && errors.phone !== undefined ? { error: errors.phone } : {})}
        />
        <Input
          label={t('admitAge', locale)}
          kind="number"
          density="console"
          value={age}
          data-testid="admit-age"
          onChange={(event) => {
            setAge(event.target.value);
          }}
          {...(tried && errors.age !== undefined ? { error: errors.age } : {})}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="font-ui text-caption text-ink-muted">{t('admitSex', locale)}</legend>
          <div className="flex gap-2">
            {(['male', 'female', 'other'] as const).map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={sex === value ? 'primary' : 'secondary'}
                aria-pressed={sex === value}
                data-testid={`admit-sex-${value}`}
                onClick={() => {
                  setSex(value);
                }}
              >
                {t(
                  value === 'male' ? 'sexMale' : value === 'female' ? 'sexFemale' : 'sexOther',
                  locale,
                )}
              </Button>
            ))}
          </div>
          {tried && errors.sex !== undefined ? (
            <p className="font-ui text-caption text-alert-700" role="alert">
              {errors.sex}
            </p>
          ) : null}
        </fieldset>

        <p className="font-ui text-caption text-ink-muted">{t('admitDeskHint', locale)}</p>

        <div className="flex gap-2">
          <Button type="submit" data-testid="admit-confirm">
            {t('admitConfirm', locale)}
          </Button>
          <Button type="button" variant="quiet" onClick={onCancel}>
            {t('goBack', locale)}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** A consequence, named, and the two ways out of it (`GR-01`). */
function Confirm({
  consequence,
  confirmLabel,
  cancelLabel,
  testId,
  onConfirm,
  onCancel,
}: {
  readonly consequence: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly testId: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-3 rounded-sm border border-line-strong p-3">
      <p className="font-ui text-body-md text-ink">{consequence}</p>
      <div className="flex gap-2">
        <Button data-testid={testId} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
    </div>
  );
}

/** `BTN-B06-TRANSFER`: "choose target bed → both tiles update". */
function TransferChooser({
  bed,
  beds,
  wardNames,
  locale,
  now,
  onCancel,
  onTransfer,
}: {
  readonly bed: BedView;
  readonly beds: readonly BedView[];
  readonly wardNames: ReadonlyMap<string, string>;
  readonly locale: Locale;
  readonly now: Timestamp;
  readonly onCancel: () => void;
  readonly onTransfer: (target: BedView) => void;
}): ReactNode {
  const [target, setTarget] = useState<BedView | null>(null);

  const targets = beds
    .filter((candidate) => canReceiveTransfer(bed, candidate, now).ok)
    .sort(
      (a, b) =>
        Number(b.kind === bed.kind) - Number(a.kind === bed.kind) || a.label.localeCompare(b.label),
    );

  if (target !== null) {
    return (
      <Confirm
        consequence={format('transferConsequence', locale, { from: bed.label, to: target.label })}
        confirmLabel={format('transferConfirm', locale, { from: bed.label, to: target.label })}
        cancelLabel={t('goBack', locale)}
        testId="confirm-transfer"
        onConfirm={() => {
          onTransfer(target);
        }}
        onCancel={() => {
          setTarget(null);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="transfer-chooser">
      <h3 className="font-ui text-title-sm text-ink">{t('transferChoose', locale)}</h3>
      {targets.length === 0 ? (
        <p className="font-ui text-body-sm text-ink-secondary">{t('noFreeBed', locale)}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {targets.map((candidate) => (
            <li key={candidate.id}>
              <Button
                variant="secondary"
                size="sm"
                fullWidth
                data-testid={`transfer-to-${candidate.label}`}
                onClick={() => {
                  setTarget(candidate);
                }}
              >
                {candidate.label} · {bedKindName(candidate.kind, locale)} ·{' '}
                {wardNames.get(candidate.wardId) ?? ''}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="quiet" onClick={onCancel}>
        {t('goBack', locale)}
      </Button>
    </div>
  );
}

/** `BTN-B06-OOS`: "marks out of service with reason". */
function OutOfServiceForm({
  locale,
  onCancel,
  onConfirm,
}: {
  readonly locale: Locale;
  readonly onCancel: () => void;
  readonly onConfirm: (reason: string) => void;
}): ReactNode {
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const missing = reason.trim() === '';

  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (!missing) onConfirm(reason.trim());
      }}
    >
      <Input
        label={t('outOfServiceReason', locale)}
        density="console"
        value={reason}
        data-testid="oos-reason"
        onChange={(event) => {
          setReason(event.target.value);
        }}
        {...(tried && missing ? { error: t('outOfServiceReason', locale) } : {})}
      />
      <div className="flex gap-2">
        <Button type="submit" data-testid="confirm-oos">
          {t('outOfService', locale)}
        </Button>
        <Button type="button" variant="quiet" onClick={onCancel}>
          {t('goBack', locale)}
        </Button>
      </div>
    </form>
  );
}
