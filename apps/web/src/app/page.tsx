import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { AskBox } from '@/components/ask-box';
import {
  AdvocateIcon,
  AlertIcon,
  ArrowRightIcon,
  ChatIcon,
  CheckIcon,
  DocumentIcon,
  LockIcon,
  ScaleIcon,
  UsersIcon,
  type IconComponent,
} from '@/components/icons';
import { SystemStatus } from '@/components/system-status';
import { SectionHeader } from '@/components/ui';
import styles from './home.module.css';

const PROOF: Array<{ Icon: IconComponent; text: string }> = [
  { Icon: ScaleIcon, text: 'Every passage shows its court, date and citation' },
  { Icon: AlertIcon, text: 'Risk rated from low to critical' },
  { Icon: LockIcon, text: 'Runs on this computer only' },
];

const DOCUMENT_TYPES = ['Rental agreement', 'Affidavit', 'Legal notice', 'NDA', '+ 7 more'];
const DIRECTORY_FILTERS = ['Practice area', 'State', 'City', 'Language'];

const STEPS: Array<{
  title: string;
  body: string;
  modes?: Array<{ label: string; text: string }>;
}> = [
  {
    title: 'Classify',
    body: 'Your question is sorted into a legal area, marked as central law, state law or court-specific, and given a risk level from low to critical.',
    modes: [
      {
        label: 'AI off',
        text: 'Fixed keyword rules do this, including common Hinglish words.',
      },
      { label: 'AI on', text: 'A model reads the question first; the rules are the fallback.' },
    ],
  },
  {
    title: 'Retrieve',
    body: 'The legal library is searched for passages that match. Each one keeps its court, date, citation and a link back to its source.',
  },
  {
    title: 'Answer, with sources',
    body: 'Every claim points to a numbered source. If nothing in the library matches, the reply says so instead of guessing.',
    modes: [
      {
        label: 'AI off',
        text: 'You get the matching passages themselves, numbered [1], [2] to match the source list.',
      },
      { label: 'AI on', text: 'A model explains the passages in plain language and cites them.' },
    ],
  },
  {
    title: 'Escalate',
    body: 'Arrests, summons, legal notices and other urgent disputes are rated high or critical and come with advocates from the directory whose practice area fits. Sample listings are labelled as samples.',
  },
];

/**
 * A tool card. The title is a real heading; the call to action is the one link
 * and is stretched over the whole card (see `.cta::after`), so the link's name is
 * short ("Ask a question", described by the card title) while the card is still
 * one large click target.
 */
function Tile({
  id,
  href,
  Icon,
  title,
  cta,
  className = '',
  children,
}: {
  id: string;
  href: string;
  Icon: IconComponent;
  title: string;
  cta: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <article className={`card-interactive ${styles.tile} ${className}`.trim()}>
      <div className={styles.tileHead}>
        <span className={styles.iconTile} aria-hidden="true">
          <Icon />
        </span>
        <h3 id={`${id}-title`} className="title title-lg">
          {title}
        </h3>
      </div>
      {children}
      <Link href={href} className={styles.cta} aria-describedby={`${id}-title`}>
        {cta}
        <ArrowRightIcon />
      </Link>
    </article>
  );
}

/**
 * What a reply looks like with AI off, using the test library's own passage. It
 * is labelled as a sample three times (tag, fixture tag, caption) so nobody can
 * mistake it for a real judgment.
 */
function ReplySample() {
  return (
    <figure className={styles.reply}>
      <div className={styles.replyRow}>
        <span className="tag">Sample reply</span>
        <span className="badge badge-warn badge-sm">
          <span className="dot" aria-hidden="true" />
          High risk
        </span>
        <span className="tag">Employment</span>
        <span className="tag">Central law</span>
      </div>

      <p className={styles.replyLead}>
        These are the passages in the legal library that match your question best. The numbers match
        the sources listed below.
      </p>

      <div className={styles.passage}>
        <span className="cite" aria-hidden="true">
          1
        </span>
        <div className={styles.passageBody}>
          <p className={styles.passageTitle}>Ramesh v. Acme Industries</p>
          <p className={styles.passageText}>
            The employee had not been paid his salary and wages for several months. The Court held
            that non-payment of wages is a breach of statutory duty under the Payment of Wages Act,
            1936.
          </p>
          <p className={styles.passageMeta}>
            <span>High Court of Delhi</span>
            <span>2019-04-02</span>
            <span className="mono">FIXTURE/2019/1</span>
          </p>
        </div>
      </div>

      <div className={styles.replyRule} aria-hidden="true" />

      <div className={styles.advocateRow}>
        <span className={styles.people} aria-hidden="true">
          <span className={styles.person}>
            <AdvocateIcon />
          </span>
          <span className={styles.person}>
            <AdvocateIcon />
          </span>
          <span className={styles.person}>
            <AdvocateIcon />
          </span>
        </span>
        <p>Advocates whose practice area fits are listed when the risk is high.</p>
      </div>

      <figcaption className={styles.replyCaption}>
        Layout example. The case and citation come from the test library and are fixtures, not real
        law.
      </figcaption>
    </figure>
  );
}

export default function HomePage() {
  return (
    <main>
      <section aria-labelledby="hero-title" className="hero-bg">
        <div className="page grid gap-x-14 gap-y-8 pb-14 pt-10 sm:pt-14 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] lg:pb-20 lg:pt-20">
          <div className="rise-in flex flex-col gap-5 lg:col-start-1 lg:row-start-1 lg:self-end">
            <p className="eyebrow eyebrow-rule max-sm:before:hidden">
              Indian legal information · Not legal advice
            </p>
            <h1 id="hero-title" className="display display-lg">
              Understand Indian law, <em>and know when you need an advocate.</em>
            </h1>
            <p className="lede pretty">
              Ask in plain language. You get the matching passages from a legal library, a clear
              risk level, and advocates to contact when a matter is serious.
            </p>
          </div>

          <div
            className="rise-in lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center"
            style={{ '--i': 2 } as CSSProperties}
          >
            <AskBox />
          </div>

          <div
            className="rise-in flex flex-col gap-6 lg:col-start-1 lg:row-start-2 lg:self-start"
            style={{ '--i': 1 } as CSSProperties}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link href="/documents" className="btn btn-secondary btn-lg">
                <DocumentIcon />
                Draft a document
              </Link>
              <Link href="/advocates" className="btn btn-secondary btn-lg">
                <UsersIcon />
                Find an advocate
              </Link>
            </div>
            <ul className={styles.proof}>
              {PROOF.map(({ Icon, text }) => (
                <li key={text}>
                  <Icon />
                  {text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <div className="page pt-0">
        <section aria-labelledby="tools-heading">
          <SectionHeader
            id="tools-heading"
            eyebrow="What it does"
            title="Three tools, one workflow"
            description="Start with a question. Move to a draft or an advocate when you need one."
          />
          <div className={styles.bento}>
            <Tile
              id="tile-chat"
              href="/chat"
              Icon={ChatIcon}
              title="Legal chat"
              cta="Ask a question"
              className={styles.tileChat}
            >
              <p className="muted">
                Ask about Indian law in plain language. Your question is sorted by legal area and
                urgency, then matched against the legal library.
              </p>
              <ul className={styles.points}>
                {[
                  'Passages come with their court, date and citation',
                  'A risk level from low to critical',
                  'Serious matters list advocates to contact',
                  'When nothing matches, it says so',
                ].map((point) => (
                  <li key={point}>
                    <CheckIcon />
                    {point}
                  </li>
                ))}
              </ul>
              <ReplySample />
            </Tile>

            <Tile
              id="tile-documents"
              href="/documents"
              Icon={DocumentIcon}
              title="Document drafts"
              cta="Start a draft"
            >
              <p className="muted text-sm">
                Answer a short questionnaire and get a labelled draft with notes on stamping,
                registration and review. With AI off the draft is a template with blanks to fill in.
                Either way, read it through with an advocate before you use it.
              </p>
              <ul className={styles.tagRow} aria-label="Some of the 11 document types">
                {DOCUMENT_TYPES.map((type) => (
                  <li key={type} className="tag">
                    {type}
                  </li>
                ))}
              </ul>
            </Tile>

            <Tile
              id="tile-advocates"
              href="/advocates"
              Icon={UsersIcon}
              title="Advocate directory"
              cta="Browse advocates"
            >
              <p className="muted text-sm">
                Find advocates when a matter needs a professional. Listings that are samples are
                clearly marked, so you always know whether you are looking at a real person.
              </p>
              <ul className={styles.tagRow} aria-label="Ways to filter the directory">
                {DIRECTORY_FILTERS.map((filter) => (
                  <li key={filter} className="tag">
                    {filter}
                  </li>
                ))}
              </ul>
            </Tile>
          </div>
        </section>

        <section aria-labelledby="how-heading" className="section">
          <SectionHeader
            id="how-heading"
            eyebrow="How it works"
            title="How an answer is produced"
            description="The same four steps run with AI on or off. Classifying and answering work differently in each mode, as noted below."
          />
          <ol className={styles.steps}>
            {STEPS.map((step, index) => (
              <li key={step.title} className={styles.step}>
                <span className={styles.node} aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className={styles.stepBody}>
                  <h3 className="title">{step.title}</h3>
                  <p className="muted text-sm leading-relaxed">{step.body}</p>
                  {step.modes?.map((mode) => (
                    <p key={mode.label} className={styles.mode}>
                      <span className="tag">{mode.label}</span>
                      <span>{mode.text}</span>
                    </p>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <SystemStatus />
      </div>
    </main>
  );
}
