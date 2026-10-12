import type { Feature, Locale } from '@/content/copy';
import type { ReactNode } from 'react';

/** A captured screen of the real product on seeded demonstration data (FR-SEC-08, FR-DEM-07). */
export function screen(key: Feature['key'], locale: Locale): string {
  return `/screens/${key}-${locale}.webp`;
}

export function BrowserFrame({
  src,
  alt,
  label,
}: {
  readonly src: string;
  readonly alt: string;
  readonly label?: string;
}): ReactNode {
  return (
    <div className="browser">
      <div className="browser-bar" aria-hidden="true">
        <span className="dc-dots">
          <i />
          <i />
          <i />
        </span>
        {label === undefined ? null : <span className="browser-url">{label}</span>}
      </div>
      <div className="browser-view">
        <img src={src} alt={alt} width="1440" height="900" loading="lazy" decoding="async" />
      </div>
    </div>
  );
}

export function PhoneFrame({
  src,
  alt,
}: {
  readonly src: string;
  readonly alt: string;
}): ReactNode {
  return (
    <div className="phone">
      <img src={src} alt={alt} width="390" height="844" loading="lazy" decoding="async" />
    </div>
  );
}
