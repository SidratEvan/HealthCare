/**
 * Inline stroke icons (`ICO-01`, FRONTEND.md §4).
 *
 * Inline SVG, drawn on the same 24-unit grid at the same 1.8 stroke weight, so
 * they read as one set rather than as a collection. Two rules from the design
 * documents shape every one of them:
 *
 * **Never emoji.** FRONTEND.md §0.2 bans 🚑 🏥 ❤️ by name — they render as a
 * different typeface's artwork on every handset, which is the opposite of a
 * designed product.
 *
 * **Never alone in the patient app** (`ICO-03`). Older users do not decode
 * pictograms reliably, so every icon here appears beside its Bangla label and
 * carries `aria-hidden`: the word is what conveys the meaning, and the icon is
 * what makes it findable at a glance.
 *
 * `currentColor` throughout, so a tab that is selected recolours by changing
 * the text colour and nothing else.
 */

import type { ReactNode } from 'react';

interface IconProps {
  readonly size?: number;
}

function Svg({ children, size = 24 }: IconProps & { readonly children: ReactNode }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

// --- Bottom navigation (NAV-A) ---------------------------------------------

export function HomeIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M4 11l8-6 8 6v8H4z" />
    </Svg>
  );
}

export function SerialIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </Svg>
  );
}

export function RecordsIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M6 4h9l3 3v13H6z" />
      <path d="M9 12h6" />
    </Svg>
  );
}

export function ProfileIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.6 3.1-5.5 7-5.5s7 1.9 7 5.5" />
    </Svg>
  );
}

// --- Specialties (S-A-02's grid) -------------------------------------------

export function HeartIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M12 20s-7-4.4-7-9.2A4 4 0 0 1 12 8a4 4 0 0 1 7 2.8C19 15.6 12 20 12 20z" />
    </Svg>
  );
}

export function StethoscopeIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M9 3v5a3 3 0 0 0 6 0V3" />
      <path d="M12 11v4a4 4 0 0 0 8 0v-2" />
    </Svg>
  );
}

export function ChildIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <circle cx="12" cy="9" r="4" />
      <path d="M6 21c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    </Svg>
  );
}

export function GyneIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M7 4h10l-2 7 2 9H7l2-9z" />
    </Svg>
  );
}

export function BoneIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M8 3v7a4 4 0 0 0 8 0V3" />
      <path d="M10 21h4" />
    </Svg>
  );
}

export function EntIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M5 9a7 7 0 0 1 14 0c0 4-3 5-3 8a3 3 0 0 1-6 0" />
    </Svg>
  );
}

export function BrainIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5.8V16a3 3 0 0 0 4 2.8" />
      <path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 1 5.8V16a3 3 0 0 1-4 2.8" />
      <path d="M12 4v16" />
    </Svg>
  );
}

export function SkinIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M12 4c4 0 7 3 7 7 0 5-3 9-7 9s-7-4-7-9c0-4 3-7 7-7z" />
      <path d="M10 11h.01M14 13h.01M11 15h.01" />
    </Svg>
  );
}

/** A specialty's icon, by department code. */
export const SPECIALTY_ICON: Record<string, (props: IconProps) => ReactNode> = {
  CARD: HeartIcon,
  MED: StethoscopeIcon,
  PAED: ChildIcon,
  GYN: GyneIcon,
  ORTHO: BoneIcon,
  ENT: EntIcon,
  NEURO: BrainIcon,
  DERM: SkinIcon,
};

// --- Quick tiles ------------------------------------------------------------

export function BedIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M3 18V9h18v9" />
      <path d="M3 18h18" />
      <circle cx="8" cy="12" r="2" />
    </Svg>
  );
}

export function AmbulanceIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M3 16V8h11v8" />
      <path d="M14 11h4l3 3v2h-7" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </Svg>
  );
}

export function BloodIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M12 3s6 6.4 6 10a6 6 0 0 1-12 0c0-3.6 6-10 6-10z" />
    </Svg>
  );
}

export function ReportIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M10 12h6M10 16h6" />
    </Svg>
  );
}

// --- Chrome -----------------------------------------------------------------

export function EmergencyIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M12 4v16M4 12h16" />
    </Svg>
  );
}

export function ChevronIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M9 6l6 6-6 6" />
    </Svg>
  );
}

export function BackIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M15 6l-6 6 6 6" />
    </Svg>
  );
}

export function HospitalIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M4 21V8l8-5 8 5v13" />
      <path d="M9 21v-6h6v6" />
      <path d="M12 8v4M10 10h4" />
    </Svg>
  );
}

export function PinIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z" />
      <circle cx="12" cy="11" r="2.2" />
    </Svg>
  );
}
