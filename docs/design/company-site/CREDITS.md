# Company site — image and map sources

Every photograph and map layer on medlivebd.com, the licence it is used under,
and what was done to it. The site shows the same list to visitors at
`/{bn,en}/credits`, and each photograph carries a credit line on the page.

All files are served from the site itself (`frontend/site/public/photos`,
`frontend/site/src/content/bangladesh-map.ts`); nothing is hot-linked.

## Photographs (Wikimedia Commons)

Downloaded 12 October 2026 through the Commons API (2560 px or 3840 px
renditions), then cropped, resized and encoded to AVIF and WebP at three widths
each. Under CC BY-SA, those adapted files carry the same licence.

| File | Title | Author | Licence | Use | Adaptation |
|---|---|---|---|---|---|
| `padma-*` | [Padma Bridge, November 2021 (2)](https://commons.wikimedia.org/wiki/File:Padma_Bridge,_November2021(2).jpg) | Nahian Bin Shafiq | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Hero | Portrait crop of the right side (bridge and pier) |
| `dhaka-*` | [Dhaka Bangladesh January 2019](https://commons.wikimedia.org/wiki/File:Dhaka_Bangladesh_January_2019.jpg) | Silver Blu3 | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | Vision band | Resized only |
| `lab-*` | [Disease detectives analyze samples](https://commons.wikimedia.org/wiki/File:Disease_detectives_analyze_samples_(33874495694).jpg) | CDC Global | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | "For hospitals" card | Cropped to the bench, gloved hand and pipette; **no faces** |
| `paddy-*` | [Paddy cultivation, Chattogram, Bangladesh](https://commons.wikimedia.org/wiki/File:Paddy_cultivation_Chattogram,Bangladesh.jpg) | Anick Bhuiyan | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | "For patients" card | Portrait crop; the farmer's face is not visible |
| `nurses-*` | [Nipah Virus – Bangladesh](https://commons.wikimedia.org/wiki/File:Nipah_Virus_-_Bangladesh_(17055832802).jpg) (infection-control training) | CDC Global | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | Hospitals section | Tight crop on the nurses' caps; **excludes the wall portraits, the slide and the presenter** |
| `tea-*` | [Tea Garden near Srimangal, Sylhet, Bangladesh](https://commons.wikimedia.org/wiki/File:Tea_Garden_near_Srimangal,_Sylhet,_Bangladesh.jpg) | Xahidur Reza | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | Patients section | Resized only |
| `buriganga-*` | [Burigonga river in Dhaka](https://commons.wikimedia.org/wiki/File:Burigonga_river_in_dhaka.JPG) | Alaminnayemhang | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Closing invitation | Resized only; everyone is in silhouette |

What was deliberately not used, and why:

- **Unsplash and Pexels:** not used. Automated access is blocked on both, and
  the owner declined fetching them on 12 October.
- **Rejected for content, not licence:** press photographs with politicians,
  refugee-camp clinical scenes, and photographs where an identifiable patient
  is the subject.
- **Faces:** every person shown is a healthcare worker in a professional
  setting, a profile, a back view or a silhouette. None is identified by name
  on the site.
- **Rights beyond copyright:** Creative Commons licences cover copyright, not
  personality rights. The site states that the people shown are not
  MedLiveBD staff, customers or patients and imply no endorsement. **Before
  paid advertising** (as distinct from this informational site), replace the
  three photographs with recognisable faces (`nurses`, `lab`, `paddy`) with
  commissioned or model-released photography.

## Map (geoBoundaries)

| Layer | Source | Licence |
|---|---|---|
| Country outline (ADM0) and eight divisions (ADM1) | [geoBoundaries](https://www.geoboundaries.org/) gbOpen BGD, release `9469f09`; source geoBoundaries / Wikimedia Commons | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| 64 districts (ADM2) | geoBoundaries gbOpen BGD; source Bangladesh Bureau of Statistics (BBS) and OCHA ROAP | [CC BY 3.0 IGO](https://creativecommons.org/licenses/by/3.0/igo/), credited on the page |

The map is projected (equirectangular, corrected by cos 23.7°) and simplified
for the web by a one-off generator; the output is
`src/content/bangladesh-map.ts`. City points are the eight division
headquarters' public coordinates. The arcs from Dhaka are a **concept** and
are labelled as such. They show no hospitals, customers or coverage.

## Everything else

The product glimpses, ECG traces, stethoscope and icons are drawn in code for
this site; there is no third-party artwork. Fonts are Geist, Geist Mono and
Anek Bangla (SIL Open Font License), bundled at build time.
