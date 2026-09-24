/**
 * Who is on a chamber's list, by name (`S-B-02`, `APP_FLOW.md` B1.4).
 *
 * The queue state the console reduces carries serials and statuses and no
 * names — it is the event log folded, and a name is not an event. The names
 * come with the roster `GET /sessions/:id/queue` already returns beside the
 * state. The console had never read them: every row said "—" from step 8
 * until this file, which made the one screen a hospital director watches a
 * receptionist use look unfinished.
 */

export interface RosterName {
  readonly patientId: string;
  readonly patientName: string;
}

/** Patient display names by patient id, for the queue table and the chamber card. */
export async function fetchPatientNames(input: {
  readonly apiBaseUrl: string;
  readonly token: string | null;
  readonly sessionId: string;
}): Promise<ReadonlyMap<string, string>> {
  const response = await fetch(`${input.apiBaseUrl}/sessions/${input.sessionId}/queue`, {
    headers: input.token === null ? {} : { authorization: `Bearer ${input.token}` },
  });
  if (!response.ok) throw new Error(`roster: ${String(response.status)}`);

  const body = (await response.json()) as { data: { bookings: readonly RosterName[] } };
  return new Map(body.data.bookings.map((booking) => [booking.patientId, booking.patientName]));
}
