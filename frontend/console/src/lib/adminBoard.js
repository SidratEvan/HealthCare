export function attentionFor(data) {
  const result = [];
  const clock = new Date(data.serverTs).getTime();
  for (const chamber of data.chambers) {
    if (chamber.status === 'ended' || chamber.status === 'cancelled') continue;
    const add = (message, settings = null) =>
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

export function chamberGroups(chambers) {
  const groups = new Map();
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
