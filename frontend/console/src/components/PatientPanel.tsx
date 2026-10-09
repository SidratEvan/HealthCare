'use client';

/**
 * The patient panel — `FR-DOC-03`, `APP_FLOW.md` B2's "Patient panel" row.
 *
 * "On calling a patient, the screen opens with: pre-visit intake summary,
 * chronic conditions, allergies, last visits, previous prescriptions, recent
 * test results."
 *
 * Five of those six are here: previous prescriptions are each past visit's
 * medicines since plan R2 (`FR-DOC-04`), printable as the patient was given
 * them (`FR-DOC-07`). Test results are not part of this read, and that is
 * **named on the screen** rather than left as blank space. That is `PRD.md` §3.2:
 * an empty area under a heading reads as "this patient has none", which about
 * allergies or medication is not a harmless difference.
 *
 * ## Allergies are laid out first among the warnings, on purpose
 *
 * A doctor scanning this panel for ten seconds before speaking needs to see an
 * allergy before anything else on it, and needs to be able to tell *no allergy
 * declared* from *nobody asked*. Those are different facts and the panel prints
 * whichever is true — which is why `Intake.asked` exists at all.
 */

import { useEffect, useState } from 'react';

import type { QueueEntry } from '@platform/domain';
import {
  formatDateTime,
  formatNumber,
  t,
  numeralsFor,
  localName,
  prescriptionSheet,
  toBengaliDigits,
} from '@platform/i18n';
import type { Locale } from '@platform/i18n';
import { Button, Card, Chip, useLocale, usePrintSheet } from '@platform/ui';

import { readDemoSession } from '@/lib/demo';
import { fetchRecords, type PatientRecords, type PrescribedMedicine } from '@/lib/visits';

import type { ReactNode } from 'react';

export function PatientPanel({ entry }: { readonly entry: QueueEntry }): ReactNode {
  const locale = useLocale();
  const [records, setRecords] = useState<PatientRecords | null>(null);
  const [failed, setFailed] = useState(false);

  const bookingId = entry.bookingId;
  const patientId = entry.patientId;

  useEffect(() => {
    let cancelled = false;
    setRecords(null);
    setFailed(false);

    void fetchRecords({
      apiBaseUrl: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1',
      token: readDemoSession()?.token ?? null,
      patientId,
      bookingId,
    })
      .then((result) => {
        if (!cancelled) setRecords(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [patientId, bookingId]);

  return (
    <Card tone="brand">
      <div className="flex flex-col gap-5" data-testid="patient-panel">
        <Header entry={entry} records={records} />

        {failed ? (
          // GR-03's error state. The serial is still correct and still useful,
          // so the panel degrades to it rather than disappearing.
          <p role="status" className="text-body-sm text-alert-700">
            {t('loadFailed', locale)}
          </p>
        ) : records === null ? (
          <div aria-busy="true" className="flex flex-col gap-2">
            <div className="h-4 w-1/2 rounded-sm bg-sunken" />
            <div className="h-4 w-1/3 rounded-sm bg-sunken" />
          </div>
        ) : (
          <>
            <Intake records={records} />
            <PastVisits records={records} />
            <Absent records={records} />
          </>
        )}
      </div>
    </Card>
  );
}

/** Serial, name, age and sex — what a doctor says out loud to confirm. */
function Header({
  entry,
  records,
}: {
  readonly entry: QueueEntry;
  readonly records: PatientRecords | null;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const patient = records?.patient;

  return (
    <div className="flex items-start gap-4">
      <span className="flex size-14 shrink-0 items-center justify-center rounded-pill bg-brand-600 text-title-md font-bold tabular-nums text-white">
        {formatNumber(entry.serial, numerals)}
      </span>

      <div className="min-w-0 flex-1">
        <h2 className="truncate font-reading text-title-md">
          {patient?.fullName ?? t('patientPanel', locale)}
        </h2>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-ink-secondary">
          {patient?.ageYears === null || patient?.ageYears === undefined ? null : (
            <span className="tabular-nums">
              {formatNumber(patient.ageYears, numerals)} {t('years', locale)}
            </span>
          )}
          {patient === undefined ? null : <span>{t(sexKey(patient.sex), locale)}</span>}
          {patient?.bloodGroup === null || patient?.bloodGroup === undefined ? null : (
            <span>
              {t('bloodGroup', locale)} {patient.bloodGroup}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** The pre-visit answers (`MOD-A07-INTAKE`), warnings first. */
function Intake({ records }: { readonly records: PatientRecords }): ReactNode {
  const locale = useLocale();
  const intake = records.intake;

  if (!intake?.asked) {
    return (
      <p data-testid="intake-not-asked" className="text-body-sm text-warn-700">
        {t('intakeNotAsked', locale)}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Allergies first, and in the alert tone when there are any: this is the
          line that changes what a doctor may safely prescribe. */}
      <Row
        label={t('allergies', locale)}
        values={intake.allergiesBn}
        tone={intake.allergiesBn.length > 0 ? 'alert' : 'neutral'}
        testId="intake-allergies"
      />
      <Row
        label={t('chronicConditions', locale)}
        values={intake.conditionsBn}
        tone={intake.conditionsBn.length > 0 ? 'caution' : 'neutral'}
      />
      <Row label={t('currentMedicines', locale)} values={intake.medicinesBn} />

      {intake.complaintBn === null ? null : (
        <Field label={t('chiefComplaint', locale)} value={intake.complaintBn} />
      )}
      {intake.durationBn === null ? null : (
        <Field label={t('symptomDuration', locale)} value={intake.durationBn} />
      )}
    </div>
  );
}

/**
 * A list that states an empty answer rather than rendering nothing.
 *
 * "কিছু জানানো হয়নি" under *allergies* is a fact a doctor can act on. A blank
 * space is not.
 */
function Row({
  label,
  values,
  tone = 'neutral',
  testId,
}: {
  readonly label: string;
  readonly values: readonly string[];
  readonly tone?: 'neutral' | 'caution' | 'alert';
  readonly testId?: string;
}): ReactNode {
  const locale = useLocale();
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2" data-testid={testId}>
      <span className="text-caption text-ink-muted">{label}</span>
      {values.length === 0 ? (
        <span className="text-body-sm text-ink-muted">{t('noneDeclared', locale)}</span>
      ) : (
        <span className="flex flex-wrap gap-2">
          {values.map((value) => (
            <Chip key={value} tone={tone}>
              {value}
            </Chip>
          ))}
        </span>
      )}
    </div>
  );
}

function Field({ label, value }: { readonly label: string; readonly value: string }): ReactNode {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <span className="text-caption text-ink-muted">{label}</span>
      <span className="text-body-md">{value}</span>
    </div>
  );
}

/** `FR-DOC-03`'s "last visits", newest first. Also what a consent code opens. */
export function PastVisits({ records }: { readonly records: PatientRecords }): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  // `FR-DOC-07`: a past prescription printed as the patient was given it.
  const { sheet, print } = usePrintSheet();
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-4">
      <h3 className="text-body-sm font-semibold">{t('pastVisits', locale)}</h3>

      {/* What is shown is this hospital's part of the record, and the screen
          says so (`FR-NET-02`). It does not say whether there is more: that
          a record exists elsewhere is not this hospital's to be told. */}
      {records.visitsFrom !== 'this_hospital' ? null : (
        <p className="text-caption text-ink-muted" data-testid="past-visits-here-only">
          {t('pastVisitsHereOnly', locale)}
        </p>
      )}

      {records.visits.length === 0 ? (
        <p className="text-body-sm text-ink-muted" data-testid="past-visits-none">
          {t(records.visitsFrom === 'this_hospital' ? 'noPastVisitsHere' : 'noPastVisits', locale)}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="past-visits">
          {records.visits.slice(0, 5).map((visit) => (
            <li key={visit.id} className="rounded-sm bg-surface p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-body-sm font-semibold">
                  {visit.diagnosisText ?? t('noneDeclared', locale)}
                </span>
                <span className="text-caption tabular-nums text-ink-muted">
                  {formatDateTime(visit.visitedAt, numerals)}
                </span>
              </div>
              <p className="text-caption text-ink-muted">
                {localName(locale, visit.doctorNameBn, visit.doctorNameEn)} ·{' '}
                {localName(locale, visit.departmentNameBn, visit.departmentNameEn)}
              </p>
              {visit.adviceTextBn === null ? null : (
                <p className="mt-1 text-body-sm text-ink-secondary">{visit.adviceTextBn}</p>
              )}
              {visit.medicines.length === 0 ? null : (
                <div className="mt-2 flex flex-col gap-2">
                  <ul
                    className="flex flex-col gap-1 text-body-sm"
                    data-testid={`past-visit-medicines-${visit.id}`}
                  >
                    {visit.medicines.map((medicine, index) => (
                      <li key={`${String(index)}-${medicine.name}`}>
                        {medicineSummary(medicine, locale)}
                      </li>
                    ))}
                  </ul>
                  <div>
                    <Button
                      variant="secondary"
                      size="sm"
                      data-testid={`past-visit-print-${visit.id}`}
                      onClick={() => {
                        print(
                          prescriptionSheet(visit, {
                            name: records.patient.fullName,
                            ageYears: records.patient.ageYears,
                            sex: records.patient.sex,
                          }),
                        );
                      }}
                    >
                      {t('rxPrint', locale)}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {sheet}
    </section>
  );
}

/** One medicine on one line: name, strength, schedule, days, instruction. */
function medicineSummary(medicine: PrescribedMedicine, locale: Locale): string {
  const digits = (text: string): string => (locale === 'bn' ? toBengaliDigits(text) : text);
  return [
    medicine.name,
    medicine.strength,
    medicine.schedule === null ? null : digits(medicine.schedule),
    medicine.durationDays === null
      ? null
      : t('rxDaysCount', locale).replace('{days}', digits(String(medicine.durationDays))),
    medicine.instructionBn,
  ]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ');
}

/**
 * What the panel cannot show, said out loud.
 *
 * `FR-DOC-03` lists recent test results, which this read does not carry, and
 * a heading with nothing under it would tell a doctor this patient has had
 * none — a clinical statement the product cannot support (`PRD.md` §3.2,
 * `FR-OFF-05`).
 */
export function Absent({ records }: { readonly records: PatientRecords }): ReactNode {
  const locale = useLocale();
  if (records.absent.length === 0) return null;

  return (
    <p data-testid="panel-absent" className="text-caption text-ink-muted">
      {records.absent.map(() => t('reportsAbsent', locale)).join(' · ')}
    </p>
  );
}

/** `patients.sex` is an enum; the label for it is a message key. */
function sexKey(sex: string): 'sexMale' | 'sexFemale' | 'sexOther' {
  if (sex === 'male') return 'sexMale';
  if (sex === 'female') return 'sexFemale';
  return 'sexOther';
}
