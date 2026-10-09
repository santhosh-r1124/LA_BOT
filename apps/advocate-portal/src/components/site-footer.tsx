import Link from 'next/link';
import { ExternalLinkIcon, LockIcon } from '@/components/icons';
import { DIRECTORY_URL } from '@/lib/links';

const SETUP_NOTES = [
  'This portal runs on this computer. Nothing is hosted online.',
  'The public directory in this setup contains synthetic sample advocates. They are labelled as samples.',
  'Consultation requests, matters and earnings are planned and not built yet.',
];

/** Site footer: what the portal is, a few links, and what is real in this setup. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="max-w-(--page-max) mx-auto flex w-full flex-col gap-8 px-4 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.6fr)_minmax(0,1.2fr)] lg:gap-12">
          <section aria-labelledby="footer-about" className="flex flex-col gap-3">
            <Link href="/" className="brand w-fit" aria-label="Advocate Portal, home">
              <span className="brand-mark" aria-hidden="true">
                §
              </span>
              <span className="brand-name">Advocate Portal</span>
            </Link>
            <h2 id="footer-about" className="sr-only">
              About the portal
            </h2>
            <p className="max-w-[56ch] text-[0.8125rem] leading-relaxed">
              The advocate side of Legal Advisor, a source of general information about Indian law
              and a directory of advocates. A directory listing is not an endorsement, and Legal
              Advisor does not give legal advice.
            </p>
          </section>

          <nav aria-label="Footer" className="flex flex-col gap-3">
            <p className="caps">Pages</p>
            <ul className="flex flex-col gap-1.5">
              <li>
                <FooterLink href="/">Overview</FooterLink>
              </li>
              <li>
                <FooterLink href="/login">Log in</FooterLink>
              </li>
              <li>
                <FooterLink href="/register">Register</FooterLink>
              </li>
              <li>
                <a
                  href={DIRECTORY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-fg-muted hover:text-fg-strong -mx-1 inline-flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-sm underline-offset-4 hover:underline"
                >
                  Public directory
                  <ExternalLinkIcon className="size-3.5" />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            </ul>
          </nav>

          <section aria-labelledby="footer-setup" className="flex flex-col gap-3">
            <h2 id="footer-setup" className="caps flex items-center gap-1.5">
              <LockIcon className="size-3.5" />
              About this setup
            </h2>
            <ul className="flex flex-col gap-2 text-[0.8125rem] leading-relaxed">
              {SETUP_NOTES.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
        </div>

        <p className="border-line border-t pt-4 text-xs">
          For advocates. Anyone looking for general legal information should use the Legal Advisor
          site instead.
        </p>
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="text-fg-muted hover:text-fg-strong -mx-1 inline-block rounded-sm px-1 py-0.5 text-sm underline-offset-4 hover:underline"
    >
      {children}
    </Link>
  );
}
