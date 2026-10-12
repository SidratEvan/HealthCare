import type { ReactNode } from 'react';

/** Line icons drawn for the site on a 24-unit grid; decorative, so hidden from assistive technology. */
const PATHS = {
  arrow: 'M4 12h15m-6-6 6 6-6 6',
  diagonal: 'M7 17 17 7M8 7h9v9',
  check: 'm5 12.5 4.2 4.2L19 7',
  desk: 'M3 10h18M5 10v9m14-9v9M8 6.5a4 4 0 0 1 8 0V10H8z',
  doctor: 'M6 3v5a4 4 0 0 0 8 0V3M10 12v3a5 5 0 0 0 10 0v-2m0 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  bed: 'M3 7v12m0-4h18v4m0-4v-3a3 3 0 0 0-3-3h-7v6M7 12a2 2 0 1 0 0-.01',
  siren: 'M7 18v-6a5 5 0 0 1 10 0v6M5 18h14v3H5zM12 3v2m7 1-1.5 1.5M5 6l1.5 1.5',
  flask: 'M9 3h6m-5 0v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7 15h10',
  pill: 'm10.5 20.5-7-7a4.95 4.95 0 0 1 7-7l7 7a4.95 4.95 0 0 1-7 7zM7 10l7 7',
  chart: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm3 17h2',
  search: 'm20 20-4.2-4.2M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z',
  ticket: 'M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v8a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2zM14 6v12',
  pulse: 'M3 12h4l2.5-6 5 12 2.5-6h4',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  alert:
    'M12 9v4m0 3.5v.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  shield: 'M12 3 4.5 6v5.5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6zM9 12l2 2 4-4',
  lock: 'M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  key: 'M14.5 9.5a4 4 0 1 0-3.2 3.9L13 15h2v2h2v2h3v-3l-5.6-5.6a4 4 0 0 0 .1-.9zM8 9.5h.01',
  map: 'M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5zM9 4v13.5m6-11V20',
  people:
    'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20m16 0v-1.5a3.5 3.5 0 0 0-2.5-3.3M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm5.5-6.8a3.5 3.5 0 0 1 0 6.6',
  wifiOff:
    'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.7m4 0A10 10 0 0 1 19 13M2 9.5a15 15 0 0 1 4.3-2.8m4.2-1A15 15 0 0 1 22 9.5M12 20h.01',
  palette:
    'M12 21a9 9 0 1 1 9-9c0 2-1.6 3-3.5 3H15a2 2 0 0 0-1.5 3.3c.5.6.3 2.7-1.5 2.7zM7.5 11h.01M10 7h.01M14.5 7h.01M17 11h.01',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z',
  mail: 'M3 6h18v12H3zm0 0 9 7 9-7',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  play: 'M8 5.5v13l10.5-6.5z',
  pause: 'M8 5v14m8-14v14',
  plus: 'M12 5v14M5 12h14',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  layers: 'm12 3 9 5-9 5-9-5zm-9 9 9 5 9-5M3 16l9 5 9-5',
  heart:
    'M12 20s-7.5-4.6-9.2-9.4C1.6 7.2 3.8 4 7.1 4c2 0 3.6 1.1 4.9 2.9C13.3 5.1 14.9 4 16.9 4c3.3 0 5.5 3.2 4.3 6.6C19.5 15.4 12 20 12 20zM8 11h2l1-2 2 4 1-2h2',
  upload: 'M12 15V4m-4.5 4.5L12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  rehearse: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4M10 9.5v5l4-2.5z',
  rocket:
    'M5 15c-1.5 1.3-2 4-2 6 2 0 4.7-.5 6-2m-1-4a14 14 0 0 1 11-12 14 14 0 0 1-12 11m1 1-3-3 2-4h4m1 5v4l-4 2',
  sliders: 'M4 6h10m4 0h2M4 12h4m4 0h8M4 18h12m4 0h0M14 4v4M8 10v4M16 16v4',
  sparkle: 'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  className = 'icon',
}: {
  readonly name: IconName;
  readonly className?: string;
}): ReactNode {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <path d={PATHS[name]} />
    </svg>
  );
}
