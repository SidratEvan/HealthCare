/** Read-only signals from the captured overview, never inferred queue events.
 * FR-ADM-12. Evaluate against serverTs so an offline snapshot does not invent
 * a new overdue event as the browser clock advances.
 */
import type { ConsoleKey } from '@platform/i18n';

import type { ChamberSummary, Overview } from './admin';

export interface AttentionItem {
  readonly id: string;
  readonly chamber: ChamberSummary | null;
  readonly message: ConsoleKey;
  readonly settings: 'doctors' | 'staff' | null;
}

export function attentionFor(data: Overview): readonly AttentionItem[] {
  const result: AttentionItem[] = [];
  const clock = new Date(data.serverTs).getTime();
  for (const chamber of data.chambers) {
    if (chamber.status === 'ended' || chamber.status === 'cancelled') continue;
    const add = (message: ConsoleKey, settings: AttentionItem['settings'] = null) =>
      result.push({ id: `${chamber.sessionId}-${message}`, chamber, message, settings });
    if (chamber.status === 'scheduled' && new Date(chamber.plannedStart).getTime() < clock)
      add('adminAttentionOverdue');
    if (chamber.status === 'paused' && chamber.waiting > 0) add('adminAttentionPaused');
    if (chamber.room === null || chamber.room.trim() === '') add('adminAttentionRoom', 'doctors');
    if (chamber.desks.length === 0) add('adminAttentionDesk', 'staff');
  }
  if (
    data.beds !== null &&
    (data.beds.asOf === null || clock - new Date(data.beds.asOf).getTime() > 5 * 60_000)
  )
    result.push({ id: 'beds', chamber: null, message: 'adminAttentionBeds', settings: null });
  return result;
}

export function chamberGroups(chambers: readonly ChamberSummary[]) {
  const groups = new Map<
    string,
    { id: string; nameBn: string | null; nameEn: string | null; chambers: ChamberSummary[] }
  >();
  for (const chamber of chambers) {
    const desks =
      chamber.desks.length > 0 ? chamber.desks : [{ id: 'unassigned', nameBn: null, nameEn: null }];
    for (const desk of desks) {
      const group = groups.get(desk.id) ?? { ...desk, chambers: [] };
      group.chambers.push(chamber);
      groups.set(desk.id, group);
    }
  }
  return [...groups.values()];
}
