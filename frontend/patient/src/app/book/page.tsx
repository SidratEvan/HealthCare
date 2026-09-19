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

import { formatDateTime, formatMinutes, formatSerial, formatTaka, tp } from '@platform/i18n';
import { Button, Card, Chip, FreshnessLine, Input } from '@platform/ui';

import { useOnline } from '@/hooks/useOnline';
import { availability, book, doctorSessions, specialtyDoctors } from '@/lib/api';

import type { BookingResponse } from '@/lib/api';
import type { Availability, DoctorCard, SessionCard } from '@/lib/types';
import type { ReactNode } from 'react';

const LOCALE = 'bn' as const;

/** Patient surfaces use Bengali numerals, always (`TYP-04`). */
const NUMERALS = 'bengali' as const;

type Step = 'doctor' | 'session' | 'confirm' | 'done';

export default function BookPage(): ReactNode {
  const [specialty, setSpecialty] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('doctor');
  const online = useOnline();

  const [doctors, setDoctors] = useState<DoctorCard[] | null>(null);
  const [doctor, setDoctor] = useState<DoctorCard | null>(null);
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
    void specialtyDoctors(specialty)
      .then(setDoctors)
      .catch(() => {
        setDoctors([]);
      });
  }, [specialty]);

  const chooseDoctor = useCallback((chosen: DoctorCard) => {
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

      {step === 'doctor' ? <DoctorList doctors={doctors} onChoose={chooseDoctor} /> : null}

      {step === 'session' && doctor !== null ? (
        <SessionList doctor={doctor} sessions={sessions} onChoose={chooseSession} />
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
          }}
        />
      ) : null}
    </main>
  );
}

/** `S-A-07` — doctors offering this specialty (`FR-PAT-11`, `FR-PAT-12`). */
function DoctorList({
  doctors,
  onChoose,
}: {
  readonly doctors: DoctorCard[] | null;
  readonly onChoose: (doctor: DoctorCard) => void;
}): ReactNode {
  // GR-03: loading and empty are designed states, not the absence of one.
  if (doctors === null)
    return <p className="text-body-md text-ink-muted">{tp('loading', LOCALE)}</p>;
  if (doctors.length === 0) {
    return <p className="text-body-md text-ink-muted">{tp('noResults', LOCALE)}</p>;
  }

  return (
    <section className="flex flex-col gap-3">
      <h1 className="font-reading text-title-lg">{tp('findDoctor', LOCALE)}</h1>

      <ul className="flex flex-col gap-3">
        {doctors.map((doctor) => {
          const chamber = doctor.chambers[0];
          return (
            <li key={doctor.id}>
              <button
                type="button"
                onClick={() => {
                  onChoose(doctor);
                }}
                className="w-full text-left"
                data-testid={`doctor-${doctor.id}`}
              >
                <Card>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-title-sm">{doctor.nameBn}</p>
                      {doctor.degrees === null ? null : (
                        <p className="text-body-sm text-ink-muted">{doctor.degrees}</p>
                      )}
                      {chamber === undefined ? null : (
                        <p className="mt-1 text-body-sm text-ink-secondary">
                          {chamber.hospitalNameBn}
                        </p>
                      )}
                    </div>

                    <div className="shrink-0 text-right">
                      {/* FR-PAT-12: the verified badge is the reason a patient
                          can trust this list at all (FR-SUP-02). */}
                      {doctor.bmdcVerifiedAt === null ? null : (
                        <Chip tone="positive">{tp('verified', LOCALE)}</Chip>
                      )}
                      {chamber === undefined ? null : (
                        <p className="mt-2 text-body-md font-semibold tabular-nums">
                          {formatTaka(chamber.feePoisha, NUMERALS)}
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
    </section>
  );
}

/** `S-A-07b` — the session picker. */
function SessionList({
  doctor,
  sessions,
  onChoose,
}: {
  readonly doctor: DoctorCard;
  readonly sessions: SessionCard[] | null;
  readonly onChoose: (session: SessionCard) => void;
}): ReactNode {
  if (sessions === null)
    return <p className="text-body-md text-ink-muted">{tp('loading', LOCALE)}</p>;
  if (sessions.length === 0) {
    return <p className="text-body-md text-ink-muted">{tp('noSessions', LOCALE)}</p>;
  }

  return (
    <section className="flex flex-col gap-3">
      <h1 className="font-reading text-title-lg">{tp('chooseTime', LOCALE)}</h1>
      <p className="text-body-sm text-ink-muted">{doctor.nameBn}</p>

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
                      <p className="text-title-sm tabular-nums">{formatDateTime(session.plannedStart, NUMERALS)}</p>
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
    </section>
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
        <p className="text-title-sm tabular-nums">{formatDateTime(session.plannedStart, NUMERALS)}</p>
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
    <main className="mx-auto flex max-w-[480px] flex-col gap-5 p-5" data-testid="booking-success">
      <h1 className="font-reading text-title-lg">{tp('bookingDone', LOCALE)}</h1>

      <Card tone="brand" hero>
        <p className="text-body-sm text-ink-secondary">{tp('yourSerial', LOCALE)}</p>
        <p className="font-reading text-display-xl tabular-nums" data-testid="serial">
          {formatSerial(booking.serial, NUMERALS)}
        </p>
        <p className="mt-2 text-body-md">{session.doctorNameBn}</p>
        <p className="text-body-sm text-ink-muted">{session.hospitalNameBn}</p>
        <p className="text-body-sm text-ink-muted tabular-nums">{formatDateTime(session.plannedStart, NUMERALS)}</p>
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
    </main>
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

