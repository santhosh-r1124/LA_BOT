import { MANDATORY_DISCLAIMER } from '@legal-platform/shared';
import Link from 'next/link';
import { SystemStatus } from '@/components/system-status';
import { Disclaimer } from '@/components/ui';

const TOOLS = [
  {
    href: '/chat',
    title: 'Legal chat',
    body: 'Ask about Indian law in plain language. Answers cite indexed legal documents (court judgments, official texts) when one is relevant, and say so plainly when none is.',
    cta: 'Ask a question',
  },
  {
    href: '/documents',
    title: 'Document assistant',
    body: 'Answer a short questionnaire to get a labelled draft plus notes on stamping, registration and review.',
    cta: 'Start a draft',
  },
  {
    href: '/advocates',
    title: 'Advocate directory',
    body: 'Find advocates by practice area, state, city and language when a matter needs a professional. Sample listings are clearly marked.',
    cta: 'Browse advocates',
  },
];

const PIPELINE = [
  ['Classify', 'Legal area, whether it depends on state law, and how urgent it is.'],
  ['Retrieve', 'Hybrid keyword + semantic search over Acts from India Code and ministries.'],
  ['Answer', 'Matched passages are cited; anything else is labelled general information.'],
  ['Escalate', 'Disputes, notices and criminal matters are routed to an advocate.'],
] as const;

export default function HomePage() {
  return (
    <main className="page">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <section className="flex flex-col gap-5 pt-4">
          <span className="eyebrow">Indian legal information · Not legal advice</span>
          <h1 className="display max-w-2xl text-3xl sm:text-[2.6rem]">
            Understand Indian law, and know when you need an advocate.
          </h1>
          <p className="muted max-w-xl">
            Plain-language answers about Indian law, document drafting guidance, and a route to
            advocates for matters that need professional help.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/chat" className="btn btn-primary">
              Ask a legal question
            </Link>
            <Link href="/documents" className="btn btn-secondary">
              Draft a document
            </Link>
            <Link href="/advocates" className="btn btn-ghost">
              Find an advocate
            </Link>
          </div>
        </section>

        <SystemStatus />
      </div>

      <section aria-labelledby="tools-heading" className="mt-14">
        <h2 id="tools-heading" className="sr-only">
          Tools
        </h2>
        <ul className="grid gap-3 md:grid-cols-3">
          {TOOLS.map((tool) => (
            <li key={tool.href}>
              <Link
                href={tool.href}
                className="surface-flat surface-interactive flex h-full flex-col gap-2 p-5"
              >
                <span className="font-semibold">{tool.title}</span>
                <span className="muted flex-1 text-sm">{tool.body}</span>
                <span className="text-accent-strong mt-2 text-sm font-semibold">{tool.cta} →</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="how-heading" className="mt-14">
        <h2 id="how-heading" className="display text-xl">
          How an answer is produced
        </h2>
        <ol className="border-line bg-line mt-4 grid gap-px overflow-hidden rounded-xl border sm:grid-cols-2 lg:grid-cols-4">
          {PIPELINE.map(([step, text], i) => (
            <li key={step} className="bg-canvas/90 p-5">
              <span className="text-fg-subtle font-mono text-xs">0{i + 1}</span>
              <p className="mt-1 font-semibold">{step}</p>
              <p className="muted mt-1 text-sm">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <Disclaimer text={MANDATORY_DISCLAIMER} />
    </main>
  );
}
