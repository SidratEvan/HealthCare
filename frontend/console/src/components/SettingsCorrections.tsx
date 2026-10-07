'use client';

/**
 * `S-B-11`: putting right what was entered wrong (plan D2, `FR-SUP-01`,
 * `FR-ADM-11`; `APP_FLOW.md` B6).
 *
 * A hospital that sets itself up by hand makes the mistakes anybody makes: a
 * department under the wrong code, a ward on the wrong floor, `301-330` typed
 * for `301-320`, a district misspelt on the application. Until this file the
 * screen could add and could not take back, so each of those stayed for good
 * or needed somebody with the database.
 *
 * What is here, each a small form beside the thing it changes:
 *
 * - the registration details (division, district, registration number), the
 *   hospital's own to correct while its workspace is setting up and read-only
 *   afterwards, because they are what the platform reviews
 *   (`identityEditable`);
 * - a department's names, and its removal while no doctor is listed under it;
 * - a ward's names and floor, and its removal while it holds no bed;
 * - a bed's label and nightly charge, and its removal while the ward has
 *   never brought it into service.
 *
 * **Nothing with a history is removed here.** A bed that has been in service
 * is retired from the ward board, where the reason is recorded; a department
 * with doctors and a ward with beds say why they cannot go. The server
 * refuses the same things whatever this screen shows.
 *
 * Split from `HospitalSettings.tsx` the way `HospitalFace.tsx` is: that file
 * is the screen, and these are parts of three of its tabs.
 */

import { useState, type FormEvent, type ReactNode } from 'react';

import { identityEditable } from '@platform/domain';
import {
  DIVISION_NAMES,
  divisionName,
  format,
  formatNumber,
  localName,
  numeralsFor,
  t,
  toLatinDigits,
} from '@platform/i18n';
import { Button, Chip, FilterChip, Input, useLocale } from '@platform/ui';

import {
  settingsApi,
  takaToPoisha,
  type Saved,
  type SettingsDepartment,
  type SettingsWard,
  type SetupSnapshot,
} from '@/lib/settings';

type Run = <T>(call: () => Promise<Saved<T>>, success: (value: T) => string) => Promise<boolean>;

interface Common {
  readonly offline: boolean;
  readonly run: Run;
}

type Bed = SettingsWard['beds'][number];

// ---------------------------------------------------------------------------
// What the hospital was registered as
// ---------------------------------------------------------------------------

export function IdentityForm({
  snapshot,
  offline,
  run,
}: Common & { readonly snapshot: SetupSnapshot }): ReactNode {
  const locale = useLocale();
  const hospital = snapshot.hospital;
  const [division, setDivision] = useState(hospital.division);
  const [district, setDistrict] = useState(hospital.district);
  const [registrationNo, setRegistrationNo] = useState(hospital.registrationNo ?? '');
  const [busy, setBusy] = useState(false);

  if (!identityEditable(hospital.lifecycle)) {
    return (
      <section className="flex flex-col gap-2" data-testid="settings-identity-locked">
        <h2 className="text-title-md">{t('settingsIdentityTitle', locale)}</h2>
        <p className="text-body-md text-ink-secondary">
          {format('settingsIdentityLocked', locale, {
            division: divisionName(hospital.division, locale),
            district: hospital.district,
            registration: hospital.registrationNo ?? t('settingsIdentityNone', locale),
          })}
        </p>
      </section>
    );
  }

  const ready = district.trim().length >= 2;

  function save(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!ready || busy || offline) return;
    setBusy(true);
    void run(
      () =>
        settingsApi.profile({
          division,
          district: district.trim(),
          registrationNo: registrationNo.trim() === '' ? null : registrationNo.trim(),
        }),
      () => t('settingsSaved', locale),
    ).finally(() => {
      setBusy(false);
    });
  }

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={save}
      data-testid="settings-identity"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-title-md">{t('settingsIdentityTitle', locale)}</h2>
        <p className="text-body-sm text-ink-secondary">{t('settingsIdentityHelp', locale)}</p>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-body-sm text-ink-secondary">
          {t('platformFieldDivision', locale)}
        </legend>
        <div className="flex flex-wrap gap-2">
          {Object.keys(DIVISION_NAMES).map((candidate) => (
            <FilterChip
              key={candidate}
              selected={division === candidate}
              data-testid={`settings-division-${candidate}`}
              onToggle={() => {
                setDivision(candidate);
              }}
            >
              {divisionName(candidate, locale)}
            </FilterChip>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 md:grid-cols-2">
        <Input
          density="console"
          label={t('platformFieldDistrict', locale)}
          value={district}
          required
          data-testid="settings-district"
          onChange={(event) => {
            setDistrict(event.target.value);
          }}
        />
        <Input
          density="console"
          label={t('platformFieldRegistration', locale)}
          value={registrationNo}
          data-testid="settings-registration"
          onChange={(event) => {
            setRegistrationNo(event.target.value);
          }}
        />
      </div>
      <SaveButton
        submit
        offline={offline}
        busy={busy}
        {...(ready ? {} : { blocked: t('settingsNeedFields', locale) })}
        testId="settings-save-identity"
      >
        {t('settingsIdentitySave', locale)}
      </SaveButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// A department
// ---------------------------------------------------------------------------

export function DepartmentRow({
  department,
  doctorsListed,
  offline,
  run,
}: Common & {
  readonly department: SettingsDepartment;
  /** Doctors listed under it, active or not: while there are any it stays. */
  readonly doctorsListed: number;
}): ReactNode {
  const locale = useLocale();
  const [editing, setEditing] = useState(false);
  const [nameBn, setNameBn] = useState(department.nameBn);
  const [nameEn, setNameEn] = useState(department.nameEn);
  const [busy, setBusy] = useState(false);
  const ready = nameBn.trim() !== '' && nameEn.trim() !== '';

  function save(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!ready || busy || offline) return;
    setBusy(true);
    void run(
      () =>
        settingsApi.updateDepartment(department.id, {
          nameBn: nameBn.trim(),
          nameEn: nameEn.trim(),
        }),
      () => t('settingsSaved', locale),
    )
      .then((saved) => {
        if (saved) setEditing(false);
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <li
      className="flex flex-col gap-3 px-4 py-3"
      data-testid={`settings-dept-row-${department.code}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-body-md">
          {localName(locale, department.nameBn, department.nameEn)}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <Chip tone="neutral">{department.code}</Chip>
          <Button
            variant="quiet"
            type="button"
            data-testid={`settings-dept-edit-${department.code}`}
            onClick={() => {
              // Closing without saving puts back what is saved.
              setNameBn(department.nameBn);
              setNameEn(department.nameEn);
              setEditing((open) => !open);
            }}
          >
            {t(editing ? 'settingsCancel' : 'settingsEdit', locale)}
          </Button>
          {doctorsListed === 0 ? (
            <RemoveControl
              offline={offline}
              testId={`settings-dept-remove-${department.code}`}
              onRemove={() =>
                run(
                  () => settingsApi.removeDepartment(department.id),
                  () => t('settingsRemoved', locale),
                )
              }
            />
          ) : (
            <span
              className="text-body-sm text-ink-muted"
              data-testid={`settings-dept-in-use-${department.code}`}
            >
              {format('settingsDepartmentInUse', locale, {
                count: formatNumber(doctorsListed, numeralsFor(locale)),
              })}
            </span>
          )}
        </span>
      </div>

      {editing ? (
        <form className="flex flex-wrap items-end gap-3" noValidate onSubmit={save}>
          <div className="w-64 max-w-full">
            <Input
              density="console"
              label={t('settingsNameBn', locale)}
              value={nameBn}
              required
              data-testid={`settings-dept-name-bn-${department.code}`}
              onChange={(event) => {
                setNameBn(event.target.value);
              }}
            />
          </div>
          <div className="w-64 max-w-full">
            <Input
              density="console"
              label={t('settingsNameEn', locale)}
              value={nameEn}
              required
              data-testid={`settings-dept-name-en-${department.code}`}
              onChange={(event) => {
                setNameEn(event.target.value);
              }}
            />
          </div>
          <SaveButton
            submit
            variant="secondary"
            offline={offline}
            busy={busy}
            {...(ready ? {} : { blocked: t('settingsNeedFields', locale) })}
            testId={`settings-dept-save-${department.code}`}
          >
            {t('settingsSaveChanges', locale)}
          </SaveButton>
        </form>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// A ward: its names and floor, and its removal while it is empty
// ---------------------------------------------------------------------------

export function WardEditor({
  ward,
  offline,
  run,
}: Common & { readonly ward: SettingsWard }): ReactNode {
  const locale = useLocale();
  const [editing, setEditing] = useState(false);
  const [nameBn, setNameBn] = useState(ward.nameBn);
  const [nameEn, setNameEn] = useState(ward.nameEn);
  const [floor, setFloor] = useState(String(ward.floor));
  const [busy, setBusy] = useState(false);

  const floorText = toLatinDigits(floor).trim();
  const floorNumber = /^\d{1,2}$/.test(floorText) ? Number(floorText) : null;
  const ready =
    nameBn.trim() !== '' && nameEn.trim() !== '' && floorNumber !== null && floorNumber <= 60;

  function save(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!ready || floorNumber === null || busy || offline) return;
    setBusy(true);
    void run(
      () =>
        settingsApi.updateWard(ward.id, {
          nameBn: nameBn.trim(),
          nameEn: nameEn.trim(),
          floor: floorNumber,
        }),
      () => t('settingsSaved', locale),
    )
      .then((saved) => {
        if (saved) setEditing(false);
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="quiet"
          type="button"
          data-testid={`settings-edit-ward-${ward.id}`}
          onClick={() => {
            setNameBn(ward.nameBn);
            setNameEn(ward.nameEn);
            setFloor(String(ward.floor));
            setEditing((open) => !open);
          }}
        >
          {t(editing ? 'settingsCancel' : 'settingsEdit', locale)}
        </Button>
        {/* Only an empty ward goes: a ward with beds says so on the server too. */}
        {ward.beds.length === 0 ? (
          <RemoveControl
            offline={offline}
            testId={`settings-remove-ward-${ward.id}`}
            onRemove={() =>
              run(
                () => settingsApi.removeWard(ward.id),
                () => t('settingsRemoved', locale),
              )
            }
          />
        ) : null}
      </div>

      {editing ? (
        <form className="flex flex-wrap items-end gap-3" noValidate onSubmit={save}>
          <div className="w-64 max-w-full">
            <Input
              density="console"
              label={t('settingsNameBn', locale)}
              value={nameBn}
              required
              data-testid={`settings-edit-ward-name-bn-${ward.id}`}
              onChange={(event) => {
                setNameBn(event.target.value);
              }}
            />
          </div>
          <div className="w-64 max-w-full">
            <Input
              density="console"
              label={t('settingsNameEn', locale)}
              value={nameEn}
              required
              data-testid={`settings-edit-ward-name-en-${ward.id}`}
              onChange={(event) => {
                setNameEn(event.target.value);
              }}
            />
          </div>
          <div className="w-32">
            <Input
              density="console"
              kind="number"
              label={t('settingsFloor', locale)}
              value={floor}
              required
              data-testid={`settings-edit-ward-floor-${ward.id}`}
              onChange={(event) => {
                setFloor(event.target.value);
              }}
            />
          </div>
          <SaveButton
            submit
            variant="secondary"
            offline={offline}
            busy={busy}
            {...(ready ? {} : { blocked: t('settingsNeedFields', locale) })}
            testId={`settings-edit-ward-save-${ward.id}`}
          >
            {t('settingsSaveChanges', locale)}
          </SaveButton>
        </form>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A ward's beds: choose one to change it, or to take away one never used
// ---------------------------------------------------------------------------

export function WardBeds({
  ward,
  offline,
  run,
}: Common & { readonly ward: SettingsWard }): ReactNode {
  const locale = useLocale();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (ward.beds.length === 0) return null;

  const selected = ward.beds.find((bed) => bed.id === selectedId) ?? null;
  const unconfirmed = ward.beds.filter((bed) => bed.unconfirmed).length;

  return (
    <div className="mt-3 flex flex-col gap-3" data-testid={`settings-bedlist-${ward.id}`}>
      <ul className="flex flex-wrap gap-2">
        {ward.beds.map((bed) => (
          <li key={bed.id}>
            <FilterChip
              selected={bed.id === selectedId}
              data-testid={`settings-bedchip-${bed.label}`}
              onToggle={() => {
                setSelectedId((current) => (current === bed.id ? null : bed.id));
              }}
            >
              {bed.label}
            </FilterChip>
          </li>
        ))}
      </ul>
      <p className="text-caption text-ink-muted">
        {t('settingsBedsPick', locale)}
        {unconfirmed === 0
          ? null
          : ` ${format('settingsBedsUnconfirmedCount', locale, {
              count: formatNumber(unconfirmed, numeralsFor(locale)),
            })}`}
      </p>
      {selected === null ? null : (
        // Keyed by the bed, so choosing another starts from that bed's own values.
        <BedForm key={selected.id} bed={selected} offline={offline} run={run} />
      )}
    </div>
  );
}

function BedForm({ bed, offline, run }: Common & { readonly bed: Bed }): ReactNode {
  const locale = useLocale();
  const [label, setLabel] = useState(bed.label);
  const [nightly, setNightly] = useState(String(bed.nightlyPoisha / 100));
  const [busy, setBusy] = useState(false);
  const nightlyPoisha = takaToPoisha(toLatinDigits(nightly));
  const ready = label.trim() !== '' && label.trim().length <= 20 && nightlyPoisha !== null;

  function save(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!ready || nightlyPoisha === null || busy || offline) return;
    setBusy(true);
    void run(
      () => settingsApi.updateBed(bed.id, { label: label.trim(), nightlyPoisha }),
      () => t('settingsSaved', locale),
    ).finally(() => {
      setBusy(false);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-md bg-sunken p-4" data-testid="settings-bed-form">
      <form className="flex flex-wrap items-end gap-3" noValidate onSubmit={save}>
        <div className="w-40">
          <Input
            density="console"
            label={t('settingsBedLabel', locale)}
            value={label}
            required
            data-testid="settings-bed-label"
            onChange={(event) => {
              setLabel(event.target.value);
            }}
          />
        </div>
        <div className="w-40">
          <Input
            density="console"
            kind="number"
            label={t('settingsNightly', locale)}
            value={nightly}
            data-testid="settings-bed-nightly"
            onChange={(event) => {
              setNightly(event.target.value);
            }}
          />
        </div>
        <SaveButton
          submit
          variant="secondary"
          offline={offline}
          busy={busy}
          {...(ready ? {} : { blocked: t('settingsNeedFields', locale) })}
          testId="settings-bed-save"
        >
          {t('settingsSaveChanges', locale)}
        </SaveButton>
      </form>

      {/* A bed nobody has lain in can go; one with a history is retired on the board. */}
      {bed.unconfirmed ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-body-sm text-ink-secondary" data-testid="settings-bed-unconfirmed">
            {t('settingsBedUnconfirmedNote', locale)}
          </p>
          <RemoveControl
            offline={offline}
            testId="settings-bed-remove"
            onRemove={() =>
              run(
                () => settingsApi.removeBed(bed.id),
                () => t('settingsRemoved', locale),
              )
            }
          />
        </div>
      ) : (
        <p className="text-body-sm text-ink-secondary" data-testid="settings-bed-in-service">
          {t('settingsBedInServiceNote', locale)}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small parts
// ---------------------------------------------------------------------------

/**
 * Removing is asked twice: the first press asks, the second does. Nothing
 * here can be removed while anything stands on it, so what is confirmed is
 * only that the press was meant.
 */
function RemoveControl({
  offline,
  testId,
  onRemove,
}: {
  readonly offline: boolean;
  readonly testId: string;
  readonly onRemove: () => Promise<boolean>;
}): ReactNode {
  const locale = useLocale();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!asking) {
    return (
      <Button
        variant="quiet"
        type="button"
        data-testid={testId}
        onClick={() => {
          setAsking(true);
        }}
      >
        {t('settingsRemove', locale)}
      </Button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-body-sm text-ink-secondary">{t('settingsRemoveSure', locale)}</span>
      <SaveButton
        variant="secondary"
        offline={offline}
        busy={busy}
        testId={`${testId}-yes`}
        onClick={() => {
          setBusy(true);
          void onRemove().finally(() => {
            setBusy(false);
            setAsking(false);
          });
        }}
      >
        {t('settingsRemoveYes', locale)}
      </SaveButton>
      <Button
        variant="quiet"
        type="button"
        data-testid={`${testId}-no`}
        onClick={() => {
          setAsking(false);
        }}
      >
        {t('settingsCancel', locale)}
      </Button>
    </span>
  );
}

/** A save that says why it cannot be pressed (`FRONTEND.md` §5.1), as in `HospitalFace`. */
function SaveButton({
  children,
  offline,
  busy,
  blocked,
  submit = false,
  variant = 'primary',
  testId,
  onClick,
}: {
  readonly children: ReactNode;
  readonly offline: boolean;
  readonly busy: boolean;
  /** Why it cannot be pressed yet, when it is not the connection. */
  readonly blocked?: string;
  readonly submit?: boolean;
  readonly variant?: 'primary' | 'secondary';
  readonly testId: string;
  readonly onClick?: () => void;
}): ReactNode {
  const locale = useLocale();
  const reason = offline ? t('settingsSaveOffline', locale) : (blocked ?? null);
  const common = {
    variant,
    type: submit ? ('submit' as const) : ('button' as const),
    'data-testid': testId,
  };
  if (reason !== null) {
    return (
      <Button {...common} disabled disabledReason={reason}>
        {children}
      </Button>
    );
  }
  return (
    <Button {...common} loading={busy} {...(onClick === undefined ? {} : { onClick })}>
      {children}
    </Button>
  );
}
