'use client';

/** Explicitly supported identity fields; verified/shared identities remain server locked. */
import { useState } from 'react';

import { doctorPatchBody } from '@platform/domain';
import { t } from '@platform/i18n';
import { Button, Input, useLocale } from '@platform/ui';

import { reviewField, useManagementDraft } from '@/components/AdminManagementContext';
import { settingsApi } from '@/lib/settings';

export function AdminDoctorIdentity({ doctor, offline, run: baseRun }) {
  const locale = useLocale();
  const [nameBn, setNameBn] = useState(doctor.nameBn);
  const [nameEn, setNameEn] = useState(doctor.nameEn);
  const [degrees, setDegrees] = useState(doctor.degrees ?? '');
  const [minutes, setMinutes] = useState(String(doctor.defaultConsultMinutes));
  const [busy, setBusy] = useState(false);
  const run = useManagementDraft(
    `doctor-identity-${doctor.doctorHospitalId}`,
    t('manageDoctorIdentity', locale),
    [
      reviewField(t('settingsNameBn', locale), doctor.nameBn, nameBn),
      reviewField(t('settingsNameEn', locale), doctor.nameEn, nameEn),
      reviewField(t('settingsDegrees', locale), doctor.degrees ?? '', degrees),
      reviewField(t('manageConsultMinutes', locale), String(doctor.defaultConsultMinutes), minutes),
    ],
    baseRun,
    () => {
      setNameBn(doctor.nameBn);
      setNameEn(doctor.nameEn);
      setDegrees(doctor.degrees ?? '');
      setMinutes(String(doctor.defaultConsultMinutes));
    },
  );
  const parsed = doctorPatchBody.safeParse({
    nameBn,
    nameEn,
    degrees: degrees.trim() || null,
    defaultConsultMinutes: minutes.trim() === '' ? null : Number(minutes),
  });
  const invalid = (key) =>
    !parsed.success && parsed.error.issues.some((issue) => issue.path[0] === key);
  return (
    <form
      className="grid gap-4"
      data-testid="doctor-identity"
      onSubmit={(event) => {
        event.preventDefault();
        if (!parsed.success || doctor.verified || busy || offline) return;
        setBusy(true);
        void run(
          () => settingsApi.updateDoctor(doctor.doctorHospitalId, parsed.data),
          () => t('settingsSaved', locale),
        ).finally(() => setBusy(false));
      }}
    >
      <h4>{t('manageDoctorIdentity', locale)}</h4>
      <p>{t('manageIdentityRestriction', locale)}</p>
      <Input
        density="console"
        label={t('settingsNameBn', locale)}
        value={nameBn}
        disabled={doctor.verified}
        onChange={(event) => setNameBn(event.target.value)}
        {...(invalid('nameBn') ? { error: t('manageInvalid', locale) } : {})}
      />
      <Input
        density="console"
        label={t('settingsNameEn', locale)}
        value={nameEn}
        disabled={doctor.verified}
        onChange={(event) => setNameEn(event.target.value)}
        {...(invalid('nameEn') ? { error: t('manageInvalid', locale) } : {})}
      />
      <Input
        density="console"
        label={t('settingsDegrees', locale)}
        value={degrees}
        disabled={doctor.verified}
        onChange={(event) => setDegrees(event.target.value)}
        {...(invalid('degrees') ? { error: t('manageInvalid', locale) } : {})}
      />
      <Input
        density="console"
        kind="number"
        label={t('manageConsultMinutes', locale)}
        value={minutes}
        disabled={doctor.verified}
        onChange={(event) => setMinutes(event.target.value)}
        {...(invalid('defaultConsultMinutes') ? { error: t('manageInvalid', locale) } : {})}
      />
      <Button
        type="submit"
        loading={busy}
        {...(doctor.verified || offline || !parsed.success
          ? {
              disabled: true,
              disabledReason: t(
                doctor.verified
                  ? 'settingsNotAllowedVerified'
                  : offline
                    ? 'settingsOffline'
                    : 'manageInvalid',
                locale,
              ),
            }
          : {})}
        data-testid="doctor-identity-save"
      >
        {t('settingsSaveChanges', locale)}
      </Button>
    </form>
  );
}
