/**
 * Every photograph on the site, with the licence it is used under. Files live
 * in `public/photos/<key>-<width>.{avif,webp}`, cropped and resized from the
 * Wikimedia Commons originals named here (docs/design/company-site/CREDITS.md).
 * The people shown are not MedLiveBD staff, customers or patients.
 */
export type PhotoKey = 'padma' | 'dhaka' | 'lab' | 'paddy' | 'nurses' | 'tea' | 'buriganga';

export interface Photo {
  readonly key: PhotoKey;
  /** Widths encoded, smallest first; the last is the largest file. */
  readonly widths: readonly number[];
  /** Intrinsic size of the largest file, for layout without shift. */
  readonly width: number;
  readonly height: number;
  /** Shown while the image loads. */
  readonly tone: string;
  readonly title: string;
  readonly author: string;
  readonly source: string;
  readonly licence: string;
  readonly licenceUrl: string;
}

export const PHOTOS: Record<PhotoKey, Photo> = {
  padma: {
    key: 'padma',
    widths: [480, 800, 1200],
    width: 1200,
    height: 1500,
    tone: '#98b8c8',
    title: 'Padma Bridge, November 2021 (2)',
    author: 'Nahian Bin Shafiq',
    source: 'https://commons.wikimedia.org/wiki/File:Padma_Bridge,_November2021(2).jpg',
    licence: 'CC BY-SA 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
  dhaka: {
    key: 'dhaka',
    widths: [800, 1400, 2200],
    width: 2200,
    height: 1039,
    tone: '#a88868',
    title: 'Dhaka Bangladesh January 2019',
    author: 'Silver Blu3',
    source: 'https://commons.wikimedia.org/wiki/File:Dhaka_Bangladesh_January_2019.jpg',
    licence: 'CC BY 2.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/2.0/',
  },
  lab: {
    key: 'lab',
    widths: [480, 800, 1200],
    width: 1200,
    height: 1120,
    tone: '#989898',
    title: 'Disease detectives analyze samples',
    author: 'CDC Global',
    source:
      'https://commons.wikimedia.org/wiki/File:Disease_detectives_analyze_samples_(33874495694).jpg',
    licence: 'CC BY 2.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/2.0/',
  },
  paddy: {
    key: 'paddy',
    widths: [480, 800, 1100],
    width: 1100,
    height: 1375,
    tone: '#689858',
    title: 'Paddy cultivation, Chattogram, Bangladesh',
    author: 'Anick Bhuiyan',
    source: 'https://commons.wikimedia.org/wiki/File:Paddy_cultivation_Chattogram,Bangladesh.jpg',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  nurses: {
    key: 'nurses',
    widths: [640, 1100],
    width: 1100,
    height: 1056,
    tone: '#787878',
    title: 'Nipah Virus – Bangladesh (infection-control training)',
    author: 'CDC Global',
    source: 'https://commons.wikimedia.org/wiki/File:Nipah_Virus_-_Bangladesh_(17055832802).jpg',
    licence: 'CC BY 2.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/2.0/',
  },
  tea: {
    key: 'tea',
    widths: [640, 1000, 1400],
    width: 1400,
    height: 957,
    tone: '#4d6b2f',
    title: 'Tea Garden near Srimangal, Sylhet, Bangladesh',
    author: 'Xahidur Reza',
    source:
      'https://commons.wikimedia.org/wiki/File:Tea_Garden_near_Srimangal,_Sylhet,_Bangladesh.jpg',
    licence: 'CC BY 2.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/2.0/',
  },
  buriganga: {
    key: 'buriganga',
    widths: [800, 1280, 1920],
    width: 1920,
    height: 1271,
    tone: '#3a2c14',
    title: 'Burigonga river in Dhaka',
    author: 'Alaminnayemhang',
    source: 'https://commons.wikimedia.org/wiki/File:Burigonga_river_in_dhaka.JPG',
    licence: 'CC BY-SA 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
};

/** The order photographs appear in, for the credits page. */
export const PHOTO_ORDER: readonly PhotoKey[] = [
  'padma',
  'dhaka',
  'lab',
  'paddy',
  'nurses',
  'tea',
  'buriganga',
];
