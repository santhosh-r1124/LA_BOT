import type { SVGProps } from 'react';

/**
 * Icons the shared set does not have, drawn on the same 24px grid with the same
 * 1.75 stroke so they sit next to the shared ones without looking different.
 * Decorative: always `aria-hidden`.
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
    focusable: 'false' as const,
    'aria-hidden': true as const,
    ...props,
  };
}

/** Envelope. */
export function MailIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="m4 8 8 5.5L20 8" />
    </svg>
  );
}

/** Key. */
export function KeyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 8.5-8.5M16 6.5l2.5 2.5M14 8.5l1.5 1.5" />
    </svg>
  );
}

/** Door and arrow: the shared icon set has no log-out glyph. */
export function LogOutIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M9.5 4H7A2.5 2.5 0 0 0 4.5 6.5v11A2.5 2.5 0 0 0 7 20h2.5" />
      <path d="m15 8 4 4-4 4M19 12H9.5" />
    </svg>
  );
}

/** Left arrow, for "back" links. */
export function ArrowLeftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M20 12H4M10 6l-6 6 6 6" />
    </svg>
  );
}
