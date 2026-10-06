/**
 * `TXT-B14-WARN` — what a checked import is warned about (`S-B-14`, V4.3,
 * `FR-IMP-21`).
 *
 * Shown on the preview, above the errors and the approval, only when there is
 * something to say. These are not errors: the check refuses nothing here, and
 * this block disables nothing. It says two kinds of thing a person approving
 * an import would want to have been told:
 *
 * - rows that look like one patient under two identifiers, by row number and
 *   why, and that they are **not merged**;
 * - a column whose dates or mobile numbers are written more than one way, and
 *   the reading that will be used.
 *
 * It shows row numbers and counts. Nothing from a row is in the answer it is
 * drawn from, so nothing from a row can be shown here.
 */

import {
  hasWarnings,
  type ImportWarnings as Warnings,
  type SamePersonReason,
  type ValueFormat,
} from '@platform/domain';
import {
  format,
  formatNumber,
  importFieldName,
  numeralsFor,
  t,
  type ConsoleKey,
} from '@platform/i18n';
import { useLocale } from '@platform/ui';

import type { ReactNode } from 'react';

/** Why two rows were read as one person. */
const BECAUSE_NAME: Readonly<Record<SamePersonReason, ConsoleKey>> = {
  phone_and_name: 'importWarnBecausePhone',
  name_and_birth: 'importWarnBecauseBirth',
};

/** The ways a date or a mobile number is written that the reader accepts. */
const FORMAT_NAME: Readonly<Record<ValueFormat, ConsoleKey>> = {
  iso: 'importFormatIso',
  day_first: 'importFormatDayFirst',
  local: 'importFormatLocal',
  country: 'importFormatCountry',
};

export function ImportWarnings({ warnings }: { readonly warnings: Warnings }): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  if (!hasWarnings(warnings)) return null;

  const notListed = warnings.samePersonTotal - warnings.samePerson.length;

  return (
    <section
      className="mt-4 rounded-sm bg-warn-100 px-3 py-3 text-body-sm text-warn-700"
      data-testid="import-warnings"
      aria-labelledby="import-warnings-heading"
    >
      <h3 id="import-warnings-heading" className="text-body-md font-semibold">
        {t('importWarnHeading', locale)}
      </h3>
      <p className="mt-1">{t('importWarnNote', locale)}</p>
      <ul className="mt-2 flex flex-col gap-3">
        {warnings.samePersonTotal === 0 ? null : (
          <li data-testid="import-warn-same-person">
            <p>
              {format('importWarnSamePerson', locale, {
                count: formatNumber(warnings.samePersonTotal, numerals),
              })}
            </p>
            <ul className="mt-1 flex flex-col gap-1 tabular-nums">
              {warnings.samePerson.map((group) => (
                <li key={group.rows.join('-')}>
                  {format('importWarnSamePersonRows', locale, {
                    rows: group.rows.map((row) => formatNumber(row, numerals)).join(', '),
                    because: group.because
                      .map((reason) => t(BECAUSE_NAME[reason], locale))
                      .join('; '),
                  })}
                </li>
              ))}
            </ul>
            {notListed <= 0 ? null : (
              <p className="mt-1">
                {format('importWarnSamePersonMore', locale, {
                  count: formatNumber(notListed, numerals),
                })}
              </p>
            )}
          </li>
        )}
        {warnings.mixedFormats.map((mixed) => (
          <li key={mixed.field} data-testid={`import-warn-format-${mixed.field}`}>
            {format(
              mixed.kind === 'date' ? 'importWarnMixedDate' : 'importWarnMixedPhone',
              locale,
              {
                column: importFieldName(mixed.field, locale),
                formats: mixed.formats
                  .map((entry) =>
                    format('importWarnFormatCount', locale, {
                      format: t(FORMAT_NAME[entry.format], locale),
                      count: formatNumber(entry.rows, numerals),
                    }),
                  )
                  .join('; '),
              },
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
