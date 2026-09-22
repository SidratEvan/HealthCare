/**
 * `@platform/i18n` — messages, formatters and locale utilities (FRONTEND.md §8).
 *
 * Every key exists in both `bn` and `en`, and CI fails on a missing key
 * (`I18N-02`). Bangla is the default, not a translation of an English original
 * (CLAUDE.md §11.5).
 *
 * The numeral formatters land first because they are the part most easily got
 * wrong: Latin digits inside a Bangla sentence is the tell FRONTEND.md §0.2
 * bans by name, and `TYP-04` makes the choice depend on which surface is
 * asking. The message catalogue itself arrives with the first screens.
 */

export {
  CONSOLE,
  PATIENT,
  format,
  t,
  tp,
  type ConsoleKey,
  type Locale,
  type Message,
  type PatientKey,
} from './messages.js';

export { BED_KIND_NAMES, bedKindName, type BedKindName } from './beds.js';

export {
  CAPABILITY_NAMES,
  EMERGENCY_PROBLEM_NAMES,
  TRIAGE_NAMES,
  capabilityName,
  problemName,
  triageName,
  type CapabilityName,
  type EmergencyProblemName,
  type TriageName,
} from './emergency.js';

export {
  TEMPLATES,
  TEMPLATE_KEYS,
  placeholdersFor,
  placeholdersIn,
  render,
  type TemplateChannel,
  type TemplateDefinition,
  type TemplateKey,
} from './templates.js';

export { DAY_PERIODS, DHAKA, dayPeriod, formatClock, formatDateTime } from './datetime.js';

export {
  NUMERAL_STYLE_BY_SURFACE,
  formatMinutes,
  formatNumber,
  formatPhone,
  formatSerial,
  formatTaka,
  hasBengaliDigits,
  toBengaliDigits,
  toLatinDigits,
  type NumeralStyle,
} from './numerals.js';
