'use client';

/**
 * `TBL-B05-RX` and `BTN-B05-ADDRX` (`APP_FLOW.md` B2; `FR-DOC-04`, `FR-DOC-05`;
 * plan R2).
 *
 * One row per medicine: its name, strength, schedule (`1+0+1`), days and an
 * instruction in Bangla. The name suggests from the formulary as the doctor
 * types and takes a name it does not carry, because the formulary helps and
 * never decides what a doctor prescribes. A row the server would refuse says
 * why under the field, and the visit is not saved until it is right
 * (`readMedicineRows`).
 *
 * Suggestions are a native `<datalist>`: keyboard-first, announced by the
 * platform, and no component to add. A suggestion picked by its exact label
 * keeps the formulary's id; anything else typed is free text.
 */

import { useEffect, useId, useState } from 'react';

import type { MedicineRow, MedicineRowProblems } from '@platform/domain';
import { t } from '@platform/i18n';
import { Button, Input, useLocale } from '@platform/ui';

import { readDemoSession } from '@/lib/demo';
import { fetchFormulary, type FormularyEntry } from '@/lib/visits';

import type { ReactNode } from 'react';

/** What the formulary entry reads as in the name field: generic, then brand. */
export function formularyLabel(entry: FormularyEntry): string {
  return entry.brandName === null ? entry.genericName : `${entry.genericName} (${entry.brandName})`;
}

export function emptyMedicineRow(): MedicineRow {
  return {
    key: crypto.randomUUID(),
    medicineId: null,
    name: '',
    strength: '',
    schedule: '',
    days: '',
    instructionBn: '',
  };
}

export function MedicineRows({
  rows,
  problems,
  disabled,
  onChange,
}: {
  readonly rows: readonly MedicineRow[];
  readonly problems: ReadonlyMap<string, MedicineRowProblems>;
  readonly disabled: boolean;
  readonly onChange: (rows: readonly MedicineRow[]) => void;
}): ReactNode {
  const locale = useLocale();

  function update(key: string, patch: Partial<MedicineRow>): void {
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  return (
    <fieldset className="flex flex-col gap-3" data-testid="rx-rows">
      <legend className="font-ui text-body-sm font-semibold text-ink">
        {t('rxTitle', locale)}
      </legend>

      {rows.length === 0 ? (
        <p className="text-caption text-ink-muted">{t('rxNone', locale)}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <MedicineRowFields
              key={row.key}
              row={row}
              index={index}
              problem={problems.get(row.key) ?? null}
              disabled={disabled}
              onUpdate={(patch) => {
                update(row.key, patch);
              }}
              onRemove={() => {
                onChange(rows.filter((other) => other.key !== row.key));
              }}
            />
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {disabled ? (
          <Button
            variant="secondary"
            size="sm"
            disabled
            disabledReason={t('nobodyToSee', locale)}
            data-testid="rx-add"
          >
            {t('rxAdd', locale)}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            data-testid="rx-add"
            onClick={() => {
              onChange([...rows, emptyMedicineRow()]);
            }}
          >
            {t('rxAdd', locale)}
          </Button>
        )}
        <p className="text-caption text-ink-muted">{t('rxHint', locale)}</p>
      </div>
    </fieldset>
  );
}

function MedicineRowFields({
  row,
  index,
  problem,
  disabled,
  onUpdate,
  onRemove,
}: {
  readonly row: MedicineRow;
  readonly index: number;
  readonly problem: MedicineRowProblems | null;
  readonly disabled: boolean;
  readonly onUpdate: (patch: Partial<MedicineRow>) => void;
  readonly onRemove: () => void;
}): ReactNode {
  const locale = useLocale();
  const listId = useId();
  const suggestions = useFormulary(row.medicineId === null ? row.name : '');
  const picked = suggestions.find((entry) => formularyLabel(entry) === row.name);

  return (
    <li
      className="flex flex-col gap-2 rounded-sm border border-line p-3"
      data-testid={`rx-row-${String(index)}`}
    >
      <Input
        label={t('rxName', locale)}
        density="console"
        list={listId}
        autoComplete="off"
        value={row.name}
        disabled={disabled}
        data-testid={`rx-name-${String(index)}`}
        onChange={(event) => {
          const name = event.target.value;
          const entry = suggestions.find((candidate) => formularyLabel(candidate) === name);
          onUpdate({
            name,
            medicineId: entry?.id ?? null,
            // The formulary's usual strength, when it has only one and none
            // was written; the doctor changes it like any other field.
            ...(entry !== undefined && row.strength.trim() === '' && entry.strengths.length === 1
              ? { strength: entry.strengths[0] ?? '' }
              : {}),
          });
        }}
      />
      <datalist id={listId}>
        {suggestions.map((entry) => (
          <option key={entry.id} value={formularyLabel(entry)} />
        ))}
      </datalist>

      <div className="grid gap-2 sm:grid-cols-3">
        <Input
          label={t('rxStrength', locale)}
          density="console"
          {...(picked === undefined ? {} : { list: `${listId}-strength` })}
          value={row.strength}
          disabled={disabled}
          data-testid={`rx-strength-${String(index)}`}
          onChange={(event) => {
            onUpdate({ strength: event.target.value });
          }}
        />
        {picked === undefined ? null : (
          <datalist id={`${listId}-strength`}>
            {picked.strengths.map((strength) => (
              <option key={strength} value={strength} />
            ))}
          </datalist>
        )}
        <Input
          label={t('rxSchedule', locale)}
          density="console"
          value={row.schedule}
          disabled={disabled}
          placeholder="1+0+1"
          data-testid={`rx-schedule-${String(index)}`}
          {...(problem?.schedule === true ? { error: t('rxScheduleInvalid', locale) } : {})}
          onChange={(event) => {
            onUpdate({ schedule: event.target.value });
          }}
        />
        <Input
          label={t('rxDays', locale)}
          density="console"
          kind="number"
          value={row.days}
          disabled={disabled}
          data-testid={`rx-days-${String(index)}`}
          {...(problem?.days === true ? { error: t('rxDaysInvalid', locale) } : {})}
          onChange={(event) => {
            onUpdate({ days: event.target.value });
          }}
        />
      </div>

      <Input
        label={t('rxInstruction', locale)}
        density="console"
        value={row.instructionBn}
        disabled={disabled}
        data-testid={`rx-instruction-${String(index)}`}
        onChange={(event) => {
          onUpdate({ instructionBn: event.target.value });
        }}
      />

      <div>
        {disabled ? (
          <Button
            variant="secondary"
            size="sm"
            disabled
            disabledReason={t('nobodyToSee', locale)}
            data-testid={`rx-remove-${String(index)}`}
          >
            {t('rxRemove', locale)}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            data-testid={`rx-remove-${String(index)}`}
            onClick={onRemove}
          >
            {t('rxRemove', locale)}
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * The formulary's answer for what is typed, a moment after the typing stops.
 * A failure leaves no suggestions, and the doctor writes the name: the
 * formulary is a help, so its absence holds nothing up.
 */
function useFormulary(typed: string): readonly FormularyEntry[] {
  const [found, setFound] = useState<readonly FormularyEntry[]>([]);
  const query = typed.trim();

  useEffect(() => {
    if (query.length < 2) {
      setFound([]);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void fetchFormulary({
        apiBaseUrl: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1',
        token: readDemoSession()?.token ?? null,
        query,
      })
        .then((entries) => {
          if (!cancelled) setFound(entries);
        })
        .catch(() => {
          if (!cancelled) setFound([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return found;
}
