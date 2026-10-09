/**
 * A hospital's own colours for the patient app (`FR-BRD-03`).
 *
 * The patient app is drawn from tokens and nothing else (`FRONTEND.md` §1–3),
 * and the brand is six of them. A hospital-branded app is therefore the same
 * app with those six values replaced, read from the server at start; this file
 * is the shape of that replacement and the rules it has to pass.
 *
 * ## Why a theme is checked and not trusted
 *
 * A hospital will send its logo's colour, and a logo's colour is chosen to
 * look right on a letterhead. As `brand-600` it has to carry white text on
 * every primary button a patient presses, and as `brand-700` it is the colour
 * of a heading on the app's own ground. A pale brand that fails either turns
 * the booking button into something an older patient cannot read
 * (`FR-LOC-05`, WCAG AA). So a theme that fails is not applied at all: the
 * app keeps its own colours, which pass, rather than half of somebody
 * else's.
 *
 * Only the brand ramp can be replaced. The alert, caution and neutral tokens
 * mean the same thing in every hospital's app — red is an emergency
 * everywhere — and are not configurable.
 */

import { z } from 'zod';

/** The tokens a hospital may replace, as `tokens.css` names them. */
export const BRAND_TOKENS = [
  'brand-900',
  'brand-700',
  'brand-600',
  'brand-300',
  'brand-100',
  'brand-border',
] as const;
export type BrandToken = (typeof BRAND_TOKENS)[number];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** `hospital_settings.brand` (0036). */
export const brandTheme = z.strictObject({
  colors: z.strictObject({
    'brand-900': hex,
    'brand-700': hex,
    'brand-600': hex,
    'brand-300': hex,
    'brand-100': hex,
    'brand-border': hex,
  }),
});
export type BrandTheme = z.infer<typeof brandTheme>;

/** The app's own ground and its text on a primary button (`tokens.css`). */
const CANVAS = '#f6f4ef';
const ON_BRAND = '#ffffff';

/** WCAG AA for body text (`FR-LOC-05`). */
export const MIN_TEXT_CONTRAST = 4.5;

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.039_28 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function luminance(colour: string): number {
  const red = Number.parseInt(colour.slice(1, 3), 16);
  const green = Number.parseInt(colour.slice(3, 5), 16);
  const blue = Number.parseInt(colour.slice(5, 7), 16);
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

/** The WCAG contrast ratio between two `#rrggbb` colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

export type BrandProblem =
  'button_text_unreadable' | 'heading_unreadable' | 'accent_unreadable_on_tint';

/**
 * What stops a theme being used, if anything.
 *
 * The three places the brand carries text: white on `brand-600` (every
 * primary button), `brand-700` on the canvas (the app's name, links), and
 * `brand-600` on `brand-100` (the live strip and tinted cards).
 */
export function brandProblems(theme: BrandTheme): readonly BrandProblem[] {
  const problems: BrandProblem[] = [];
  const { colors } = theme;

  if (contrastRatio(ON_BRAND, colors['brand-600']) < MIN_TEXT_CONTRAST) {
    problems.push('button_text_unreadable');
  }
  if (contrastRatio(colors['brand-700'], CANVAS) < MIN_TEXT_CONTRAST) {
    problems.push('heading_unreadable');
  }
  if (contrastRatio(colors['brand-600'], colors['brand-100']) < MIN_TEXT_CONTRAST) {
    problems.push('accent_unreadable_on_tint');
  }
  return problems;
}

// ---------------------------------------------------------------------------
// One colour in, six out (`FR-BRD-06`)
// ---------------------------------------------------------------------------

interface Hsl {
  /** 0 to 360. */
  readonly h: number;
  /** 0 to 1. */
  readonly s: number;
  /** 0 to 1. */
  readonly l: number;
}

function toHsl(colour: string): Hsl {
  const red = Number.parseInt(colour.slice(1, 3), 16) / 255;
  const green = Number.parseInt(colour.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(colour.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };

  const spread = max - min;
  const s = l > 0.5 ? spread / (2 - max - min) : spread / (max + min);
  const sector =
    max === red
      ? (green - blue) / spread + (green < blue ? 6 : 0)
      : max === green
        ? (blue - red) / spread + 2
        : (red - green) / spread + 4;
  return { h: sector * 60, s, l };
}

function fromHsl({ h, s, l }: Hsl): string {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const sector = h / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const [red, green, blue] =
    sector < 1
      ? [chroma, second, 0]
      : sector < 2
        ? [second, chroma, 0]
        : sector < 3
          ? [0, chroma, second]
          : sector < 4
            ? [0, second, chroma]
            : sector < 5
              ? [second, 0, chroma]
              : [chroma, 0, second];
  const lift = l - chroma / 2;
  const part = (value: number): string =>
    Math.round(Math.min(1, Math.max(0, value + lift)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${part(red)}${part(green)}${part(blue)}`;
}

/** One step of lightness when a colour is darkened until it reads. */
const STEP = 0.01;

/**
 * The six brand tokens, from the one colour a hospital chose.
 *
 * An administrator knows their hospital's colour. They do not know six hex
 * values and what each is for, and a form that asked for them would be filled
 * in wrongly or not at all. So the settings screen asks for one, and this
 * makes the rest: a tint and a border of the same hue, a light accent, and
 * the two darker shades headings and pressed states use.
 *
 * The chosen colour is kept as it is when it can carry white text. When it
 * cannot (a logo's yellow, a pale blue) it is darkened, on its own hue, only
 * as far as it has to be. What comes back always passes `brandProblems`: the
 * screen shows the result before it is saved, and the server checks whatever
 * it is sent regardless.
 */
export function themeFromColour(colour: string): BrandTheme {
  const chosen = toHsl(colour);
  const s = Math.min(chosen.s, 0.85);
  const h = chosen.h;

  const tint = fromHsl({ h, s: Math.min(s, 0.35), l: 0.93 });
  const border = fromHsl({ h, s: Math.min(s, 0.3), l: 0.84 });
  const light = fromHsl({ h, s: Math.min(s, 0.6), l: 0.72 });

  const carries = (candidate: string): boolean =>
    contrastRatio(ON_BRAND, candidate) >= MIN_TEXT_CONTRAST &&
    contrastRatio(candidate, tint) >= MIN_TEXT_CONTRAST;

  let mainLightness = chosen.l;
  let main = colour.toLowerCase();
  while (!carries(main) && mainLightness > STEP) {
    mainLightness -= STEP;
    main = fromHsl({ h, s, l: mainLightness });
  }

  let deepLightness = Math.max(mainLightness - 0.08, STEP);
  let deep = fromHsl({ h, s, l: deepLightness });
  while (contrastRatio(deep, CANVAS) < MIN_TEXT_CONTRAST && deepLightness > STEP) {
    deepLightness -= STEP;
    deep = fromHsl({ h, s, l: deepLightness });
  }

  const darkest = fromHsl({
    h,
    s: Math.min(s, 0.75),
    l: Math.max(Math.min(deepLightness - 0.07, 0.14), 0.04),
  });

  return {
    colors: {
      'brand-900': darkest,
      'brand-700': deep,
      'brand-600': main,
      'brand-300': light,
      'brand-100': tint,
      'brand-border': border,
    },
  };
}

/** `PUT /hospital/brand`: a hospital's colours, or null for the platform's own. */
export const brandBody = z.strictObject({ theme: brandTheme.nullable() });
export type BrandBody = z.infer<typeof brandBody>;

// ---------------------------------------------------------------------------
// A logo (`FR-BRD-06`, migration 0045)
// ---------------------------------------------------------------------------

/**
 * What a logo file may be. No SVG: an image that can carry a script is not
 * one to serve from the API's own address.
 */
export const LOGO_FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type LogoFileType = (typeof LOGO_FILE_TYPES)[number];

/** A quarter of a megabyte: generous for a mark shown at 48 pixels. */
export const LOGO_MAX_BYTES = 256 * 1024;

/**
 * `PUT /hospital/logo`. Base64 in JSON, as a lab report travels
 * (`uploadReportBody`): one body parser, no multipart.
 */
export const logoBody = z.strictObject({
  fileType: z.enum(LOGO_FILE_TYPES),
  /** Base64, without a `data:` prefix. */
  content: z
    .string()
    .min(1)
    .max(Math.ceil(LOGO_MAX_BYTES / 3) * 4 + 4),
});
export type LogoBody = z.infer<typeof logoBody>;

/**
 * Whether bytes are the kind of image they are said to be, by how the file
 * begins. A PDF renamed `.png` is refused here and not by a browser later.
 */
export function logoBytesMatch(type: LogoFileType, bytes: Uint8Array): boolean {
  const starts = (...signature: number[]): boolean =>
    signature.every((value, index) => bytes[index] === value);
  switch (type) {
    case 'image/png':
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/jpeg':
      return starts(0xff, 0xd8, 0xff);
    case 'image/webp':
      // "RIFF" …size… "WEBP"
      return (
        starts(0x52, 0x49, 0x46, 0x46) &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
  }
}

/**
 * Reads a stored theme. Null when there is none, when it is not the shape, or
 * when it would be unreadable: the caller then keeps the platform's colours.
 */
export function readBrandTheme(value: unknown): BrandTheme | null {
  if (value === null || value === undefined) return null;
  const parsed = brandTheme.safeParse(value);
  if (!parsed.success) return null;
  return brandProblems(parsed.data).length === 0 ? parsed.data : null;
}
