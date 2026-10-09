import type { ReactNode } from 'react';
import { BriefcaseIcon, HomeIcon, LockIcon } from '@/components/icons';
import type { DocIconName } from './doc-types';

/**
 * One inline-SVG icon per document type, plus the few small glyphs this page
 * needs that the shared set lacks. Same construction as components/icons.tsx:
 * 24px grid, 1.75 stroke, round caps, `currentColor`, decorative by default.
 */

interface GlyphProps {
  className?: string;
}

function Glyph({ children, className }: GlyphProps & { children: ReactNode }) {
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
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

/** Paper with a folded corner, the base for several document icons. */
const SHEET = (
  <>
    <path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z" />
    <path d="M14 3v3.5A1.5 1.5 0 0 0 15.5 8H19" />
  </>
);

/** A sheet with a seal and ribbon: sworn and attested. */
function AffidavitGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <path d="M13.5 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21H11" />
      <path d="M13.5 3 19 8.5V12" />
      <path d="M13.5 3v3.5A1.5 1.5 0 0 0 15 8h4" />
      <path d="M9 12.5h4M9 16h1.5" />
      <circle cx="16.5" cy="16" r="3.25" />
      <path d="m15.2 16 1 1 1.8-2" />
      <path d="m15 19 -.7 2.3 2.2-1 2.2 1L18 19" />
    </Glyph>
  );
}

/** A sheet with a signature squiggle. */
function DeclarationGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      {SHEET}
      <path d="M9 11.5h6" />
      <path d="M8.5 17c.9-2.2 1.7-2.2 2 -.6.3 1.3 1 1.2 1.6-.3.4-1 1-1 1.4 0 .2.5.7.6 1.5.3" />
    </Glyph>
  );
}

/** Two overlapping rings: two parties and what they share. */
function BusinessGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <circle cx="8.75" cy="12" r="5.25" />
      <circle cx="15.25" cy="12" r="5.25" />
    </Glyph>
  );
}

/** A pie cut into shares. */
function PartnershipGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5V12h8.5" />
      <path d="m12 12-6 6" />
    </Glyph>
  );
}

/** A person with a check badge: permission granted. */
function AuthorizationGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <circle cx="9.5" cy="8" r="3.5" />
      <path d="M3.5 20c0-3.7 2.7-6 6-6 .9 0 1.7.15 2.5.5" />
      <circle cx="17.25" cy="17.25" r="4" />
      <path d="m15.5 17.3 1.2 1.2 2.1-2.4" />
    </Glyph>
  );
}

/** A clipboard with ticked lines: scope of work. */
function ServiceGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2.5" />
      <path d="M9 4.5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v.5" />
      <path d="M9 4.5h6" />
      <path d="m8.5 11 1.1 1.1 1.9-2.1M14 11.2h2.5" />
      <path d="m8.5 16 1.1 1.1 1.9-2.1M14 16.2h2.5" />
    </Glyph>
  );
}

/** A sealed envelope: a formal notice. */
function NoticeGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="m3.75 7.5 8.25 6 8.25-6" />
    </Glyph>
  );
}

/** A sheet with three dots: something else. */
function OtherGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      {SHEET}
      <path d="M9 14.5h.01M12 14.5h.01M15 14.5h.01" strokeWidth={2.6} />
    </Glyph>
  );
}

const TYPE_ICONS: Record<DocIconName, (props: GlyphProps) => ReactNode> = {
  rental: HomeIcon,
  employment: BriefcaseIcon,
  nda: LockIcon,
  affidavit: AffidavitGlyph,
  declaration: DeclarationGlyph,
  business: BusinessGlyph,
  partnership: PartnershipGlyph,
  authorization: AuthorizationGlyph,
  service: ServiceGlyph,
  notice: NoticeGlyph,
  other: OtherGlyph,
};

export function DocTypeIcon({ name, className }: { name: DocIconName } & GlyphProps) {
  const Icon = TYPE_ICONS[name];
  return <Icon className={className} />;
}

export function ArrowLeftGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <path d="M20 12H4M10 6l-6 6 6 6" />
    </Glyph>
  );
}

export function PrintGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <path d="M7 9V3.5h10V9" />
      <rect x="3.5" y="9" width="17" height="8" rx="2" />
      <path d="M7 14h10v6.5H7z" />
    </Glyph>
  );
}

export function PencilGlyph({ className }: GlyphProps) {
  return (
    <Glyph className={className}>
      <path d="m4 20 1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z" />
      <path d="m14.5 6.5 3 3" />
    </Glyph>
  );
}
