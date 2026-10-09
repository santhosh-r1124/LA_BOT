import type { ReactNode, SVGProps } from 'react';
import type { IconComponent, IconProps } from '@/components/icons';

/**
 * Icons the shared set does not have, drawn on the same 24px grid with the same
 * stroke so they sit next to the shared ones. Decorative unless given a `title`.
 */
function createIcon(displayName: string, paths: ReactNode): IconComponent {
  const Icon = ({ title, className, ...rest }: IconProps) => {
    const props: SVGProps<SVGSVGElement> = rest;
    return (
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
        className={className}
        {...props}
      >
        {title ? <title>{title}</title> : null}
        {paths}
      </svg>
    );
  };
  Icon.displayName = displayName;
  return Icon;
}

/** A display, for "follow the system" theme. */
export const MonitorIcon = createIcon(
  'MonitorIcon',
  <>
    <rect x="3" y="4.5" width="18" height="12" rx="2.5" />
    <path d="M8.5 20h7M12 16.5V20" />
  </>,
);

/** Door and arrow. */
export const LogOutIcon = createIcon(
  'LogOutIcon',
  <>
    <path d="M9.5 4H7A2.5 2.5 0 0 0 4.5 6.5v11A2.5 2.5 0 0 0 7 20h2.5" />
    <path d="m15 8 4 4-4 4M19 12H9.5" />
  </>,
);

/** Clock face. */
export const ClockIcon = createIcon(
  'ClockIcon',
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </>,
);

/** An empty circle: a step or checklist item not yet done. */
export const CircleIcon = createIcon('CircleIcon', <circle cx="12" cy="12" r="8.5" />);

/** Calendar page. */
export const CalendarIcon = createIcon(
  'CalendarIcon',
  <>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </>,
);

/** Rupee sign. */
export const RupeeIcon = createIcon(
  'RupeeIcon',
  <>
    <path d="M7 5.5h10M7 10h10" />
    <path d="M9 5.5h1.5a4 4 0 0 1 0 8H7l8 5.5" />
  </>,
);

/** An inbox tray. */
export const InboxIcon = createIcon(
  'InboxIcon',
  <>
    <path d="M3.5 13.5 6 5.5h12l2.5 8" />
    <path d="M3.5 13.5V18a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5v-4.5h-5.5a3 3 0 0 1-6 0z" />
  </>,
);

/** A closed folder. */
export const FolderIcon = createIcon(
  'FolderIcon',
  <path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" />,
);

/** An eye with a slash: hide the password. */
export const EyeOffIcon = createIcon(
  'EyeOffIcon',
  <>
    <path d="M10.6 5.2A9.6 9.6 0 0 1 12 5c5 0 8.5 4.4 9.5 7a12.5 12.5 0 0 1-2.6 3.9" />
    <path d="M6.3 6.8A12.7 12.7 0 0 0 2.5 12c1 2.6 4.5 7 9.5 7a9.4 9.4 0 0 0 4-.9" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3.5 3.5l17 17" />
  </>,
);

/** A pencil. */
export const EditIcon = createIcon(
  'EditIcon',
  <>
    <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z" />
    <path d="m14.5 7.5 3 3" />
  </>,
);
