'use client';

/**
 * The pharmacy — `S-B-09` (`APP_FLOW.md` B5, `FR-PHR-02`).
 *
 * ## What this screen is, and what it is not
 *
 * `APP_FLOW.md` B5 gives `S-B-09` two halves: scan a prescription QR and
 * dispense against it (`FR-PHR-01`), and flag what is out of stock so the
 * patient app's medicine search knows (`FR-PHR-02`).
 *
 * **Only the second half is built, and the screen says so rather than showing
 * a dead scanner.** Dispensing is downstream of `FR-DOC-04`, which the owner
 * removed from this version on 2026-09-19 (`PRD.md` §9): no code path and no
 * seed creates a `prescriptions` row, so there is nothing to scan and nothing
 * to dispense against. A scanner that opened a camera and then found an empty
 * table would be worse than a sentence explaining why it is absent — the same
 * choice `S-A-12` makes about its unbuilt tabs.
 *
 * ## The shelf is a promise somebody has to keep renewing
 *
 * A flag says "we have this". `FR-PHR-02` publishes it to families deciding
 * whether to cross Dhaka, so an old flag is not a small problem — and the
 * honest answer is the third one (`lab/stock.ts`): after twelve hours an
 * in-stock claim lapses to *not known* rather than being repeated.
 *
 * That is why every row shows **what a patient is being told right now**, in
 * the pharmacy's own words, beside what the pharmacy last said. It is
 * `FR-BED-06`'s idea applied to a shelf: the consequence of not renewing is
 * visible to the person who would renew it. And it is why the main action is
 * *still correct* — confirming an unchanged list is the commonest and most
 * valuable thing somebody at this counter does.
 *
 * ## The four states (`GR-03`)
 *
 * Loading is the shape of the list. An error says what failed and retries. An
 * empty pharmacy says no medicines are listed and who adds them. Offline
 * keeps the list readable and says the buttons need a connection.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { format, formatAge, t, type ConsoleKey, type Locale } from '@platform/i18n';
import { Button, Card, Chip, FreshnessLine, ToastProvider, useToast } from '@platform/ui';

import { ActionButton } from '@/components/ActionButton';
import { OfflineBlock } from '@/components/OfflineBlock';
import { readDemoSession } from '@/lib/demo';
import { failureOf, labApi, type ShelfResponse, type StockRow } from '@/lib/lab';

const LOCALE: Locale = 'bn';
const NUMERALS = 'bengali' as const;

/** `APP_FLOW.md` B1.1's rail. Billing is where a pharmacy counter sits. */
const NAV_ITEMS = [
  'navQueue',
  'navRegistration',
  'navBeds',
  'navEmergency',
  'navTests',
  'navBilling',
  'navDashboard',
] as const;

/** The demo principal (CLAUDE.md §4.1). Supabase Auth replaces this one function. */
function readToken(): string | null {
  return readDemoSession()?.token ?? null;
}

/** The three answers, in the words a patient reads (`lab/stock.ts`). */
const ANSWER_LABEL: Readonly<Record<StockRow['publishedAs'], ConsoleKey>> = {
  in_stock: 'pharmacyInStock',
  out_of_stock: 'pharmacyOutOfStock',
  unknown: 'pharmacyUnknown',
};

export function PharmacyConsole(): ReactNode {
  return (
    <ToastProvider placement="console">
      <PharmacyBody />
    </ToastProvider>
  );
}

function PharmacyBody(): ReactNode {
  const locale = LOCALE;
  const { show } = useToast();
  const session = readDemoSession();
  const hospitalId = session?.hospitalId ?? '';

  const api = useMemo(() => labApi(readToken), []);

  const [shelf, setShelf] = useState<ShelfResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [online, setOnline] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    if (hospitalId === '') return;
    setFailed(false);
    try {
      setShelf(await api.shelf(hospitalId));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [api, hospitalId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const sync = (): void => {
      setOnline(globalThis.navigator.onLine);
    };
    sync();
    globalThis.addEventListener('online', sync);
    globalThis.addEventListener('offline', sync);
    return () => {
      globalThis.removeEventListener('online', sync);
      globalThis.removeEventListener('offline', sync);
    };
  }, []);

  const write = useCallback(
    async (flags: readonly { medicineId: string; inStock: boolean }[]): Promise<void> => {
      if (flags.length === 0) return;
      setSaving(true);
      try {
        setShelf(await api.setFlags(hospitalId, flags));
        show({ title: t('pharmacySaved', locale), tone: 'positive' });
      } catch (error: unknown) {
        const failure = failureOf(error);
        show({
          title:
            failure.kind === 'offline' ? t('offline', locale) : t('pharmacySaveFailed', locale),
          tone: 'caution',
        });
      } finally {
        setSaving(false);
      }
    },
    [api, hospitalId, show, locale],
  );

  const freshness = {
    justNow: t('updatedJustNow', locale),
    ago: t('updatedAgo', locale),
    never: t('neverConfirmed', locale),
    stale: t('staleWarning', locale),
  };
  const minutes = (value: number): string => formatAge(value, locale, NUMERALS);

  if (hospitalId === '') return <Notice>{t('noSession', locale)}</Notice>;

  if (loading) {
    return (
      <div className="flex min-h-screen gap-6 p-6" aria-busy="true" data-testid="pharmacy-loading">
        <div className="w-52 shrink-0 rounded-md bg-sunken" />
        <div className="flex flex-1 flex-col gap-2">
          {Array.from({ length: 10 }, (_, index) => (
            <div key={index} className="h-14 rounded-md bg-sunken" />
          ))}
        </div>
      </div>
    );
  }

  if (failed || shelf === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p role="alert" className="text-body-lg text-ink-secondary" data-testid="pharmacy-failed">
          {t('pharmacyLoadFailed', locale)}
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            void load();
          }}
        >
          {t('retry', locale)}
        </Button>
      </div>
    );
  }

  const rows = shelf.rows;
  const goneQuiet = rows.filter((row) => row.publishedAs === 'unknown' && row.inStock).length;

  // §5.1: a control that is off says why, rather than being dead.
  const offReason = !online ? t('offline', locale) : saving ? t('actionSending', locale) : null;

  return (
    <div className="flex min-h-screen" data-testid="pharmacy-console">
      <nav aria-label={t('navBilling', locale)} className="w-52 shrink-0 border-r border-line p-4">
        <ul className="flex flex-col gap-1">
          {NAV_ITEMS.map((key) => (
            <li key={key}>
              <span
                aria-current={key === 'navBilling' ? 'page' : undefined}
                className="flex min-h-touch items-center rounded-sm px-3 text-body-md aria-[current=page]:bg-brand-100 aria-[current=page]:font-semibold"
              >
                {t(key, locale)}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-6">
          <OfflineBlock
            connected={online}
            pendingCount={0}
            lastServerTs={shelf.serverTs}
            stuckCount={0}
            locale={locale}
            now={now}
          />
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* FR-DEM-07 */}
        <p className="bg-warn-100 px-6 py-2 text-caption text-warn-700">
          {t('demoBanner', locale)}
        </p>

        <header className="flex items-center gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0 flex-1">
            <h1 className="font-reading text-title-lg text-ink">{t('pharmacyTitle', locale)}</h1>
            <p className="text-body-sm text-ink-muted">{t('pharmacyIntro', locale)}</p>
          </div>
          <FreshnessLine
            asOf={new Date(shelf.serverTs)}
            now={now}
            labels={freshness}
            formatMinutes={minutes}
          />
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
          {/* `FR-PHR-01` is absent, and says why rather than showing a dead
              scanner. See the header. */}
          <Card data-testid="pharmacy-dispense-absent">
            <p className="text-body-md text-ink">{t('pharmacyDispenseAbsent', locale)}</p>
            <p className="mt-1 text-body-sm text-ink-muted">
              {t('pharmacyDispenseAbsentHint', locale)}
            </p>
          </Card>

          {rows.length === 0 ? (
            <Card data-testid="pharmacy-empty">
              <p className="text-body-lg text-ink">{t('pharmacyEmpty', locale)}</p>
              <p className="mt-1 text-body-sm text-ink-muted">{t('pharmacyEmptyHint', locale)}</p>
            </Card>
          ) : (
            <>
              <div className="flex items-center gap-4">
                <ActionButton
                  variant="primary"
                  size="md"
                  reason={offReason}
                  onClick={() => {
                    // Every row, unchanged: "the whole list is still correct".
                    void write(
                      rows.map((row) => ({ medicineId: row.medicineId, inStock: row.inStock })),
                    );
                  }}
                  testId="pharmacy-confirm-all"
                >
                  {t('pharmacyConfirmAll', locale)}
                </ActionButton>
                <p className="text-body-sm text-ink-muted">{t('pharmacyConfirmHint', locale)}</p>
              </div>

              {goneQuiet > 0 ? (
                <p className="text-body-sm text-warn-700" data-testid="pharmacy-stale-warning">
                  {t('pharmacyStaleWarning', locale)}
                </p>
              ) : null}

              <ul className="flex flex-col gap-2">
                {rows.map((row) => (
                  <li key={row.medicineId}>
                    <ShelfRow
                      row={row}
                      now={now}
                      locale={locale}
                      offReason={offReason}
                      freshness={freshness}
                      formatMinutes={minutes}
                      onSet={(inStock) => {
                        void write([{ medicineId: row.medicineId, inStock }]);
                      }}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** One medicine on the shelf. */
function ShelfRow({
  row,
  now,
  locale,
  offReason,
  freshness,
  formatMinutes,
  onSet,
}: {
  readonly row: StockRow;
  readonly now: Date;
  readonly locale: Locale;
  /** Why the two buttons are off, or null when they are live (§5.1). */
  readonly offReason: string | null;
  readonly freshness: { justNow: string; ago: string; never: string; stale: string };
  readonly formatMinutes: (minutes: number) => string;
  readonly onSet: (inStock: boolean) => void;
}): ReactNode {
  return (
    <Card data-testid={`stock-${row.medicineId}`}>
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-body-lg text-ink">
            {row.brandName === null ? row.genericName : `${row.brandName} (${row.genericName})`}
          </p>
          <p className="text-body-sm text-ink-muted">
            {[row.form, row.strengths.join(', ')]
              .filter((part) => part !== null && part !== '')
              .join(' · ')}
          </p>
          {/* `FR-BED-06`'s idea on a shelf: what the public is being told. */}
          <p className="mt-1 text-body-sm text-ink-secondary">
            {format('pharmacyShownAs', locale, {
              answer: t(ANSWER_LABEL[row.publishedAs], locale),
            })}
          </p>
          <FreshnessLine
            asOf={new Date(row.updatedAt)}
            now={now}
            // Twelve hours, the threshold a stock flag lapses at
            // (`STOCK_STALE_THRESHOLD_MINUTES`). A bed's ten minutes here
            // would paint the whole list amber by mid-morning.
            staleAfterMinutes={12 * 60}
            labels={freshness}
            formatMinutes={formatMinutes}
          />
        </div>

        <Chip tone={row.inStock ? 'positive' : 'alert'}>
          {t(row.inStock ? 'pharmacyInStock' : 'pharmacyOutOfStock', locale)}
        </Chip>

        <div className="flex shrink-0 gap-2">
          <ActionButton
            size="sm"
            variant={row.inStock ? 'secondary' : 'primary'}
            reason={offReason}
            onClick={() => {
              onSet(true);
            }}
            testId={`stock-in-${row.medicineId}`}
          >
            {t('pharmacyInStock', locale)}
          </ActionButton>
          <ActionButton
            size="sm"
            variant={row.inStock ? 'primary' : 'secondary'}
            reason={offReason}
            onClick={() => {
              onSet(false);
            }}
            testId={`stock-out-${row.medicineId}`}
          >
            {t('pharmacyOutOfStock', locale)}
          </ActionButton>
        </div>
      </div>
    </Card>
  );
}

function Notice({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-body-lg text-ink-secondary">{children}</p>
    </div>
  );
}
