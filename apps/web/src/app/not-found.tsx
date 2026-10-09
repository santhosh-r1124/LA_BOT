import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRightIcon,
  ChatIcon,
  DocumentIcon,
  HomeIcon,
  UsersIcon,
  type IconComponent,
} from '@/components/icons';

export const metadata: Metadata = { title: 'Page not found' };

const SUGGESTIONS: Array<{ href: string; Icon: IconComponent; title: string; text: string }> = [
  {
    href: '/chat',
    Icon: ChatIcon,
    title: 'Ask a legal question',
    text: 'Get matching passages and a risk level.',
  },
  {
    href: '/documents',
    Icon: DocumentIcon,
    title: 'Draft a document',
    text: 'A labelled draft with notes to review.',
  },
  {
    href: '/advocates',
    Icon: UsersIcon,
    title: 'Find an advocate',
    text: 'Search by practice area, state and language.',
  },
];

export default function NotFound() {
  return (
    <main className="hero-bg">
      {/* The ghosted § sits behind the page title on wide screens only; on phones
          and tablets it would show through the list of links. */}
      <span className="hero-sign max-lg:hidden" aria-hidden="true">
        §
      </span>
      <div className="page page-narrow flex flex-col items-start gap-6 pb-16 pt-14 sm:pt-20">
        <p className="eyebrow eyebrow-rule">Error 404</p>
        <h1 className="display display-lg">
          We could not find <em>that page.</em>
        </h1>
        <p className="lede">
          The address may be mistyped, or the page may have moved. These are the places people
          usually come here for.
        </p>

        <ul className="list w-full" aria-label="Where to go instead">
          {SUGGESTIONS.map(({ href, Icon, title, text }) => (
            <li key={href} className="!p-0">
              <Link href={href} className="list-row list-row-interactive w-full !py-4">
                <span className="border-accent-line bg-accent-soft text-accent-strong rounded-item grid size-10 shrink-0 place-items-center border">
                  <Icon className="size-5" />
                </span>
                <span className="list-row-main">
                  <span className="list-row-title block">{title}</span>
                  <span className="list-row-meta block">{text}</span>
                </span>
                <ArrowRightIcon className="text-fg-subtle size-5 shrink-0" />
              </Link>
            </li>
          ))}
        </ul>

        <Link href="/" className="btn btn-primary btn-lg">
          <HomeIcon />
          Back to the home page
        </Link>
      </div>
    </main>
  );
}
