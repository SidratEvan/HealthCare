import { ImageResponse } from 'next/og';

/** The share card for a link to either edition (S-C-01). Latin only: no font is fetched. */
export const alt = 'MedLiveBD — healthcare technology for Bangladesh';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// The image renderer cannot read CSS custom properties, so the card carries
// site.css's --ink, --paper and --teal by value.
const INK = '#0b1a33';
const PAPER = '#ffffff';
const TEAL = '#01ceb8';

export function generateStaticParams(): { locale: string }[] {
  return [{ locale: 'bn' }, { locale: 'en' }];
}

/** Built once into a file, so a static host can serve it (`SITE_EXPORT`). */
export const dynamic = 'force-static';

export default function OpengraphImage(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 80,
        background: INK,
        color: PAPER,
      }}
    >
      <div style={{ display: 'flex', fontSize: 36, fontWeight: 700, letterSpacing: -0.5 }}>
        MedLiveBD
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', fontSize: 68, fontWeight: 700, lineHeight: 1.08 }}>
          A Connected Healthcare Ecosystem for a Healthier Bangladesh
        </div>
        <div style={{ display: 'flex', marginTop: 28, fontSize: 32, color: TEAL }}>
          Live hospital operations for Bangladesh
        </div>
      </div>
    </div>,
    size,
  );
}
