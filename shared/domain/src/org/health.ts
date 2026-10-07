/**
 * How a hospital's workspace is doing, for the platform's screen (`PRD.md`
 * `FR-SUP-06`; `S-B-12`; plan G2).
 *
 * "System health view: sync lag per hospital, stale-data offenders,
 * notification delivery rates." Three things about an organisation, none of
 * them about a person (`FR-ONB-08`):
 *
 * - **its published figures**, each with its age. A figure is stale here by
 *   the same rule and the same threshold a patient's screen uses
 *   (`freshnessOf`, the hospital's own `stale_threshold_minutes`): what the
 *   platform is told is exactly what a patient is being shown in amber, not a
 *   second opinion about it;
 * - **its messages**, counted by what became of them over a week;
 * - **its consoles' sync**: how many actions reached the server late, and how
 *   late the slowest was.
 *
 * ## What asks for somebody's attention, and what does not
 *
 * A flag is for what is wrong beyond argument. A message that failed, or one
 * still waiting after minutes, is: somebody was not told. A figure a live
 * hospital publishes that nobody has ever confirmed is: a patient is shown a
 * number with nothing behind it.
 *
 * **A stale figure is not flagged, and is ranked instead.** A ward does not
 * touch its counts every ten minutes through a night, so by the threshold a
 * patient's screen uses most hospitals are stale most of the time, and a flag
 * that is on every row says nothing about any of them. What the list is for
 * is "stale-data offenders": which hospital is worst. So each workspace
 * carries its oldest shared figure and how old it is, and the screen says
 * that in words, row by row, where one can be read against another.
 *
 * **Late sync is not flagged either.** A counter that lost its connection,
 * went on working and sent what it did when the connection came back is the
 * product doing what it was built to do (`FR-OFF-01`); the figure is shown so
 * that a hospital whose connection drops every evening can be seen.
 *
 * Pure: the counting is the database's and the wording is `@platform/i18n`'s.
 */

import { freshnessOf, type Freshness } from '../emergency/freshness.js';

import type { Timestamp } from '../types/ids.js';

/** The live figures a workspace's health reports on. */
export const HEALTH_FIGURES = ['beds', 'capabilities'] as const;
export type HealthFigure = (typeof HEALTH_FIGURES)[number];

/** What asks for attention at a workspace. Order is the order they are said in. */
export const WORKSPACE_ATTENTIONS = ['unconfirmed_figures', 'messages'] as const;
export type WorkspaceAttention = (typeof WORKSPACE_ATTENTIONS)[number];

/** Past this, a message still waiting to be sent is not "about to go". */
export const MESSAGE_WAITING_MINUTES = 5;

/** Past this, an action reached the server late: it was not an ordinary tap. */
export const LATE_ACTION_SECONDS = 60;

/** The window the message and sync counts are taken over. */
export const HEALTH_WINDOW_DAYS = 7;

/** One published figure as counted: when it was last confirmed, if ever. */
export interface FigureStamp {
  readonly figure: HealthFigure;
  /**
   * False where the hospital keeps this figure to itself (`FR-NET-04`): it is
   * shown to nobody, so its age is nobody's problem.
   */
  readonly shared: boolean;
  readonly asOf: Timestamp | null;
}

export interface FigureHealth extends Freshness {
  readonly figure: HealthFigure;
  readonly shared: boolean;
}

export interface MessageCounts {
  /** Handed to the provider, or reported delivered by it. */
  readonly sent: number;
  /** The provider refused it or could not send it. */
  readonly failed: number;
  /** Deliberately not sent: no number, quiet hours, the monthly cap. */
  readonly held: number;
  /** Still queued after `MESSAGE_WAITING_MINUTES`. */
  readonly waiting: number;
}

export interface SyncCounts {
  /** Actions that reached the server more than `LATE_ACTION_SECONDS` after the tap. */
  readonly lateActions: number;
  /** How late the slowest of them was, in seconds; 0 when there was none. */
  readonly slowestSeconds: number;
  /** When the last late action arrived; null when there was none. */
  readonly lastLateAt: Timestamp | null;
}

/** The oldest figure a workspace is showing patients past its threshold. */
export interface StalestFigure {
  readonly figure: HealthFigure;
  readonly ageMinutes: number;
}

export interface WorkspaceHealth {
  readonly figures: readonly FigureHealth[];
  readonly messages: MessageCounts;
  readonly sync: SyncCounts;
  readonly attention: readonly WorkspaceAttention[];
  /** Null where no shared figure is stale, or the workspace is not public. */
  readonly stalest: StalestFigure | null;
}

/** What a figure's stamp comes to now, by the hospital's own threshold. */
export function figureHealth(
  stamp: FigureStamp,
  now: Timestamp,
  thresholdMinutes: number,
): FigureHealth {
  return {
    figure: stamp.figure,
    shared: stamp.shared,
    ...freshnessOf([stamp.asOf], now, thresholdMinutes),
  };
}

/**
 * What asks for attention, from what was counted.
 *
 * `live` because a workspace that is not public shows nobody anything: a
 * hospital still setting up has figures nobody has confirmed, and that is
 * what setting up looks like, not an offence.
 */
export function workspaceAttention(input: {
  readonly live: boolean;
  readonly figures: readonly FigureHealth[];
  readonly messages: MessageCounts;
}): readonly WorkspaceAttention[] {
  const attention: WorkspaceAttention[] = [];
  if (input.live && input.figures.some((figure) => figure.shared && figure.asOf === null)) {
    attention.push('unconfirmed_figures');
  }
  if (input.messages.failed > 0 || input.messages.waiting > 0) attention.push('messages');
  return attention;
}

/**
 * The oldest figure a public workspace is showing patients as stale.
 *
 * Among the figures it shares that are past the threshold and have an age:
 * one never confirmed has none, and is flagged instead of ranked.
 */
export function stalestFigure(input: {
  readonly live: boolean;
  readonly figures: readonly FigureHealth[];
}): StalestFigure | null {
  if (!input.live) return null;
  let stalest: StalestFigure | null = null;
  for (const figure of input.figures) {
    if (!figure.shared || !figure.stale || figure.ageMinutes === null) continue;
    if (stalest === null || figure.ageMinutes > stalest.ageMinutes) {
      stalest = { figure: figure.figure, ageMinutes: figure.ageMinutes };
    }
  }
  return stalest;
}

/** A workspace's health, assembled. */
export function workspaceHealth(input: {
  readonly live: boolean;
  readonly stamps: readonly FigureStamp[];
  readonly messages: MessageCounts;
  readonly sync: SyncCounts;
  readonly now: Timestamp;
  readonly thresholdMinutes: number;
}): WorkspaceHealth {
  const figures = input.stamps.map((stamp) =>
    figureHealth(stamp, input.now, input.thresholdMinutes),
  );
  return {
    figures,
    messages: input.messages,
    sync: input.sync,
    attention: workspaceAttention({ live: input.live, figures, messages: input.messages }),
    stalest: stalestFigure({ live: input.live, figures }),
  };
}

/**
 * The share of a week's messages that went, as a whole percentage; null when
 * none was attempted. Held messages are not attempts: nothing was sent and
 * nothing failed.
 */
export function deliveryPercent(messages: MessageCounts): number | null {
  const attempted = messages.sent + messages.failed;
  if (attempted === 0) return null;
  return Math.floor((messages.sent / attempted) * 100);
}
