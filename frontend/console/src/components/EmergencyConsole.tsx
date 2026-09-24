'use client';

/**
 * The emergency console — `S-B-07` (`APP_FLOW.md` B4, `FR-EMG-01..05`).
 *
 * Laid out like the reception console and the ward board, so a hospital's
 * staff learn one shape: navigation rail and offline block on the left, the
 * work in the middle, what the ER publishes and reads on the right.
 *
 * The middle is two lists in the order an ER works them:
 *
 *   **আসছেন** — inbound alerts (`CARD-B07-<caseId>`), unanswered first. A new
 *   one rings and stays the emergency colour until somebody answers it.
 *   **জরুরি বিভাগে আছেন** — the triage list (`TBL-B07-TRIAGE`), red pinned to
 *   the top, then the untriaged, then yellow and green (`triageOrder`).
 *
 * Between them, **অন্য হাসপাতাল পাঠাতে চায়** — referrals other ERs have sent
 * this one (`LIST-B07-IN`, `FR-EMG-09`), which ring as an alert does. Each row
 * of the triage list can be referred out (`BTN-B07-REFER`, `FR-EMG-07`) and
 * shows where its referral has got to; the right column keeps today's
 * referrals with their timelines (`FR-EMG-08`).
 *
 * Above them, the ER's load (`FR-EMG-04`), counted from these very lists —
 * never a number somebody typed.
 *
 * ## The four states (`GR-03`)
 *
 * Loading is the shape of the console. An error says what failed and offers
 * the retry. Empty lists say what fills them. Offline keeps everything on
 * screen and working, says that new alerts cannot arrive, and counts what is
 * waiting to send.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  inboundOrder,
  isInEr,
  isOnTheWay,
  triageOrder,
  type EmergencyCaseView,
  type EmergencyNeed,
  type EmergencyProblem,
  type ReferralView,
} from '@platform/domain';
import { format, formatNumber, problemName, t, type Locale, formatAge } from '@platform/i18n';
import { Button, FreshnessLine, ToastProvider, useToast } from '@platform/ui';

import { InboundCard, TriageTable } from '@/components/ErCases';
import {
  IncomingReferrals,
  ReferSheet,
  ReferralCancelSheet,
  ReferralDeclineSheet,
  ReferralsToday,
  latestReferralOf,
} from '@/components/ErReferrals';
import { AdmitSheet, DeclineSheet, DischargeSheet, WalkInSheet } from '@/components/ErSheets';
import { CapabilityPanel, ErBeds } from '@/components/ErSidebar';
import { OfflineBlock } from '@/components/OfflineBlock';
import { useEmergencyConsole } from '@/hooks/useEmergencyConsole';
import { createAlarm, type Alarm } from '@/lib/alarm';
import { NUMERALS } from '@/lib/bedCopy';
import { readDemoSession } from '@/lib/demo';

const LOCALE: Locale = 'bn';

/** `APP_FLOW.md` B1.1's rail. Emergency is this screen. */
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

export function EmergencyConsole(): ReactNode {
  return (
    <ToastProvider placement="console">
      <ConsoleBody />
    </ToastProvider>
  );
}

function ConsoleBody(): ReactNode {
  const locale = LOCALE;
  const { show } = useToast();
  const session = readDemoSession();
  const hospitalId = session?.hospitalId ?? '';

  // One alarm for the life of the screen.
  const [alarm] = useState<Alarm>(() => createAlarm());
  const er = useEmergencyConsole({ hospitalId, getToken: readToken, alarm });

  const [now, setNow] = useState(() => new Date());
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [declining, setDeclining] = useState<EmergencyCaseView | null>(null);
  const [admitting, setAdmitting] = useState<EmergencyCaseView | null>(null);
  const [discharging, setDischarging] = useState<EmergencyCaseView | null>(null);
  const [referring, setReferring] = useState<EmergencyCaseView | null>(null);
  const [decliningReferral, setDecliningReferral] = useState<ReferralView | null>(null);
  const [cancellingReferral, setCancellingReferral] = useState<ReferralView | null>(null);

  // Freshness lines age on screen with nothing else happening (`FR-OFF-03`).
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  // A refused action is said once, as a sentence (`SY-03`).
  useEffect(() => {
    if (er.lastRefusal === null) return;
    show({ title: t('erRefused', locale), tone: 'caution' });
    er.clearRefusal();
  }, [er, show, locale]);

  // BTN-A10C-CANCEL reaching the ER: the family is not coming.
  useEffect(() => {
    if (er.lastCancelled === null) return;
    show({
      title: format('erFamilyCancelled', locale, {
        problem: problemName(er.lastCancelled.problem, locale),
      }),
      tone: 'caution',
    });
    er.clearCancelled();
  }, [er, show, locale]);

  const inbound = useMemo(
    () => inboundOrder(er.cases.filter((entry) => isOnTheWay(entry.state))),
    [er.cases],
  );
  const inEr = useMemo(
    () => triageOrder(er.cases.filter((entry) => isInEr(entry.state))),
    [er.cases],
  );

  // A referred person arrived: the token the desk now calls them by.
  useEffect(() => {
    if (er.lastArrival === null) return;
    show({
      title: format('erIncomingArrivedAs', locale, {
        token: er.lastArrival.arrivedTokenLabel ?? '',
      }),
      tone: 'positive',
    });
    er.clearArrival();
  }, [er, show, locale]);

  const fetchPhone = useCallback((caseId: string) => er.api.contact(caseId), [er.api]);
  // Stable, so the refer sheet asks again only when the need changes.
  const fetchReferResults = useCallback(
    (problem: EmergencyProblem, need: EmergencyNeed) =>
      er.api.suggestions(hospitalId, problem, need),
    [er.api, hospitalId],
  );
  const referralOf = useCallback(
    (caseId: string) => latestReferralOf(er.referrals, caseId, hospitalId),
    [er.referrals, hospitalId],
  );

  if (hospitalId === '') {
    return <Notice>{t('noSession', locale)}</Notice>;
  }

  if (er.loading) {
    return (
      <div className="flex min-h-screen gap-6 p-6" aria-busy="true" data-testid="er-loading">
        <div className="w-52 shrink-0 rounded-md bg-sunken" />
        <div className="flex flex-1 flex-col gap-3">
          <div className="h-28 rounded-md bg-sunken" />
          <div className="h-28 rounded-md bg-sunken" />
          <div className="h-64 rounded-md bg-sunken" />
        </div>
        <div className="w-96 shrink-0 rounded-md bg-sunken" />
      </div>
    );
  }

  if (er.failed || er.board === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p role="alert" className="text-body-lg text-ink-secondary" data-testid="er-failed">
          {t('loadFailed', locale)}
        </p>
        <Button variant="secondary" onClick={er.retry}>
          {t('retry', locale)}
        </Button>
      </div>
    );
  }

  const loaded = er.board;
  const freshness = {
    justNow: t('updatedJustNow', locale),
    ago: t('updatedAgo', locale),
    never: t('neverConfirmed', locale),
    stale: t('staleWarning', locale),
  };
  const minutes = (value: number): string => formatAge(value, locale, NUMERALS);
  const capabilitiesPending = er.pendingCount > 0 && er.pendingCaseIds.size < er.pendingCount;

  return (
    <div className="flex min-h-screen" data-testid="er-console">
      {/* --- navigation rail ------------------------------------------------- */}
      <nav
        aria-label={t('navEmergency', locale)}
        className="w-52 shrink-0 border-r border-line p-4"
      >
        <ul className="flex flex-col gap-1">
          {NAV_ITEMS.map((key) => (
            <li key={key}>
              <span
                aria-current={key === 'navEmergency' ? 'page' : undefined}
                className="flex min-h-touch items-center rounded-sm px-3 text-body-md aria-[current=page]:bg-brand-100 aria-[current=page]:font-semibold"
              >
                {t(key, locale)}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-6">
          <OfflineBlock
            connected={er.connected}
            pendingCount={er.pendingCount}
            lastServerTs={er.lastServerTs}
            stuckCount={0}
            locale={locale}
            now={now}
          />
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* FR-DEM-07: the demo says what it is, on screen, permanently. */}
        <p className="bg-warn-100 px-6 py-2 text-caption text-warn-700">
          {t('demoBanner', locale)}
        </p>

        <header className="flex flex-wrap items-center gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0 flex-1">
            <h1 className="font-reading text-title-lg text-ink">{t('erTitle', locale)}</h1>
            <p className="text-body-sm text-ink-muted">
              {loaded.hospitalNameBn}
              {session?.staffName === undefined ? '' : ` · ${session.staffName}`}
            </p>
            <FreshnessLine
              asOf={er.lastServerTs === null ? null : new Date(er.lastServerTs)}
              now={now}
              staleAfterMinutes={loaded.staleAfterMinutes}
              labels={{ ...freshness, never: t('neverSynced', locale) }}
              formatMinutes={minutes}
            />
          </div>

          {/* FR-EMG-04: counted, and it says so. */}
          <div className="text-right" data-testid="er-load">
            <p className="font-reading text-title-lg tabular-nums text-ink">
              {format('erLoad', locale, { count: formatNumber(er.load, NUMERALS) })}
            </p>
            <p className="max-w-[16rem] text-caption text-ink-muted">{t('erLoadHint', locale)}</p>
          </div>

          {/* The audible half of CARD-B07. A blocked alarm says so and asks for
              the one tap that unblocks it; it never looks armed when it is not. */}
          {er.alarm === 'ready' ? (
            <span className="text-caption text-brand-700" data-testid="er-sound-on">
              {t('erSoundOn', locale)}
            </span>
          ) : er.alarm === 'blocked' ? (
            <Button
              size="sm"
              variant="secondary"
              data-testid="er-sound-enable"
              onClick={() => {
                void er.unlockAlarm();
              }}
            >
              {t('erSoundEnable', locale)}
            </Button>
          ) : null}

          <Button data-testid="er-walkin" onClick={() => setWalkInOpen(true)}>
            {t('erWalkIn', locale)}
          </Button>

          <a
            href="/"
            className="flex min-h-touch items-center rounded-sm px-3 text-body-sm text-brand-600 hover:bg-brand-100"
          >
            {t('changeConsole', locale)}
          </a>
        </header>

        {er.connected ? null : (
          <p
            role="status"
            data-testid="er-offline"
            className="bg-warn-100 px-6 py-2 text-body-sm text-warn-700"
          >
            {t('erOffline', locale)}
          </p>
        )}
        {er.alarm === 'blocked' ? (
          <p className="px-6 pt-2 text-caption text-ink-muted">{t('erSoundBlocked', locale)}</p>
        ) : null}

        <main className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-auto p-6">
            {/* --- আসছেন ---------------------------------------------------- */}
            <section aria-labelledby="er-inbound-title" className="flex flex-col gap-3">
              <h2 id="er-inbound-title" className="text-title-md text-ink">
                {t('erInboundTitle', locale)}
              </h2>
              {inbound.length === 0 ? (
                <div data-testid="er-inbound-empty">
                  <p className="text-body-md text-ink-secondary">{t('erInboundEmpty', locale)}</p>
                  <p className="text-caption text-ink-muted">{t('erInboundEmptyHint', locale)}</p>
                </div>
              ) : (
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
                  {inbound.map((entry) => (
                    <li key={entry.id}>
                      <InboundCard
                        entry={entry}
                        isNew={er.newCaseIds.has(entry.id)}
                        pending={er.pendingCaseIds.has(entry.id)}
                        locale={locale}
                        connected={er.connected}
                        onCommand={(next) => {
                          void er.command(entry.id, next);
                        }}
                        onDecline={() => setDeclining(entry)}
                        onSeen={() => {
                          er.seen(entry.id);
                        }}
                        fetchPhone={fetchPhone}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* --- অন্য হাসপাতাল পাঠাতে চায় (LIST-B07-IN) -------------------- */}
            <section
              aria-labelledby="er-incoming-title"
              className="flex flex-col gap-3"
              data-testid="er-incoming"
            >
              <h2 id="er-incoming-title" className="text-title-md text-ink">
                {t('erIncomingTitle', locale)}
              </h2>
              <IncomingReferrals
                referrals={er.referrals}
                hospitalId={hospitalId}
                newIds={er.newReferralIds}
                pendingIds={er.pendingReferralIds}
                locale={locale}
                onSeen={er.seenReferral}
                onAccept={(referral) => {
                  void er.referralStep(referral.id, { action: 'accept' });
                }}
                onDecline={setDecliningReferral}
                onArrive={(referral) => {
                  void er.referralStep(referral.id, { action: 'arrive' });
                }}
              />
            </section>

            {/* --- জরুরি বিভাগে আছেন ----------------------------------------- */}
            <section aria-labelledby="er-triage-title" className="flex flex-col gap-3">
              <h2 id="er-triage-title" className="text-title-md text-ink">
                {t('erTriageTitle', locale)}
              </h2>
              {inEr.length === 0 ? (
                <div data-testid="er-triage-empty">
                  <p className="text-body-md text-ink-secondary">{t('erTriageEmpty', locale)}</p>
                  <p className="text-caption text-ink-muted">{t('erTriageEmptyHint', locale)}</p>
                </div>
              ) : (
                <TriageTable
                  cases={inEr}
                  pendingCaseIds={er.pendingCaseIds}
                  locale={locale}
                  connected={er.connected}
                  onCommand={(caseId, next) => {
                    void er.command(caseId, next);
                  }}
                  onAdmit={setAdmitting}
                  onDischarge={setDischarging}
                  fetchPhone={fetchPhone}
                  referralOf={referralOf}
                  pendingReferralIds={er.pendingReferralIds}
                  onRefer={setReferring}
                  onCancelReferral={setCancellingReferral}
                />
              )}
            </section>
          </div>

          {/* --- right column -------------------------------------------------- */}
          <aside className="w-96 shrink-0 space-y-4 overflow-auto border-l border-line p-4">
            <CapabilityPanel
              capabilities={er.capabilities}
              pending={capabilitiesPending}
              locale={locale}
              now={now}
              staleAfterMinutes={loaded.staleAfterMinutes}
              freshness={freshness}
              minutes={minutes}
              onToggle={(kind, available) => {
                void er.confirmCapabilities([{ kind, available }]);
              }}
              onConfirmAll={() => {
                void er.confirmCapabilities(
                  er.capabilities.map((row) => ({ kind: row.kind, available: row.available })),
                );
              }}
            />
            <ErBeds
              published={er.published}
              locale={locale}
              now={now}
              staleAfterMinutes={loaded.staleAfterMinutes}
              freshness={freshness}
              minutes={minutes}
            />
            <ReferralsToday referrals={er.referrals} hospitalId={hospitalId} locale={locale} />
          </aside>
        </main>
      </div>

      <WalkInSheet
        open={walkInOpen}
        locale={locale}
        onOpenChange={setWalkInOpen}
        onSave={(input) => {
          void er.walkIn(input);
        }}
      />
      <DeclineSheet
        entry={declining}
        locale={locale}
        connected={er.connected}
        onClose={() => setDeclining(null)}
        onDecline={(entry, reason) => {
          void er.command(entry.id, { action: 'decline', reason });
        }}
        fetchSuggestions={(problem) => er.api.suggestions(hospitalId, problem)}
      />
      <AdmitSheet
        entry={admitting}
        bedKinds={loaded.bedKinds}
        locale={locale}
        onClose={() => setAdmitting(null)}
        onHandoff={(entry, bedKind) => {
          void er.command(entry.id, { action: 'handoff', bedKind });
        }}
      />
      <DischargeSheet
        entry={discharging}
        locale={locale}
        onClose={() => setDischarging(null)}
        onDischarge={(entry) => {
          void er.command(entry.id, { action: 'discharge' });
        }}
      />
      <ReferSheet
        entry={referring}
        locale={locale}
        connected={er.connected}
        now={now}
        freshness={freshness}
        minutes={minutes}
        fetchResults={fetchReferResults}
        onSend={(input) => {
          void er.refer(input);
        }}
        onClose={() => setReferring(null)}
      />
      <ReferralDeclineSheet
        referral={decliningReferral}
        locale={locale}
        onClose={() => setDecliningReferral(null)}
        onDecline={(referral, reason) => {
          void er.referralStep(referral.id, { action: 'decline', reason });
        }}
      />
      <ReferralCancelSheet
        referral={cancellingReferral}
        locale={locale}
        onClose={() => setCancellingReferral(null)}
        onCancel={(referral) => {
          void er.referralStep(referral.id, { action: 'cancel' });
        }}
      />
    </div>
  );
}

function Notice({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-body-lg text-ink-muted">{children}</p>
    </div>
  );
}
