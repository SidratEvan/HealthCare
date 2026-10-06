/**
 * Which live figures a hospital shares with the network (`PRD.md`
 * `FR-NET-04`, `FR-NET-01`; plan C5).
 *
 * A hospital in the network is listed: its name, where it is, its
 * departments, its doctors and when they sit. Those are what being in the
 * network is. Beyond them it contributes live figures, and which of those it
 * shares is its own decision:
 *
 *   - `serials`: how many serials are open, who is sitting now, how many
 *     places a chamber has left;
 *   - `beds`: beds by kind, free and total;
 *   - `stock`: which medicines its pharmacy has.
 *
 * A figure a hospital does not share is said to be **not shared**. Never zero,
 * never "none": a patient told there are no beds stays away from a hospital
 * that has them, and that is the hospital's choice turned into a false
 * statement (`PRD.md` §3.2). So the answer carries, beside the missing
 * figure, the fact that it is withheld (`notShared`), and the screen says so.
 *
 * ## Not the same as a module being off
 *
 * A hospital that does not run beds has no bed figure and nothing is said
 * about beds at all (`FR-BRD-11`). A hospital that runs beds and does not
 * share the figure is said not to share it. `notSharedOf` keeps the two
 * apart: a figure is "not shared" only where its module is on.
 *
 * ## What a hospital cannot withhold
 *
 * What its emergency department can treat. A person looking for a burn unit
 * is shown the nearest that has one (`FR-BRD-09`), and whether a hospital may
 * hide that is not a choice this file makes for anybody
 * (`docs/STATUS.md`, question 8). While it runs its emergency module, it is
 * shared.
 */

import { z } from 'zod';

import type { HospitalModule } from '../modules/modules.js';

export const PUBLISHABLE_FIGURES = ['serials', 'beds', 'stock'] as const;

export type PublishableFigure = (typeof PUBLISHABLE_FIGURES)[number];

export function isPublishableFigure(value: string): value is PublishableFigure {
  return (PUBLISHABLE_FIGURES as readonly string[]).includes(value);
}

/** The module a figure comes from: with the module off there is no figure to share. */
export const MODULE_OF_FIGURE: Readonly<Record<PublishableFigure, HospitalModule>> = {
  serials: 'queue',
  beds: 'beds',
  stock: 'pharmacy',
};

/**
 * The figures a hospital has but does not share: what it has unpublished,
 * less anything whose module it does not run at all.
 */
export function notSharedOf(
  unpublished: readonly string[],
  modulesOff: readonly string[],
): PublishableFigure[] {
  return PUBLISHABLE_FIGURES.filter(
    (figure) => unpublished.includes(figure) && !modulesOff.includes(MODULE_OF_FIGURE[figure]),
  );
}

/** `PUT /hospital/publishing`: the figures the hospital does not share. */
export const publishingBody = z.strictObject({
  unpublished: z
    .array(z.enum(PUBLISHABLE_FIGURES))
    .max(PUBLISHABLE_FIGURES.length)
    .refine((list) => new Set(list).size === list.length, 'each figure once'),
});
export type PublishingBody = z.infer<typeof publishingBody>;
