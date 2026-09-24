/**
 * `FR-GOV-03` — which past visits a doctor tagged dengue, diarrhoeal or fever
 * (migration 0025), so `S-B-13`'s early-warning panel has something to read.
 *
 * ## What the national screen should show, and why it is planted
 *
 * One clear signal and nothing else: **dengue in Dhaka district this week**,
 * against a quiet fortnight before it — the September pattern a Bangladeshi
 * health official would recognise, and the case `FR-GOV-03` exists for.
 * Every other district and category runs at a steady handful a week and reads
 * as normal.
 *
 * The counts are set per district and per week rather than drawn as a
 * probability per visit. The seeded history is scheduled by weekday, so how
 * many medicine and paediatric consultations fall in "this week" swings with
 * the day the demo is reset on — and a per-visit chance turned that swing
 * into a spike in whichever district happened to have a busy week. A signal
 * the demo shows by accident is exactly what a surveillance screen must not
 * teach anybody to expect.
 *
 * ## The records stay coherent
 *
 * A dengue tag on a visit whose note says "respiratory infection" would be a
 * record that contradicts itself the moment somebody opens it. So a planted
 * dengue or diarrhoeal case is re-labelled whole — the booking's complaint,
 * the visit's assessment and advice, and the tag — from the declared cases in
 * `data/reference.ts` (`DEMO_SIGNAL_CASES`, CLAUDE.md §8). Only visits whose
 * original complaint could present that way are eligible: a fever for
 * dengue, a fever or weakness for diarrhoeal disease. A fever tag changes
 * nothing but the tag, because a child's viral fever already reads as one.
 *
 * ## Why its own module, and why after seed_04
 *
 * It reads the visits `seed_04_history` wrote and changes a few dozen of
 * them. Inside seed_04 it would have had to decide before the visits existed;
 * as its own stream it moved none of the draws the rest of the history — the
 * offers, the check-ins, the counts STATUS quotes — was built from.
 */

import { time } from '@platform/domain';

import { DEMO_SIGNAL_CASES } from './data/reference.js';

import type { Rng } from './lib/random.js';
import type { SeedContext, SeedModule, SeedSummary } from './lib/runner.js';
import type { Client } from 'pg';

type Signal = 'dengue' | 'diarrhoeal' | 'fever';

/**
 * How many tagged visits each district gets, per week: this week, last week,
 * the week before.
 *
 * Dhaka's dengue is nine against one a week before it — a spike by
 * `shared/domain/gov/signals.ts`'s rule (at least five, at least double) with
 * room to spare. Nothing else reaches five in a week, so nothing else can.
 * Chattogram and Narayanganj are the declared demo districts with facilities
 * (`DEMO_DISTRICTS`); a district not listed gets no tags.
 */
const TARGETS: Readonly<Record<string, Readonly<Record<Signal, readonly number[]>>>> = {
  Dhaka: { dengue: [9, 1, 1], diarrhoeal: [2, 2, 2], fever: [2, 3, 2] },
  Chattogram: { dengue: [0, 1, 0], diarrhoeal: [1, 1, 2], fever: [1, 1, 1] },
  Narayanganj: { dengue: [1, 0, 0], diarrhoeal: [2, 1, 2], fever: [2, 2, 2] },
};

/** The complaints a case of each category could have walked in with. */
const ELIGIBLE: Readonly<Record<Signal, readonly string[]>> = {
  dengue: ['Fever and cough', "Child's fever"],
  diarrhoeal: ['Weakness', "Child's fever"],
  fever: ['Fever and cough', "Child's fever"],
};

/** Planted in this order, so the rarest pool is drawn from first. */
const ORDER: readonly Signal[] = ['dengue', 'diarrhoeal', 'fever'];

interface Candidate {
  readonly visitId: string;
  readonly bookingId: string;
  readonly district: string;
  readonly day: string;
  readonly complaintEn: string;
}

export const seed09Signals: SeedModule = {
  name: 'seed_09_signals',
  title: 'the symptom tags a district counts — dengue rising in Dhaka this week',
  requirements: ['FR-GOV-03', 'FR-DEM-07'],
  writes: ['visits', 'bookings'],

  async run({ client, now, rng, log }: SeedContext): Promise<SeedSummary> {
    const today = time.toDhakaDate(now);
    const candidates = await loadCandidates(client);
    const tagged = plant(candidates, today, rng.stream('signals'));

    for (const entry of tagged) await apply(client, entry);

    const count = (signal: Signal): number =>
      tagged.filter((entry) => entry.signal === signal).length;
    log(
      `      ${String(tagged.length)} visits tagged: ${String(count('dengue'))} dengue, ` +
        `${String(count('diarrhoeal'))} diarrhoeal, ${String(count('fever'))} fever`,
    );

    // Nothing inserted: every row touched here was written by seed_04, and the
    // totals the reset prints are rows written, so counting these again would
    // report 539 visits in a database holding 500.
    return {};
  },
};

/** Every signed past visit whose complaint makes it eligible for some tag. */
async function loadCandidates(client: Client): Promise<Candidate[]> {
  const complaints = [...new Set(Object.values(ELIGIBLE).flat())];

  const { rows } = await client.query<{
    visit_id: string;
    booking_id: string;
    district: string;
    day: string;
    complaint_en: string;
  }>(
    `SELECT v.id AS visit_id, v.booking_id, h.district,
            ((v.signed_at AT TIME ZONE 'Asia/Dhaka')::date)::text AS day,
            b.intake ->> 'complaintEn' AS complaint_en
       FROM visits v
       JOIN bookings b  ON b.id = v.booking_id
       JOIN hospitals h ON h.id = v.hospital_id
      WHERE v.signed_at IS NOT NULL
        AND v.deleted_at IS NULL
        AND b.intake ->> 'complaintEn' = ANY ($1)
      ORDER BY v.signed_at, v.id`,
    [complaints],
  );

  return rows.map((row) => ({
    visitId: row.visit_id,
    bookingId: row.booking_id,
    district: row.district,
    day: row.day,
    complaintEn: row.complaint_en,
  }));
}

/**
 * Chooses which visits carry which tag, district by district and week by week.
 *
 * A week asking for more than its eligible visits gets what there is — a
 * schedule that ran no paediatric chamber this week cannot have a paediatric
 * fever in it — and the shortfall is simply a smaller count, never a visit
 * moved from another week.
 */
export function plant(
  candidates: readonly Candidate[],
  today: string,
  rng: Rng,
): { readonly candidate: Candidate; readonly signal: Signal }[] {
  const chosen: { candidate: Candidate; signal: Signal }[] = [];

  for (const [district, targets] of Object.entries(TARGETS)) {
    for (let week = 0; week < 3; week += 1) {
      const pool = rng.shuffle(
        candidates.filter(
          (candidate) => candidate.district === district && weeksAgo(candidate.day, today) === week,
        ),
      );
      const used = new Set<string>();

      for (const signal of ORDER) {
        const wanted = targets[signal][week] ?? 0;
        const picks = pool
          .filter(
            (candidate) =>
              !used.has(candidate.visitId) && ELIGIBLE[signal].includes(candidate.complaintEn),
          )
          .slice(0, wanted);

        for (const candidate of picks) {
          used.add(candidate.visitId);
          chosen.push({ candidate, signal });
        }
      }
    }
  }

  return chosen;
}

/** Writes one tag, and for dengue and diarrhoea the record that goes with it. */
async function apply(
  client: Client,
  entry: { readonly candidate: Candidate; readonly signal: Signal },
): Promise<void> {
  const { candidate, signal } = entry;

  if (signal === 'fever') {
    await client.query(`UPDATE visits SET symptom_signal = 'fever' WHERE id = $1`, [
      candidate.visitId,
    ]);
    return;
  }

  const declared = DEMO_SIGNAL_CASES[signal];

  await client.query(
    `UPDATE bookings
        SET reason_text = $2,
            intake = intake || jsonb_build_object('complaintBn', $2::text, 'complaintEn', $3::text)
      WHERE id = $1`,
    [candidate.bookingId, declared.complaintBn, declared.complaintEn],
  );

  await client.query(
    `UPDATE visits
        SET diagnosis_text = $2, advice_text_bn = $3, symptom_signal = $4::symptom_signal
      WHERE id = $1`,
    [candidate.visitId, declared.diagnosisBn, declared.adviceBn, signal],
  );
}

/** 0 for the seven days ending today, 1 for the seven before, and so on. */
function weeksAgo(day: string, today: string): number {
  const days = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000,
  );
  return days < 0 ? -1 : Math.floor(days / 7);
}
