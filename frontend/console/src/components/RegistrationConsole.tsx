'use client';

/**
 * `S-B-03` Registration (pilot step 23, `APP_FLOW.md` B1.6, `FR-REC-20`,
 * `FR-GST-13`).
 *
 * "phone-first search → existing patient or create → save → immediate booking
 * option." The immediate booking is a place in one of today's chambers at
 * this facility, given as a walk-in (`FR-REC-14`), so the serial is the
 * chamber's next and the queue on every screen gains the row at once.
 *
 * Opened from the rail's রেজিস্ট্রেশন. It is the same finder the walk-in
 * modal on `S-B-02` uses; this screen is for a registration desk that serves
 * every chamber rather than one.
 *
 * ## The four states (`GR-03`)
 *
 * Today's chambers load with the screen: a skeleton while they do, a sentence
 * when there are none, the failure with a retry, and — offline — the finder
 * and the chamber buttons switched off with the reason, since a serial cannot
 * be issued without the server (`lib/registration.ts`).
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { format, formatNumber, formatSerial, localName, numeralsFor, t } from '@platform/i18n';
import { Button, Card, ToastProvider, useLocale, useToast } from '@platform/ui';

import { ConsoleLanguageSwitch } from '@/components/ConsoleLanguageSwitch';
import { ConsoleRail } from '@/components/ConsoleRail';
import { FAILURE_KEY, PatientFinder, type ChosenPatient } from '@/components/PatientFinder';
import { addWalkIn } from '@/lib/registration';
import { fetchStaffChambers, type StaffChamber } from '@/lib/staffAuth';

type ChamberLoad = 'loading' | 'ready' | 'failed';

export function RegistrationConsole(): ReactNode {
  return (
    <ToastProvider placement="console">
      <RegistrationBody />
    </ToastProvider>
  );
}

function RegistrationBody(): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const { show } = useToast();
  const [online, setOnline] = useState(true);
  const [chambers, setChambers] = useState<readonly StaffChamber[]>([]);
  const [load, setLoad] = useState<ChamberLoad>('loading');
  const [patient, setPatient] = useState<ChosenPatient | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  /** The finder is remounted for the next patient, so it forgets the last. */
  const [round, setRound] = useState(0);

  const loadChambers = useCallback(async () => {
    setLoad('loading');
    const answer = await fetchStaffChambers();
    if (answer === null) {
      setLoad('failed');
      return;
    }
    // A chamber that has ended or was cancelled takes nobody.
    setChambers(
      answer.filter((chamber) => chamber.status !== 'ended' && chamber.status !== 'cancelled'),
    );
    setLoad('ready');
  }, []);

  useEffect(() => {
    setOnline(globalThis.navigator.onLine);
    void loadChambers();
    const up = (): void => {
      setOnline(true);
      void loadChambers();
    };
    const down = (): void => {
      setOnline(false);
    };
    globalThis.addEventListener('online', up);
    globalThis.addEventListener('offline', down);
    return () => {
      globalThis.removeEventListener('online', up);
      globalThis.removeEventListener('offline', down);
    };
  }, [loadChambers]);

  async function addTo(chamber: StaffChamber): Promise<void> {
    if (patient === null || adding !== null) return;
    setAdding(chamber.id);
    const result = await addWalkIn(chamber.id, patient.patientId, { kind: 'end' });
    setAdding(null);
    if (!result.ok) {
      if (result.failure === 'offline') setOnline(false);
      show({ title: t(FAILURE_KEY[result.failure], locale), tone: 'alert' });
      return;
    }
    show({
      title: format('walkInAdded', locale, {
        name: patient.fullName,
        serial: formatSerial(result.value, numerals),
      }),
      description: localName(locale, chamber.doctorNameBn, chamber.doctorNameEn),
      tone: 'positive',
    });
    setPatient(null);
    setRound((value) => value + 1);
    void loadChambers();
  }

  const chamberReason = !online
    ? t('walkInOffline', locale)
    : patient === null
      ? t('registrationChooseFirst', locale)
      : null;

  return (
    <div className="flex min-h-screen">
      <ConsoleRail current="navRegistration" locale={locale} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* FR-DEM-07: the demo says what it is, on screen, permanently. */}
        <p className="bg-warn-100 px-6 py-2 text-caption text-warn-700">
          {t('demoBanner', locale)}
        </p>

        <header className="flex items-center gap-3 border-b border-line bg-surface px-6 py-4">
          <h1 className="min-w-0 flex-1 text-title-md font-bold">
            {t('registrationTitle', locale)}
          </h1>
          <ConsoleLanguageSwitch />
        </header>

        <main className="grid flex-1 gap-6 p-6 lg:grid-cols-2" data-testid="registration-console">
          <section className="flex flex-col gap-4">
            <p className="text-body-md text-ink-secondary">{t('registrationIntro', locale)}</p>
            {!online ? (
              <p
                role="status"
                className="rounded-sm bg-warn-100 px-3 py-2 text-body-sm text-warn-700"
                data-testid="registration-offline"
              >
                {t('walkInOffline', locale)}
              </p>
            ) : null}
            {patient === null ? (
              <PatientFinder key={round} online={online} onChosen={setPatient} />
            ) : (
              <Card tone="brand" data-testid="registration-chosen">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-body-md font-semibold">{patient.fullName}</p>
                  <Button
                    variant="quiet"
                    onClick={() => {
                      setPatient(null);
                      setRound((value) => value + 1);
                    }}
                  >
                    {t('counterChangePatient', locale)}
                  </Button>
                </div>
              </Card>
            )}
          </section>

          <section className="flex flex-col gap-3" data-testid="registration-chambers">
            <h2 className="text-title-sm">{t('registrationChambers', locale)}</h2>
            {load === 'loading' ? (
              <div
                className="flex flex-col gap-3"
                aria-busy="true"
                data-testid="registration-chambers-loading"
              >
                <div className="h-20 rounded-md bg-sunken" />
                <div className="h-20 rounded-md bg-sunken" />
              </div>
            ) : load === 'failed' ? (
              <div
                role="alert"
                className="flex flex-col items-start gap-3 rounded-md bg-alert-100 p-4"
              >
                <p className="text-body-md text-alert-700">
                  {t('registrationChambersFailed', locale)}
                </p>
                <Button variant="secondary" onClick={() => void loadChambers()}>
                  {t('retry', locale)}
                </Button>
              </div>
            ) : chambers.length === 0 ? (
              <Card data-testid="registration-no-chambers">
                <p className="text-body-md text-ink-secondary">
                  {t('registrationNoChambers', locale)}
                </p>
              </Card>
            ) : (
              chambers.map((chamber) => (
                <Card key={chamber.id} data-testid={`registration-chamber-${chamber.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-body-md font-semibold">
                        {localName(locale, chamber.doctorNameBn, chamber.doctorNameEn)}
                      </p>
                      <p className="text-body-sm text-ink-muted">
                        {localName(locale, chamber.departmentNameBn, chamber.departmentNameEn)}
                        {chamber.room === null ? null : ` · ${chamber.room}`}
                        {` · ${format('registrationWaiting', locale, { count: formatNumber(chamber.waiting, numerals) })}`}
                      </p>
                    </div>
                    {chamberReason === null ? (
                      <Button
                        loading={adding === chamber.id}
                        onClick={() => void addTo(chamber)}
                        data-testid={`registration-add-${chamber.id}`}
                      >
                        {t('registrationAddHere', locale)}
                      </Button>
                    ) : (
                      <Button
                        disabled
                        disabledReason={chamberReason}
                        data-testid={`registration-add-${chamber.id}`}
                      >
                        {t('registrationAddHere', locale)}
                      </Button>
                    )}
                  </div>
                </Card>
              ))
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
