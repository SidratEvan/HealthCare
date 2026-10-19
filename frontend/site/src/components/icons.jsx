/** Line icons drawn for the site on a 24-unit grid; decorative, so hidden from assistive technology. */
const PATHS = {
  /** Goes on to another page of this site. */
  arrow: 'M4 12h15m-6-6 6 6-6 6',
  /** Leaves for another site, or opens an app (email, the patient app). */
  external: 'M7 17 17 7M8 7h9v9',
  up: 'M12 19V5m-6 6 6-6 6 6',
  mail: 'M3 6h18v12H3zm0 0 9 7 9-7',
  phone:
    'M5 4h3.5l1.7 4.3-2.2 1.4a11 11 0 0 0 6.3 6.3l1.4-2.2L20 15.5V19a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z',
};

export function Icon({ name, className = 'icon' }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <path d={PATHS[name]} />
    </svg>
  );
}
