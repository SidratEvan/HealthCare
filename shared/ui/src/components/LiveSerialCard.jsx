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
export function liveSerialTone(facts) {
  if (facts.called) return 'called';
  if (facts.delayMinutes > 0) return 'delayed';
  if (!facts.doctorArrived) return 'not-arrived';
  if (facts.patientsAhead === 0) return 'next';
  return 'waiting';
}

/**
 * The card's surface, by state. The ordinary case sits on the brand tint, as
 * on the approved card; the others step away from it so the change reads at a
 * glance.
 */
const TONE_SURFACE = {
  waiting: 'bg-brand-100 border-brand-border',
  // The chamber has not opened. Quieter than waiting, because there is less to
  // report, not more.
  'not-arrived': 'bg-surface border-line',
  // §6.1: the surface shifts to the `--warn-*` family. Warn means exactly
  // three things in this product and a declared delay is one of them.
  delayed: 'bg-warn-100 border-warn-border',
  // "Brand surface intensifies" — the one moment before being called.
  next: 'bg-brand-100 border-brand-600 border-2',
  called: 'bg-brand-600 border-brand-700',
};

/** The number's colour, by state. */
const TONE_NUMBER = {
  waiting: 'text-brand-600',
  'not-arrived': 'text-ink',
  delayed: 'text-warn-700',
  next: 'text-brand-600',
  called: 'text-white',
};

/**
 * The live dot.
 *
 * It pulses while the figures are arriving and stops when they are not, which
 * makes "is this still live" answerable without reading anything — and makes
 * the stopped state visible rather than merely unstated. It wears the accent,
 * the logo's teal, in the patient app (§0.5). `motion-safe` gates the
 * animation: under `prefers-reduced-motion` the dot stays, the movement goes,
 * and the words beside it still say which it is (`A11Y-03`, §3.4).
 */
function LiveDot({ live, tone }) {
  return (
    <span
      aria-hidden="true"
      data-testid="live-dot"
      data-live={live ? 'true' : 'false'}
      className={cx(
        'inline-block size-2 shrink-0 rounded-pill',
        tone === 'called' ? 'bg-white' : live ? 'bg-accent-500' : 'bg-ink-muted',
        live && 'motion-safe:animate-[live-pulse_2s_ease-in-out_infinite]',
      )}
    />
  );
}

export function LiveSerialCard({
  serial,
  nowServing,
  ahead = null,
  seen,
  total,
  etaText,
  confidence,
  stale,
  labels,
  freshness,
  actions,
  ...facts
}) {
  const tone = liveSerialTone(facts);
  const called = tone === 'called';
  const percent = total === 0 ? 0 : Math.min(100, Math.round((seen / total) * 100));
  const soft = called ? 'text-white/85' : 'text-ink-secondary';
  const statBox = called ? 'bg-white/15' : 'bg-surface';

  return (
    <section
      data-testid="live-serial"
      data-tone={tone}
      data-stale={stale ? 'true' : 'false'}
      aria-live={called ? 'assertive' : 'polite'}
      className={cx(
        'flex flex-col items-center gap-3 rounded-lg border px-5 pt-5 pb-4 text-center',
        TONE_SURFACE[tone],
        called ? 'text-white' : 'text-ink',
      )}
    >
      <p className="flex items-center justify-center gap-2 font-ui text-body-sm font-semibold">
        <LiveDot live={!stale} tone={tone} />
        <span data-testid="live-serial-status">{labels.status}</span>
      </p>

      <div>
        <p
          className={cx(
            'font-ui text-body-md font-semibold',
            called ? 'text-white' : 'text-brand-700',
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
          className={cx(
            'font-ui text-display-xl font-extrabold tabular-nums motion-safe:animate-[serial-roll_var(--motion-count)_var(--ease-count)]',
            TONE_NUMBER[tone],
          )}
        >
          {serial}
        </p>
      </div>

      <dl
        className={cx(
          'grid w-full gap-2.5 font-ui',
          ahead === null ? 'grid-cols-1' : 'grid-cols-2',
        )}
      >
        <div className={cx('rounded-sm px-3 py-2', statBox)}>
          <dt className={cx('text-body-sm', soft)}>{labels.nowServing}</dt>
          <dd
            className={cx(
              'font-bold tabular-nums',
              nowServing === null ? 'pt-1 text-body-md leading-[1.45]' : 'text-title-md',
            )}
            data-testid="now-serving"
          >
            {nowServing ?? labels.nobodyCalledYet}
          </dd>
        </div>
        {ahead === null ? null : (
          <div className={cx('rounded-sm px-3 py-2', statBox)}>
            <dt className={cx('text-body-sm', soft)}>{ahead.label}</dt>
            <dd className="text-title-md font-bold tabular-nums" data-testid="live-serial-ahead">
              {ahead.value}
            </dd>
          </div>
        )}
      </dl>

      <div className="flex w-full flex-col items-center gap-0.5">
        {/*
          `FR-QUE-13`: a time plus a confidence band, never false precision —
          and when the rate is unknown, no time at all. An estimate the chamber
          cannot support is worse than admitting there isn't one.
        */}
        <p className="font-ui text-body-md">
          <span className={soft}>{labels.eta} </span>
          <span className="font-bold tabular-nums" data-testid="live-serial-eta">
            {confidence === 'unknown' || etaText === null ? labels.etaUnknown : etaText}
          </span>
        </p>

        {labels.countdown === null ? null : (
          <p
            className={cx(
              'font-ui text-body-sm tabular-nums',
              called ? 'text-white/85' : 'text-ink-muted',
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

      {/*
          Position within the session: a thin track at the card's foot.
          `role="progressbar"` rather than a styled div, because a person using
          a screen reader needs the same fact (`A11Y-01`, `A11Y-03`) and the
          label carries it in words.
        */}
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={labels.progress}
        data-testid="live-serial-progress"
        className={cx(
          'h-1 w-full overflow-hidden rounded-pill',
          called ? 'bg-white/30' : 'bg-surface',
        )}
      >
        <div
          style={{ width: `${String(percent)}%` }}
          className={cx(
            'h-full rounded-pill transition-[width] duration-[var(--motion-quick)] ease-[var(--ease-standard)]',
            called ? 'bg-white' : 'bg-brand-600',
          )}
        />
      </div>

      {actions}
    </section>
  );
}
