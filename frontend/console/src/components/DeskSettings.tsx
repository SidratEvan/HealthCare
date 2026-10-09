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

import { useCallback, useEffect, useState } from 'react';

import { localName, t } from '@platform/i18n';
import { Button, Card, FilterChip, Input, useLocale } from '@platform/ui';

import { loadDesks, settingsApi, type Desk, type Saved, type SetupSnapshot } from '@/lib/settings';

import type { ReactNode } from 'react';

/** The settings screen's own runner: saves, says so, reports failure. */
type Run = <T>(call: () => Promise<Saved<T>>, success: (value: T) => string) => Promise<boolean>;

export function DeskSettings({
  snapshot,
  offline,
  run,
}: {
  readonly snapshot: SetupSnapshot;
  readonly offline: boolean;
  readonly run: Run;
}): ReactNode {
  const locale = useLocale();
  const [desks, setDesks] = useState<readonly Desk[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [nameBn, setNameBn] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [busy, setBusy] = useState(false);

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
  }, [load]);

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
          <ul className="flex flex-col gap-3">
            {desks.map((desk) => (
              <DeskRow
                key={desk.id}
                desk={desk}
                snapshot={snapshot}
                offline={offline}
                run={run}
                onChanged={() => void load()}
              />
            ))}
          </ul>
        )}

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
              if (!saved) return;
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

function DeskRow({
  desk,
  snapshot,
  offline,
  run,
  onChanged,
}: {
  readonly desk: Desk;
  readonly snapshot: SetupSnapshot;
  readonly offline: boolean;
  readonly run: Run;
  readonly onChanged: () => void;
}): ReactNode {
  const locale = useLocale();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(desk.doctorIds));
  const [confirming, setConfirming] = useState(false);
  const changed =
    chosen.size !== desk.doctorIds.length || desk.doctorIds.some((id) => !chosen.has(id));
  // A doctor listed twice under the hospital (two departments) is one chip.
  const doctors = [...new Map(snapshot.doctors.map((d) => [d.doctorId, d])).values()];

  return (
    <li
      className="flex flex-col gap-3 rounded-sm border border-line p-3"
      data-testid={`desk-${desk.id}`}
    >
      <p className="text-body-md font-semibold">{localName(locale, desk.nameBn, desk.nameEn)}</p>
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
      <div className="flex flex-wrap gap-2">
        {offline || !changed ? (
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
                () => settingsApi.updateDesk(desk.id, { doctorIds: [...chosen] }),
                () => t('settingsSaved', locale),
              ).then((saved) => {
                if (saved) onChanged();
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
    </li>
  );
}
