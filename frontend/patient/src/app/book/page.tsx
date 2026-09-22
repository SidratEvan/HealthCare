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

import {
  formatDateTime,
  formatMinutes,
  formatNumber,
  formatSerial,
  formatTaka,
  tp,
} from '@platform/i18n';
import { Button, Card, Chip, FreshnessLine, Input } from '@platform/ui';

import { BottomNav, BottomNavSpacer } from '@/components/BottomNav';
import { HospitalBeds } from '@/components/HospitalBeds';
import { BackIcon, ChevronIcon, HospitalIcon } from '@/components/icons';
import { useNow } from '@/hooks/useNow';
import { useOnline } from '@/hooks/useOnline';
import {
  availability,
  book,
  doctorSessions,
  doctorsAtHospital,
  hospitalsForSpecialty,
} from '@/lib/api';
import { rememberBooking } from '@/lib/bookings';

import type { BookingResponse } from '@/lib/api';
import type {
  Availability,
  HospitalCard,
  HospitalDoctorCard,
  Loadable,
  SessionCard,
} from '@/lib/types';
import type { ReactNode } from 'react';

const LOCALE = 'bn' as const;

/** Patient surfaces use Bengali numerals, always (`TYP-04`). */
const NUMERALS = 'bengali' as const;

/**
 * The flow, in the order `APP_FLOW.md` A3–A4 specifies.
 *
 * `S-A-07` is titled "Specialty results — **hospitals offering it**", and the
 * order is the point: a patient picks somewhere they can reach before they
 * pick who they see. Doctors-first asked somebody in Dhaka to choose between
 * forty cardiologists without knowing which was twenty minutes away.
 */
type Step = 'hospital' | 'doctor' | 'session' | 'confirm' | 'done';

export default function BookPage(): ReactNode {
  const [specialty, setSpecialty] = useState<string | null>(null);
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
    setSpecialty(new URLSearchParams(globalThis.location.search).get('specialty') ?? 'MED');
  }, []);

  useEffect(() => {
    if (specialty === null) return;
    setPlaces({ state: 'loading' });
    void hospitalsForSpecialty(specialty)
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
      void doctorsAtHospital(chosen.id, specialty ?? 'MED')
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

  if (step === 'done' && booking !== null && session !== null) {
    return <Success booking={booking} session={session} />;
  }

  return (
    <>
      <main className="mx-auto flex max-w-[480px] flex-col gap-5 p-5">
        <p className="rounded-sm bg-warn-100 px-3 py-2 text-caption text-warn-700">
          {tp('demoBanner', LOCALE)}
        </p>

        {/* GR-03: the fourth state. Announced, because a person who has just
          lost signal is not necessarily looking at the top of the screen. */}
        {online ? null : (
          <p
            role="status"
            data-testid="offline-notice"
            className="rounded-sm bg-alert-100 px-3 py-2 text-body-md text-alert-700"
          >
            {tp('offlineBooking', LOCALE)}
          </p>
        )}

        {step === 'hospital' ? <HospitalList hospitals={places} onChoose={chooseHospital} /> : null}

        {step === 'doctor' && place !== null ? (
          <DoctorList
            hospital={place}
            doctors={doctors}
            onChoose={chooseDoctor}
            onBack={() => {
              setStep('hospital');
            }}
          />
        ) : null}

        {step === 'session' && doctor !== null ? (
          <SessionList
            doctor={doctor}
            sessions={sessions}
            onChoose={chooseSession}
            onBack={() => {
              setStep('doctor');
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
                    hospitalNameBn: place?.nameBn ?? '',
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

        <BottomNavSpacer />
      </main>

      <BottomNav />
    </>
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
  const now = useNow();

  // GR-03: all four are designed states, not the absence of one — and the
  // failed one never borrows the empty one's words.
  if (hospitals.state === 'loading')
    return <p className="text-body-md text-ink-muted">{tp('loading', LOCALE)}</p>;
  if (hospitals.state === 'failed') return <LoadFailed />;
  if (hospitals.items.length === 0) {
    return <p className="text-body-md text-ink-muted">{tp('noHospitals', LOCALE)}</p>;
  }

  return (
    <section className="flex flex-col gap-3">
      <h1 className="font-reading text-title-lg">{tp('chooseHospitalFirst', LOCALE)}</h1>

      {/* DoD §5.8 and FR-PAT-14: "who is sitting now" is a live figure, so the
          list says how old it is rather than implying it is this instant. */}
      <Freshness asOf={hospitals.asOf} now={now} />

      <ul className="flex flex-col gap-3">
        {hospitals.items.map((hospital) => (
          <li key={hospital.id}>
            <button
              type="button"
              onClick={() => {
                onChoose(hospital);
              }}
              className="w-full text-left"
              data-testid={`hospital-${hospital.id}`}
            >
              <Card tone={hospital.sittingNow > 0 ? 'brand' : 'default'}>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 text-brand-600">
                    <HospitalIcon size={22} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="text-title-sm">{hospital.nameBn}</p>
                    <p className="text-body-sm text-ink-muted">
                      {hospital.thana === null
                        ? hospital.district
                        : `${hospital.thana}, ${hospital.district}`}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {hospital.doctorCount === null ? null : (
                        <Chip tone="neutral">
                          {tp('doctorsHere', LOCALE).replace(
                            '{count}',
                            formatNumber(hospital.doctorCount, NUMERALS),
                          )}
                        </Chip>
                      )}

                      {/* A11Y-03: the state is a sentence, not a colour. */}
                      <Chip tone={hospital.sittingNow > 0 ? 'positive' : 'neutral'}>
                        {hospital.sittingNow > 0
                          ? tp('sittingNowCount', LOCALE).replace(
                              '{count}',
                              formatNumber(hospital.sittingNow, NUMERALS),
                            )
                          : tp('nobodySittingNow', LOCALE)}
                      </Chip>
                    </div>

                    {/* FR-PAT-14: free beds and ICU, with their own age. */}
                    <HospitalBeds beds={hospital.beds} now={now} />
                  </div>

                  <span className="mt-1 text-ink-muted">
                    <ChevronIcon size={18} />
                  </span>
                </div>
              </Card>
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
  onBack,
}: {
  readonly hospital: HospitalCard;
  readonly doctors: Loadable<HospitalDoctorCard>;
  readonly onChoose: (doctor: HospitalDoctorCard) => void;
  readonly onBack: () => void;
}): ReactNode {
  const now = useNow();

  return (
    <section className="flex flex-col gap-3">
      <BackLink onBack={onBack} />

      <div>
        <h1 className="font-reading text-title-lg">{hospital.nameBn}</h1>
        <p className="text-body-sm text-ink-muted">{tp('chooseDoctor', LOCALE)}</p>
      </div>

      {doctors.state === 'loading' ? (
        <p className="text-body-md text-ink-muted">{tp('loading', LOCALE)}</p>
      ) : doctors.state === 'failed' ? (
        <LoadFailed />
      ) : doctors.items.length === 0 ? (
        <p className="text-body-md text-ink-muted">{tp('noDoctorsHere', LOCALE)}</p>
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
                  className="w-full text-left"
                  data-testid={`doctor-${doctor.id}`}
                >
                  <Card tone={doctor.sittingNow ? 'brand' : 'default'}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-title-sm">{doctor.nameBn}</p>
                        {doctor.degrees === null ? null : (
                          <p className="text-body-sm text-ink-muted">{doctor.degrees}</p>
                        )}

                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {/* FR-PAT-13: in a chamber now, or the next time they
                            sit — never a bare "available". */}
                          <Chip tone={doctor.sittingNow ? 'positive' : 'neutral'}>
                            {doctor.sittingNow
                              ? tp('inChamberNow', LOCALE)
                              : doctor.nextSessionAt === null
                                ? tp('notSittingSoon', LOCALE)
                                : tp('nextSitting', LOCALE).replace(
                                    '{time}',
                                    formatDateTime(doctor.nextSessionAt, NUMERALS),
                                  )}
                          </Chip>

                          {doctor.openSerials === null ? null : (
                            <Chip tone={doctor.openSerials > 0 ? 'neutral' : 'caution'}>
                              {doctor.openSerials > 0
                                ? tp('serialsLeft', LOCALE).replace(
                                    '{count}',
                                    formatNumber(doctor.openSerials, NUMERALS),
                                  )
                                : tp('sessionFull', LOCALE)}
                            </Chip>
                          )}
                        </div>
                      </div>

                      <p className="shrink-0 text-body-md font-semibold tabular-nums">
                        {formatTaka(doctor.feePoisha, NUMERALS)}
                      </p>
                    </div>
                  </Card>
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
 * `GR-03`'s error state, for a list that could not be fetched.
 *
 * Reloads rather than re-running one fetch: this is a screen a person reached
 * by tapping a specialty, so the whole screen is the retry, and a button that
 * silently retried one request would leave the rest of the page in whatever
 * state it was already in.
 */
function LoadFailed(): ReactNode {
  return (
    <div
      role="status"
      data-testid="load-failed"
      className="flex flex-col gap-3 rounded-md border border-line bg-surface p-5"
    >
      <p className="text-body-md text-ink-secondary">{tp('listFailed', LOCALE)}</p>
      <Button
        onClick={() => {
          globalThis.location.reload();
        }}
      >
        {tp('tryAgain', LOCALE)}
      </Button>
    </div>
  );
}

/**
 * The one freshness line both discovery lists use.
 *
 * `FreshnessLine` takes its labels and its number formatting from the caller so
 * that `shared/ui` never imports a locale; every patient surface passes the
 * same four Bangla strings and Bengali numerals, so they are passed once here
 * rather than twice at each call site.
 */
function Freshness({ asOf, now }: { readonly asOf: string; readonly now: Date }): ReactNode {
  return (
    <FreshnessLine
      asOf={new Date(asOf)}
      now={now}
      labels={{
        justNow: tp('updatedJustNow', LOCALE),
        ago: tp('updatedAgo', LOCALE),
        never: tp('updatedNever', LOCALE),
        stale: tp('staleWarning', LOCALE),
      }}
      formatMinutes={(minutes) => formatMinutes(minutes, NUMERALS)}
    />
  );
}

/** `BTN-A07-BACK` — one step back, never a dead end. */
function BackLink({ onBack }: { readonly onBack: () => void }): ReactNode {
  return (
    <button
      type="button"
      onClick={onBack}
      data-testid="step-back"
      className="flex min-h-touch items-center gap-1 self-start text-body-md text-ink-secondary"
    >
      <BackIcon size={18} />
      {tp('back', LOCALE)}
    </button>
  );
}

/** `S-A-07b` — the session picker. */
function SessionList({
  doctor,
  sessions,
  onChoose,
  onBack,
}: {
  readonly doctor: HospitalDoctorCard;
  readonly sessions: SessionCard[] | null;
  readonly onChoose: (session: SessionCard) => void;
  readonly onBack: () => void;
}): ReactNode {
  return (
    <section className="flex flex-col gap-3">
      <BackLink onBack={onBack} />
      <h1 className="font-reading text-title-lg">{tp('chooseTime', LOCALE)}</h1>
      <p className="text-body-sm text-ink-muted">{doctor.nameBn}</p>

      {sessions === null ? (
        <p className="text-body-md text-ink-muted">{tp('loading', LOCALE)}</p>
      ) : sessions.length === 0 ? (
        <p className="text-body-md text-ink-muted">{tp('noSessions', LOCALE)}</p>
      ) : (
        <SessionCards sessions={sessions} onChoose={onChoose} />
      )}
    </section>
  );
}

function SessionCards({
  sessions,
  onChoose,
}: {
  readonly sessions: SessionCard[];
  readonly onChoose: (session: SessionCard) => void;
}): ReactNode {
  return (
    <>
      <ul className="flex flex-col gap-3">
        {sessions.map((session) => {
          const remaining =
            session.capacity === null ? null : Math.max(0, session.capacity - session.taken);
          const full = remaining === 0;

          return (
            <li key={session.id}>
              <button
                type="button"
                disabled={full}
                onClick={() => {
                  onChoose(session);
                }}
                className="w-full text-left disabled:opacity-40"
                data-testid={`session-${session.id}`}
              >
                <Card>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-title-sm tabular-nums">
                        {formatDateTime(session.plannedStart, NUMERALS)}
                      </p>
                      <p className="text-body-sm text-ink-muted">{session.hospitalNameBn}</p>
                    </div>

                    <div className="text-right">
                      {full ? (
                        <Chip tone="caution">{tp('sessionFull', LOCALE)}</Chip>
                      ) : (
                        <p className="text-body-sm tabular-nums text-ink-secondary">
                          {remaining === null
                            ? ''
                            : `${formatMinutes(remaining, NUMERALS)} ${tp('seatsLeft', LOCALE)}`}
                        </p>
                      )}
                    </div>
                  </div>
                </Card>
              </button>
            </li>
          );
        })}
      </ul>
    </>
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
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<'male' | 'female' | 'other'>('female');
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<'bkash' | 'nagad' | 'card' | 'at_hospital'>('bkash');
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

  const phoneValid = /^\+8801[3-9]\d{8}$/.test(phone);
  // Offline is part of readiness, not a separate guard: the button then
  // carries "no connection" as its reason rather than silently doing nothing
  // when tapped (`FRONTEND.md` §5.1).
  const ready = online && name.trim().length >= 2 && phoneValid && Number(age) >= 0 && age !== '';

  const fee = useMemo(() => {
    // Shown from the session's own fee before the server answers, so a person
    // sees what they are agreeing to *before* agreeing to it (FR-PAT-21). The
    // platform fee is added by the server, which owns the rate.
    return { consultation: session.feePoisha };
  }, [session.feePoisha]);

  const confirm = useCallback(async () => {
    setBusy(true);
    onFailure(null);

    try {
      const result = await book({
        sessionId: session.id,
        method,
        guest: { name: name.trim(), phone, ageYears: Number(age), sex },
        reason,
        idempotencyKey,
      });
      onBooked(result);
    } catch (error) {
      // Stated in Bangla, by cause. "Something went wrong" tells a person
      // nothing they can act on (BACKEND.md §9 maps codes to copy).
      const code = (error as { code?: string }).code;
      onFailure(
        code === 'BOOKING_DUPLICATE'
          ? tp('alreadyBooked', LOCALE)
          : code === 'SESSION_FULL'
            ? tp('chamberFull', LOCALE)
            : tp('bookingFailed', LOCALE),
      );
    } finally {
      setBusy(false);
    }
  }, [session.id, method, name, phone, age, sex, reason, idempotencyKey, onBooked, onFailure]);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="font-reading text-title-lg">{tp('confirmTitle', LOCALE)}</h1>

      <Card>
        <p className="text-title-sm tabular-nums">
          {formatDateTime(session.plannedStart, NUMERALS)}
        </p>
        <p className="text-body-sm text-ink-muted">{session.doctorNameBn}</p>
        <p className="text-body-sm text-ink-muted">{session.hospitalNameBn}</p>

        {/* FR-PAT-13: unknown is a real answer, and not the same as zero. */}
        <p className="mt-2 text-body-sm text-ink-secondary">
          {tp('expectedWait', LOCALE)}:{' '}
          {slots?.expectedWaitMinutes == null
            ? tp('waitUnknown', LOCALE)
            : `${formatMinutes(slots.expectedWaitMinutes, NUMERALS)} ${tp('minutesShort', LOCALE)}`}
        </p>

        {/* DoD §5.8: the expected wait is a live figure, so it never appears
            without saying how old it is. */}
        <FreshnessLine
          asOf={slots === null ? null : new Date(slots.asOf)}
          now={now}
          labels={{
            justNow: tp('updatedJustNow', LOCALE),
            ago: tp('updatedAgo', LOCALE),
            never: tp('updatedNever', LOCALE),
            stale: tp('staleWarning', LOCALE),
          }}
          formatMinutes={(minutes) => formatMinutes(minutes, NUMERALS)}
        />
      </Card>

      {/* MOD-A07-GUEST: name, phone, age, sex. Nothing else is asked
          (FR-GST-02) — a guest supplies only what the task needs. */}
      <div className="flex flex-col gap-4">
        <Input
          label={tp('patientName', LOCALE)}
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />

        <Input
          label={tp('mobileNumber', LOCALE)}
          kind="phone"
          required
          value={phone}
          placeholder="+8801XXXXXXXXX"
          helper={tp('mobileHelper', LOCALE)}
          {...(phoneTouched && !phoneValid ? { error: tp('mobileInvalid', LOCALE) } : {})}
          onBlur={() => {
            setPhoneTouched(true);
          }}
          onChange={(event) => {
            setPhone(event.target.value.trim());
          }}
        />

        <Input
          label={tp('age', LOCALE)}
          kind="number"
          required
          value={age}
          onChange={(event) => {
            setAge(event.target.value.replace(/\D/g, ''));
          }}
        />

        <fieldset className="flex flex-col gap-2 border-0 p-0">
          <legend className="font-ui text-body-sm font-semibold text-ink">
            {tp('sex', LOCALE)}
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
                {tp(value, LOCALE)}
              </button>
            ))}
          </div>
        </fieldset>

        <Input
          label={tp('reason', LOCALE)}
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
            label={tp('feeConsultation', LOCALE)}
            value={formatTaka(fee.consultation, NUMERALS)}
          />
          <Row
            label={tp('feeTotal', LOCALE)}
            value={formatTaka(fee.consultation, NUMERALS)}
            strong
          />
          {method === 'at_hospital' ? (
            <Row
              label={tp('feeDueAtHospital', LOCALE)}
              value={formatTaka(fee.consultation, NUMERALS)}
            />
          ) : null}
        </dl>
      </Card>

      <fieldset className="flex flex-col gap-2 border-0 p-0">
        <legend className="font-ui text-body-sm font-semibold text-ink">
          {tp('payWith', LOCALE)}
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['bkash', 'payBkash'],
              ['nagad', 'payNagad'],
              ['card', 'payCard'],
              ['at_hospital', 'payAtHospital'],
            ] as const
          ).map(([value, key]) => (
            <button
              key={value}
              type="button"
              aria-pressed={method === value}
              onClick={() => {
                setMethod(value);
              }}
              className="min-h-touch rounded-sm border border-line-strong bg-surface px-3 text-body-md aria-pressed:border-brand-600 aria-pressed:bg-brand-100"
            >
              {tp(key, LOCALE)}
            </button>
          ))}
        </div>
      </fieldset>

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
              disabledReason: online ? tp('yourDetails', LOCALE) : tp('offline', LOCALE),
            })}
      >
        {tp('confirmBooking', LOCALE)}
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
  return (
    <>
      <main className="mx-auto flex max-w-[480px] flex-col gap-5 p-5" data-testid="booking-success">
        <h1 className="font-reading text-title-lg">{tp('bookingDone', LOCALE)}</h1>

        <Card tone="brand" hero>
          <p className="text-body-sm text-ink-secondary">{tp('yourSerial', LOCALE)}</p>
          <p className="font-reading text-display-xl tabular-nums" data-testid="serial">
            {formatSerial(booking.serial, NUMERALS)}
          </p>
          <p className="mt-2 text-body-md">{session.doctorNameBn}</p>
          <p className="text-body-sm text-ink-muted">{session.hospitalNameBn}</p>
          <p className="text-body-sm text-ink-muted tabular-nums">
            {formatDateTime(session.plannedStart, NUMERALS)}
          </p>
        </Card>

        <Card>
          <dl className="flex flex-col gap-1 text-body-md">
            <Row
              label={tp('feeConsultation', LOCALE)}
              value={formatTaka(booking.fee.consultationPoisha, NUMERALS)}
            />
            <Row
              label={tp('feePlatform', LOCALE)}
              value={formatTaka(booking.fee.platformFeePoisha, NUMERALS)}
            />
            <Row
              label={tp('feeTotal', LOCALE)}
              value={formatTaka(booking.fee.totalPoisha, NUMERALS)}
              strong
            />
            <Row
              label={tp('feeDueAtHospital', LOCALE)}
              value={formatTaka(booking.fee.dueAtHospitalPoisha, NUMERALS)}
            />
          </dl>
        </Card>

        {/* FR-GST-05: the SMS carries the tracking link. Shown here too, because
          in a demo there is no SMS to open and the link is the point. */}
        <p className="text-body-sm text-ink-secondary">{tp('smsSent', LOCALE)}</p>

        {booking.trackingUrl === null ? null : (
          <a
            href={booking.trackingUrl}
            data-testid="tracking-link"
            className="flex min-h-touch items-center justify-center rounded-md bg-brand-600 px-5 text-body-lg font-semibold text-white"
          >
            {tp('viewLiveSerial', LOCALE)}
          </a>
        )}

        <a
          href="/"
          className="flex min-h-touch items-center justify-center rounded-md border border-line-strong bg-surface px-5 text-body-md"
        >
          {tp('backHome', LOCALE)}
        </a>

        <BottomNavSpacer />
      </main>

      <BottomNav />
    </>
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
