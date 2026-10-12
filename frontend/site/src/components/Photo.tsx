import { PHOTOS } from '@/content/photos';

import type { PhotoKey } from '@/content/photos';
import type { CSSProperties, ReactNode } from 'react';

/**
 * A licensed photograph from this site's own files: AVIF with a WebP fallback,
 * responsive widths, intrinsic size to prevent layout shift, its average tone
 * shown while it loads. Below-the-fold images load lazily.
 */
export function Photo({
  name,
  alt,
  sizes,
  className,
  priority = false,
  position,
}: {
  readonly name: PhotoKey;
  readonly alt: string;
  readonly sizes: string;
  readonly className?: string;
  readonly priority?: boolean;
  /** CSS object-position, for the crop each layout wants. */
  readonly position?: string;
}): ReactNode {
  const photo = PHOTOS[name];
  const set = (format: 'avif' | 'webp'): string =>
    photo.widths.map((w) => `/photos/${name}-${String(w)}.${format} ${String(w)}w`).join(', ');
  const largest = photo.widths[photo.widths.length - 1] ?? photo.width;
  const style: CSSProperties = { backgroundColor: photo.tone };
  if (position !== undefined) style.objectPosition = position;
  return (
    <picture className={className}>
      <source type="image/avif" srcSet={set('avif')} sizes={sizes} />
      <img
        src={`/photos/${name}-${String(largest)}.webp`}
        srcSet={set('webp')}
        sizes={sizes}
        alt={alt}
        width={photo.width}
        height={photo.height}
        loading={priority ? 'eager' : 'lazy'}
        decoding={priority ? 'sync' : 'async'}
        fetchPriority={priority ? 'high' : 'auto'}
        style={style}
      />
    </picture>
  );
}

/** A small, quiet credit line laid over a photograph's corner. */
export function PhotoCredit({
  name,
  label,
  place,
}: {
  readonly name: PhotoKey;
  readonly label: string;
  readonly place?: string;
}): ReactNode {
  const photo = PHOTOS[name];
  return (
    <span className="photo-credit">
      {place === undefined ? null : <b>{place}</b>}
      {label}: {photo.author} · {photo.licence}
    </span>
  );
}
