/**
 * The pharmacy: what is on the shelf, and what a family searching is told
 * (BACKEND.md §7.6; `FR-PHR-02`).
 *
 * ## `FR-PHR-01` is not implemented in this version, and this is why
 *
 * "Dispense against a prescription QR; partial dispensing supported" is
 * downstream of `FR-DOC-04`, which the owner removed from this version on
 * 2026-09-19 (`PRD.md` §9). No code path and no seed creates a `prescriptions`
 * row, so `POST /prescriptions/:id/dispense` would guard a table that is
 * always empty and `S-B-09`'s scanner would scan nothing. Building it would be
 * a screen demonstrating a flow the demo cannot reach.
 *
 * So it follows prescribing out of scope, in the same way and for the same
 * reason — and `FR-PHR-02`, which needs no prescription, is built in full.
 * The requirement stays in `PRD.md`; it is simply not this version's, and
 * `docs/STATUS.md` records it under the open decisions.
 *
 * ## What is built
 *
 * A pharmacy flags what it has (`S-B-09`) and a patient searches those flags.
 * The honest part is in the domain (`lab/stock.ts`): three answers rather than
 * two, an in-stock claim that lapses to *unknown* when nobody has renewed it,
 * and an out-of-stock flag that does not. This service is the plumbing around
 * that decision.
 */

import {
  rankStockResults,
  stockAnswerFor,
  summariseStockSearch,
  type StockAnswer,
  type StockAvailabilityView,
  type StockSearchSummary,
  type Timestamp,
} from '@platform/domain';

import { forbiddenScope } from '../errors/AppError.js';
import * as labRepo from '../repositories/lab.repo.js';
import { withTransaction } from '../repositories/transaction.js';

import type { LabActor } from './lab.service.js';

/** One row of `S-B-09`'s shelf. */
export interface StockRow {
  readonly medicineId: string;
  readonly genericName: string;
  readonly brandName: string | null;
  readonly form: string | null;
  readonly strengths: readonly string[];
  readonly inStock: boolean;
  readonly updatedAt: Timestamp;
  /** What a patient searching would be told right now, given the flag's age. */
  readonly publishedAs: StockAnswer;
}

/** `GET /hospitals/:id/pharmacy-stock` — the pharmacy's own shelf. */
export async function shelf(
  hospitalId: string,
  actor: LabActor,
): Promise<{ rows: StockRow[]; serverTs: string }> {
  if (hospitalId !== actor.hospitalId) {
    throw forbiddenScope({ resource: 'pharmacy stock', hospitalId });
  }

  const now = new Date().toISOString() as Timestamp;
  const rows = await labRepo.listStock(hospitalId);

  return {
    rows: rows.map((row) => ({
      ...row,
      // `FR-BED-06`'s idea, applied to a shelf: the console shows what the
      // public is currently being told, so the consequence of not renewing a
      // flag is visible to the person who would renew it.
      publishedAs: stockAnswerFor({ inStock: row.inStock, updatedAt: row.updatedAt }, now).answer,
    })),
    serverTs: now,
  };
}

/** `PUT /hospitals/:id/pharmacy-stock` — the flags a pharmacy confirmed. */
export async function setFlags(
  input: {
    readonly hospitalId: string;
    readonly flags: readonly { medicineId: string; inStock: boolean }[];
  },
  actor: LabActor,
): Promise<{ rows: StockRow[]; written: number; serverTs: string }> {
  if (input.hospitalId !== actor.hospitalId) {
    throw forbiddenScope({ resource: 'pharmacy stock', hospitalId: input.hospitalId });
  }

  const at = new Date();
  const written = await withTransaction(
    async (trx) =>
      await labRepo.upsertStockFlags(trx, {
        hospitalId: input.hospitalId,
        flags: input.flags,
        at,
        staffUserId: actor.staffUserId,
      }),
  );

  // Read back after commit, so the console reconciles against what is stored
  // rather than what it hoped — the arrangement the bed writes have.
  const after = await shelf(input.hospitalId, actor);

  return { rows: after.rows, written, serverTs: at.toISOString() };
}

/** One medicine, and everywhere a patient could look for it. */
export interface MedicineAvailability {
  readonly medicineId: string;
  readonly genericName: string;
  readonly brandName: string | null;
  readonly form: string | null;
  readonly pharmacies: readonly StockAvailabilityView[];
  readonly summary: StockSearchSummary;
}

/**
 * `GET /medicines?q=&lat=&lng=` — the availability search (`FR-PHR-02`).
 *
 * Public, like the hospital discovery it sits beside: a stock flag names no
 * patient and no staff member. A pharmacy that has never flagged the medicine
 * still appears, as *unknown* — an absent hospital would read as "does not
 * stock it", which is a claim nobody made (`PRD.md` §3.2).
 */
export async function searchMedicines(input: {
  readonly q: string;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly limit: number;
}): Promise<{ medicines: MedicineAvailability[]; serverTs: string }> {
  const now = new Date().toISOString() as Timestamp;

  const rows = await labRepo.searchMedicineAvailability({
    query: input.q,
    lat: input.lat,
    lng: input.lng,
    // One medicine can have many pharmacies, so the row limit is the caller's
    // limit multiplied out rather than applied to medicines.
    limit: input.limit * 10,
  });

  const byMedicine = new Map<string, MedicineAvailability>();

  for (const row of rows) {
    const { answer, freshness } = stockAnswerFor(
      row.inStock === null || row.updatedAt === null
        ? null
        : { inStock: row.inStock, updatedAt: row.updatedAt },
      now,
    );

    const pharmacy: StockAvailabilityView = {
      hospitalId: row.hospitalId,
      hospitalNameBn: row.hospitalNameBn,
      hospitalNameEn: row.hospitalNameEn,
      distanceKm: row.distanceKm,
      answer,
      freshness,
    };

    const existing = byMedicine.get(row.medicineId);
    if (existing === undefined) {
      byMedicine.set(row.medicineId, {
        medicineId: row.medicineId,
        genericName: row.genericName,
        brandName: row.brandName,
        form: row.form,
        pharmacies: [pharmacy],
        summary: { inStock: 0, outOfStock: 0, unknown: 0 },
      });
    } else {
      byMedicine.set(row.medicineId, {
        ...existing,
        pharmacies: [...existing.pharmacies, pharmacy],
      });
    }
  }

  const medicines = [...byMedicine.values()]
    .map((entry) => ({
      ...entry,
      pharmacies: rankStockResults(entry.pharmacies),
      summary: summariseStockSearch(entry.pharmacies),
    }))
    .slice(0, input.limit);

  return { medicines, serverTs: now };
}
