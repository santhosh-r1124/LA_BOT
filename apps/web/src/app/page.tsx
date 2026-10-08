import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { AskBox } from '@/components/ask-box';
import {
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

function Tile({
  href,
  Icon,
  title,
  cta,
  className = '',
  children,
}: {
  href: string;
  Icon: IconComponent;
  title: string;
  cta: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={`card-interactive ${styles.tile} ${className}`.trim()}>
      <span className={styles.tileHead}>
        <span className={styles.iconTile}>
          <Icon />
        </span>
        <span className="title title-lg">{title}</span>
      </span>
      {children}
      <span className={styles.cta}>
        {cta}
        <ArrowRightIcon />
      </span>
    </Link>
  );
}

/** A reply drawn with bars: where the risk level, sources and advocates sit. */
function ReplyIllustration() {
  return (
    <figure className={styles.reply} aria-label="Illustration of how a reply is laid out">
      <div className={styles.replyRow} aria-hidden="true">
        <span className="badge badge-warn">
          <span className="dot" />
          Risk level
        </span>
        <span className="tag">Legal area</span>
        <span className="tag">Central or state law</span>
      </div>
      <div className={styles.lines} aria-hidden="true">
        <span className={styles.bar} style={{ width: '96%' }} />
        <span className={styles.bar} style={{ width: '88%' }} />
        <span className="flex items-center gap-2">
          <span className={styles.bar} style={{ width: '52%' }} />
          <span className="cite">1</span>
          <span className={styles.bar} style={{ width: '18%' }} />
        </span>
      </div>
      <div className={styles.replyRule} aria-hidden="true" />
      <div className={styles.sourceRow} aria-hidden="true">
        <span className="cite">1</span>
        <span className={styles.lines}>
          <span className={styles.bar} style={{ width: '64%' }} />
          <span className={styles.bar} style={{ width: '40%', opacity: 0.6 }} />
        </span>
      </div>
      <div className={styles.sourceRow} aria-hidden="true">
        <span className={styles.people}>
          <span className={styles.person} />
          <span className={styles.person} />
          <span className={styles.person} />
        </span>
        <span className={styles.bar} style={{ width: '42%' }} />
      </div>
      <figcaption className={styles.replyCaption}>
        Illustration only: a risk level, numbered sources, then advocates to contact.
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
            <p className="lede">
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
            <div className="cluster">
              <Link href="/documents" className="btn btn-secondary btn-lg">
                <DocumentIcon />
                Draft a document
              </Link>
              <Link href="/advocates" className="btn btn-ghost btn-lg">
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
              <ReplyIllustration />
            </Tile>

            <Tile href="/documents" Icon={DocumentIcon} title="Document drafts" cta="Start a draft">
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
