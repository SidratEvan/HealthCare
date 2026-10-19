'use client';

/**
 * `FRM-B11-DESKS` — a hospital's reception desks (`PRD.md` `FR-REC-32`;
 * `APP_FLOW.md` B6; plan R4; the owner's decision 2b of 8 October).
 *
 * Each desk with its names and a chip for every doctor of the hospital,
 * ticked when the desk looks after them; saved per desk; removed after asking
 * twice. A line under the heading says what a desk does and does not do: it
 * puts a receptionist's chambers first and locks nobody out (decision 2a).
 */

import { useCallback, useEffect, useState, useRef } from 'react';

import { localName, t } from '@platform/i18n';
import { Button, Card, FilterChip, Input, Sheet, useLocale } from '@platform/ui';

import {
  reviewField,
  useManagementDraft,
  useAdminManagement,
} from '@/components/AdminManagementContext';
import { loadDesks, settingsApi } from '@/lib/settings';

export function DeskSettings({ snapshot, offline, run: baseRun }) {
  const locale = useLocale();
  const [desks, setDesks] = useState(null);
  const [failed, setFailed] = useState(false);
  const [nameBn, setNameBn] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [busy, setBusy] = useState(false);
  const management = useAdminManagement();
  const focus = useRef(null);
  const [selected, setSelected] = useState(null);
  const run = useManagementDraft(
    'desk-add',
    t('desksAdd', locale),
    [
      reviewField(t('desksNameBn', locale), '', nameBn),
      reviewField(t('desksNameEn', locale), '', nameEn),
    ],
    baseRun,
    () => {
      setNameBn('');
      setNameEn('');
    },
  );

  const load = useCallback(async () => {
    const result = await loadDesks();
    if (result === 'offline' || result === 'error') {
      setFailed(true);
      return;
    }
    setFailed(false);
    setDesks(result);
  }, []);

  useEffect(() => {
    void load();
  }, [load, snapshot.serverTs]);

  const ready = nameBn.trim() !== '' && nameEn.trim() !== '';

  return (
    <Card>
      <section className="flex flex-col gap-4" data-testid="settings-desks">
        <h2 className="text-title-sm">{t('desksTitle', locale)}</h2>
        <p className="text-body-sm text-ink-secondary">{t('desksHint', locale)}</p>

        {failed ? (
          <div role="alert" className="flex items-center gap-3 text-body-sm text-alert-700">
            {t('loadFailed', locale)}
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              {t('retry', locale)}
            </Button>
          </div>
        ) : desks === null ? (
          <div className="h-16 rounded-sm bg-sunken" aria-busy="true" />
        ) : desks.length === 0 ? (
          <p className="text-body-sm text-ink-muted" data-testid="desks-none">
            {t('desksNone', locale)}
          </p>
        ) : (
          <div className="admin-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('manageDesks', locale)}</th>
                  <th>{t('adminNavDoctors', locale)}</th>
                  <th>{t('manageStaffList', locale)}</th>
                  <th>{t('manageChange', locale)}</th>
                </tr>
              </thead>
              <tbody>
                {desks.map((desk) => (
                  <tr key={desk.id}>
                    <th>{localName(locale, desk.nameBn, desk.nameEn)}</th>
                    <td>
                      {desk.doctorIds
                        .map((id) => snapshot.doctors.find((d) => d.doctorId === id))
                        .filter((d) => d !== undefined)
                        .map((d) => localName(locale, d.nameBn, d.nameEn))
                        .join(', ') || '—'}
                    </td>
                    <td>
                      {desk.staffIds
                        .map((id) => snapshot.staff.find((p) => p.id === id)?.fullName ?? '—')
                        .join(', ') || '—'}
                    </td>
                    <td>
                      <Button
                        variant="quiet"
                        data-testid={`desk-change-${desk.id}`}
                        onClick={() =>
                          management?.navigate(() => {
                            focus.current =
                              document.activeElement instanceof HTMLElement
                                ? document.activeElement
                                : null;
                            setSelected(desk.id);
                          })
                        }
                      >
                        {t('manageChange', locale)}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p>{t('manageDeskConsequence', locale)}</p>
        <Sheet
          console
          className="admin-person-sheet"
          variant="modal"
          restoreFocusTo={() => focus.current}
          open={selected !== null}
          title={t('manageDesks', locale)}
          description={localName(locale, snapshot.hospital.nameBn, snapshot.hospital.nameEn)}
          onOpenChange={(open) => {
            if (!open) management?.navigate(() => setSelected(null));
          }}
        >
          <div className="admin-workspace admin-person-panel">
            <Button
              variant="quiet"
              onClick={() => management?.navigate(() => setSelected(null))}
              {...(management?.busy
                ? { disabled: true, disabledReason: t('manageSaving', locale) }
                : {})}
              data-testid="desk-close"
            >
              {t('manageClose', locale)}
            </Button>
            {desks
              ?.filter((desk) => desk.id === selected)
              .map((desk) => (
                <DeskRow
                  key={desk.id}
                  desk={desk}
                  snapshot={snapshot}
                  offline={offline || failed}
                  run={baseRun}
                  onChanged={() => void load()}
                />
              ))}
          </div>
        </Sheet>

        <form
          className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end"
          data-testid="desk-add-form"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            void run(
              () =>
                settingsApi.addDesk({
                  nameBn: nameBn.trim(),
                  nameEn: nameEn.trim(),
                  doctorIds: [],
                }),
              () => t('settingsSaved', locale),
            ).then((saved) => {
              setBusy(false);
              if (!saved) {
                void load();
                return;
              }
              setNameBn('');
              setNameEn('');
              void load();
            });
          }}
        >
          <Input
            label={t('desksNameBn', locale)}
            density="console"
            value={nameBn}
            data-testid="desk-name-bn"
            onChange={(event) => {
              setNameBn(event.target.value);
            }}
          />
          <Input
            label={t('desksNameEn', locale)}
            density="console"
            value={nameEn}
            data-testid="desk-name-en"
            onChange={(event) => {
              setNameEn(event.target.value);
            }}
          />
          {offline || !ready ? (
            <Button
              disabled
              disabledReason={t(offline ? 'settingsOffline' : 'desksNameFirst', locale)}
              data-testid="desk-add"
            >
              {t('desksAdd', locale)}
            </Button>
          ) : (
            <Button type="submit" loading={busy} data-testid="desk-add">
              {t('desksAdd', locale)}
            </Button>
          )}
        </form>
      </section>
    </Card>
  );
}

function DeskRow({ desk, snapshot, offline, run: baseRun, onChanged }) {
  const locale = useLocale();
  const [chosen, setChosen] = useState(() => new Set(desk.doctorIds));
  // Question 20: the receptionists at this desk manage only its doctors.
  const [staff, setStaff] = useState(() => new Set(desk.staffIds));
  const receptionists = snapshot.staff.filter(
    (person) => person.isActive && person.roles.includes('receptionist'),
  );
  const [confirming, setConfirming] = useState(false);
  const [nameBn, setNameBn] = useState(desk.nameBn);
  const [nameEn, setNameEn] = useState(desk.nameEn);
  const doctorNames = (value) =>
    Array.isArray(value)
      ? value
          .map((id) => snapshot.doctors.find((d) => d.doctorId === id))
          .filter((d) => d !== undefined)
          .map((d) => localName(locale, d.nameBn, d.nameEn))
          .join(', ')
      : '';
  const staffNames = (value) =>
    Array.isArray(value)
      ? value
          .map((id) => snapshot.staff.find((person) => person.id === id)?.fullName ?? '—')
          .join(', ')
      : '';
  const run = useManagementDraft(
    `desk-${desk.id}`,
    localName(locale, desk.nameBn, desk.nameEn),
    [
      reviewField(t('desksNameBn', locale), desk.nameBn, nameBn),
      reviewField(t('desksNameEn', locale), desk.nameEn, nameEn),
      reviewField(
        t('adminNavDoctors', locale),
        [...desk.doctorIds].sort(),
        [...chosen].sort(),
        doctorNames,
      ),
      reviewField(
        t('manageStaffList', locale),
        [...desk.staffIds].sort(),
        [...staff].sort(),
        staffNames,
      ),
    ],
    baseRun,
    () => {
      setNameBn(desk.nameBn);
      setNameEn(desk.nameEn);
      setChosen(new Set(desk.doctorIds));
      setStaff(new Set(desk.staffIds));
    },
  );
  const changed =
    nameBn !== desk.nameBn ||
    nameEn !== desk.nameEn ||
    chosen.size !== desk.doctorIds.length ||
    desk.doctorIds.some((id) => !chosen.has(id)) ||
    staff.size !== desk.staffIds.length ||
    desk.staffIds.some((id) => !staff.has(id));
  // A doctor listed twice under the hospital (two departments) is one chip.
  const doctors = [...new Map(snapshot.doctors.map((d) => [d.doctorId, d])).values()];

  return (
    <article
      className="flex flex-col gap-3 rounded-sm border border-line p-3"
      data-testid={`desk-${desk.id}`}
    >
      <p className="text-body-md font-semibold">{localName(locale, desk.nameBn, desk.nameEn)}</p>
      <Input
        density="console"
        label={t('desksNameBn', locale)}
        value={nameBn}
        onChange={(event) => setNameBn(event.target.value)}
        data-testid="desk-edit-name-bn"
      />
      <Input
        density="console"
        label={t('desksNameEn', locale)}
        value={nameEn}
        onChange={(event) => setNameEn(event.target.value)}
        data-testid="desk-edit-name-en"
      />
      <p>{t('manageDeskConsequence', locale)}</p>
      <div className="flex flex-wrap gap-2">
        {doctors.map((doctor) => (
          <FilterChip
            key={doctor.doctorId}
            selected={chosen.has(doctor.doctorId)}
            onToggle={() => {
              const next = new Set(chosen);
              if (next.has(doctor.doctorId)) next.delete(doctor.doctorId);
              else next.add(doctor.doctorId);
              setChosen(next);
            }}
          >
            {localName(locale, doctor.nameBn, doctor.nameEn)}
          </FilterChip>
        ))}
      </div>
      {receptionists.length === 0 ? null : (
        <div className="flex flex-col gap-2" data-testid={`desk-staff-${desk.id}`}>
          <p className="text-caption text-ink-muted">{t('desksStaffHint', locale)}</p>
          <div className="flex flex-wrap gap-2">
            {receptionists.map((person) => (
              <FilterChip
                key={person.id}
                selected={staff.has(person.id)}
                data-testid={`desk-staff-${desk.id}-${person.id}`}
                onToggle={() => {
                  const next = new Set(staff);
                  if (next.has(person.id)) next.delete(person.id);
                  else next.add(person.id);
                  setStaff(next);
                }}
              >
                {person.fullName}
              </FilterChip>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {offline || !changed || !nameBn.trim() || !nameEn.trim() ? (
          <Button
            variant="secondary"
            size="sm"
            disabled
            disabledReason={t(offline ? 'settingsOffline' : 'desksNothingChanged', locale)}
            data-testid={`desk-save-${desk.id}`}
          >
            {t('desksSave', locale)}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            data-testid={`desk-save-${desk.id}`}
            onClick={() => {
              void run(
                () =>
                  settingsApi.updateDesk(desk.id, {
                    nameBn: nameBn.trim(),
                    nameEn: nameEn.trim(),
                    doctorIds: [...chosen],
                    staffIds: [...staff],
                    expected: {
                      nameBn: desk.nameBn,
                      nameEn: desk.nameEn,
                      doctorIds: [...desk.doctorIds],
                      staffIds: [...desk.staffIds],
                    },
                  }),
                () => t('settingsSaved', locale),
              ).then(() => {
                onChanged();
              });
            }}
          >
            {t('desksSave', locale)}
          </Button>
        )}
        {offline ? null : confirming ? (
          <Button
            variant="secondary"
            size="sm"
            data-testid={`desk-remove-sure-${desk.id}`}
            onClick={() => {
              void run(
                () => settingsApi.removeDesk(desk.id),
                () => t('settingsSaved', locale),
                {
                  title: t('desksRemove', locale),
                  note: t('manageDeskConsequence', locale),
                  fields: [
                    reviewField(
                      t('manageDesks', locale),
                      localName(locale, desk.nameBn, desk.nameEn),
                      '—',
                    ),
                  ],
                },
              ).then(() => {
                setConfirming(false);
                onChanged();
              });
            }}
          >
            {t('desksRemoveSure', locale)}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            data-testid={`desk-remove-${desk.id}`}
            onClick={() => {
              setConfirming(true);
            }}
          >
            {t('desksRemove', locale)}
          </Button>
        )}
      </div>
    </article>
  );
}
