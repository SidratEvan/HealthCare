'use client';

/** Existing clinical fields, approved composition (FR-DOC-04/06/07/08, FR-GOV-03).
 * Invalid custom days stay in memory and clear followUpDate on draft save.
 */
import { customFollowUpDays, followUpDateIn, followUpDateLabel } from '@platform/client';
import { SYMPTOM_SIGNALS } from '@platform/domain';
import {
  CONSOLE,
  format,
  formatNumber,
  localName,
  numeralsFor,
  symptomSignalName,
  t,
} from '@platform/i18n';
import { BilingualLabel, Input, useLocale } from '@platform/ui';

import { MedicineRows } from '@/components/MedicineRows';

export function DoctorRecord({
  disabled,
  draft,
  catalogue,
  onChange,
  medicineProblems,
  failed,
  excluded,
  now,
}) {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const custom = draft.customFollowUp !== undefined;
  const days = custom ? customFollowUpDays(draft.customFollowUp ?? '') : draft.followUpDays;
  const invalid = custom && days === null;
  const date = invalid
    ? null
    : (draft.followUpDate ?? (days === null ? null : followUpDateIn(days, now)));
  const heading = (step, label) => (
    <h2 className="doc-section-heading">
      <span aria-hidden="true">{formatNumber(step, numerals)}</span>
      <BilingualLabel label={label} />
    </h2>
  );
  return (
    <div className="doc-record-form">
      <h2 className="doc-record-title">{t('visitNote', locale)}</h2>
      {failed ? (
        <p role="alert" className="doc-alert" data-testid="visit-failed">
          {t('visitSaveFailed', locale)}
        </p>
      ) : null}
      <section className="doc-section" data-help-topic="notes">
        {heading(1, CONSOLE.diagnosis)}
        <Input
          label={t('diagnosis', locale)}
          helper={t('diagnosisHint', locale)}
          density="console"
          data-testid="visit-diagnosis"
          value={draft.diagnosisText}
          disabled={disabled}
          onChange={(event) => onChange({ ...draft, diagnosisText: event.target.value })}
        />
      </section>
      <section className="doc-section" data-help-topic="notes">
        {heading(2, CONSOLE.rxTitle)}
        <MedicineRows
          rows={draft.medicines}
          problems={medicineProblems}
          disabled={disabled}
          onChange={(rows) => onChange({ ...draft, medicines: rows })}
        />
      </section>
      <section className="doc-section" data-help-topic="tests">
        {heading(3, CONSOLE.orderTests)}
        {catalogue.length === 0 ? (
          <p>{t('doctorTestsUnavailable', locale)}</p>
        ) : (
          <fieldset data-testid="visit-tests">
            <legend>{t('orderTests', locale)}</legend>
            <div className="doc-options">
              {catalogue.map((test) => (
                <button
                  key={test.code}
                  type="button"
                  disabled={disabled}
                  aria-pressed={draft.testCodes.includes(test.code)}
                  onClick={() =>
                    onChange({
                      ...draft,
                      testCodes: draft.testCodes.includes(test.code)
                        ? draft.testCodes.filter((code) => code !== test.code)
                        : [...draft.testCodes, test.code],
                    })
                  }
                >
                  {localName(locale, test.nameBn, test.nameEn)}
                </button>
              ))}
            </div>
            <p>
              {draft.testCodes.length === 0
                ? t('orderTestsHint', locale)
                : format('orderTestsCount', locale, {
                    count: formatNumber(draft.testCodes.length, numerals),
                  })}
            </p>
          </fieldset>
        )}
      </section>
      <section className="doc-section" data-help-topic="notes">
        {heading(4, CONSOLE.adviceBn)}
        <label htmlFor="doctor-advice">{t('adviceBn', locale)}</label>
        <textarea
          id="doctor-advice"
          rows={4}
          data-testid="visit-advice"
          value={draft.adviceTextBn}
          disabled={disabled}
          onChange={(event) => onChange({ ...draft, adviceTextBn: event.target.value })}
        />
        <p>{t('adviceHint', locale)}</p>
      </section>
      <section className="doc-section" data-help-topic="followup">
        {heading(5, CONSOLE.followUp)}
        <fieldset>
          <legend>{t('followUp', locale)}</legend>
          <div className="doc-options">
            <button
              type="button"
              disabled={disabled}
              aria-pressed={!custom && draft.followUpDays === null && draft.followUpDate == null}
              data-testid="follow-up-none"
              onClick={() =>
                onChange({
                  ...draft,
                  customFollowUp: undefined,
                  followUpDays: null,
                  followUpDate: null,
                })
              }
            >
              {t('followUpNone', locale)}
            </button>
            {[7, 14, 30].map((value) => (
              <button
                key={value}
                type="button"
                disabled={disabled}
                data-testid={`follow-up-${value}`}
                aria-pressed={!custom && draft.followUpDays === value}
                onClick={() =>
                  onChange({
                    ...draft,
                    customFollowUp: undefined,
                    followUpDays: value,
                    followUpDate: null,
                  })
                }
              >
                {format('followUpDays', locale, { days: formatNumber(value, numerals) })}
              </button>
            ))}
            <button
              type="button"
              disabled={disabled}
              data-testid="follow-up-custom"
              aria-pressed={custom}
              onClick={() =>
                onChange({
                  ...draft,
                  customFollowUp: draft.customFollowUp ?? '',
                  followUpDays: null,
                  followUpDate: null,
                })
              }
            >
              {t('doctorFollowUpCustom', locale)}
            </button>
          </div>
        </fieldset>
        {custom ? (
          <Input
            label={t('doctorFollowUpDays', locale)}
            density="console"
            kind="number"
            data-testid="follow-up-days"
            value={draft.customFollowUp ?? ''}
            disabled={disabled}
            {...(invalid ? { error: t('doctorFollowUpInvalid', locale) } : {})}
            onChange={(event) =>
              onChange({
                ...draft,
                customFollowUp: event.target.value,
                followUpDays: customFollowUpDays(event.target.value),
                followUpDate: null,
              })
            }
          />
        ) : null}
        {date === null ? null : (
          <p data-testid="follow-up-date" className="doc-followup-date">
            {followUpDateLabel(date, locale)}
          </p>
        )}
        {excluded ? (
          <p className="doc-caution" data-testid="follow-up-excluded">
            {t('doctorFollowUpExcluded', locale)}
          </p>
        ) : null}
        <p>{t('doctorFollowUpNoAppointment', locale)}</p>
      </section>
      <section className="doc-section" data-help-topic="signal">
        {heading(6, CONSOLE.visitSignal)}
        <fieldset data-testid="visit-signal">
          <legend>{t('visitSignal', locale)}</legend>
          <div className="doc-options">
            <button
              type="button"
              disabled={disabled}
              data-testid="visit-signal-none"
              aria-pressed={draft.symptomSignal === null}
              onClick={() => onChange({ ...draft, symptomSignal: null })}
            >
              {t('visitSignalNone', locale)}
            </button>
            {SYMPTOM_SIGNALS.map((signal) => (
              <button
                key={signal}
                type="button"
                disabled={disabled}
                data-testid={`visit-signal-${signal}`}
                aria-pressed={draft.symptomSignal === signal}
                onClick={() => onChange({ ...draft, symptomSignal: signal })}
              >
                {symptomSignalName(signal, locale)}
              </button>
            ))}
          </div>
          <p>{t('visitSignalHint', locale)}</p>
        </fieldset>
      </section>
    </div>
  );
}
