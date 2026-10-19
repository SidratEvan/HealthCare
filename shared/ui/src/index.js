/**
 * `@platform/ui` — the design system (FRONTEND.md §1–§6).
 *
 * The only place a styling decision exists. If a colour or a radius appears in
 * an app package, it is a bug (FRONTEND.md §10).
 *
 * Here: the token layer, the contrast checks that keep it honest, and the
 * primitives from §5 — Button, Input, OtpInput, Card, Chip, Sheet, Toast.
 *
 * The signature components that carry the brand (§6) — `<LiveSerialCard>`,
 * `<FreshnessLine>`, `<QueueTable>`, `<BedTile>` — land with the screens that
 * render them, from step 8 onward, because each is defined by a live data
 * shape rather than by a visual one.
 */

export {
  BANNED_FONT_FAMILIES,
  COLOUR,
  ELEVATION,
  FONT,
  MIN_BODY_SIZE_PX,
  MIN_TOUCH_TARGET_PX,
  MOTION,
  PATIENT_COLOUR,
  RADIUS,
  SPACE,
  TYPE_SCALE,
  cssVar,
} from './tokens/index.js';

export {
  CONTRAST_MINIMUM,
  contrastRatio,
  levelOf,
  meets,
  parseHex,
  relativeLuminance,
} from './a11y/contrast.js';
export { useWindowKeydown } from './a11y/keys.js';

// --- Primitives (FRONTEND.md §5) -------------------------------------------
export { Button } from './components/Button.jsx';
export { Input } from './components/Input.jsx';
export { OtpInput, OTP_LENGTH } from './components/OtpInput.jsx';
export { Card, CardMeta, CardTitle } from './components/Card.jsx';
export { Chip, FilterChip } from './components/Chip.jsx';
export { Sheet, SheetActions, SheetClose } from './components/Sheet.jsx';
export {
  DEFAULT_DURATION_MS,
  ToastProvider,
  UNDO_DURATION_MS,
  useToast,
} from './components/Toast.jsx';
export { cx } from './components/cx.js';

// --- Signature components (FRONTEND.md §6) ---------------------------------
//
// `<FreshnessLine>` lands first because CLAUDE.md §5.8 requires it beneath
// every live figure, so no screen can ship without it.
export { FreshnessLine } from './components/FreshnessLine.jsx';

// The printed prescription (FR-DOC-07, plan R2).
export { PrescriptionSheet, usePrintSheet } from './components/PrescriptionSheet.jsx';

// The ward board's pair (§6.5, build step 14).
export { BedTile } from './components/BedTile.jsx';
export { CapacityMirror } from './components/CapacityMirror.jsx';

/**
 * `<LiveSerialCard>` — the screen the whole product is for (§6.1). It lands
 * with step 10, which is the two-device demo.
 */
export { LiveSerialCard, liveSerialTone } from './components/LiveSerialCard.jsx';

// --- Language (GR-06, I18N-08) ---------------------------------------------
//
// One store for the whole app, so that the switch at the top of a screen
// changes every screen, sheet and toast in the same render.
export { LOCALE_STORAGE_KEY, setLocale, useLocale } from './locale/store.js';
export { LanguageSwitch } from './locale/LanguageSwitch.jsx';
export { LocaleDocument } from './locale/LocaleDocument.jsx';

// Opt-in approved console foundation; import @platform/ui/console.css locally.
export {
  ConsoleTheme,
  consoleNavigationFor,
  consoleBrandStyle,
  BilingualLabel,
  ConsoleAction,
  ConsoleInput,
  ConsoleHeader,
  ConsoleShell,
  ConsolePageHeader,
  ConsolePanel,
  ConsoleStatus,
  ConsoleFeedback,
  ConsoleState,
  ConsoleHelp,
  ConsoleConfirmation,
} from './console/ConsoleFoundation.jsx';
