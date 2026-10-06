/**
 * What a phone is told when the app is added to its home screen
 * (`FR-BRD-08`; plan C3).
 */

import { describe, expect, it } from 'vitest';

import {
  INSTALL_ICON_MIN_PIXELS,
  PLATFORM_INSTALL,
  installIconUsable,
  installManifest,
  pngSize,
  shortInstallName,
  type InstallSubject,
} from '../manifest.js';

/** The first 24 bytes of a PNG of the given size, as hexadecimal. */
function pngHead(width: number, height: number): string {
  const size = (value: number): string => value.toString(16).padStart(8, '0');
  return `89504e470d0a1a0a0000000d49484452${size(width)}${size(height)}`;
}

const PADMA: InstallSubject = {
  nameBn: 'পদ্মা স্পেশালাইজড হাসপাতাল (ডেমো)',
  descriptionBn: 'উত্তরার একটি বিশেষায়িত বেসরকারি হাসপাতাল।',
  mainColour: '#17507f',
  icon: {
    src: 'https://api.example/api/v1/hospitals/h1/logo?v=abc',
    type: 'image/png',
    width: 512,
    height: 512,
  },
  startUrl: '/',
};

describe('the network’s own app', () => {
  it('installs as itself', () => {
    const manifest = installManifest(null);
    expect(manifest).toMatchObject({
      name: 'MedLiveBD',
      short_name: 'MedLiveBD',
      start_url: '/',
      display: 'standalone',
      lang: 'bn',
      theme_color: PLATFORM_INSTALL.ground,
      background_color: PLATFORM_INSTALL.ground,
    });
    expect(manifest.icons).toEqual(PLATFORM_INSTALL.icons);
  });
});

describe('a hospital’s portal installs as that hospital’s app (FR-BRD-08)', () => {
  it('its name, its words, its colour, its logo', () => {
    const manifest = installManifest(PADMA);
    expect(manifest.name).toBe(PADMA.nameBn);
    expect(manifest.description).toBe(PADMA.descriptionBn);
    expect(manifest.theme_color).toBe('#17507f');
    // The splash is the app's own ground whoever's app it is: the page is.
    expect(manifest.background_color).toBe(PLATFORM_INSTALL.ground);
    expect(manifest.icons).toEqual([
      { src: PADMA.icon?.src, sizes: '512x512', type: 'image/png', purpose: 'any' },
    ]);
    expect(manifest.display).toBe('standalone');
  });

  it('opens where the portal is: by its address, or by its parameter', () => {
    expect(installManifest(PADMA).start_url).toBe('/');
    expect(installManifest({ ...PADMA, startUrl: '/?scope=PADMA' }).start_url).toBe(
      '/?scope=PADMA',
    );
  });

  it('with nothing set but a name, it is still that hospital’s, under the platform’s icon', () => {
    const manifest = installManifest({
      nameBn: 'কর্ণফুলী জেনারেল হাসপাতাল (ডেমো)',
      descriptionBn: null,
      mainColour: null,
      icon: null,
      startUrl: '/',
    });
    expect(manifest.name).toBe('কর্ণফুলী জেনারেল হাসপাতাল (ডেমো)');
    expect(manifest.description).toBe(PLATFORM_INSTALL.description);
    expect(manifest.theme_color).toBe(PLATFORM_INSTALL.ground);
    expect(manifest.icons).toEqual(PLATFORM_INSTALL.icons);
  });

  it.each([
    ['a JPEG', { ...PADMA.icon, type: 'image/jpeg' }],
    ['not square', { ...PADMA.icon, width: 512, height: 300 }],
    ['too small', { ...PADMA.icon, width: 96, height: 96 }],
  ])('a logo that is %s is not given to a launcher', (_why, icon) => {
    const manifest = installManifest({ ...PADMA, icon: icon as InstallSubject['icon'] });
    expect(manifest.icons).toEqual(PLATFORM_INSTALL.icons);
    // Still the hospital's app in every other way.
    expect(manifest.name).toBe(PADMA.nameBn);
  });

  it('the smallest logo a launcher is given is the stated one', () => {
    const at = (pixels: number): boolean =>
      installIconUsable({ src: 'x', type: 'image/png', width: pixels, height: pixels });
    expect(at(INSTALL_ICON_MIN_PIXELS)).toBe(true);
    expect(at(INSTALL_ICON_MIN_PIXELS - 1)).toBe(false);
    expect(installIconUsable(null)).toBe(false);
  });
});

describe('a name under an icon', () => {
  it('is whole words from the front, as many as fit', () => {
    expect(shortInstallName('পদ্মা স্পেশালাইজড হাসপাতাল (ডেমো)')).toBe('পদ্মা');
    expect(shortInstallName('City Care Hospital')).toBe('City Care');
    expect(shortInstallName('MedLiveBD')).toBe('MedLiveBD');
    expect(shortInstallName('  শাপলা   জেনারেল  ')).toBe('শাপলা');
  });

  it('a first word too long for a launcher is cut, not dropped', () => {
    expect(shortInstallName('Bangabandhumedical College')).toBe('Bangabandhum');
    expect([...shortInstallName('Bangabandhumedical College')]).toHaveLength(12);
  });
});

describe('a PNG’s size is read from the file itself', () => {
  it('from its header', () => {
    expect(pngSize(pngHead(512, 512))).toEqual({ width: 512, height: 512 });
    expect(pngSize(pngHead(96, 40))).toEqual({ width: 96, height: 40 });
    expect(pngSize(pngHead(512, 512).toUpperCase())).toEqual({ width: 512, height: 512 });
  });

  it('and is nothing for what is not the start of a PNG', () => {
    expect(pngSize('')).toBeNull();
    expect(pngSize('ffd8ffe000104a4649460001')).toBeNull();
    expect(pngSize(pngHead(512, 512).slice(0, 40))).toBeNull();
    expect(pngSize(pngHead(0, 512))).toBeNull();
    // The right signature with something other than the header chunk after it.
    expect(pngSize(`89504e470d0a1a0a0000000d49444154${'0'.repeat(16)}`)).toBeNull();
  });
});
