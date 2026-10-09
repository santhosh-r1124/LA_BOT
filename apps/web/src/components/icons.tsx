import type { ReactNode, SVGProps } from 'react';

/**
 * Inline SVG icon set for the design system.
 *
 * - 24px grid, 1.75 stroke, round caps/joins, `currentColor` (so an icon takes
 *   the colour of the text around it and follows the theme).
 * - Size comes from `className` (`h-4 w-4`, `size-5`, …). With no size class an
 *   icon is `1em` square and scales with the surrounding text.
 * - Decorative by default (`aria-hidden`). Pass `title` to give it an accessible
 *   name (renders `<title>`, `role="img"` and `aria-label`).
 *
 * This file is intentionally identical in apps/web and apps/advocate-portal.
 * Edit both together.
 */

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children' | 'title'> {
  /** Accessible name. Omit for purely decorative icons. */
  title?: string;
}

export type IconComponent = (props: IconProps) => ReactNode;

function createIcon(displayName: string, paths: ReactNode, baseClassName?: string): IconComponent {
  const Icon = ({ title, className, ...rest }: IconProps) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
      className={[baseClassName, className].filter(Boolean).join(' ') || undefined}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {paths}
    </svg>
  );
  Icon.displayName = displayName;
  return Icon;
}

/** Scales of justice. */
export const ScaleIcon = createIcon(
  'ScaleIcon',
  <>
    <path d="M12 3.5v17" />
    <path d="M8 21h8" />
    <path d="M5 7.5h14" />
    <path d="M5 7.5l-3 8M5 7.5l3 8M19 7.5l-3 8M19 7.5l3 8" />
    <path d="M2 15.5h6a3 3 0 0 1-6 0z" />
    <path d="M16 15.5h6a3 3 0 0 1-6 0z" />
  </>,
);

export const ChatIcon = createIcon(
  'ChatIcon',
  <>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-3.5 4v-4A2.5 2.5 0 0 1 4 13.5z" />
    <path d="M8 8.5h8M8 11.5h5" />
  </>,
);

export const DocumentIcon = createIcon(
  'DocumentIcon',
  <>
    <path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z" />
    <path d="M14 3v3.5A1.5 1.5 0 0 0 15.5 8H19" />
    <path d="M9 12.5h6M9 16h4" />
  </>,
);

/** Two people: a directory or a team. */
export const UsersIcon = createIcon(
  'UsersIcon',
  <>
    <circle cx="9" cy="8" r="3.25" />
    <path d="M3 19.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
    <circle cx="17.25" cy="8.75" r="2.5" />
    <path d="M16.75 14.25c2.6 0 4.5 1.7 4.5 4.5" />
  </>,
);

/** One advocate: head, shoulders and the white bands of a barrister's collar. */
export const AdvocateIcon = createIcon(
  'AdvocateIcon',
  <>
    <circle cx="12" cy="7.5" r="3.5" />
    <path d="M5 20.5c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5" />
    <path d="M10.6 14.3v3M13.4 14.3v3" />
  </>,
);

export const SearchIcon = createIcon(
  'SearchIcon',
  <>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M15.5 15.5 21 21" />
  </>,
);

export const ShieldIcon = createIcon(
  'ShieldIcon',
  <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8 7.5 9.5 4.4-1.5 7.5-4.9 7.5-9.5V6z" />,
);

export const SunIcon = createIcon(
  'SunIcon',
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </>,
);

export const MoonIcon = createIcon(
  'MoonIcon',
  <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.2 8.2 0 1 0 10.2 10.2z" />,
);

export const MenuIcon = createIcon('MenuIcon', <path d="M4 7h16M4 12h16M4 17h16" />);

export const CloseIcon = createIcon('CloseIcon', <path d="M6 6l12 12M18 6 6 18" />);

export const CheckIcon = createIcon('CheckIcon', <path d="m5 12.5 4.5 4.5L19 7.5" />);

export const AlertIcon = createIcon(
  'AlertIcon',
  <>
    <path d="M10.3 4.2 2.9 17.2a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
    <path d="M12 9.5v4M12 17h.01" />
  </>,
);

export const InfoIcon = createIcon(
  'InfoIcon',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </>,
);

export const ArrowRightIcon = createIcon('ArrowRightIcon', <path d="M4 12h16M14 6l6 6-6 6" />);

export const CopyIcon = createIcon(
  'CopyIcon',
  <>
    <rect x="8.5" y="8.5" width="12" height="12" rx="2.5" />
    <path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" />
  </>,
);

export const DownloadIcon = createIcon(
  'DownloadIcon',
  <>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
    <path d="M4.5 19.5h15" />
  </>,
);

export const MapPinIcon = createIcon(
  'MapPinIcon',
  <>
    <path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0c0 5.4 6.5 11 6.5 11z" />
    <circle cx="12" cy="10" r="2.5" />
  </>,
);

export const BriefcaseIcon = createIcon(
  'BriefcaseIcon',
  <>
    <rect x="3.5" y="7.5" width="17" height="12" rx="2.5" />
    <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5" />
    <path d="M3.5 13h17" />
  </>,
);

/** A globe: languages spoken. */
export const LanguageIcon = createIcon(
  'LanguageIcon',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3z" />
  </>,
);

/** Generic spinner (an open ring). Rotates via the design system's .icon-spin. */
export const SpinnerIcon = createIcon('SpinnerIcon', <path d="M12 3a9 9 0 1 0 9 9" />, 'icon-spin');

export const ExternalLinkIcon = createIcon(
  'ExternalLinkIcon',
  <>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
  </>,
);

export const PhoneIcon = createIcon(
  'PhoneIcon',
  <path d="M5.5 3.5h3l1.5 4-2 1.3a11 11 0 0 0 5.2 5.2l1.3-2 4 1.5v3a2 2 0 0 1-2 2A13 13 0 0 1 3.5 5.5a2 2 0 0 1 2-2z" />,
);

export const ChevronDownIcon = createIcon('ChevronDownIcon', <path d="m6 9 6 6 6-6" />);

export const FilterIcon = createIcon('FilterIcon', <path d="M3.5 5h17l-6.5 7.5V19l-4 2v-8.5z" />);

/** Judge's gavel and sound block. */
export const GavelIcon = createIcon(
  'GavelIcon',
  <>
    <path d="M11 6.5 14.5 3 21 9.5 17.5 13z" />
    <path d="M14.25 9.75 5 19" />
    <path d="M12.5 21h8" />
  </>,
);

export const HomeIcon = createIcon(
  'HomeIcon',
  <>
    <path d="M4 11 12 4l8 7" />
    <path d="M6 9.5V19a1.5 1.5 0 0 0 1.5 1.5H10V15h4v5.5h2.5A1.5 1.5 0 0 0 18 19V9.5" />
  </>,
);

export const LockIcon = createIcon(
  'LockIcon',
  <>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    <path d="M12 14.5v2" />
  </>,
);

export const RefreshIcon = createIcon(
  'RefreshIcon',
  <>
    <path d="M20 11.5A8 8 0 0 0 5.8 7M4 4v4h4" />
    <path d="M4 12.5A8 8 0 0 0 18.2 17M20 20v-4h-4" />
  </>,
);

export const EyeIcon = createIcon(
  'EyeIcon',
  <>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);

/** Every icon by short name, for dynamic use: `const I = Icons[name]`. */
export const Icons = {
  Scale: ScaleIcon,
  Chat: ChatIcon,
  Document: DocumentIcon,
  Users: UsersIcon,
  Advocate: AdvocateIcon,
  Search: SearchIcon,
  Shield: ShieldIcon,
  Sun: SunIcon,
  Moon: MoonIcon,
  Menu: MenuIcon,
  Close: CloseIcon,
  Check: CheckIcon,
  Alert: AlertIcon,
  Info: InfoIcon,
  ArrowRight: ArrowRightIcon,
  Copy: CopyIcon,
  Download: DownloadIcon,
  MapPin: MapPinIcon,
  Briefcase: BriefcaseIcon,
  Language: LanguageIcon,
  Spinner: SpinnerIcon,
  ExternalLink: ExternalLinkIcon,
  Phone: PhoneIcon,
  ChevronDown: ChevronDownIcon,
  Filter: FilterIcon,
  Gavel: GavelIcon,
  Home: HomeIcon,
  Lock: LockIcon,
  Refresh: RefreshIcon,
  Eye: EyeIcon,
} as const;

export type IconName = keyof typeof Icons;
