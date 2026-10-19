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

import { useCallback, useEffect, useRef, useState } from 'react';

import { format, formatSerial, numeralsFor, t, toLatinDigits, CONSOLE } from '@platform/i18n';
import {
  Button,
  FilterChip,
  Input,
  Sheet,
  SheetActions,
  useLocale,
  ConsoleHelp,
  ConsoleConfirmation,
} from '@platform/ui';

import { FAILURE_KEY, PatientFinder } from '@/components/PatientFinder';
import { addWalkIn } from '@/lib/registration';

export function WalkInSheet({ sessionId, open, online, waiting, chamberName, onAdded, onClose }) {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const [patient, setPatient] = useState(null);
  const [atPosition, setAtPosition] = useState(false);
  const [place, setPlace] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [finderDirty, setFinderDirty] = useState(false);
  const [finderPending, setFinderPending] = useState(false);
  const [closing, setClosing] = useState(false);
  const sending = useRef(false);
  const restoreFocus = useRef(null);
  const onFinderDirty = useCallback((dirty, pending) => {
    setFinderDirty(dirty);
    setFinderPending(pending);
  }, []);
  const [error, setError] = useState(null);
  const attempt = useRef(null);

  // Every opening starts from the phone.
  useEffect(() => {
    if (!open) return;
    setPatient(null);
    setAtPosition(false);
    setPlace('');
    setReason('');
    setError(null);
    setUncertain(false);
    setClosing(false);
    setFinderDirty(false);
    setFinderPending(false);
    attempt.current = null;
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

  async function confirm() {
    if (patient === null || (!positionReady && !uncertain) || sending.current || !online) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    const signature = JSON.stringify({
      sessionId,
      patientId: patient.patientId,
      atPosition,
      placeNumber,
      reason,
    });
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, key: crypto.randomUUID(), at: new Date().toISOString() };
    const result = await addWalkIn(
      sessionId,
      patient.patientId,
      atPosition && placeNumber !== null
        ? { kind: 'index', index: placeNumber - 1, reason: reason.trim() }
        : { kind: 'end' },
      attempt.current,
    );
    setBusy(false);
    sending.current = false;
    if (!result.ok) {
      setError(FAILURE_KEY[result.failure]);
      setUncertain(uncertain || result.failure === 'uncertain');
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
      : positionReady || uncertain
        ? null
        : t('walkInNeedReason', locale);

  function requestClose() {
    if (busy || uncertain || finderPending) {
      setError('regUncertain');
      return;
    }
    if (finderDirty || patient !== null || place !== '' || reason !== '') {
      restoreFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setClosing(true);
    } else onClose();
  }
  useEffect(() => {
    const guard = (event) => {
      if (open && (finderDirty || patient !== null || uncertain || finderPending))
        event.preventDefault();
    };
    globalThis.addEventListener('beforeunload', guard);
    return () => globalThis.removeEventListener('beforeunload', guard);
  }, [open, finderDirty, patient, uncertain, finderPending]);
  return (
    <Sheet
      console
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
      variant="modal"
      title={t('addWalkin', locale)}
      description={
        chamberName === undefined
          ? t('walkInDescription', locale)
          : `${chamberName} · ${t('walkInDescription', locale)}`
      }
    >
      <div className="flex flex-col gap-4" data-testid="walkin-sheet">
        <ConsoleHelp
          topic={{
            id: 'reception-add',
            title: { bn: t('addWalkin', 'bn'), en: t('addWalkin', 'en') },
            steps: [
              { bn: t('receptionHelpAdd', 'bn'), en: t('receptionHelpAdd', 'en') },
              { bn: t('receptionHelpOffline', 'bn'), en: t('receptionHelpOffline', 'en') },
            ],
          }}
        />
        {patient === null ? (
          <PatientFinder
            online={online}
            onChosen={(chosen) => {
              setPatient(chosen);
              setFinderPending(false);
            }}
            onDirty={onFinderDirty}
          />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-brand-100 px-4 py-3">
            <p className="text-body-md font-semibold" data-testid="walkin-patient">
              {patient.fullName}
            </p>
            <Button
              variant="quiet"
              {...(busy || uncertain
                ? { disabled: true, disabledReason: t('regUncertain', locale) }
                : {})}
              onClick={() => {
                setPatient(null);
              }}
            >
              {t('counterChangePatient', locale)}
            </Button>
          </div>
        )}

        {patient === null ? null : (
          <fieldset className="flex flex-col gap-3" disabled={busy || uncertain}>
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
          <Button variant="secondary" onClick={requestClose}>
            {t('checkInCancel', locale)}
          </Button>
          {blocked === null ? (
            <Button loading={busy} onClick={() => void confirm()} data-testid="walkin-confirm">
              {t(uncertain ? 'regRetrySame' : 'walkInConfirm', locale)}
            </Button>
          ) : (
            <Button disabled disabledReason={blocked} data-testid="walkin-confirm">
              {t('walkInConfirm', locale)}
            </Button>
          )}
        </SheetActions>
        <ConsoleConfirmation
          open={closing}
          onOpenChange={(next) => {
            setClosing(next);
            if (!next) globalThis.requestAnimationFrame(() => restoreFocus.current?.focus());
          }}
          trigger={<button type="button" hidden aria-label={t('regLeaveTitle', locale)} />}
          title={CONSOLE.regLeaveTitle}
          description={CONSOLE.regLeaveBody}
          confirmLabel={CONSOLE.regDiscard}
          onConfirm={() => {
            setClosing(false);
            onClose();
          }}
        />
      </div>
    </Sheet>
  );
}
