/**
 * Inline stroke icons (`ICO-01`, FRONTEND.md §4, §0.5).
 *
 * One set, drawn on the same 24-unit grid at the same 1.75 stroke weight with
 * round caps and joins, so they read as one family rather than a collection.
 * They are the set on the approved Visual Direction 2 board. Two rules from
 * the design documents shape every one of them:
 *
 * **Never emoji.** FRONTEND.md §0.2 bans 🚑 🏥 ❤️ by name: they render as a
 * different typeface's artwork on every handset, which is the opposite of a
 * designed product.
 *
 * **Never alone in the patient app** (`ICO-03`). Older users do not decode
 * pictograms reliably, so every icon here appears beside its Bangla label and
 * carries `aria-hidden`: the word conveys the meaning, the icon makes it
 * findable at a glance.
 *
 * `currentColor` throughout, so a selected tab recolours by changing the text
 * colour and nothing else.
 */

import type { ReactNode } from 'react';

export interface IconProps {
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
      strokeWidth={1.75}
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
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />
    </Svg>
  );
}

export function SearchIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </Svg>
  );
}

/** A serial ticket: the সিরিয়াল tab. */
export function SerialIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v2.2a2.3 2.3 0 0 0 0 4.6v2.2a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-2.2a2.3 2.3 0 0 0 0-4.6z" />
      <path d="M14.5 5v2M14.5 10v1M14.5 14v2" />
    </Svg>
  );
}

export function RecordsIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M6.5 3.5h7.5l4 4V20a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z" />
      <path d="M13.5 3.5V8h4.5M9 12.5h6M9 16h4" />
    </Svg>
  );
}

/** The আরও tab. */
export function MoreIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
    </Svg>
  );
}

export function ProfileIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </Svg>
  );
}

export function UsersIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0M15.5 5.7a3 3 0 0 1 0 5.6M17.5 14.2a5.5 5.5 0 0 1 3 4.8" />
    </Svg>
  );
}

// --- The three main actions ------------------------------------------------

export function StethoscopeIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M5.5 3.5H5v5a4 4 0 0 0 8 0v-5h-.5" />
      <path d="M9 12.5v2a4.5 4.5 0 0 0 9 0v-2" />
      <circle cx="18" cy="10.5" r="2" />
    </Svg>
  );
}

/** A person and a live signal: আমার লাইভ সিরিয়াল. */
export function LiveIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <circle cx="10" cy="8.5" r="3.2" />
      <path d="M4 19.5a6 6 0 0 1 12 0" />
      <path d="M17.5 5.5a5 5 0 0 1 0 6.5M20 3.5a8.2 8.2 0 0 1 0 10.5" />
    </Svg>
  );
}

/** A beacon: জরুরি সহায়তা. Literal and calm (`ICO-04`), not a cartoon. */
export function EmergencyIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M7 17.5V13a5 5 0 0 1 10 0v4.5" />
      <path d="M5 17.5h14v3H5z" />
      <path d="M12 3v2M4.6 6.1 6 7.5M19.4 6.1 18 7.5M12 11v3.5" />
    </Svg>
  );
}

// --- Services ---------------------------------------------------------------

export function BedIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M3 6v13M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6" />
      <circle cx="7" cy="11.5" r="1.8" />
    </Svg>
  );
}

export function PillIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M10.6 19.6a4.2 4.2 0 0 1-6-6l9-9a4.2 4.2 0 0 1 6 6z" />
      <path d="m8.6 9.6 6 6" />
    </Svg>
  );
}

export function ReportIcon(props: IconProps): ReactNode {
  return <RecordsIcon {...props} />;
}

export function FlaskIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M9.5 3.5h5M10.5 3.5v5.3L5.3 18a1.7 1.7 0 0 0 1.5 2.5h10.4a1.7 1.7 0 0 0 1.5-2.5l-5.2-9.2V3.5M7.5 14.5h9" />
    </Svg>
  );
}

// --- Specialties ------------------------------------------------------------

export function HeartIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" />
      <path d="M7.5 12h2.5l1.3-2.2 1.9 4.2 1.3-2h2" />
    </Svg>
  );
}

export function ChildIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12.5" r="7.5" />
      <path d="M9.5 11.5h.01M14.5 11.5h.01M9.8 15a3 3 0 0 0 4.4 0M12 5c.2 1.2 1 1.8 2 1.8" />
    </Svg>
  );
}

export function GyneIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <circle cx="11" cy="5.5" r="2.3" />
      <path d="M8.5 20.5v-6.5l1-4.5h2.7c2.6 0 4.2 2.4 3.6 4.8l-.4 1.7h-3.4v4.5" />
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
      <path d="M12 6a2.6 2.6 0 0 0-5 .8 2.8 2.8 0 0 0-2.3 4.4 2.9 2.9 0 0 0 1.6 4.6A2.9 2.9 0 0 0 12 17.5zM12 6a2.6 2.6 0 0 1 5 .8 2.8 2.8 0 0 1 2.3 4.4 2.9 2.9 0 0 1-1.6 4.6A2.9 2.9 0 0 1 12 17.5V20" />
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

// --- Emergency problems (S-A-10) -------------------------------------------

export function FlameIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M12 3c3 3.5 6 6.5 6 10.5a6 6 0 0 1-12 0c0-2.4 1.2-4.2 2.6-5.6.3 1.8 1.2 3 2.4 3.4-.6-3 .2-5.8 1-8.3z" />
    </Svg>
  );
}

export function BandageIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M4.9 14.6 14.6 4.9a2.8 2.8 0 0 1 4 0l.5.5a2.8 2.8 0 0 1 0 4l-9.7 9.7a2.8 2.8 0 0 1-4 0l-.5-.5a2.8 2.8 0 0 1 0-4z" />
      <path d="M10.5 12h.01M12 10.5h.01M13.5 12h.01M12 13.5h.01" />
    </Svg>
  );
}

export function BreathIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M3.5 9h10a2.5 2.5 0 1 0-2.5-2.5M3.5 13h14a2.5 2.5 0 1 1-2.5 2.5M3.5 17h6" />
    </Svg>
  );
}

export function DotsIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth={3} />
    </Svg>
  );
}

export function PhoneIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M6.6 3.5h2.6l1.3 4-1.9 1.4a11 11 0 0 0 6.5 6.5l1.4-1.9 4 1.3v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z" />
    </Svg>
  );
}

// --- Records, account, settings --------------------------------------------

export function QrIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <path d="M14 14h2.5v2.5H14zM18.5 18.5H20V20h-1.5zM14 19.5h2M19.5 14v2" />
    </Svg>
  );
}

export function EyeIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </Svg>
  );
}

export function ShieldIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M12 3.5 19 6v5.5c0 4.4-3 8-7 9-4-1-7-4.6-7-9V6z" />
      <path d="m9 12 2 2 4-4" />
    </Svg>
  );
}

export function GlobeIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5s1.1-5.9 3.6-8.5z" />
    </Svg>
  );
}

export function HelpIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.5a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.6M12 17h.01" />
    </Svg>
  );
}

export function InfoIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8h.01" />
    </Svg>
  );
}

export function LogoutIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M14.5 4.5h3A1.5 1.5 0 0 1 19 6v12a1.5 1.5 0 0 1-1.5 1.5h-3M10 8l-4 4 4 4M6 12h9" />
    </Svg>
  );
}

// --- Small furniture --------------------------------------------------------

export function ChevronIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="m9.5 6 6 6-6 6" />
    </Svg>
  );
}

export function BackIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />
    </Svg>
  );
}

export function ClockIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  );
}

export function SmsIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M4.5 5.5h15a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1h-9l-4.5 3.5V16h-1.5a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z" />
      <path d="M8.5 10.8h7" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M7 7l10 10M17 7 7 17" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="m5.5 12.5 4 4 9-9" />
    </Svg>
  );
}

export function HospitalIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M4.5 20.5h15M6 20.5V5.5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v15M12 7.5v4M10 9.5h4M10 20.5v-4h4v4" />
    </Svg>
  );
}

export function PinIcon(props: IconProps): ReactNode {
  return (
    <Svg {...props}>
      <path d="M12 21s-6.5-5.6-6.5-10.8a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z" />
      <circle cx="12" cy="10.3" r="2.2" />
    </Svg>
  );
}
