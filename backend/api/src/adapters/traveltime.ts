/**
 * Travel time to a hospital (BACKEND.md §3 `maps/traveltime.ts`, §10
 * `TRAVEL_TIME_MODE`; `FR-PAT-43`, `FR-PAT-44`, `FR-PAT-46`).
 *
 * ## `TRAVEL_TIME_MODE=static` is the implementation, not a placeholder
 *
 * CLAUDE.md §1.1 names it with the SMS log provider and the mock payment:
 * "`TRAVEL_TIME_MODE=static` uses the built-in matrix", and that is what the
 * demo runs on. A routing API needs a key, a contract and a billing account,
 * and arrives with a signed counterparty — at which point it is a new class
 * behind this interface and one environment variable.
 *
 * ## What "static" computes, and why it says it is an estimate
 *
 * Straight-line distance (PostGIS, `fn_nearby_hospitals`) stretched by a road
 * factor, divided by a speed that depends on the hour in Dhaka. Dhaka's roads
 * are not straight and its traffic is not constant, so the answer is an
 * estimate and the patient app labels it আনুমানিক. It is still worth ranking
 * on: the *order* of three hospitals by this estimate is right far more often
 * than the minutes are, and the order is what `FR-PAT-43` asks for.
 *
 * **The constants are placeholders.** No document gives a road factor or a
 * speed, and they are not measured here — they are recorded in
 * `docs/STATUS.md` as awaiting the owner's word, the same arrangement as
 * `POISHA_PER_SEGMENT` in the SMS adapter. Replacing them changes estimates,
 * not code.
 *
 * ## Any other mode answers "unknown"
 *
 * `TRAVEL_TIME_MODE=api` names a provider that does not exist yet. Rather than
 * fall back to the static estimate while claiming to be live, it returns null:
 * the ranking sorts unknown last and the card shows the distance alone. A
 * travel time from the wrong source is worse than none (`PRD.md` §3.2).
 */

import { time, type Timestamp } from '@platform/domain';

import { env } from '../env.js';

export interface TravelTimeAdapter {
  readonly name: string;
  /** Minutes to drive `distanceMetres` of straight line, starting at `at`. Null when unknown. */
  minutesFor(distanceMetres: number, at: Timestamp): number | null;
}

/** Road distance over straight-line distance. A placeholder: see the header. */
const ROAD_FACTOR = 1.4;

/**
 * Average speed by the hour in Dhaka, km/h. A placeholder: see the header.
 *
 * Three bands: the morning and evening peaks, the working day between them,
 * and the night. A burn case at two in the morning and one at six in the
 * evening are not the same drive.
 */
const SPEED_BANDS: readonly { readonly from: number; readonly to: number; readonly kmh: number }[] =
  [
    { from: 7, to: 10, kmh: 12 },
    { from: 10, to: 16, kmh: 18 },
    { from: 16, to: 21, kmh: 12 },
  ];
const NIGHT_KMH = 28;

export class StaticTravelTime implements TravelTimeAdapter {
  readonly name = 'static';

  minutesFor(distanceMetres: number, at: Timestamp): number {
    const { hour } = time.toDhakaClock(at);
    const kmh = SPEED_BANDS.find((band) => hour >= band.from && hour < band.to)?.kmh ?? NIGHT_KMH;
    const roadKm = (distanceMetres / 1000) * ROAD_FACTOR;
    // At least a minute: "0 minutes away" reads as "already there".
    return Math.max(1, Math.ceil((roadKm / kmh) * 60));
  }
}

/** No routing provider is configured: every travel time is unknown. */
export class UnconfiguredTravelTime implements TravelTimeAdapter {
  readonly name = 'unconfigured';

  minutesFor(): null {
    return null;
  }
}

let current: TravelTimeAdapter | null = null;

/** The adapter this process estimates with. */
export function travelTime(): TravelTimeAdapter {
  current ??=
    env.TRAVEL_TIME_MODE === 'static' ? new StaticTravelTime() : new UnconfiguredTravelTime();
  return current;
}

/** Replaces it. Called by tests; nothing in production calls this. */
export function setTravelTimeAdapter(adapter: TravelTimeAdapter): void {
  current = adapter;
}

/** Restores the environment's choice. */
export function resetTravelTimeAdapter(): void {
  current = null;
}
