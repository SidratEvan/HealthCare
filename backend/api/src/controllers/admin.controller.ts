/**
 * The admin dashboard endpoints (BACKEND.md §7.7, `S-B-10`).
 *
 * Thin by rule, like every controller. The one thing it does that others do
 * not is decide *which hospital* — and that is exactly where an aggregate
 * endpoint gets dangerous, so it is done once, here, and never from anything
 * the caller sent.
 */

import { AppError, forbiddenScope } from '../errors/AppError.js';
import * as adminService from '../services/admin.service.js';

import type { Request, Response } from 'express';

/**
 * The hospital these figures are about.
 *
 * Taken from the principal, never from a query parameter. `FR-ROLE-01` scopes
 * a hospital admin to their own facility, and a `?hospitalId=` that the server
 * honoured would let one hospital's administrator read another's revenue by
 * editing a URL — with every query in `admin.repo` doing exactly as it was
 * told and nothing looking wrong anywhere.
 */
function hospitalOf(req: Request): string {
  const principal = req.principal;
  if (principal === undefined) throw forbiddenScope({ reason: 'no_principal' });
  if (principal.kind !== 'staff' || principal.hospitalId === null) {
    throw forbiddenScope({ reason: 'not_hospital_staff' });
  }
  return principal.hospitalId;
}

/** Today in Dhaka, which is what "today" means to everybody using this screen. */
function todayInDhaka(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function rangeOf(req: Request): { from: string; to: string } {
  const query = req.query as { from?: string; to?: string };
  const to = query.to ?? todayInDhaka();
  const from = query.from ?? to;
  return { from, to };
}

/** `GET /admin/dashboard?from&to` — every section of `S-B-10` (`FR-ADM-01`..`09`). */
export async function getDashboard(req: Request, res: Response): Promise<void> {
  const { from, to } = rangeOf(req);

  const data = await adminService.dashboard({ hospitalId: hospitalOf(req), from, to });

  res.json({ ok: true, data });
}

/**
 * `GET /admin/export?view=&from&to` — one section as CSV (`FR-ADM-10`).
 *
 * `Content-Disposition: attachment` with a filename naming the view and the
 * window, because an administrator exporting four sections in a morning ends
 * up with four files and no way to tell them apart otherwise.
 */
export async function getExport(req: Request, res: Response): Promise<void> {
  const query = req.query as { view?: string };
  const view = query.view ?? '';

  if (!adminService.isExportable(view)) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'No such export.',
      details: { view, allowed: adminService.EXPORTABLE },
    });
  }

  const { from, to } = rangeOf(req);
  const principal = req.principal;

  const result = await adminService.exportView({
    hospitalId: hospitalOf(req),
    from,
    to,
    view,
    staffUserId: principal?.kind === 'staff' ? principal.id : null,
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);

  // Never cached. An export is an audited read of live figures, and a proxy
  // serving a stale copy would hand somebody last week's numbers without a
  // second audit row ever being written.
  res.setHeader('Cache-Control', 'no-store');
  res.send(result.csv);
}
