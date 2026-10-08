import type { SVGProps } from 'react';

/**
 * Icons used only by the chat page, drawn to match components/icons.tsx
 * (24px grid, 1.75 stroke, round caps, currentColor, decorative).
 */
function base(props: SVGProps<SVGSVGElement>) {
  return {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: '0 0 24 24',
    width: '1em',
    height: '1em',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    focusable: false,
    'aria-hidden': true,
    ...props,
  };
}

/** Arrow pointing up: send. */
export function SendIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12 19V5" />
      <path d="M5.5 11.5 12 5l6.5 6.5" />
    </svg>
  );
}

/** Filled square: stop. */
export function StopIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" />
    </svg>
  );
}

export function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Clock with a back arrow: conversation history. */
export function HistoryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.5 4.5v4h4" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

/** Open book: the legal library. */
export function LibraryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12 6.5C10.5 5.3 8.3 4.8 4.5 5v12.5c3.8-.2 6 .3 7.5 1.5 1.5-1.2 3.7-1.7 7.5-1.5V5c-3.8-.2-6 .3-7.5 1.5z" />
      <path d="M12 6.5V19" />
    </svg>
  );
}

/** A page with lines of text: one passage from the library. */
export function PassageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M5 4.5h10l4 4v11H5z" />
      <path d="M15 4.5v4h4" />
      <path d="M8.5 12.5h7M8.5 15.5h5" />
    </svg>
  );
}
