'use client';

/**
 * The printed prescription (`PRD.md` `FR-DOC-07`; plan R2; `APP_FLOW.md`
 * `BTN-B05-PRINT`, `BTN-A12-PRINT`).
 *
 * One sheet for the doctor's console and the patient's records, so what a
 * patient keeps is what the doctor handed over. It takes its words already
 * written, as every component here does (`FreshnessLine`): the apps hold the
 * catalogue and the numerals, and this holds the layout.
 *
 * Nothing on it is generated. Each line is what the doctor wrote or chose, or
 * a heading.
 *
 * ## Printing
 *
 * The browser's own print, which also saves a PDF; no PDF writer is added
 * (`CLAUDE.md` §7). `usePrintSheet` puts the sheet directly under `<body>` and
 * marks the document as printing, and `styles.css` then prints the sheet and
 * nothing else. On screen the sheet is never shown.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import type { ReactNode } from 'react';

export interface PrescriptionSheetMedicine {
  readonly name: string;
  /** Strength, schedule and days, already written: `৫০০ mg · ১+০+১ · ৭ দিন`. */
  readonly detail: string | null;
  readonly instruction: string | null;
}

export interface PrescriptionSheetData {
  readonly hospital: string;
  readonly doctor: string;
  /** The doctor's registration and department: what the sheet is signed under. */
  readonly doctorLine: string;
  /** The patient, when the reader knows them; a tracking link does not say. */
  readonly patientLine: string | null;
  readonly dateLine: string;
  readonly diagnosis: string | null;
  readonly medicines: readonly PrescriptionSheetMedicine[];
  readonly advice: string | null;
  readonly followUp: string | null;
  readonly labels: {
    readonly diagnosis: string;
    readonly medicines: string;
    /** How the schedule reads: `সকাল + দুপুর + রাত`. */
    readonly scheduleLegend: string;
    readonly advice: string;
    readonly followUp: string;
    readonly signedNote: string;
  };
}

export function PrescriptionSheet({ data }: { readonly data: PrescriptionSheetData }): ReactNode {
  return (
    <article
      data-print-sheet=""
      data-testid="prescription-sheet"
      lang="bn"
      className="flex-col gap-4 bg-surface p-6 font-reading text-ink"
    >
      <header className="flex flex-col gap-1 border-b border-line-strong pb-3">
        <p className="text-title-md font-semibold">{data.hospital}</p>
        <p className="text-title-sm">{data.doctor}</p>
        <p className="text-body-sm text-ink-secondary">{data.doctorLine}</p>
      </header>

      <section className="flex flex-col gap-1 border-b border-line pb-3 text-body-md">
        {data.patientLine === null ? null : <p>{data.patientLine}</p>}
        <p className="text-body-sm text-ink-secondary">{data.dateLine}</p>
      </section>

      {data.diagnosis === null ? null : (
        <section className="flex flex-col gap-1">
          <h2 className="text-body-sm font-semibold">{data.labels.diagnosis}</h2>
          <p className="text-body-md">{data.diagnosis}</p>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-body-sm font-semibold">{data.labels.medicines}</h2>
        <ol className="flex list-decimal flex-col gap-2 ps-6">
          {data.medicines.map((medicine, index) => (
            <li key={`${String(index)}-${medicine.name}`} className="text-body-md">
              <p className="font-semibold">{medicine.name}</p>
              {medicine.detail === null ? null : <p>{medicine.detail}</p>}
              {medicine.instruction === null ? null : (
                <p className="text-ink-secondary">{medicine.instruction}</p>
              )}
            </li>
          ))}
        </ol>
        <p className="text-caption text-ink-muted">{data.labels.scheduleLegend}</p>
      </section>

      {data.advice === null ? null : (
        <section className="flex flex-col gap-1">
          <h2 className="text-body-sm font-semibold">{data.labels.advice}</h2>
          <p className="whitespace-pre-line text-body-md">{data.advice}</p>
        </section>
      )}

      {data.followUp === null ? null : (
        <p className="text-body-md">
          <span className="font-semibold">{data.labels.followUp}</span> {data.followUp}
        </p>
      )}

      <footer className="border-t border-line pt-3 text-caption text-ink-muted">
        {data.labels.signedNote}
      </footer>
    </article>
  );
}

/**
 * Prints one sheet: `print(data)` draws it under `<body>`, opens the
 * browser's print, and takes it away when printing is over.
 */
export function usePrintSheet(): {
  readonly sheet: ReactNode;
  readonly print: (data: PrescriptionSheetData) => void;
} {
  const [data, setData] = useState<PrescriptionSheetData | null>(null);

  useEffect(() => {
    if (data === null) return undefined;
    const root = document.documentElement;
    root.setAttribute('data-printing', '');
    const done = (): void => {
      root.removeAttribute('data-printing');
      setData(null);
    };
    globalThis.addEventListener('afterprint', done, { once: true });
    // After the sheet is on the page, or the print shows the page without it.
    const frame = requestAnimationFrame(() => {
      globalThis.print();
    });
    return () => {
      cancelAnimationFrame(frame);
      globalThis.removeEventListener('afterprint', done);
      root.removeAttribute('data-printing');
    };
  }, [data]);

  return {
    sheet: data === null ? null : createPortal(<PrescriptionSheet data={data} />, document.body),
    print: setData,
  };
}
