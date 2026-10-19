export function assignmentChanges(desks, staffId, wanted) {
  return desks
    .filter((desk) => desk.staffIds.includes(staffId) !== wanted.has(desk.id))
    .map((before) => ({
      before,
      staffIds: wanted.has(before.id)
        ? [...before.staffIds, staffId]
        : before.staffIds.filter((id) => id !== staffId),
    }));
}
export function sameDesk(a, b) {
  return (
    a.id === b.id &&
    a.nameBn === b.nameBn &&
    a.nameEn === b.nameEn &&
    JSON.stringify([...a.staffIds].sort()) === JSON.stringify([...b.staffIds].sort()) &&
    JSON.stringify([...a.doctorIds].sort()) === JSON.stringify([...b.doctorIds].sort())
  );
}
/** Reconcile receipts after any later successful read, without replaying writes. */
export function reconcileAssignmentResults(results, desks) {
  return results.map((result) => ({
    ...result,
    confirmed: desks.some(
      (desk) =>
        desk.id === result.change.before.id &&
        JSON.stringify([...desk.staffIds].sort()) ===
          JSON.stringify([...result.change.staffIds].sort()),
    ),
  }));
}
export async function writeAssignments(changes, write, read) {
  const results = [];
  let stopped = false;
  for (const change of changes) {
    if (stopped) {
      results.push({ change, status: 'pending', confirmed: false });
      continue;
    }
    try {
      const saved = await write(change);
      const status = saved.ok
        ? 'completed'
        : saved.failure.kind === 'offline' || saved.failure.kind === 'failed'
          ? 'uncertain'
          : 'rejected';
      results.push({ change, status, confirmed: false });
      stopped = !saved.ok;
    } catch {
      results.push({ change, status: 'uncertain', confirmed: false });
      stopped = true;
    }
  }
  let desks = null;
  try {
    const result = await read();
    if (typeof result !== 'string') desks = result;
  } catch {
    /* Preserve acknowledged and pending results. */
  }
  return {
    desks,
    results: reconcileAssignmentResults(results, desks ?? []),
  };
}
