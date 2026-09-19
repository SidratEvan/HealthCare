/**
 * `<LiveSerialCard>` — `S-A-08` (FRONTEND.md §6.1).
 *
 * "Anatomy: status line with a pulsing live dot → your number in `display-xl`
 * → now-serving → progress track → ETA with confidence band → freshness line.
 * On `EVT-PATIENT_CALLED`: number rolls (`motion-count`), progress advances,
 * light haptic. States: waiting, doctor-not-arrived, delayed (surface shifts to
 * `--warn-*` family), you're-next (brand surface intensifies), called
 * (full-screen takeover), stale (amber freshness, "সংযোগ নেই" line)."
 *
 * This is the product. Everything else in the patient app exists to get
 * somebody to this card, and the promise it makes — the number on it is true
 * right now — is the whole pitch.
 *
 * ## It holds no copy and converts no numerals
 *
 * Every string arrives already localised and every number already formatted,
 * the way `<FreshnessLine>` takes its labels. `I18N-03` forbids a literal in a
 * component and `I18N-04` forbids hand-converting digits in one; both are
 * easier to keep when there is nowhere in the file for either to live. The
 * serial is a `string` for that reason, not a `number`.
 *
 * ## Why the visual state is derived here and exported
 *
 * `liveSerialTone` is a pure function over the same facts the card renders, and
 * it is exported so a test can assert the rule rather than infer it from a
 * class name. Deriving it inside the screen instead would put a second copy of
 * "when is a patient next" in the app — and the one that drifts is always the
 * one nobody is looking at.
 */

import { cx } from './cx.js';

import type { ReactNode } from 'react';

/**
 * How certain the ETA is (`FR-QUE-13`), as the domain reports it.
 *
 * `unknown` is not a missing value: it is the honest answer while the doctor
 * has not arrived or the chamber is paused, and it makes the card show a wait
 * without a time rather than a time nobody should plan around (`PRD.md` §3.2).
 */
export type EtaConfidence = 'measured' | 'estimated' | 'unknown';

/** The surface a card wears. One at a time, in the order `liveSerialTone` picks. */
export type LiveSerialTone = 'waiting' | 'not-arrived' | 'delayed' | 'next' | 'called';

export interface LiveSerialFacts {
  /** True once `DOCTOR_ARRIVED` has been folded. */
  readonly doctorArrived: boolean;
  /** Cumulative declared delay, in minutes (`FR-REC-03`). */
  readonly delayMinutes: number;
  /** How many patients are seen before this one, the chamber's occupant included. */
  readonly patientsAhead: number;
  /** True while this patient is the one in the chamber (`EVT-PATIENT_CALLED`). */
  readonly called: boolean;
}

/**
 * Which state the card is in.
 *
 * Ordered by what a person standing in a corridor most needs to know:
 *
 *   `called`      go to the room — nothing outranks being sent for
 *   `delayed`     a declared delay carries a number, so it beats "not started"
 *   `not-arrived` the chamber has not opened, so no position means much yet
 *   `next`        you are the next one in
 *   `waiting`     the ordinary case
 */
export function liveSerialTone(facts: LiveSerialFacts): LiveSerialTone {
  if (facts.called) return 'called';
  if (facts.delayMinutes > 0) return 'delayed';
  if (!facts.doctorArrived) return 'not-arrived';
  if (facts.patientsAhead === 0) return 'next';
  return 'waiting';
}

export interface LiveSerialLabels {
  /** The line above the number: "ডাক্তার এসেছেন", "৩০ মিনিট দেরি", … */
  readonly status: string;
  readonly yourSerial: string;
  readonly nowServing: string;
  readonly nobodyCalledYet: string;
  /** Read by a screen reader for the progress track (`A11Y-03`). */
  readonly progress: string;
  readonly eta: string;
  /** Shown instead of a time when the estimate would be a guess (`FR-QUE-13`). */
  readonly etaUnknown: string;
  /** "আর বাকি ~৪০ মিনিট", already assembled by the caller. */
  readonly countdown: string | null;
  /** "সংযোগ নেই" — shown when the figures have stopped arriving (`FR-PAT-36`). */
  readonly disconnected: string;
}

export interface LiveSerialCardProps extends LiveSerialFacts {
  /** This patient's serial, already in the surface's numerals (`TYP-04`). */
  readonly serial: string;
  /** The number in the chamber now, or null if nobody has been called. */
  readonly nowServing: string | null;
  /** Seen so far and the session's total, for the progress track. */
  readonly seen: number;
  readonly total: number;
  /** "আনুমানিক ৬:০৫ · ±১৫ মিনিট", assembled by the caller. */
  readonly etaText: string | null;
  readonly confidence: EtaConfidence;
  /**
   * True when the figures have stopped arriving.
   *
   * Drives the "সংযোগ নেই" line. It does not blank the card: a number that has
   * stopped updating, labelled as such, is more use to somebody in a corridor
   * than an empty screen (`FR-PAT-36`, `FR-OFF-02`).
   */
  readonly stale: boolean;
  readonly labels: LiveSerialLabels;
  /** The caller's `<FreshnessLine>` (`FR-PAT-35`, CLAUDE.md §5.8). */
  readonly freshness: ReactNode;
  /** The late / reschedule / cancel controls, rendered beneath. */
  readonly actions?: ReactNode;
}

const TONE_SURFACE: Record<LiveSerialTone, string> = {
  waiting: 'bg-surface border-line',
  // The chamber has not opened. Quieter than waiting, because there is less to
  // report, not more.
  'not-arrived': 'bg-sunken border-line',
  // §6.1: the surface shifts to the `--warn-*` family. Warn means exactly
  // three things in this product and a declared delay is one of them.
  delayed: 'bg-warn-100 border-warn-border',
  // "Brand surface intensifies" — the one moment before being called.
  next: 'bg-brand-100 border-brand-600',
  called: 'bg-brand-600 border-brand-700',
};

const TONE_INK: Record<LiveSerialTone, string> = {
  waiting: 'text-ink',
  'not-arrived': 'text-ink',
  delayed: 'text-warn-700',
  next: 'text-brand-900',
  called: 'text-white',
};

/**
 * The live dot.
 *
 * It pulses while the figures are arriving and stops when they are not, which
 * makes "is this still live" answerable without reading anything — and makes
 * the stopped state visible rather than merely unstated. `motion-safe` gates
 * the animation: under `prefers-reduced-motion` the dot stays, the movement
 * goes, and the words beside it still say which it is (`A11Y-03`, §3.4).
 */
function LiveDot({ live, tone }: { readonly live: boolean; readonly tone: LiveSerialTone }) {
  return (
    <span
      aria-hidden="true"
      data-testid="live-dot"
      data-live={live ? 'true' : 'false'}
      className={cx(
        'inline-block size-2 rounded-pill',
        tone === 'called' ? 'bg-white' : live ? 'bg-brand-600' : 'bg-ink-muted',
        live && 'motion-safe:animate-[live-pulse_2s_ease-in-out_infinite]',
      )}
    />
  );
}

export function LiveSerialCard({
  serial,
  nowServing,
  seen,
  total,
  etaText,
  confidence,
  stale,
  labels,
  freshness,
  actions,
  ...facts
}: LiveSerialCardProps): ReactNode {
  const tone = liveSerialTone(facts);
  const percent = total === 0 ? 0 : Math.min(100, Math.round((seen / total) * 100));

  return (
    <section
      data-testid="live-serial"
      data-tone={tone}
      data-stale={stale ? 'true' : 'false'}
      // A11Y-04: the serial changes on its own. Being called is announced
      // assertively because it is an instruction to move; every other change
      // is announced politely because it is information.
      aria-live={tone === 'called' ? 'assertive' : 'polite'}
      className={cx(
        'flex flex-col gap-4 rounded-lg border p-6',
        TONE_SURFACE[tone],
        TONE_INK[tone],
      )}
    >
      <p className="flex items-center gap-2 font-ui text-body-md">
        <LiveDot live={!stale} tone={tone} />
        <span data-testid="live-serial-status">{labels.status}</span>
      </p>

      <div>
        <p
          className={cx(
            'font-ui text-body-sm',
            tone === 'called' ? 'text-white/80' : 'text-ink-secondary',
          )}
        >
          {labels.yourSerial}
        </p>
        {/*
          The one signature movement in the product (§3.4, `motion-count`). It
          is keyed on the serial's own text so React remounts the node when the
          number changes and the animation runs again — without the key it
          would play once, on mount, and never at the moment that matters.
        */}
        <p
          key={serial}
          data-testid="live-serial-number"
          className="font-reading text-display-xl tabular-nums motion-safe:animate-[serial-roll_var(--motion-count)_var(--ease-count)]"
        >
          {serial}
        </p>
      </div>

      <dl className="flex items-baseline justify-between gap-3 font-ui text-body-md">
        <dt className={tone === 'called' ? 'text-white/80' : 'text-ink-secondary'}>
          {labels.nowServing}
        </dt>
        <dd className="text-title-md font-semibold tabular-nums" data-testid="now-serving">
          {nowServing ?? labels.nobodyCalledYet}
        </dd>
      </dl>

      {/*
        Position within the session. `role="progressbar"` rather than a styled
        div, because a person using a screen reader needs the same fact
        (`A11Y-01`, `A11Y-03`) and the label carries it in words.
      */}
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={labels.progress}
        data-testid="live-serial-progress"
        className={cx(
          'h-1.5 w-full overflow-hidden rounded-pill',
          tone === 'called' ? 'bg-white/30' : 'bg-sunken',
        )}
      >
        <div
          style={{ width: `${String(percent)}%` }}
          className={cx(
            'h-full rounded-pill transition-[width] duration-[var(--motion-quick)] ease-[var(--ease-standard)]',
            tone === 'called' ? 'bg-white' : 'bg-brand-600',
          )}
        />
      </div>

      <div className="flex flex-col gap-1">
        <dl className="flex items-baseline justify-between gap-3 font-ui text-body-md">
          <dt className={tone === 'called' ? 'text-white/80' : 'text-ink-secondary'}>
            {labels.eta}
          </dt>
          {/*
            `FR-QUE-13`: a time plus a confidence band, never false precision —
            and when the rate is unknown, no time at all. An estimate the chamber
            cannot support is worse than admitting there isn't one.
          */}
          <dd className="tabular-nums" data-testid="live-serial-eta">
            {confidence === 'unknown' || etaText === null ? labels.etaUnknown : etaText}
          </dd>
        </dl>

        {labels.countdown === null ? null : (
          <p
            className={cx(
              'font-ui text-body-sm tabular-nums',
              tone === 'called' ? 'text-white/80' : 'text-ink-muted',
            )}
            data-testid="live-serial-countdown"
          >
            {labels.countdown}
          </p>
        )}

        {/*
          §6.1's stale state. The freshness line already says how old the
          figures are; this says the connection itself is gone, which is a
          different fact and the one that explains why (`FR-PAT-36`).
        */}
        {stale ? (
          <p className="font-ui text-caption text-warn-600" data-testid="live-serial-disconnected">
            {labels.disconnected}
          </p>
        ) : null}

        {freshness}
      </div>

      {actions}
    </section>
  );
}
