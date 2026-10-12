import { ImageResponse } from 'next/og';

/** The share card for a link to either edition (S-C-01). Latin only: no font is fetched. */
export const alt = 'MedLiveBD — healthcare technology for Bangladesh';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// The image renderer cannot read CSS custom properties, so the card carries
// site.css's --navy, --paper and --mint by value.
const NAVY = '#122430';
const PAPER = '#f8f9f6';
const MINT = '#c9f1da';

export function generateStaticParams(): { locale: string }[] {
  return [{ locale: 'bn' }, { locale: 'en' }];
}

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
        background: NAVY,
        color: PAPER,
      }}
    >
      <div style={{ display: 'flex', fontSize: 36, fontWeight: 700, letterSpacing: -0.5 }}>
        MedLiveBD
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', fontSize: 92, fontWeight: 700, lineHeight: 1.02 }}>
          A clearer picture of care.
        </div>
        <div style={{ display: 'flex', marginTop: 28, fontSize: 32, color: MINT }}>
          Live hospital operations, connected to the patient · Bangladesh
        </div>
      </div>
    </div>,
    size,
  );
}
