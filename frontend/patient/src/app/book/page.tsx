'use client';

/**
 * The booking flow: doctor → session → confirm → success.
 *
 * `APP_FLOW.md` A3/A4 gives these four as separate screens (`S-A-07`,
 * `S-A-07b`, `S-A-07c`, `S-A-07d`). They are one route with four steps here,
 * for one reason: a booking is a single decision a person is making, and every
 * navigation between steps on a 3G connection is a chance to lose them. The
 * step boundaries and the control ids are kept exactly, so the screens can be
 * split later without changing what any of them does.
 *
 * ## The confirm step is the one place a blocking wait is allowed
 *
 * `APP_FLOW.md` A4: "the screen locks (this is the one place a blocking wait
 * is acceptable, because money)". Everywhere else in this product the UI
 * answers immediately and reconciles afterwards; here it must not, because an
 * optimistic serial that the server then refuses is worse than a two-second
 * wait.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { SPECIALTIES, normaliseBdMobile } from '@platform/domain';
import {
  formatDateTime,
  formatMinutes,
  formatNumber,
  formatSerial,
  formatTaka,
  tp,
  formatAge,
  districtName,
  numeralsFor,
  localName,
  type Locale,
} from '@platform/i18n';
import { Button, Card, Chip, FreshnessLine, Input, useLocale } from '@platform/ui';

import { GuestCodeCard } from '@/components/GuestCodeCard';
import { HospitalBeds } from '@/components/HospitalBeds';
import { HospitalMark } from '@/components/HospitalMark';
import { ChevronIcon } from '@/components/icons';
import { Monogram } from '@/components/Monogram';
import { NotShared, withholds } from '@/components/NotShared';
import { PaymentHold } from '@/components/PaymentHold';
import { StandbyJoin } from '@/components/StandbyJoin';
import { EmptyState, FailedState, OfflineNotice, Panel, SkeletonCards } from '@/components/States';
import { TabScreen } from '@/components/TabScreen';
import { useDeployment } from '@/hooks/useDeployment';
import { useGuestPhoneProof } from '@/hooks/useGuestPhoneProof';
import { useNow } from '@/hooks/useNow';
import { useOnline } from '@/hooks/useOnline';
import { bookAsProfile, profiles, readAccount, type Profile } from '@/lib/account';
import {
  allHospitals,
  availability,
  book,
  doctorSessions,
  doctorsAtHospital,
  hospitalsForSpecialty,
} from '@/lib/api';
import { rememberBooking } from '@/lib/bookings';
import { doctorName } from '@/lib/doctor';
import { sessionDay, sessionHours } from '@/lib/when';

import type { BackTarget } from '@/components/AppHeader';
import type { BookingResponse } from '@/lib/api';
import type {
  Availability,
  HospitalCard,
  HospitalDoctorCard,
  Loadable,
  SessionCard,
} from '@/lib/types';
import type { ReactNode } from 'react';

/**
 * The flow, in the order `APP_FLOW.md` A3–A4 specifies.
 *
 * `S-A-07` is titled "Specialty results — **hospitals offering it**", and the
 * order is the point: a patient picks somewhere they can reach before they
 * pick who they see. Doctors-first asked somebody in Dhaka to choose between
 * forty cardiologists without knowing which was twenty minutes away.
 */
type Step = 'hospital' | 'doctor' | 'session' | 'confirm' | 'standby' | 'done';

/**
 * No specialty: a hospital opened by name from the search screen
 * (`S-A-07s`), where the answer is every doctor there. Not a code any
 * department carries, so it cannot be mistaken for one.
 */
const ANY_SPECIALTY = '';

/**
 * Where a search result enters the flow.
 *
 * A result already names the hospital, and sometimes the doctor, so the flow
 * opens on the step after them rather than asking again (`FR-PAT-17`: "without
 * searching again"). Each is taken once; going back from there is the
 * ordinary flow.
 */
interface Entry {
  hospital: string | null;
  doctor: string | null;
}

export default function BookPage(): ReactNode {
  const locale = useLocale();
  const [specialty, setSpecialty] = useState<string | null>(null);
  const [entry, setEntry] = useState<Entry>({ hospital: null, doctor: null });
  const [step, setStep] = useState<Step>('hospital');
  const online = useOnline();

  const [places, setPlaces] = useState<Loadable<HospitalCard>>({ state: 'loading' });
  const [place, setPlace] = useState<HospitalCard | null>(null);
  const [doctors, setDoctors] = useState<Loadable<HospitalDoctorCard>>({ state: 'loading' });
  const [doctor, setDoctor] = useState<HospitalDoctorCard | null>(null);
  const [sessions, setSessions] = useState<SessionCard[] | null>(null);
  const [session, setSession] = useState<SessionCard | null>(null);
  const [slots, setSlots] = useState<Availability | null>(null);
  const [booking, setBooking] = useState<BookingResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // Read after mount: the server has no `location`, and reading it during
  // render makes the first client render disagree with the server's.
  useEffect(() => {
    const params = new URLSearchParams(globalThis.location.search);
    const hospital = params.get('hospital');
    setEntry({ hospital, doctor: params.get('doctor') });
    setSpecialty(params.get('specialty') ?? (hospital === null ? 'MED' : ANY_SPECIALTY));
  }, []);

  useEffect(() => {
    if (specialty === null) return;
    setPlaces({ state: 'loading' });
    void (specialty === ANY_SPECIALTY ? allHospitals() : hospitalsForSpecialty(specialty))
      .then((list) => {
        setPlaces({ state: 'ready', ...list });
      })
      .catch(() => {
        // Not an empty list: see `Loadable`.
        setPlaces({ state: 'failed' });
      });
  }, [specialty]);

  const chooseHospital = useCallback(
    (chosen: HospitalCard) => {
      setPlace(chosen);
      setDoctors({ state: 'loading' });
      setStep('doctor');
      void doctorsAtHospital(chosen.id, specialty === ANY_SPECIALTY ? null : (specialty ?? 'MED'))
        .then((list) => {
          setDoctors({ state: 'ready', ...list });
        })
        .catch(() => {
          setDoctors({ state: 'failed' });
        });
    },
    [specialty],
  );

  const chooseDoctor = useCallback((chosen: HospitalDoctorCard) => {
    setDoctor(chosen);
    setSessions(null);
    setStep('session');
    void doctorSessions(chosen.id)
      .then(setSessions)
      .catch(() => {
        setSessions([]);
      });
  }, []);

  // A search result's hospital, then its doctor, each taken once the list
  // that holds it has arrived. One that is no longer there (a hospital that
  // has left the network, a doctor no longer listed) leaves the person on the
  // list they would have chosen from, which is the honest place to be.
  useEffect(() => {
    if (entry.hospital === null || places.state === 'loading') return;
    const found =
      places.state === 'ready'
        ? places.items.find((candidate) => candidate.id === entry.hospital)
        : undefined;
    setEntry((current) => ({ ...current, hospital: null }));
    if (found !== undefined) chooseHospital(found);
  }, [entry.hospital, places, chooseHospital]);

  useEffect(() => {
    if (entry.doctor === null || entry.hospital !== null) return;
    if (step !== 'doctor' || doctors.state === 'loading') return;
    const found =
      doctors.state === 'ready'
        ? doctors.items.find((candidate) => candidate.id === entry.doctor)
        : undefined;
    setEntry((current) => ({ ...current, doctor: null }));
    if (found !== undefined) chooseDoctor(found);
  }, [entry.doctor, entry.hospital, step, doctors, chooseDoctor]);

  const chooseSession = useCallback((chosen: SessionCard) => {
    setSession(chosen);
    setStep('confirm');
    // Availability is fetched fresh at the confirm step rather than reused
    // from the list: between choosing and confirming, somebody else may have
    // taken the last serial.
    void availability(chosen.id)
      .then(setSlots)
      .catch(() => {
        setSlots(null);
      });
  }, []);

  /**
   * `BTN-A06D-STANDBY`: a full chamber's card offers its standby list
   * (`FR-PAT-25`) instead of a booking.
   */
  const chooseStandby = useCallback((chosen: SessionCard) => {
    setSession(chosen);
    setStep('standby');
  }, []);

  if (step === 'done' && booking !== null && session !== null) {
    return <Success booking={booking} session={session} />;
  }

  // The header says where in the flow a person is, and its back control is
  // one step back inside the flow, never a dead end (`BTN-A07-BACK`).
  const specialtyEntry =
    specialty === null || specialty === ANY_SPECIALTY
      ? undefined
      : SPECIALTIES.find((entry) => entry.code === specialty);
  const stepBack = (to: Step): BackTarget => ({
    onBack: () => {
      setStep(to);
    },
    testId: 'step-back',
  });
  const header: { readonly title: string; readonly back: BackTarget } =
    step === 'doctor'
      ? { title: tp('chooseDoctor', locale), back: stepBack('hospital') }
      : step === 'session'
        ? { title: tp('doctorDetailsTitle', locale), back: stepBack('doctor') }
        : step === 'standby'
          ? { title: tp('standbyJoinTitle', locale), back: stepBack('session') }
          : step === 'confirm'
            ? { title: tp('confirmTitle', locale), back: stepBack('session') }
            : {
                title:
                  specialtyEntry === undefined
                    ? tp('homeFindDoctor', locale)
                    : localName(locale, specialtyEntry.nameBn, specialtyEntry.nameEn),
                back: { fallback: '/search' },
              };

  return (
    <TabScreen title={header.title} back={header.back}>
      {/* GR-03: the fourth state. Announced, because a person who has just
          lost signal is not necessarily looking at the top of the screen. */}
      {online ? null : (
        <OfflineNotice testId="offline-notice">{tp('offlineBooking', locale)}</OfflineNotice>
      )}

      {step === 'hospital' ? (
        // A result that names its hospital waits for the list rather than
        // showing it for a moment and then leaving it.
        <HospitalList
          hospitals={entry.hospital === null ? places : { state: 'loading' }}
          onChoose={chooseHospital}
        />
      ) : null}

      {step === 'doctor' && place !== null ? (
        <DoctorList hospital={place} doctors={doctors} onChoose={chooseDoctor} />
      ) : null}

      {step === 'session' && doctor !== null ? (
        <SessionList
          doctor={doctor}
          hospital={place}
          asOf={doctors.state === 'ready' ? doctors.asOf : null}
          sessions={sessions}
          onChoose={chooseSession}
          onStandby={chooseStandby}
        />
      ) : null}

      {step === 'standby' && session !== null ? (
        <StandbyJoin
          session={session}
          online={online}
          onJoined={(joined) => {
            // The status token is the place on the list; the page it
            // opens is where the offer — or the seat — arrives.
            globalThis.location.assign(`/standby?t=${encodeURIComponent(joined.token)}`);
          }}
        />
      ) : null}

      {step === 'confirm' && session !== null ? (
        <Confirm
          session={session}
          slots={slots}
          online={online}
          failure={failure}
          onFailure={setFailure}
          onBooked={(result) => {
            setBooking(result);
            setStep('done');

            // `S-A-09` and the home screen's live strip both read this. A
            // guest has no account for `GET /me/bookings` to list against
            // (CLAUDE.md §4.1), so the device remembers what it booked — and
            // the serials tab says as much rather than implying more.
            if (result.trackingUrl !== null && doctor !== null) {
              const token = new URL(result.trackingUrl).searchParams.get('t');
              if (token !== null) {
                rememberBooking({
                  bookingId: result.bookingId,
                  serial: result.serial,
                  sessionId: result.sessionId,
                  doctorNameBn: doctor.nameBn,
                  doctorNameEn: doctor.nameEn,
                  hospitalNameBn: place?.nameBn ?? '',
                  hospitalNameEn: place?.nameEn ?? '',
                  ...(place === null ? {} : { hospitalId: place.id }),
                  plannedStart: session.plannedStart,
                  url: `/s?b=${result.bookingId}&t=${encodeURIComponent(token)}`,
                  token,
                  savedAt: new Date().toISOString(),
                });
              }
            }
          }}
        />
      ) : null}
    </TabScreen>
  );
}

/**
 * `S-A-07` — the hospitals offering this specialty.
 *
 * Each card carries what a person weighs when choosing where to go: how many
 * doctors are here for their problem, whether anybody is sitting right now,
 * and how many serials are still open today. `FR-PAT-14` requires a live
 * figure to carry its freshness, and "sitting now" is one — it is stamped by
 * the count beside it rather than presented as a standing fact.
 */
function HospitalList({
  hospitals,
  onChoose,
}: {
  readonly hospitals: Loadable<HospitalCard>;
  readonly onChoose: (hospital: HospitalCard) => void;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const now = useNow();

  // GR-03: all four are designed states, not the absence of one — and the
  // failed one never borrows the empty one's words.
  if (hospitals.state === 'loading') return <SkeletonCards count={3} />;
  if (hospitals.state === 'failed') return <LoadFailed />;
  if (hospitals.items.length === 0) {
    return <EmptyState>{tp('noHospitals', locale)}</EmptyState>;
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-title-sm font-bold">{tp('chooseHospitalFirst', locale)}</h2>
        {/* DoD §5.8 and FR-PAT-14: "who is sitting now" is a live figure, so the
            list says how old it is rather than implying it is this instant. */}
        <Freshness asOf={hospitals.asOf} now={now} />
      </div>

      <ul className="flex flex-col gap-3">
        {hospitals.items.map((hospital) => (
          <li key={hospital.id}>
            <button
              type="button"
              onClick={() => {
                onChoose(hospital);
              }}
              className="w-full rounded-md border border-line bg-surface p-4 text-left shadow-1"
              data-testid={`hospital-${hospital.id}`}
            >
              <span className="flex items-start gap-3">
                <HospitalMark hospitalId={hospital.id} logoVersion={hospital.logoVersion} />

                <span className="min-w-0 flex-1">
                  <span className="block text-title-sm font-bold">
                    {localName(locale, hospital.nameBn, hospital.nameEn)}
                  </span>
                  <span className="block text-body-sm text-ink-muted">
                    {(locale === 'en' ? hospital.addressEn : hospital.addressBn) ??
                      districtName(hospital.district, locale)}
                  </span>

                  <span className="mt-2 flex flex-wrap items-center gap-2">
                    {hospital.doctorCount === null ? null : (
                      <Chip tone="neutral">
                        {tp('doctorsHere', locale).replace(
                          '{count}',
                          formatNumber(hospital.doctorCount, numerals),
                        )}
                      </Chip>
                    )}

                    {/* A11Y-03: the state is a sentence, not a colour. And a
                        hospital that keeps the figure is not said to have
                        nobody sitting (FR-NET-04). */}
                    {hospital.sittingNow === null ? (
                      withholds(hospital, 'serials') ? (
                        <NotShared figure="serials" />
                      ) : null
                    ) : (
                      <Chip tone={hospital.sittingNow > 0 ? 'positive' : 'neutral'}>
                        {hospital.sittingNow > 0
                          ? tp('sittingNowCount', locale).replace(
                              '{count}',
                              formatNumber(hospital.sittingNow, numerals),
                            )
                          : tp('nobodySittingNow', locale)}
                      </Chip>
                    )}
                  </span>

                  {/* FR-PAT-14: free beds and ICU, with their own age. */}
                  <HospitalBeds
                    beds={hospital.beds}
                    notShared={withholds(hospital, 'beds')}
                    now={now}
                  />
                </span>

                <span className="mt-1 text-ink-muted">
                  <ChevronIcon size={18} />
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * `S-A-05h` — the doctors at the hospital that was chosen.
 *
 * Ordered by who is in a chamber now, then by who sits next. A doctor with no
 * upcoming chamber is still listed, greyed by its own words rather than
 * hidden: they work here, and somebody looking for them by name should find
 * them rather than conclude the hospital has nobody.
 */
function DoctorList({
  hospital,
  doctors,
  onChoose,
}: {
  readonly hospital: HospitalCard;
  readonly doctors: Loadable<HospitalDoctorCard>;
  readonly onChoose: (doctor: HospitalDoctorCard) => void;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const now = useNow();

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <HospitalMark hospitalId={hospital.id} logoVersion={hospital.logoVersion} size="header" />
        <h2 className="min-w-0 text-title-sm font-bold">
          {localName(locale, hospital.nameBn, hospital.nameEn)}
        </h2>
      </div>

      {/* What the hospital says of itself (`FR-BRD-06`): its own words, shown
          as its own, in the reader's language where it wrote both. */}
      {describe(hospital, locale) === null ? null : (
        <p className="text-body-md text-ink-secondary" data-testid="facility-description">
          {describe(hospital, locale)}
        </p>
      )}

      {doctors.state === 'loading' ? (
        <SkeletonCards count={3} />
      ) : doctors.state === 'failed' ? (
        <LoadFailed />
      ) : doctors.items.length === 0 ? (
        <EmptyState>{tp('noDoctorsHere', locale)}</EmptyState>
      ) : (
        <>
          {/* Who is in a chamber right now is the liveliest figure on the
              screen, so it carries its age (`FR-PAT-14`). */}
          <Freshness asOf={doctors.asOf} now={now} />

          <ul className="flex flex-col gap-3">
            {doctors.items.map((doctor) => (
              <li key={doctor.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChoose(doctor);
                  }}
                  className="w-full rounded-md border border-line bg-surface p-4 text-left shadow-1"
                  data-testid={`doctor-${doctor.id}`}
                >
                  <span className="flex items-start gap-3">
                    <Monogram name={localName(locale, doctor.nameBn, doctor.nameEn)} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-title-sm font-bold">
                        {doctorName(locale, doctor.nameBn, doctor.nameEn)}
                      </span>
                      {doctor.degrees === null ? null : (
                        <span className="block text-body-sm text-ink-muted">{doctor.degrees}</span>
                      )}

                      <span className="mt-2 flex flex-wrap items-center gap-2">
                        <DoctorStatus doctor={doctor} />

                        {doctor.openSerials === null ? null : (
                          <Chip tone={doctor.openSerials > 0 ? 'neutral' : 'caution'}>
                            {doctor.openSerials > 0
                              ? tp('serialsLeft', locale).replace(
                                  '{count}',
                                  formatNumber(doctor.openSerials, numerals),
                                )
                              : tp('sessionFull', locale)}
                          </Chip>
                        )}

                        {/* When a doctor sits is a schedule and is shown;
                            who is in a chamber now and how many serials are
                            left are the hospital's to keep (FR-NET-04). */}
                        {doctor.serialsShared === false ? <NotShared figure="serials" /> : null}
                      </span>
                    </span>

                    <span className="shrink-0 text-right">
                      <span className="block text-caption text-ink-muted">
                        {tp('feeShort', locale)}
                      </span>
                      <span className="block text-body-md font-bold tabular-nums">
                        {formatTaka(doctor.feePoisha, numerals)}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * `FR-PAT-13`: in a chamber now, or the next time they sit — never a bare
 * "available". Green only for the first, which is good news (§0.5).
 */
function DoctorStatus({ doctor }: { readonly doctor: HospitalDoctorCard }): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  return (
    <Chip tone={doctor.sittingNow === true ? 'positive' : 'neutral'}>
      {doctor.sittingNow === true
        ? tp('inChamberNow', locale)
        : doctor.nextSessionAt === null
          ? tp('notSittingSoon', locale)
          : tp('nextSitting', locale).replace(
              '{time}',
              formatDateTime(doctor.nextSessionAt, numerals),
            )}
    </Chip>
  );
}

/**
 * A hospital's description in the reader's language, or in the other one when
 * it wrote only that; null when it has said nothing.
 */
function describe(hospital: HospitalCard, locale: Locale): string | null {
  const [first, second] =
    locale === 'en'
      ? [hospital.descriptionEn, hospital.descriptionBn]
      : [hospital.descriptionBn, hospital.descriptionEn];
  return first ?? second ?? null;
}

/**
 * `GR-03`'s error state, for a list that could not be fetched.
 *
 * Reloads rather than re-running one fetch: this is a screen a person reached
 * by tapping a specialty, so the whole screen is the retry, and a button that
 * silently retried one request would leave the rest of the page in whatever
 * state it was already in.
 */
function LoadFailed(): ReactNode {
  const locale = useLocale();
  return (
    <FailedState
      role="status"
      testId="load-failed"
      action={
        <Button
          onClick={() => {
            globalThis.location.reload();
          }}
        >
          {tp('tryAgain', locale)}
        </Button>
      }
    >
      {tp('listFailed', locale)}
    </FailedState>
  );
}

/**
 * The one freshness line both discovery lists use.
 *
 * `FreshnessLine` takes its labels and its number formatting from the caller so
 * that `shared/ui` never imports a locale; every patient surface passes the
 * same four strings and the screen's numerals, so they are passed once here
 * rather than at each call site.
 */
function Freshness({ asOf, now }: { readonly asOf: string; readonly now: Date }): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  return (
    <FreshnessLine
      asOf={new Date(asOf)}
      now={now}
      labels={{
        justNow: tp('updatedJustNow', locale),
        ago: tp('updatedAgo', locale),
        never: tp('updatedNever', locale),
        stale: tp('staleWarning', locale),
      }}
      formatMinutes={(value) => formatAge(value, locale, numerals)}
    />
  );
}

/**
 * `S-A-06d` and `S-A-07b` — the doctor, and their chambers.
 *
 * The approved screen (FRONTEND.md §0.5): the doctor's card first, with the
 * live status and its age and the fee; then the chambers, each a row with its
 * day, its hours and room, and how many serials are left. A tap on a chamber
 * goes straight on to confirming, as it always has: one decision, one tap.
 */
function SessionList({
  doctor,
  hospital,
  asOf,
  sessions,
  onChoose,
  onStandby,
}: {
  readonly doctor: HospitalDoctorCard;
  readonly hospital: HospitalCard | null;
  readonly asOf: string | null;
  readonly sessions: SessionCard[] | null;
  readonly onChoose: (session: SessionCard) => void;
  readonly onStandby: (session: SessionCard) => void;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const now = useNow();
  const department = localName(locale, doctor.departmentNameBn, doctor.departmentNameEn);

  return (
    <section className="flex flex-col gap-4">
      <Panel className="p-4" testId="doctor-card">
        <div className="flex items-center gap-4">
          <Monogram name={localName(locale, doctor.nameBn, doctor.nameEn)} size="lg" />
          <div className="min-w-0">
            <p className="text-title-sm font-bold">
              {doctorName(locale, doctor.nameBn, doctor.nameEn)}
            </p>
            {doctor.degrees === null ? null : (
              <p className="text-body-sm text-ink-muted">{doctor.degrees}</p>
            )}
            <p className="text-body-sm text-ink-secondary">
              {hospital === null
                ? department
                : `${department} · ${localName(locale, hospital.nameBn, hospital.nameEn)}`}
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <DoctorStatus doctor={doctor} />
          {doctor.serialsShared === false ? <NotShared figure="serials" /> : null}
        </div>
        {asOf === null ? null : (
          <div className="mt-1">
            <Freshness asOf={asOf} now={now} />
          </div>
        )}

        <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
          <span className="text-body-sm text-ink-secondary">{tp('consultationFee', locale)}</span>
          <span className="text-title-sm font-bold tabular-nums">
            {formatTaka(doctor.feePoisha, numerals)}
          </span>
        </div>
      </Panel>

      <div className="flex flex-col gap-1">
        <h2 className="text-title-sm font-bold">{tp('chooseChamber', locale)}</h2>
        <p className="text-body-sm text-ink-muted">{tp('chooseChamberHint', locale)}</p>
      </div>

      {sessions === null ? (
        <SkeletonCards count={2} height={76} />
      ) : sessions.length === 0 ? (
        <EmptyState>{tp('noSessions', locale)}</EmptyState>
      ) : (
        <SessionCards sessions={sessions} onChoose={onChoose} onStandby={onStandby} />
      )}
    </section>
  );
}

function SessionCards({
  sessions,
  onChoose,
  onStandby,
}: {
  readonly sessions: SessionCard[];
  readonly onChoose: (session: SessionCard) => void;
  readonly onStandby: (session: SessionCard) => void;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const now = useNow();
  return (
    <ul className="flex flex-col gap-2.5">
      {sessions.map((session) => {
        // `taken` is null where the hospital does not share its serial
        // figures (FR-NET-04). Whether the chamber is full is always said: a
        // patient is not sent into a booking that can only be refused.
        const remaining =
          session.capacity === null || session.taken === null
            ? null
            : Math.max(0, session.capacity - session.taken);
        const full = session.full ?? remaining === 0;
        const hours = sessionHours(session.plannedStart, session.plannedEnd, locale);

        return (
          <li key={session.id}>
            <button
              type="button"
              disabled={full}
              onClick={() => {
                onChoose(session);
              }}
              className="flex w-full items-center gap-3 rounded-md border border-line bg-surface px-4 py-3 text-left shadow-1 hover:border-brand-600 disabled:opacity-50 disabled:shadow-none"
              data-testid={`session-${session.id}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-body-md font-bold">
                  {sessionDay(session.plannedStart, locale, now)}
                </span>
                <span className="block text-body-sm text-ink-secondary tabular-nums">
                  {session.room === null
                    ? hours
                    : tp('sessionHoursRoom', locale)
                        .replace('{hours}', hours)
                        .replace('{room}', session.room)}
                </span>
                <span className="block text-caption text-ink-muted">
                  {localName(locale, session.hospitalNameBn, session.hospitalNameEn)}
                </span>
              </span>

              <span className="shrink-0 text-right">
                {full ? (
                  <Chip tone="caution">{tp('sessionFull', locale)}</Chip>
                ) : remaining === null ? (
                  session.taken === null ? (
                    <span className="text-body-sm text-ink-muted">
                      {tp('serialsNotShared', locale)}
                    </span>
                  ) : null
                ) : (
                  <span className="text-body-md font-bold text-brand-700 tabular-nums">
                    {tp('seatsLeftCount', locale).replace(
                      '{count}',
                      formatNumber(remaining, numerals),
                    )}
                  </span>
                )}
              </span>

              {full ? null : (
                <span className="text-ink-muted">
                  <ChevronIcon size={18} />
                </span>
              )}
            </button>

            {/* `BTN-A06D-STANDBY` — "visible only when a session is full". */}
            {full ? (
              <div className="mt-2">
                <Button
                  variant="secondary"
                  fullWidth
                  onClick={() => {
                    onStandby(session);
                  }}
                  data-testid={`standby-join-${session.id}`}
                >
                  {tp('standbyJoin', locale)}
                </Button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** `S-A-07c` — the guest sheet, the fee breakdown, and the one blocking wait. */
function Confirm({
  session,
  slots,
  online,
  failure,
  onFailure,
  onBooked,
}: {
  readonly session: SessionCard;
  readonly slots: Availability | null;
  readonly online: boolean;
  readonly failure: string | null;
  readonly onFailure: (message: string | null) => void;
  readonly onBooked: (booking: BookingResponse) => void;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<'male' | 'female' | 'other'>('female');
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<'bkash' | 'nagad' | 'card' | 'at_hospital'>('bkash');
  // A deployment with no online payment offers the counter only (pilot step 26).
  const deployment = useDeployment();
  const onlinePayments = deployment?.onlinePayments !== false;
  // The online methods this deployment can take (plan H3): card only where a
  // provider takes it. An older server that does not say offers all three.
  const offered = deployment?.paymentMethods ?? ['bkash', 'nagad', 'card'];
  useEffect(() => {
    if (!onlinePayments) setMethod('at_hospital');
    else if (method !== 'at_hospital' && !offered.includes(method)) {
      const first = offered[0];
      setMethod(first === 'bkash' || first === 'nagad' || first === 'card' ? first : 'at_hospital');
    }
  }, [onlinePayments, offered, method]);
  const [busy, setBusy] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(false);

  // The freshness caption has to age on screen without anything else
  // happening — that is the whole point of it (`FR-OFF-03`).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  /**
   * One key per confirm *attempt*, reused across retries of that attempt.
   *
   * That is what makes a double tap on a bad connection safe rather than
   * expensive — and it must not be regenerated on every render, or the whole
   * point is lost.
   */
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  // The number as people type it — 01712-345678, 8801712345678, +8801712345678 —
  // normalised to the stored shape (`DB-P6`), as the bed request and the
  // emergency form already do. Refusing everything but `+880…` lost people
  // who typed their number the way they say it.
  const phoneStored = normaliseBdMobile(phone);
  const phoneValid = phoneStored !== null;

  /**
   * Signed in: the account's own profiles, so nothing is typed again
   * (`FR-GST-10`, `FR-PAT-03`; plan F1). Null means the guest sheet: nobody
   * is signed in, the account holds no profile yet, or the profiles could not
   * be read, none of which may stand between a person and a serial
   * (`FR-GST-11`).
   */
  const [ownProfiles, setOwnProfiles] = useState<readonly Profile[] | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  // Booking for somebody who is not one of the profiles: the guest sheet, as asked for.
  const [forSomebodyElse, setForSomebodyElse] = useState(false);
  useEffect(() => {
    if (readAccount() === null) return undefined;
    let stale = false;
    void profiles().then((answer) => {
      if (stale || !answer.ok || answer.value.length === 0) return;
      setOwnProfiles(answer.value);
      const first = answer.value.find((profile) => profile.isPrimary) ?? answer.value[0];
      setProfileId(first?.patientId ?? null);
    });
    return () => {
      stale = true;
    };
  }, []);
  const asAccount = ownProfiles !== null && !forSomebodyElse;

  // Offline is part of readiness, not a separate guard: the button then
  // carries "no connection" as its reason rather than silently doing nothing
  // when tapped (`FRONTEND.md` §5.1).
  const ready = asAccount
    ? online && profileId !== null
    : online && name.trim().length >= 2 && phoneValid && Number(age) >= 0 && age !== '';

  const fee = useMemo(() => {
    // Shown from the session's own fee before the server answers, so a person
    // sees what they are agreeing to *before* agreeing to it (FR-PAT-21). The
    // platform fee is added by the server, which owns the rate.
    return { consultation: session.feePoisha };
  }, [session.feePoisha]);

  /**
   * `MOD-GST-OTP` (`FR-GST-03`): open when this deployment asks a new number
   * to prove itself before booking. A demonstration never opens it; a number
   * that has proved itself before is not asked again (`FR-GST-12`).
   */
  const {
    pending: phoneCheck,
    codeWrong,
    begin: beginPhoneCheck,
    prove: provePhone,
  } = useGuestPhoneProof();

  const finish = useCallback(
    async (guestToken: string | null) => {
      if (phoneStored === null) return;
      const result = await book({
        sessionId: session.id,
        method,
        guest: { name: name.trim(), phone: phoneStored, ageYears: Number(age), sex },
        reason,
        idempotencyKey,
        guestToken,
      });
      onBooked(result);
    },
    [session.id, method, name, phoneStored, age, sex, reason, idempotencyKey, onBooked],
  );

  const proveCode = useCallback(
    async (code: string) => {
      if (phoneStored === null) return;
      setBusy(true);
      try {
        await finish(await provePhone(phoneStored, name.trim(), code));
      } catch (error) {
        const code = (error as { code?: string }).code;
        onFailure(
          code === 'AUTH_OTP_INVALID'
            ? tp('accountCodeWrong', locale)
            : code === 'AUTH_LOCKED'
              ? tp('accountLocked', locale)
              : tp('bookingFailed', locale),
        );
      } finally {
        setBusy(false);
      }
    },
    [phoneStored, name, finish, provePhone, onFailure, locale],
  );

  const confirm = useCallback(async () => {
    if (asAccount ? profileId === null : phoneStored === null) return;
    setBusy(true);
    onFailure(null);

    try {
      if (asAccount && profileId !== null) {
        // The account is a number that was proved (`FR-PAT-01`): no code is
        // asked for, and the profile carries the name, the age and the sex.
        onBooked(
          await bookAsProfile({
            sessionId: session.id,
            method,
            patientId: profileId,
            reason,
            idempotencyKey,
          }),
        );
        return;
      }
      if (phoneStored === null) return;
      const start = await beginPhoneCheck(phoneStored, name.trim());
      if (!start.ready) return;
      await finish(start.guestToken);
    } catch (error) {
      // Stated in Bangla, by cause. "Something went wrong" tells a person
      // nothing they can act on (BACKEND.md §9 maps codes to copy).
      const code = (error as { code?: string }).code;
      onFailure(
        code === 'BOOKING_DUPLICATE'
          ? tp('alreadyBooked', locale)
          : code === 'SESSION_FULL'
            ? tp('chamberFull', locale)
            : code === 'BOOKING_LIMIT_REACHED'
              ? tp('bookingLimitReached', locale)
              : code === 'PREPAYMENT_REQUIRED'
                ? tp('prepaymentRequired', locale)
                : code === 'PAYMENT_UNAVAILABLE'
                  ? tp('paymentUnavailable', locale)
                  : tp('bookingFailed', locale),
      );
    } finally {
      setBusy(false);
    }
  }, [
    asAccount,
    profileId,
    session.id,
    method,
    reason,
    idempotencyKey,
    onBooked,
    phoneStored,
    name,
    finish,
    beginPhoneCheck,
    onFailure,
    locale,
  ]);

  return (
    <section className="flex flex-col gap-4">
      <Panel className="p-4">
        <p className="text-body-md font-bold">
          {doctorName(locale, session.doctorNameBn, session.doctorNameEn)}
        </p>
        <p className="text-body-sm text-ink-secondary">
          {localName(locale, session.hospitalNameBn, session.hospitalNameEn)}
        </p>
        <p className="text-body-sm text-ink-secondary tabular-nums">
          {`${sessionDay(session.plannedStart, locale, now)} · ${sessionHours(
            session.plannedStart,
            session.plannedEnd,
            locale,
          )}`}
        </p>

        {/* FR-PAT-13: unknown is a real answer, and not the same as zero. */}
        <p className="mt-2 border-t border-line pt-2 text-body-sm text-ink-secondary">
          {tp('expectedWait', locale)}:{' '}
          {slots?.expectedWaitMinutes == null
            ? tp('waitUnknown', locale)
            : `${formatMinutes(slots.expectedWaitMinutes, numerals)} ${tp('minutesShort', locale)}`}
        </p>

        {/* DoD §5.8: the expected wait is a live figure, so it never appears
            without saying how old it is. */}
        <FreshnessLine
          asOf={slots === null ? null : new Date(slots.asOf)}
          now={now}
          labels={{
            justNow: tp('updatedJustNow', locale),
            ago: tp('updatedAgo', locale),
            never: tp('updatedNever', locale),
            stale: tp('staleWarning', locale),
          }}
          formatMinutes={(value) => formatAge(value, locale, numerals)}
        />
      </Panel>

      {/* MOD-A07-PROFILE (plan F1): signed in, the serial is for one of the
          account's own profiles and nothing is typed again (FR-GST-10). */}
      {asAccount && ownProfiles !== null ? (
        <fieldset className="flex flex-col gap-2 border-0 p-0" data-testid="booking-profiles">
          <legend className="font-ui text-body-sm font-semibold text-ink">
            {tp('bookingForWhom', locale)}
          </legend>
          <div className="flex flex-col gap-2">
            {ownProfiles.map((profile) => (
              <button
                key={profile.patientId}
                type="button"
                aria-pressed={profileId === profile.patientId}
                data-testid={`booking-profile-${profile.patientId}`}
                onClick={() => {
                  setProfileId(profile.patientId);
                }}
                className="min-h-touch rounded-sm border border-line-strong bg-surface px-3 py-2 text-left text-body-md aria-pressed:border-brand-600 aria-pressed:bg-brand-100"
              >
                <span className="block font-semibold">{profile.fullName}</span>
                {profile.ageYears === null ? null : (
                  <span className="block text-body-sm text-ink-muted">
                    {`${tp('age', locale)}: ${formatNumber(profile.ageYears, numerals)}`}
                  </span>
                )}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="min-h-touch self-start text-body-sm text-brand-600 underline"
            data-testid="booking-for-someone-else"
            onClick={() => {
              setForSomebodyElse(true);
            }}
          >
            {tp('bookingForSomeoneElse', locale)}
          </button>
        </fieldset>
      ) : null}
      {ownProfiles !== null && forSomebodyElse ? (
        <button
          type="button"
          className="min-h-touch self-start text-body-sm text-brand-600 underline"
          data-testid="booking-for-own-profile"
          onClick={() => {
            setForSomebodyElse(false);
          }}
        >
          {tp('bookingForOwnProfile', locale)}
        </button>
      ) : null}

      {/* MOD-A07-GUEST: name, phone, age, sex. Nothing else is asked
          (FR-GST-02) — a guest supplies only what the task needs. */}
      <div className="flex flex-col gap-4">
        {asAccount ? null : (
          <>
            <Input
              label={tp('patientName', locale)}
              required
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />

            <Input
              label={tp('mobileNumber', locale)}
              kind="phone"
              required
              value={phone}
              placeholder="01XXXXXXXXX"
              helper={tp('mobileHelper', locale)}
              {...(phoneTouched && !phoneValid ? { error: tp('mobileInvalid', locale) } : {})}
              onBlur={() => {
                setPhoneTouched(true);
              }}
              onChange={(event) => {
                setPhone(event.target.value.trim());
              }}
            />

            <Input
              label={tp('age', locale)}
              kind="number"
              required
              value={age}
              onChange={(event) => {
                setAge(event.target.value.replace(/\D/g, ''));
              }}
            />

            <fieldset className="flex flex-col gap-2 border-0 p-0">
              <legend className="font-ui text-body-sm font-semibold text-ink">
                {tp('sex', locale)}
              </legend>
              <div className="flex gap-2">
                {(['female', 'male', 'other'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={sex === value}
                    onClick={() => {
                      setSex(value);
                    }}
                    className="min-h-touch flex-1 rounded-sm border border-line-strong bg-surface px-3 text-body-md aria-pressed:border-brand-600 aria-pressed:bg-brand-100"
                  >
                    {tp(value, locale)}
                  </button>
                ))}
              </div>
            </fieldset>
          </>
        )}

        <Input
          label={tp('reason', locale)}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
      </div>

      {/* FR-PAT-21: four lines, each labelled. A total on its own is a number
          somebody has to take on trust. */}
      <Card tone="brand">
        <dl className="flex flex-col gap-1 text-body-md">
          <Row
            label={tp('feeConsultation', locale)}
            value={formatTaka(fee.consultation, numerals)}
          />
          <Row
            label={tp('feeTotal', locale)}
            value={formatTaka(fee.consultation, numerals)}
            strong
          />
          {method === 'at_hospital' ? (
            <Row
              label={tp('feeDueAtHospital', locale)}
              value={formatTaka(fee.consultation, numerals)}
            />
          ) : null}
        </dl>
      </Card>

      <fieldset className="flex flex-col gap-2 border-0 p-0">
        <legend className="font-ui text-body-sm font-semibold text-ink">
          {tp('payWith', locale)}
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['bkash', 'payBkash'],
              ['nagad', 'payNagad'],
              ['card', 'payCard'],
              ['at_hospital', 'payAtHospital'],
            ] as const
          )
            .filter(
              ([value]) => value === 'at_hospital' || (onlinePayments && offered.includes(value)),
            )
            .map(([value, key]) => (
              <button
                key={value}
                type="button"
                aria-pressed={method === value}
                onClick={() => {
                  setMethod(value);
                }}
                className="min-h-touch rounded-sm border border-line-strong bg-surface px-3 text-body-md aria-pressed:border-brand-600 aria-pressed:bg-brand-100"
              >
                {tp(key, locale)}
              </button>
            ))}
        </div>
      </fieldset>

      {phoneCheck === null ? null : (
        <GuestCodeCard
          phone={phone}
          demoCode={phoneCheck.demoCode}
          invalid={codeWrong}
          disabled={busy}
          onComplete={(code) => {
            void proveCode(code);
          }}
        />
      )}

      {failure === null ? null : (
        <p role="alert" className="rounded-sm bg-alert-100 p-3 text-body-md text-alert-700">
          {failure}
        </p>
      )}

      <Button
        size="lg"
        fullWidth
        loading={busy}
        data-testid="confirm-booking"
        onClick={() => {
          void confirm();
        }}
        {...(ready
          ? {}
          : {
              disabled: true as const,
              disabledReason: online ? tp('yourDetails', locale) : tp('offline', locale),
            })}
      >
        {tp('confirmBooking', locale)}
      </Button>
    </section>
  );
}

/** `S-A-07d` — the success screen. */
function Success({
  booking,
  session,
}: {
  readonly booking: BookingResponse;
  readonly session: SessionCard;
}): ReactNode {
  const locale = useLocale();
  const numerals = numeralsFor(locale);
  return (
    <TabScreen title={tp('bookingDone', locale)} testId="booking-success">
      <section className="flex flex-col items-center gap-1 rounded-lg bg-brand-100 px-5 py-6 text-center">
        <p className="text-body-md font-semibold text-brand-700">{tp('yourSerial', locale)}</p>
        <p
          className="text-display-xl leading-[1.1] font-extrabold text-brand-600 tabular-nums"
          data-testid="serial"
        >
          {formatSerial(booking.serial, numerals)}
        </p>
        <p className="mt-1 text-body-md font-bold">
          {doctorName(locale, session.doctorNameBn, session.doctorNameEn)}
        </p>
        <p className="text-body-sm text-ink-secondary">
          {localName(locale, session.hospitalNameBn, session.hospitalNameEn)}
        </p>
        <p className="text-body-sm text-ink-secondary tabular-nums">
          {`${sessionDay(session.plannedStart, locale)} · ${sessionHours(
            session.plannedStart,
            session.plannedEnd,
            locale,
          )}`}
        </p>
      </section>

      <Panel className="p-4">
        <dl className="flex flex-col gap-1.5 text-body-md">
          <Row
            label={tp('feeConsultation', locale)}
            value={formatTaka(booking.fee.consultationPoisha, numerals)}
          />
          <Row
            label={tp('feePlatform', locale)}
            value={formatTaka(booking.fee.platformFeePoisha, numerals)}
          />
          <Row
            label={tp('feeTotal', locale)}
            value={formatTaka(booking.fee.totalPoisha, numerals)}
            strong
          />
          <Row
            label={tp('feeDueAtHospital', locale)}
            value={formatTaka(booking.fee.dueAtHospitalPoisha, numerals)}
          />
        </dl>
      </Panel>

      {/* FR-PAY-08 (plan H3): paid online at a provider that sends the patient
          away, the serial is held until the payment is confirmed. */}
      {booking.payment?.state === 'pending' && booking.payment.holdUntil !== null ? (
        <PaymentHold bookingId={booking.bookingId} payment={booking.payment} />
      ) : null}

      {/* FR-GST-05: the SMS carries the tracking link. Shown here too, because
          in a demo there is no SMS to open and the link is the point. */}
      <p className="text-body-sm text-ink-secondary">{tp('smsSent', locale)}</p>

      <div className="flex flex-col gap-2.5">
        {booking.trackingUrl === null ? null : (
          <a
            href={booking.trackingUrl}
            data-testid="tracking-link"
            className="flex min-h-[52px] items-center justify-center rounded-md bg-brand-600 px-5 text-body-lg font-bold text-white"
          >
            {tp('viewLiveSerial', locale)}
          </a>
        )}

        <a
          href="/"
          className="flex min-h-[52px] items-center justify-center rounded-md border border-line-strong bg-surface px-5 text-body-md font-semibold text-ink-secondary"
        >
          {tp('backHome', locale)}
        </a>
      </div>
    </TabScreen>
  );
}

function Row({
  label,
  value,
  strong = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly strong?: boolean;
}): ReactNode {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? 'font-semibold' : 'text-ink-secondary'}>{label}</dt>
      <dd className={`tabular-nums ${strong ? 'font-semibold' : ''}`}>{value}</dd>
    </div>
  );
}
