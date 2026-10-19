'use client';

/** Availability-only workspace (S-B-09, FR-PHR-02). No dispensing or inventory. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { format, formatAge, formatNumber, t, numeralsFor } from '@platform/i18n';
import {
  Button,
  Card,
  ConsoleHelp,
  ConsolePageHeader,
  ConsoleState,
  ConsoleConfirmation,
  Chip,
  FreshnessLine,
  ToastProvider,
  useToast,
  useLocale,
} from '@platform/ui';

import { ActionButton } from '@/components/ActionButton';
import { ConsoleWorkspaceFrame } from '@/components/ConsoleWorkspaceFrame';
import { DemoBanner } from '@/components/DemoBanner';
import { OfflineBlock } from '@/components/OfflineBlock';
import { currentStockRows, matchingStockRows } from '@/lib/clinicalWorkspace';
import { CLINICAL } from '@/lib/clinicalWorkspaceMessages';
import { readDemoSession } from '@/lib/demo';
import { failureOf, labApi } from '@/lib/lab';
import '@platform/ui/console-pharmacy.css';

/** The demo principal (CLAUDE.md §4.1). Supabase Auth replaces this one function. */
function readToken() {
  return readDemoSession()?.token ?? null;
}

/** The three answers, in the words a patient reads (`lab/stock.ts`). */
const ANSWER_LABEL = {
  in_stock: 'pharmacyInStock',
  out_of_stock: 'pharmacyOutOfStock',
  unknown: 'pharmacyUnknown',
};

export function PharmacyConsole() {
  return (
    <ToastProvider placement="console">
      <PharmacyBody />
    </ToastProvider>
  );
}

function PharmacyBody() {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const { show } = useToast();
  const session = readDemoSession();
  const hospitalId = session?.hospitalId ?? '';

  const api = useMemo(() => labApi(readToken), []);

  const [shelf, setShelf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [online, setOnline] = useState(true);
  const writing = useRef(false);

  const load = useCallback(async () => {
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
    const sync = () => {
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
    async (flags) => {
      if (flags.length === 0 || flags.length > 200 || !online || writing.current) return;
      writing.current = true;
      setSaving(true);
      try {
        setShelf(await api.setFlags(hospitalId, flags));
        show({ title: t('pharmacySaved', locale), tone: 'positive' });
      } catch (error) {
        const failure = failureOf(error);
        if (failure.kind === 'offline') {
          await load();
          show({ title: CLINICAL.stockUncertain[locale], tone: 'caution' });
        } else {
          await load();
          show({
            title:
              failure.code === 'WRITE_CONFLICT'
                ? CLINICAL.stockChanged[locale]
                : t('pharmacySaveFailed', locale),
            tone: 'caution',
          });
        }
      } finally {
        writing.current = false;
        setSaving(false);
      }
    },
    [api, hospitalId, show, locale, online, load],
  );

  const freshness = {
    justNow: t('updatedJustNow', locale),
    ago: t('updatedAgo', locale),
    never: t('neverConfirmed', locale),
    stale: t('staleWarning', locale),
  };
  const minutes = (value) => formatAge(value, locale, numerals);

  if (session === null || hospitalId === '') return <Notice>{t('noSession', locale)}</Notice>;
  // Recompute with the domain's exact 720 whole-minute boundary (FR-PHR-02).
  const rows = currentStockRows(shelf?.rows ?? [], now);
  const visible = matchingStockRows(rows, search, filter);
  const goneQuiet = rows.filter((row) => row.publishedAs === 'unknown' && row.inStock).length;
  const offReason = !online ? t('offline', locale) : saving ? t('actionSending', locale) : null;
  const bulkReason = offReason ?? (rows.length > 200 ? CLINICAL.bulkLimit[locale] : null);
  return (
    <ConsoleWorkspaceFrame
      session={session}
      workspace={CLINICAL.pharmacy}
      rail="navPharmacy"
      navigation={[
        {
          id: 'pharmacy',
          label: { bn: t('navPharmacy', 'bn'), en: t('navPharmacy', 'en') },
          current: true,
          roles: ['pharmacy', 'hospital_admin'],
          enabled: true,
          onSelect: () => {
            setFilter('all');
            setSearch('');
          },
        },
        {
          id: 'switch',
          label: CLINICAL.switchConsole,
          roles: [session.role],
          enabled: true,
          onSelect: () => globalThis.location.assign('/'),
        },
      ]}
      actions={
        <>
          <span className={`cf-status cf-tone-${online ? 'positive' : 'caution'}`}>
            {t(online ? 'online' : 'offline', locale)}
          </span>
          <ConsoleHelp
            topic={{
              id: 'pharmacy',
              title: CLINICAL.pharmacy,
              steps: [CLINICAL.stockHelp, CLINICAL.confirmHint],
            }}
          />
        </>
      }
    >
      <div className="pharmacy-workspace" data-testid="pharmacy-console">
        <DemoBanner />
        <ConsolePageHeader
          title={CLINICAL.pharmacy}
          description={CLINICAL.pharmacyIntro}
          actions={
            shelf === null ? undefined : (
              <FreshnessLine
                asOf={new Date(shelf.serverTs)}
                now={now}
                labels={freshness}
                formatMinutes={minutes}
              />
            )
          }
        />
        <OfflineBlock
          connected={online}
          pendingCount={0}
          lastServerTs={shelf?.serverTs ?? null}
          stuckCount={0}
          locale={locale}
          now={now}
        />
        {loading ? (
          <div data-testid="pharmacy-loading">
            <ConsoleState kind="loading" description={CLINICAL.pharmacyIntro} />
          </div>
        ) : failed || shelf === null ? (
          <div data-testid="pharmacy-failed">
            <ConsoleState
              kind="error"
              description={CLINICAL.pharmacyIntro}
              onRetry={() => {
                void load();
              }}
            />
          </div>
        ) : (
          <>
            <div
              className="pharmacy-summaries"
              role="group"
              aria-label={t('pharmacyTitle', locale)}
            >
              {['in_stock', 'unknown', 'out_of_stock'].map((answer) => (
                <button
                  key={answer}
                  type="button"
                  aria-pressed={filter === answer}
                  data-testid={`pharmacy-filter-${answer}`}
                  onClick={() => setFilter(filter === answer ? 'all' : answer)}
                >
                  <strong>
                    {formatNumber(
                      rows.filter((row) => row.publishedAs === answer).length,
                      numerals,
                    )}
                  </strong>
                  <span>{t(ANSWER_LABEL[answer], locale)}</span>
                </button>
              ))}
            </div>
            {goneQuiet > 0 ? (
              <p className="cf-feedback cf-tone-caution" data-testid="pharmacy-stale-warning">
                {t('pharmacyStaleWarning', locale)}
              </p>
            ) : null}
            {rows.length === 0 ? (
              <Card data-testid="pharmacy-empty">
                <p>{t('pharmacyEmpty', locale)}</p>
                <p>{t('pharmacyEmptyHint', locale)}</p>
              </Card>
            ) : (
              <>
                <div className="pharmacy-renew">
                  <p>{t('pharmacyConfirmHint', locale)}</p>
                  <ConsoleConfirmation
                    open={confirmOpen}
                    onOpenChange={setConfirmOpen}
                    pending={saving}
                    title={CLINICAL.confirmTitle}
                    description={CLINICAL.confirmHint}
                    confirmLabel={{
                      bn: t('pharmacyConfirmAll', 'bn'),
                      en: t('pharmacyConfirmAll', 'en'),
                    }}
                    trigger={
                      <button
                        type="button"
                        className="min-h-touch rounded-sm bg-brand-600 px-4 text-white"
                        disabled={bulkReason !== null}
                        title={bulkReason ?? undefined}
                        data-testid="pharmacy-confirm-all"
                      >
                        {t('pharmacyConfirmAll', locale)}
                      </button>
                    }
                    onConfirm={() => {
                      if (bulkReason !== null || rows.length === 0) return;
                      setConfirmOpen(false);
                      void write(
                        rows.map((row) => ({
                          medicineId: row.medicineId,
                          inStock: row.inStock,
                          expectedUpdatedAt: row.updatedAt,
                        })),
                      );
                    }}
                  />
                  {rows.length > 200 ? <p>{CLINICAL.bulkLimit[locale]}</p> : null}
                </div>
                <div className="pharmacy-toolbar">
                  <input
                    className="pharmacy-search"
                    type="search"
                    value={search}
                    aria-label={CLINICAL.searchMedicines[locale]}
                    placeholder={CLINICAL.searchMedicines[locale]}
                    data-testid="pharmacy-search"
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <Button
                    variant="quiet"
                    onClick={() => {
                      setSearch('');
                      setFilter('all');
                    }}
                  >
                    {t('labQueueAll', locale)}
                  </Button>
                </div>
                {visible.length === 0 ? (
                  <Card data-testid="pharmacy-no-matches">{CLINICAL.noMatches[locale]}</Card>
                ) : (
                  <ul className="pharmacy-list">
                    {visible.map((row) => (
                      <li key={row.medicineId}>
                        <ShelfRow
                          row={row}
                          now={now}
                          locale={locale}
                          offReason={offReason}
                          freshness={freshness}
                          formatMinutes={minutes}
                          onSet={(inStock) => {
                            void write([
                              {
                                medicineId: row.medicineId,
                                inStock,
                                expectedUpdatedAt: row.updatedAt,
                              },
                            ]);
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            <Card data-testid="pharmacy-dispense-absent">
              <p>{t('pharmacyDispenseAbsent', locale)}</p>
              <p className="text-body-sm text-ink-muted">
                {t('pharmacyDispenseAbsentHint', locale)}
              </p>
            </Card>
          </>
        )}
      </div>
    </ConsoleWorkspaceFrame>
  );
}

/** One medicine on the shelf. */
function ShelfRow({ row, now, locale, offReason, freshness, formatMinutes, onSet }) {
  return (
    <div
      className="pharmacy-row"
      data-testid={`stock-${row.medicineId}`}
      data-answer={row.publishedAs}
    >
      <div>
        <p className="font-semibold text-body-lg">
          {row.brandName === null ? row.genericName : `${row.brandName} (${row.genericName})`}
        </p>
        <p className="text-body-sm text-ink-muted">
          {[row.form, row.strengths.join(', ')]
            .filter((part) => part !== null && part !== '')
            .join(' \u00b7 ')}
        </p>
        <Chip tone={row.inStock ? 'positive' : 'alert'}>
          {t(row.inStock ? 'pharmacyInStock' : 'pharmacyOutOfStock', locale)}
        </Chip>
        <FreshnessLine
          asOf={new Date(row.updatedAt)}
          now={now}
          staleAfterMinutes={12 * 60}
          labels={freshness}
          formatMinutes={formatMinutes}
        />
      </div>
      <div className="pharmacy-public">
        <p className="text-caption text-ink-muted">{CLINICAL.patientAnswer[locale]}</p>
        <Chip
          tone={
            row.publishedAs === 'unknown'
              ? 'caution'
              : row.publishedAs === 'in_stock'
                ? 'positive'
                : 'alert'
          }
        >
          {t(ANSWER_LABEL[row.publishedAs], locale)}
        </Chip>
        <p className="text-body-sm">
          {format('pharmacyShownAs', locale, { answer: t(ANSWER_LABEL[row.publishedAs], locale) })}
        </p>
      </div>
      <div className="pharmacy-row-actions">
        <ActionButton
          size="sm"
          variant="secondary"
          reason={offReason}
          onClick={() => onSet(true)}
          testId={`stock-in-${row.medicineId}`}
        >
          <span aria-current={row.inStock ? 'true' : undefined}>
            {row.publishedAs === 'unknown' && row.inStock
              ? CLINICAL.stillInStock[locale]
              : t('pharmacyInStock', locale)}
          </span>
        </ActionButton>
        <ActionButton
          size="sm"
          variant="secondary"
          reason={offReason}
          onClick={() => onSet(false)}
          testId={`stock-out-${row.medicineId}`}
        >
          <span aria-current={!row.inStock ? 'true' : undefined}>
            {t('pharmacyOutOfStock', locale)}
          </span>
        </ActionButton>
      </div>
    </div>
  );
}

function Notice({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-body-lg text-ink-secondary">{children}</p>
    </div>
  );
}
