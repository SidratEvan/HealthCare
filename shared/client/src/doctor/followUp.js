/** Date-only follow-up, not appointments/reminders (FR-DOC-07; DB-P4). */
export function customFollowUpDays(raw) {
  const latin = raw.trim().replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6));
  if (!/^\d+$/.test(latin)) return null;
  const days = Number(latin);
  return Number.isInteger(days) && days >= 1 && days <= 365 ? days : null;
}

/** Start from the Bangladesh calendar day, independent of the device's zone. */
export function followUpDateIn(days, at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const read = (name) => Number(parts.find((p) => p.type === name)?.value);
  return new Date(Date.UTC(read('year'), read('month') - 1, read('day') + days))
    .toISOString()
    .slice(0, 10);
}

export function followUpDateLabel(date, locale) {
  return new Intl.DateTimeFormat(locale === 'bn' ? 'bn-BD' : 'en-GB', {
    timeZone: 'Asia/Dhaka',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${date}T00:00:00Z`));
}
