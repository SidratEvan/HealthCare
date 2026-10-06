/**
 * What a phone is told when the patient app is added to its home screen
 * (`PRD.md` `FR-BRD-08`; plan C3).
 *
 * A hospital's portal installs as that hospital's app: its name under the
 * icon, its logo as the icon, its colour on the splash. It is the same build
 * and the same pages; only this description differs, and it is made here from
 * what the hospital has set (`FR-BRD-06`), so that the network's own app and
 * every hospital's are described by one function.
 *
 * ## When a hospital's logo is the icon
 *
 * A launcher needs an icon it can draw at home-screen size. A logo is used
 * when it is a PNG, square, and at least 192 pixels a side; the size it is
 * declared at is the size it is, read from the file's own header, because a
 * launcher that is told one size and given another may refuse the icon.
 * Anything else (no logo, a JPEG, a small or oblong image) installs under the
 * platform's own icon with the hospital's name and colour, which is still
 * recognisably the hospital's and never a blank tile.
 */

/** The platform's own install description (`frontend/patient` used to hold it as a file). */
export const PLATFORM_INSTALL = {
  name: 'MedLiveBD',
  description: 'ডাক্তারের সিরিয়াল নিন, আর অপেক্ষা সরাসরি দেখুন।',
  /** The app's ground (`--color-bg-canvas`): the splash, and the network's own bar. */
  ground: '#F6F4EF',
  icons: [
    { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    { src: '/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
  ],
} as const;

/** The smallest logo a launcher is given as an icon. */
export const INSTALL_ICON_MIN_PIXELS = 192;

/** How long a name a launcher shows under an icon before it cuts it. */
const SHORT_NAME_MAX = 12;

export interface InstallIcon {
  /** An absolute address: the logo is served by the API, not by the app. */
  readonly src: string;
  readonly type: string;
  readonly width: number;
  readonly height: number;
}

/** The hospital whose portal is being installed. */
export interface InstallSubject {
  readonly nameBn: string;
  readonly descriptionBn: string | null;
  /** Its `brand-600`, or null when it is in the platform's colours. */
  readonly mainColour: string | null;
  readonly icon: InstallIcon | null;
  /**
   * Where the installed app opens. `/` at a portal's own address; at the
   * network's address a portal is opened by a parameter, which has to be in
   * the address the icon opens or the installed app would be the network.
   */
  readonly startUrl: string;
}

export interface WebManifest {
  readonly name: string;
  readonly short_name: string;
  readonly description: string;
  readonly lang: 'bn';
  readonly dir: 'ltr';
  readonly start_url: string;
  readonly scope: '/';
  readonly display: 'standalone';
  readonly orientation: 'portrait';
  readonly background_color: string;
  readonly theme_color: string;
  readonly categories: readonly string[];
  readonly icons: readonly {
    readonly src: string;
    readonly sizes: string;
    readonly type: string;
    readonly purpose: string;
  }[];
}

/**
 * A PNG's pixel size, from the start of the file as hexadecimal.
 *
 * Bytes 17 to 24 of every PNG are the width and the height: the header chunk
 * is always first and always this shape. Null when what was given is not the
 * start of a PNG.
 */
export function pngSize(headHex: string): { width: number; height: number } | null {
  const hex = headHex.toLowerCase();
  if (hex.length < 48 || !hex.startsWith('89504e470d0a1a0a') || hex.slice(24, 32) !== '49484452') {
    return null;
  }
  const width = Number.parseInt(hex.slice(32, 40), 16);
  const height = Number.parseInt(hex.slice(40, 48), 16);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

/** Whether a logo can be a home-screen icon: a PNG, square, large enough. */
export function installIconUsable(icon: InstallIcon | null): icon is InstallIcon {
  return (
    icon !== null &&
    icon.type === 'image/png' &&
    icon.width === icon.height &&
    icon.width >= INSTALL_ICON_MIN_PIXELS
  );
}

/**
 * A name short enough to sit under an icon: whole words from the front, as
 * many as fit. A first word that is itself too long is cut, since a launcher
 * would cut it anyway and less tidily.
 */
export function shortInstallName(name: string): string {
  const words = name.trim().split(/\s+/);
  let short = '';
  for (const word of words) {
    const next = short === '' ? word : `${short} ${word}`;
    if ([...next].length > SHORT_NAME_MAX) break;
    short = next;
  }
  if (short !== '') return short;
  return [...(words[0] ?? name)].slice(0, SHORT_NAME_MAX).join('');
}

/** The install description: the network's own with null, a hospital's otherwise. */
export function installManifest(subject: InstallSubject | null): WebManifest {
  const base = {
    lang: 'bn',
    dir: 'ltr',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: PLATFORM_INSTALL.ground,
    categories: ['health', 'medical'],
  } as const;

  if (subject === null) {
    return {
      ...base,
      name: PLATFORM_INSTALL.name,
      short_name: PLATFORM_INSTALL.name,
      description: PLATFORM_INSTALL.description,
      start_url: '/',
      theme_color: PLATFORM_INSTALL.ground,
      icons: PLATFORM_INSTALL.icons,
    };
  }

  return {
    ...base,
    name: subject.nameBn,
    short_name: shortInstallName(subject.nameBn),
    description: subject.descriptionBn ?? PLATFORM_INSTALL.description,
    start_url: subject.startUrl,
    theme_color: subject.mainColour ?? PLATFORM_INSTALL.ground,
    icons: installIconUsable(subject.icon)
      ? [
          {
            src: subject.icon.src,
            sizes: `${String(subject.icon.width)}x${String(subject.icon.height)}`,
            type: subject.icon.type,
            purpose: 'any',
          },
        ]
      : PLATFORM_INSTALL.icons,
  };
}
