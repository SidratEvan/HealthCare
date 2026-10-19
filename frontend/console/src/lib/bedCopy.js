/**
 * What a bed says about itself on the ward board, in words.
 *
 * One place, because the tile, the panel and the transfer list all name a
 * bed's state, and three spellings of "being cleaned" is how a board starts
 * contradicting itself.
 */

import { effectiveState } from '@platform/domain';
import { format, formatClock, formatNumber, numeralsFor, t } from '@platform/i18n';

const STATE_KEY = {
  free: 'bedStateFree',
  occupied: 'bedStateOccupied',
  cleaning: 'bedStateCleaning',
  reserved: 'bedStateReserved',
  out_of_service: 'bedStateOos',
};

export function stateLabel(state, locale) {
  return t(STATE_KEY[state], locale);
}

/** The state the bed is really in: a lapsed hold is free (`shared/domain`). */
export function shownState(bed, now) {
  return effectiveState(bed, now.toISOString());
}

/**
 * The one line of context a tile carries.
 *
 * How long a patient has been in, how long the cleaning has taken, when a
 * hold runs out, why a bed is broken. Each is the question the ward asks of
 * that state first.
 */
export function tileDetail(bed, now, locale) {
  const numerals = numeralsFor(locale);
  const since = new Date(bed.stateChangedAt).getTime();

  switch (shownState(bed, now)) {
    case 'occupied': {
      const days = Math.floor((now.getTime() - since) / 86_400_000);
      return days <= 0
        ? t('bedSinceToday', locale)
        : format('bedDaysIn', locale, { days: formatNumber(days, numerals) });
    }
    case 'cleaning':
      return format('bedCleaningFor', locale, {
        minutes: formatNumber(Math.max(0, Math.floor((now.getTime() - since) / 60_000)), numerals),
      });
    case 'reserved':
      return bed.reservedUntil === null
        ? undefined
        : format('bedUntil', locale, { time: formatClock(bed.reservedUntil, numerals) });
    case 'out_of_service':
      return bed.oosReason ?? undefined;
    case 'free':
      return undefined;
  }
}
