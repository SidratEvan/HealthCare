'use client';

/**
 * The token slip the counter prints for a serial (`PRD.md` `FR-REC-21`;
 * `APP_FLOW.md` `BTN-B02-SLIP`).
 *
 * The pilot runs with no SMS, so the QR code on the slip is how a patient
 * served at the counter follows the live serial on their own phone
 * (`FR-GST-05`). The words are `@platform/i18n`'s `tokenSlip`: Bangla, as all
 * patient-facing paper is; this draws them.
 *
 * Printing is the browser's own, on the rule `styles.css` keeps for every
 * printed sheet: the slip is put directly under `<body>`, the document is
 * marked as printing, and only the slip goes to paper. No dependency is
 * added: the QR code is the `qrcode` package two-factor setup already uses.
 */

import QRCode from 'qrcode';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { t, tokenSlip, type SlipLines } from '@platform/i18n';
import { useLocale, useToast } from '@platform/ui';

import { useIsDemonstration } from '@/lib/deployment';
import { fetchCounterSlip } from '@/lib/registration';

interface Printable {
  readonly lines: SlipLines;
  readonly qr: string | null;
}

export function TokenSlip({ slip }: { readonly slip: Printable }): ReactNode {
  const { lines, qr } = slip;
  return (
    <article
      data-print-sheet=""
      data-token-slip=""
      data-testid="token-slip"
      lang="bn"
      className="flex-col items-center gap-2 bg-surface p-3 text-center text-ink"
    >
      {lines.demoLine === null ? null : (
        <p className="text-caption font-semibold" data-testid="token-slip-demo">
          {lines.demoLine}
        </p>
      )}
      <p className="text-title-sm font-semibold">{lines.hospital}</p>
      <p className="text-body-sm">{lines.serialLabel}</p>
      <p className="text-display-lg font-semibold" data-testid="token-slip-serial">
        {lines.serial}
      </p>
      <p className="text-body-lg font-semibold">{lines.doctor}</p>
      {lines.room === null ? null : <p className="text-body-md">{lines.room}</p>}
      <p className="text-body-sm">{lines.chamberLine}</p>
      <p className="text-body-md font-semibold" data-testid="token-slip-estimate">
        {lines.estimateLine}
      </p>
      {lines.aheadLine === null ? null : <p className="text-body-sm">{lines.aheadLine}</p>}
      {qr === null || lines.scanLine === null ? null : (
        <>
          {/* A data: URL drawn here; `next/image` would only add a loader. */}
          <img src={qr} alt="" width={140} height={140} data-testid="token-slip-qr" />
          <p className="text-caption">{lines.scanLine}</p>
        </>
      )}
      <p className="text-caption text-ink-muted">{lines.printedLine}</p>
    </article>
  );
}

/**
 * `printSlip(bookingId)` asks the server for the slip (a fresh tracking link
 * and the live estimate), draws it, opens the browser's print, and takes it
 * away when printing is over. A failure is said in a toast; nothing prints.
 */
export function usePrintSlip(): {
  readonly sheet: ReactNode;
  readonly printing: boolean;
  readonly printSlip: (bookingId: string) => Promise<void>;
} {
  const locale = useLocale();
  const { show } = useToast();
  const demonstration = useIsDemonstration();
  const [slip, setSlip] = useState<Printable | null>(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (slip === null) return undefined;
    const root = document.documentElement;
    root.setAttribute('data-printing', '');
    const done = (): void => {
      root.removeAttribute('data-printing');
      setSlip(null);
    };
    globalThis.addEventListener('afterprint', done, { once: true });
    // After the slip is on the page, or the print shows the page without it.
    const frame = requestAnimationFrame(() => {
      globalThis.print();
    });
    return () => {
      cancelAnimationFrame(frame);
      globalThis.removeEventListener('afterprint', done);
      root.removeAttribute('data-printing');
    };
  }, [slip]);

  const printSlip = useCallback(
    async (bookingId: string): Promise<void> => {
      setPrinting(true);
      try {
        const result = await fetchCounterSlip(bookingId);
        if (!result.ok) {
          show({ title: t('printSlipFailed', locale), tone: 'caution' });
          return;
        }
        const data = result.value;
        let qr: string | null = null;
        if (data.trackingUrl === null) {
          show({ title: t('printSlipNoPhone', locale), tone: 'caution' });
        } else {
          qr = await QRCode.toDataURL(data.trackingUrl, { errorCorrectionLevel: 'M', margin: 1 });
        }
        setSlip({ lines: tokenSlip(data, new Date().toISOString(), demonstration), qr });
      } catch {
        show({ title: t('printSlipFailed', locale), tone: 'caution' });
      } finally {
        setPrinting(false);
      }
    },
    [demonstration, locale, show],
  );

  return {
    sheet: slip === null ? null : createPortal(<TokenSlip slip={slip} />, document.body),
    printing,
    printSlip,
  };
}
