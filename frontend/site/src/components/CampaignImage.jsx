export function CampaignImage({ name, alt, priority = false, sizes = '100vw', className = '' }) {
  const widths = [640, 1200, 1920];
  const set = (format) =>
    widths.map((w) => `/campaign/${name}-${String(w)}.${format} ${String(w)}w`).join(', ');
  return (
    <picture className={`campaign-image ${className}`}>
      <source type="image/avif" srcSet={set('avif')} sizes={sizes} />
      <img
        src={`/campaign/${name}-1920.webp`}
        srcSet={set('webp')}
        sizes={sizes}
        width={1920}
        height={
          name === 'hero' || name === 'hero-collaboration' || name === 'atmosphere' ? 828 : 1280
        }
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
      />
    </picture>
  );
}
