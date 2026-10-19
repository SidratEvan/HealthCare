/** Patient display names by patient id, for the queue table and the chamber card. */
export async function fetchPatientNames(input) {
  const response = await fetch(`${input.apiBaseUrl}/sessions/${input.sessionId}/queue`, {
    headers: input.token === null ? {} : { authorization: `Bearer ${input.token}` },
  });
  if (!response.ok) throw new Error(`roster: ${String(response.status)}`);

  const body = await response.json();
  return new Map(body.data.bookings.map((booking) => [booking.patientId, booking.patientName]));
}
