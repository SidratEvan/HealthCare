'use client';

/**
 * The patient panel — `FR-DOC-03`, `APP_FLOW.md` B2's "Patient panel" row.
 *
 * "On calling a patient, the screen opens with: pre-visit intake summary,
 * chronic conditions, allergies, last visits, previous prescriptions, recent
 * test results."
 *
 * Four of those six are here. Prescriptions were dropped from this version
 * (`FR-DOC-04`) and test reports arrive with the lab at step 17, and both are
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
import { formatDateTime, formatNumber, t, type Locale } from '@platform/i18n';
import { Card, Chip } from '@platform/ui';

import { readDemoSession } from '@/lib/demo';
import { fetchRecords, type PatientRecords } from '@/lib/visits';

import type { ReactNode } from 'react';

const LOCALE: Locale = 'bn';
const NUMERALS = 'latin' as const;

export function PatientPanel({ entry }: { readonly entry: QueueEntry }): ReactNode {
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
            {t('loadFailed', LOCALE)}
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
  const patient = records?.patient;

  return (
    <div className="flex items-start gap-4">
      <span className="flex size-14 shrink-0 items-center justify-center rounded-pill bg-brand-600 text-title-md font-bold tabular-nums text-white">
        {formatNumber(entry.serial, NUMERALS)}
      </span>

      <div className="min-w-0 flex-1">
        <h2 className="truncate font-reading text-title-md">
          {patient?.fullName ?? t('patientPanel', LOCALE)}
        </h2>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-ink-secondary">
          {patient?.ageYears === null || patient?.ageYears === undefined ? null : (
            <span className="tabular-nums">
              {formatNumber(patient.ageYears, NUMERALS)} {t('years', LOCALE)}
            </span>
          )}
          {patient === undefined ? null : <span>{t(sexKey(patient.sex), LOCALE)}</span>}
          {patient?.bloodGroup === null || patient?.bloodGroup === undefined ? null : (
            <span>
              {t('bloodGroup', LOCALE)} {patient.bloodGroup}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** The pre-visit answers (`MOD-A07-INTAKE`), warnings first. */
function Intake({ records }: { readonly records: PatientRecords }): ReactNode {
  const intake = records.intake;

  if (!intake?.asked) {
    return (
      <p data-testid="intake-not-asked" className="text-body-sm text-warn-700">
        {t('intakeNotAsked', LOCALE)}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Allergies first, and in the alert tone when there are any: this is the
          line that changes what a doctor may safely prescribe. */}
      <Row
        label={t('allergies', LOCALE)}
        values={intake.allergiesBn}
        tone={intake.allergiesBn.length > 0 ? 'alert' : 'neutral'}
        testId="intake-allergies"
      />
      <Row
        label={t('chronicConditions', LOCALE)}
        values={intake.conditionsBn}
        tone={intake.conditionsBn.length > 0 ? 'caution' : 'neutral'}
      />
      <Row label={t('currentMedicines', LOCALE)} values={intake.medicinesBn} />

      {intake.complaintBn === null ? null : (
        <Field label={t('chiefComplaint', LOCALE)} value={intake.complaintBn} />
      )}
      {intake.durationBn === null ? null : (
        <Field label={t('symptomDuration', LOCALE)} value={intake.durationBn} />
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
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2" data-testid={testId}>
      <span className="text-caption text-ink-muted">{label}</span>
      {values.length === 0 ? (
        <span className="text-body-sm text-ink-muted">{t('noneDeclared', LOCALE)}</span>
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

/** `FR-DOC-03`'s "last visits", newest first. */
function PastVisits({ records }: { readonly records: PatientRecords }): ReactNode {
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-4">
      <h3 className="text-body-sm font-semibold">{t('pastVisits', LOCALE)}</h3>

      {records.visits.length === 0 ? (
        <p className="text-body-sm text-ink-muted">{t('noPastVisits', LOCALE)}</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="past-visits">
          {records.visits.slice(0, 5).map((visit) => (
            <li key={visit.id} className="rounded-sm bg-surface p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-body-sm font-semibold">
                  {visit.diagnosisText ?? t('noneDeclared', LOCALE)}
                </span>
                <span className="text-caption tabular-nums text-ink-muted">
                  {formatDateTime(visit.visitedAt, NUMERALS)}
                </span>
              </div>
              <p className="text-caption text-ink-muted">
                {visit.doctorNameBn} · {visit.departmentNameBn}
              </p>
              {visit.adviceTextBn === null ? null : (
                <p className="mt-1 text-body-sm text-ink-secondary">{visit.adviceTextBn}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * What the panel cannot show, said out loud.
 *
 * `FR-DOC-03` lists previous prescriptions and recent test results. Neither
 * exists in this version, and a heading with nothing under it would tell a
 * doctor this patient has never been prescribed anything — which is a clinical
 * statement the product cannot support (`PRD.md` §3.2, `FR-OFF-05`).
 */
function Absent({ records }: { readonly records: PatientRecords }): ReactNode {
  if (records.absent.length === 0) return null;

  return (
    <p data-testid="panel-absent" className="text-caption text-ink-muted">
      {records.absent
        .map((what) =>
          what === 'prescriptions' ? t('prescriptionsAbsent', LOCALE) : t('reportsAbsent', LOCALE),
        )
        .join(' · ')}
    </p>
  );
}

/** `patients.sex` is an enum; the label for it is a message key. */
function sexKey(sex: string): 'sexMale' | 'sexFemale' | 'sexOther' {
  if (sex === 'male') return 'sexMale';
  if (sex === 'female') return 'sexFemale';
  return 'sexOther';
}
