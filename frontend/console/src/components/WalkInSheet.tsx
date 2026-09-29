'use client';

/**
 * `MOD-B02-WALKIN` — somebody walks up to the counter (pilot step 23,
 * `APP_FLOW.md` B1.4, `FR-REC-14`, `FR-REC-20`).
 *
 * "phone → if existing, profile auto-fills (duplicate detection by phone);
 * else quick-create (name, age, sex). Position: শেষে যোগ (default) or
 * নির্দিষ্ট অবস্থানে (reason required). Confirm → `EVT-WALKIN_ADDED`."
 *
 * The serial comes back from the server, issued under the session's lock,
 * and the toast says it aloud-ready. The row itself arrives on the session
 * channel like every other change.
 */

import { useEffect, useState, type ReactNode } from 'react';

import {
  format,
  formatSerial,
  numeralsFor,
  t,
  toLatinDigits,
  type ConsoleKey,
} from '@platform/i18n';
import { Button, FilterChip, Input, Sheet, SheetActions, useLocale } from '@platform/ui';

import { FAILURE_KEY, PatientFinder, type ChosenPatient } from '@/components/PatientFinder';
import { addWalkIn } from '@/lib/registration';

export function WalkInSheet({
  sessionId,
  open,
  online,
  waiting,
  onAdded,
  onClose,
}: {
  readonly sessionId: string;
  readonly open: boolean;
  readonly online: boolean;
  /** How many are waiting, so a position can be no further back than the end. */
  readonly waiting: number;
  readonly onAdded: (message: string) => void;
  readonly onClose: () => void;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const [patient, setPatient] = useState<ChosenPatient | null>(null);
  const [atPosition, setAtPosition] = useState(false);
  const [place, setPlace] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ConsoleKey | null>(null);

  // Every opening starts from the phone.
  useEffect(() => {
    if (!open) return;
    setPatient(null);
    setAtPosition(false);
    setPlace('');
    setReason('');
    setError(null);
  }, [open]);

  const placeNumber = /^\d{1,3}$/.test(toLatinDigits(place).trim())
    ? Number(toLatinDigits(place).trim())
    : null;
  const positionReady =
    !atPosition ||
    (placeNumber !== null &&
      placeNumber >= 1 &&
      placeNumber <= waiting + 1 &&
      reason.trim() !== '');

  async function confirm(): Promise<void> {
    if (patient === null || !positionReady || busy) return;
    setBusy(true);
    setError(null);
    const result = await addWalkIn(
      sessionId,
      patient.patientId,
      atPosition && placeNumber !== null
        ? { kind: 'index', index: placeNumber - 1, reason: reason.trim() }
        : { kind: 'end' },
    );
    setBusy(false);
    if (!result.ok) {
      setError(FAILURE_KEY[result.failure]);
      return;
    }
    onAdded(
      format('walkInAdded', locale, {
        name: patient.fullName,
        serial: formatSerial(result.value, numerals),
      }),
    );
  }

  const blocked = !online
    ? t('walkInOffline', locale)
    : patient === null
      ? t('registrationChooseFirst', locale)
      : positionReady
        ? null
        : t('walkInNeedReason', locale);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      variant="modal"
      title={t('addWalkin', locale)}
      description={t('walkInDescription', locale)}
    >
      <div className="flex flex-col gap-4" data-testid="walkin-sheet">
        {patient === null ? (
          <PatientFinder online={online} onChosen={setPatient} />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-brand-100 px-4 py-3">
            <p className="text-body-md font-semibold" data-testid="walkin-patient">
              {patient.fullName}
            </p>
            <Button
              variant="quiet"
              onClick={() => {
                setPatient(null);
              }}
            >
              {t('counterChangePatient', locale)}
            </Button>
          </div>
        )}

        {patient === null ? null : (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-body-sm text-ink-secondary">
              {t('walkInWhere', locale)}
            </legend>
            <div className="flex flex-wrap gap-2">
              <FilterChip
                selected={!atPosition}
                onToggle={() => {
                  setAtPosition(false);
                }}
              >
                {t('walkInPositionEnd', locale)}
              </FilterChip>
              <FilterChip
                selected={atPosition}
                onToggle={() => {
                  setAtPosition(true);
                }}
              >
                {t('walkInPositionAt', locale)}
              </FilterChip>
            </div>
            {atPosition ? (
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  label={t('walkInPlace', locale)}
                  kind="number"
                  density="console"
                  required
                  value={place}
                  data-testid="walkin-place"
                  onChange={(event) => {
                    setPlace(event.target.value);
                  }}
                />
                <Input
                  label={t('walkInReason', locale)}
                  helper={t('walkInReasonHelper', locale)}
                  density="console"
                  required
                  value={reason}
                  data-testid="walkin-reason"
                  onChange={(event) => {
                    setReason(event.target.value);
                  }}
                />
              </div>
            ) : null}
          </fieldset>
        )}

        {error === null ? null : (
          <p role="alert" className="text-body-sm text-alert-700" data-testid="walkin-error">
            {t(error, locale)}
          </p>
        )}

        <SheetActions>
          <Button variant="secondary" onClick={onClose}>
            {t('checkInCancel', locale)}
          </Button>
          {blocked === null ? (
            <Button loading={busy} onClick={() => void confirm()} data-testid="walkin-confirm">
              {t('walkInConfirm', locale)}
            </Button>
          ) : (
            <Button disabled disabledReason={blocked} data-testid="walkin-confirm">
              {t('walkInConfirm', locale)}
            </Button>
          )}
        </SheetActions>
      </div>
    </Sheet>
  );
}
