'use client';

import { MANDATORY_DISCLAIMER } from '@legal-platform/shared';
import Link from 'next/link';
import { LockIcon } from '@/components/icons';
import { usePlatformStatus } from '@/lib/status-client';
import { aiMode } from '@/lib/status-summary';

const LINKS = [
  { href: '/chat', label: 'Legal chat' },
  { href: '/documents', label: 'Documents' },
  { href: '/advocates', label: 'Advocates' },
  { href: '/login', label: 'Log in' },
];

/**
 * Shown while AI answers are off (and until the server has said otherwise).
 * The verbatim FRD text below talks about "this AI", which would be untrue here.
 */
const LIBRARY_DISCLAIMER =
  'This service provides general legal information drawn from a legal library, and ' +
  'template drafts for common documents. It does not constitute legal advice, does ' +
  'not establish an advocate-client relationship, and should not replace advice from ' +
  'a qualified legal professional. Laws and procedures may vary by jurisdiction and ' +
  'circumstances.';

type FooterMode = 'checking' | 'ai' | 'off' | 'unreachable';

/** What the footer should say about AI, taken from the live platform status. */
function useFooterMode(): FooterMode {
  const { state } = usePlatformStatus();
  if (state.kind === 'loading') return 'checking';
  if (state.kind === 'error') return 'unreachable';
  return aiMode(state.status) === 'ai' ? 'ai' : 'off';
}

const MODE_NOTE: Record<FooterMode, string> = {
  checking: 'Checking whether AI answers are on.',
  ai: 'AI answers are on. Replies are written from the library passages found and list their sources.',
  off: 'AI answers are switched off on this computer, so you get matching passages and template drafts.',
  unreachable: 'The server is not answering, so no answers are available right now.',
};

/**
 * Site footer: the disclaimer, a few links and what this setup is. The verbatim
 * mandatory disclaimer (it describes AI-generated content) appears only while AI
 * answers are actually on; otherwise a neutral version says the same thing
 * without claiming there is an AI.
 */
export function SiteFooter() {
  const mode = useFooterMode();

  return (
    <footer className="site-footer">
      <div className="max-w-(--page-max) mx-auto flex w-full flex-col gap-8 px-4 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,0.6fr)_minmax(0,1.1fr)] lg:gap-12">
          <section aria-labelledby="footer-disclaimer" className="flex flex-col gap-3">
            <Link href="/" className="brand min-h-10 w-fit" aria-label="Legal Advisor, home">
              <span className="brand-mark" aria-hidden="true">
                §
              </span>
              <span className="brand-name">Legal Advisor</span>
            </Link>
            <h2 id="footer-disclaimer" className="sr-only">
              Disclaimer
            </h2>
            <p className="max-w-[62ch] text-[0.8125rem] leading-relaxed">
              {mode === 'ai' ? MANDATORY_DISCLAIMER : LIBRARY_DISCLAIMER}
            </p>
          </section>

          <nav aria-label="Footer" className="flex flex-col gap-2">
            <p className="caps">Pages</p>
            <ul className="flex flex-col">
              {LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-fg-muted hover:text-fg-strong -mx-1 inline-flex min-h-10 items-center rounded-sm px-1 text-sm underline-offset-4 hover:underline"
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
              <li>This runs locally on this computer. Nothing is hosted online.</li>
              <li>{MODE_NOTE[mode]}</li>
              <li>
                Anything marked sample or fixture is test data, not real law or real advocates.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </footer>
  );
}
