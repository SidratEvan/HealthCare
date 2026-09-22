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
  RADIUS,
  SPACE,
  TYPE_SCALE,
  cssVar,
  type ColourToken,
  type TypeToken,
} from './tokens/index.js';

export {
  CONTRAST_MINIMUM,
  contrastRatio,
  levelOf,
  meets,
  parseHex,
  relativeLuminance,
  type ContrastLevel,
  type Rgb,
} from './a11y/contrast.js';

// --- Primitives (FRONTEND.md §5) -------------------------------------------
export {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from './components/Button.js';
export { Input, type InputKind, type InputProps } from './components/Input.js';
export { OtpInput, OTP_LENGTH, type OtpInputProps } from './components/OtpInput.js';
export { Card, CardMeta, CardTitle, type CardProps } from './components/Card.js';
export {
  Chip,
  FilterChip,
  type ChipProps,
  type ChipTone,
  type FilterChipProps,
} from './components/Chip.js';
export {
  Sheet,
  SheetActions,
  SheetClose,
  type SheetActionsProps,
  type SheetProps,
} from './components/Sheet.js';
export {
  DEFAULT_DURATION_MS,
  ToastProvider,
  UNDO_DURATION_MS,
  useToast,
  type ToastRequest,
  type ToastTone,
} from './components/Toast.js';
export { cx, type ClassValue } from './components/cx.js';

// --- Signature components (FRONTEND.md §6) ---------------------------------
//
// `<FreshnessLine>` lands first because CLAUDE.md §5.8 requires it beneath
// every live figure, so no screen can ship without it.
export { FreshnessLine, type FreshnessLineProps } from './components/FreshnessLine.js';

// The ward board's pair (§6.5, build step 14).
export { BedTile, type BedTileProps, type BedTileState } from './components/BedTile.js';
export {
  CapacityMirror,
  type CapacityMirrorProps,
  type CapacityMirrorRow,
} from './components/CapacityMirror.js';

/**
 * `<LiveSerialCard>` — the screen the whole product is for (§6.1). It lands
 * with step 10, which is the two-device demo.
 */
export {
  LiveSerialCard,
  liveSerialTone,
  type EtaConfidence,
  type LiveSerialCardProps,
  type LiveSerialFacts,
  type LiveSerialLabels,
  type LiveSerialTone,
} from './components/LiveSerialCard.js';
