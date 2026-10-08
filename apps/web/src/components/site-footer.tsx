import { MANDATORY_DISCLAIMER } from '@legal-platform/shared';
import Link from 'next/link';
import { LockIcon } from '@/components/icons';

const LINKS = [
  { href: '/chat', label: 'Legal chat' },
  { href: '/documents', label: 'Documents' },
  { href: '/advocates', label: 'Advocates' },
  { href: '/login', label: 'Log in' },
];

const SETUP_NOTES = [
  'This instance runs locally on this computer. Nothing is hosted online.',
  'AI answers need a provider key on the server; without one you get matching passages and templates.',
  'Anything marked sample or fixture is test data, not real law or real advocates.',
];

/** Site footer: the mandatory disclaimer, a few links and what this setup is. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="max-w-(--page-max) mx-auto flex w-full flex-col gap-8 px-4 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,0.6fr)_minmax(0,1.1fr)] lg:gap-12">
          <section aria-labelledby="footer-disclaimer" className="flex flex-col gap-3">
            <Link href="/" className="brand w-fit" aria-label="Legal Advisor, home">
              <span className="brand-mark" aria-hidden="true">
                §
              </span>
              <span className="brand-name">Legal Advisor</span>
            </Link>
            <h2 id="footer-disclaimer" className="sr-only">
              Disclaimer
            </h2>
            <p className="max-w-[62ch] text-[0.8125rem] leading-relaxed">{MANDATORY_DISCLAIMER}</p>
          </section>

          <nav aria-label="Footer" className="flex flex-col gap-3">
            <p className="caps">Pages</p>
            <ul className="flex flex-col gap-1.5">
              {LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-fg-muted hover:text-fg-strong -mx-1 inline-block rounded-sm px-1 py-0.5 text-sm underline-offset-4 hover:underline"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
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
          Legal Advisor gives general information about Indian law. It is not legal advice.
        </p>
      </div>
    </footer>
  );
}
