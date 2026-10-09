'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import {
  AdvocateIcon,
  AlertIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  InfoIcon,
  MapPinIcon,
  RefreshIcon,
  ScaleIcon,
  SearchIcon,
} from '@/components/icons';
import { LegalText } from '@/components/legal-text';
import type { AnswerMode, RecommendedAdvocate, SourceOut } from '@/lib/chat-client';
import { formatEnumLabel, stateName } from '@/lib/format';
import {
  categoryLabel,
  describeSource,
  initials,
  isHighStakes,
  isOfflineWelcome,
  JURISDICTION_LABEL,
  noMatchLead,
  parseSourcesOnlyText,
  publicSourceUrl,
  RISK_META,
  stripAdvocateNote,
  suggestedQuestions,
  type LibraryKind,
  type RiskLevel,
} from './chat-helpers';
import { PassageIcon } from './chat-icons';
import styles from './chat.module.css';

/** Everything the reply view needs, whether it is stored, streaming or restored. */
export interface ReplyData {
  id: string;
  text: string;
  /** Null until the first event of a streamed reply says which kind it is. */
  mode: AnswerMode | null;
  sources: SourceOut[] | null;
  category: string | null;
  jurisdiction: string | null;
  risk: RiskLevel | null;
  /** The question was outside what the assistant covers. */
  outOfScope: boolean;
  /** Null when the list is not known (a reply restored from history keeps no advocates). */
  advocates: RecommendedAdvocate[] | null;
  /** AI reply with no indexed source behind it: general information only. */
  general: boolean;
  /** The question this answers, so it can be edited and asked again. */
  question: string | null;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* -------------------------------------------------------------------------- */
/* Badges                                                                     */
/* -------------------------------------------------------------------------- */

const TONE_CLASS = {
  ok: 'badge-ok',
  warn: 'badge-warn',
  danger: 'badge-danger',
  accent: 'badge-accent',
  neutral: '',
} as const;

function Badge({
  tone = 'neutral',
  icon,
  title,
  children,
}: {
  tone?: keyof typeof TONE_CLASS;
  icon: ReactNode;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span className={cx('badge', TONE_CLASS[tone])} title={title}>
      {icon}
      {children}
    </span>
  );
}

function RiskIcon({ risk }: { risk: RiskLevel }) {
  if (risk === 'LOW') return <CheckIcon />;
  if (risk === 'MEDIUM') return <InfoIcon />;
  return <AlertIcon />;
}

/**
 * Category, risk, jurisdiction and how the reply was made. Every badge carries
 * a word, never only a colour. The topic is a plain outlined chip so a High
 * risk (brass or red) is the only tinted one, and the reason for the risk is
 * written out under the row instead of hiding in a tooltip.
 */
function ReplyBadges({ reply }: { reply: ReplyData }) {
  const jurisdiction = reply.jurisdiction ? JURISDICTION_LABEL[reply.jurisdiction] : undefined;
  const risk = reply.risk ? RISK_META[reply.risk] : null;
  const showPassagesBadge = reply.mode === 'sources_only' && Array.isArray(reply.sources) && reply.sources.length > 0;
  const any = reply.category || risk || jurisdiction || reply.outOfScope || showPassagesBadge || reply.general;
  if (!any) return null;
  return (
    <div className={styles.replyMeta}>
      <ul className={styles.badges} aria-label="About this reply">
        {reply.outOfScope && (
          <li>
            <Badge icon={<InfoIcon />}>Outside what I cover</Badge>
          </li>
        )}
        {reply.category && (
          <li>
            <Badge icon={<ScaleIcon className={styles.badgeBrass} />}>{categoryLabel(reply.category)}</Badge>
          </li>
        )}
        {reply.risk && risk && (
          <li>
            <Badge tone={risk.tone} icon={<RiskIcon risk={reply.risk} />}>
              Risk: {risk.label}
            </Badge>
          </li>
        )}
        {jurisdiction && (
          <li>
            <Badge icon={<MapPinIcon />}>{jurisdiction}</Badge>
          </li>
        )}
        {showPassagesBadge && (
          <li>
            <Badge
              icon={<PassageIcon />}
              title="AI answers are off, so this reply is the matching library text itself."
            >
              Library passages only
            </Badge>
          </li>
        )}
        {reply.general && (
          <li>
            <Badge icon={<InfoIcon />}>General information</Badge>
          </li>
        )}
      </ul>
      {reply.risk && risk && reply.risk !== 'LOW' && <p className={styles.riskNote}>{risk.hint}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sources                                                                    */
/* -------------------------------------------------------------------------- */

interface SourceCardProps {
  id: string;
  n: number;
  source: SourceOut | undefined;
  heading: string;
  excerpt: string | null;
  /** `result`: the passage is the content. `reference`: it sits behind a toggle. */
  variant: 'result' | 'reference';
  open?: boolean;
  onToggle?: (open: boolean) => void;
}

function SourceCard({ id, n, source, heading, excerpt, variant, open, onToggle }: SourceCardProps) {
  const view = describeSource(
    source ?? { document_id: '', document_title: heading, section: null, article: null, source_url: '' },
  );
  const passage = excerpt?.trim() || view.excerpt;
  const meta = [view.caseName, ...view.meta].filter(Boolean).join(' · ');
  // A test fixture or placeholder address has nothing real to open.
  const link = publicSourceUrl(view);
  return (
    <li id={id} className={cx(styles.source, variant === 'reference' && styles.sourceCompact)}>
      <span className={cx('cite', styles.sourceNum)}>
        <span className="sr-only">Source </span>
        {n}
      </span>
      <div className={styles.sourceBody}>
        <div className={styles.sourceHead}>
          <h3 className={styles.sourceTitle}>{view.title}</h3>
          {view.locator && <span className={styles.sourceLocator}>{view.locator}</span>}
          {view.label &&
            (view.fixture ? (
              <span className="stamp" style={{ fontSize: '0.62rem' }} title={view.label}>
                Fixture
              </span>
            ) : (
              <span className="tag">{view.label}</span>
            ))}
        </div>
        {meta && <p className={cx('citation', styles.sourceMeta)}>{meta}</p>}

        {passage &&
          (variant === 'result' ? (
            <blockquote className={styles.passage}>{passage}</blockquote>
          ) : (
            <details
              className={styles.passageToggle}
              open={open}
              onToggle={(e) => onToggle?.(e.currentTarget.open)}
            >
              <summary>
                View the passage used
                <ChevronDownIcon />
              </summary>
              <blockquote className={styles.passage}>{passage}</blockquote>
            </details>
          ))}

        <div className={styles.sourceFoot}>
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" className={cx('link', styles.sourceLink)}>
              Open source
              <ExternalLinkIcon />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
          {view.dataset && (
            <span className="tag" title="Dataset this passage came from">
              {view.dataset}
            </span>
          )}
          {view.fixture && (
            <p className={styles.fixtureNote}>
              Fixture passage for local testing. It is not a real court record, so there is no public source to open.
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Advocates                                                                  */
/* -------------------------------------------------------------------------- */

function AdvocateCard({
  category,
  advocates,
  risk,
  directoryHasSamples,
}: {
  category: string | null;
  advocates: RecommendedAdvocate[] | null;
  risk: RiskLevel | null;
  directoryHasSamples: boolean;
}) {
  const href = category ? `/advocates?practice_area=${encodeURIComponent(category)}` : '/advocates';
  const shown = (advocates ?? []).slice(0, 3);
  // The list is not known for a reply restored from history when the lookup failed:
  // say the same thing about the directory either way.
  const samples = shown.some((a) => a.is_sample) || (shown.length === 0 && directoryHasSamples);
  return (
    <section aria-label="Advocate recommendation" className={styles.advocates}>
      <div className={styles.advocatesHead}>
        <AdvocateIcon className={styles.advocatesIcon} />
        <div>
          <h2 className={styles.advocatesTitle}>This matter may require professional legal assistance.</h2>
          <p className={styles.advocatesLede}>
            {shown.length > 0
              ? `Advocates in the directory who practise in this area${
                  shown.some((a) => a.same_state) ? ', nearest your state first' : ''
                }:`
              : advocates === null
                ? 'Browse the directory for advocates who practise in this area.'
                : 'No listed advocate matched this area yet. You can still browse the directory.'}
          </p>
        </div>
      </div>

      {shown.length > 0 && (
        <ul className={styles.advocateList}>
          {shown.map((a) => (
            <li key={a.id} className={styles.advocateRow}>
              <span className="avatar avatar-sm" aria-hidden="true">
                {initials(a.display_name)}
              </span>
              <div className={styles.advocateMain}>
                <Link href={`/advocates/${a.id}`} className={styles.advocateName}>
                  {a.display_name ?? 'Advocate'}
                </Link>{' '}
                {a.is_sample && <span className="badge badge-sm">Sample listing</span>}
                <p className={styles.advocateMeta}>
                  {[
                    formatEnumLabel(a.matched_area),
                    `${a.city}, ${stateName(a.state_code)}`,
                    a.experience_years !== null ? `${a.experience_years} yrs` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.advocatesFoot}>
        <Link href={href} className="btn btn-primary">
          Find an Advocate
        </Link>
        {samples && (
          <p className={styles.advocatesNote}>Listings in this setup are synthetic samples, not real people.</p>
        )}
      </div>

      {risk === 'CRITICAL' && (
        <p className={styles.urgent}>
          <AlertIcon />
          <span>
            <strong>If this is urgent</strong>, you do not have to wait for a private advocate. Free legal aid is
            available through your District Legal Services Authority (NALSA helpline 15100), and 112 is the
            emergency number.
          </span>
        </p>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Reply                                                                      */
/* -------------------------------------------------------------------------- */

function PendingBody({ label, shape }: { label: string; shape: 'cards' | 'text' }) {
  return (
    <div className={styles.pending} role="status">
      <span className={styles.pendingLabel}>
        <span className="spinner" aria-hidden="true" style={{ width: '1rem', height: '1rem' }} />
        {label}
      </span>
      {shape === 'cards' ? (
        <div className={styles.pendingCard} aria-hidden="true">
          <div className="skeleton skeleton-block h-7 w-7 shrink-0" />
          <div className="flex flex-col gap-2.5">
            <div className="skeleton h-5 w-2/3" />
            <div className="skeleton h-3 w-1/2" />
            <div className="skeleton h-3.5 w-full" />
            <div className="skeleton h-3.5 w-11/12" />
            <div className="skeleton h-3.5 w-3/4" />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5" aria-hidden="true">
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-11/12" />
          <div className="skeleton h-4 w-2/3" />
        </div>
      )}
    </div>
  );
}

/** Starter questions that are known to have a matching passage, one tap each. */
function AskList({
  questions,
  onAsk,
  label,
}: {
  questions: string[];
  onAsk?: (question: string) => void;
  label: string;
}) {
  if (questions.length === 0 || !onAsk) return null;
  return (
    <div className={styles.askBlock}>
      <p className={styles.askLabel}>{label}</p>
      <ul className={styles.askList}>
        {questions.map((q) => (
          <li key={q}>
            <button type="button" className={styles.askBtn} onClick={() => onAsk(q)}>
              <span>{q}</span>
              <ArrowRightIcon />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NextLinks({ directory = true }: { directory?: boolean }) {
  return (
    <div className={styles.actions}>
      {directory && (
        <Link href="/advocates" className="btn btn-secondary btn-sm">
          Browse advocates
        </Link>
      )}
      <Link href="/documents" className="btn btn-secondary btn-sm">
        Draft a document
      </Link>
    </div>
  );
}

function NoMatch({
  text,
  libraryDocs,
  fixtureLibrary,
  showAdvocateLink,
  question,
  onReuse,
  onAsk,
}: {
  text: string;
  libraryDocs: number | null;
  fixtureLibrary: boolean;
  showAdvocateLink: boolean;
  question: string | null;
  onReuse?: (question: string) => void;
  onAsk?: (question: string) => void;
}) {
  const kind: LibraryKind = fixtureLibrary ? 'fixture' : 'full';
  return (
    <div className={styles.noMatch}>
      <div className={styles.noMatchHead}>
        <span className={styles.noMatchIcon}>
          <SearchIcon />
        </span>
        <h2 className={styles.noMatchTitle}>Nothing in the library matched</h2>
      </div>
      <p className={styles.noMatchText}>{noMatchLead(text)}</p>
      {fixtureLibrary ? (
        <>
          <p className={styles.noMatchLibrary}>
            This setup&apos;s library holds only {libraryDocs ?? 'a few'} test passages (marked Fixture), so most
            topics will not match.
          </p>
          <AskList
            questions={suggestedQuestions(kind, 4)}
            onAsk={onAsk}
            label="These questions do have a matching passage"
          />
        </>
      ) : (
        <>
          <p className={styles.noMatchText}>
            Try rewording it around the specific topic, law or document involved.
          </p>
          {libraryDocs !== null && (
            <p className={styles.noMatchLibrary}>
              The library currently holds {libraryDocs} document{libraryDocs === 1 ? '' : 's'}, so a narrow topic
              may simply not be covered yet.
            </p>
          )}
        </>
      )}
      <div className={styles.actions}>
        {question && onReuse && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onReuse(question)}>
            <RefreshIcon />
            Edit and ask again
          </button>
        )}
        {showAdvocateLink && (
          <Link href="/advocates" className="btn btn-secondary btn-sm">
            Browse advocates
          </Link>
        )}
        <Link href="/documents" className="btn btn-secondary btn-sm">
          Draft a document
        </Link>
      </div>
    </div>
  );
}

/** The greeting in offline mode: says what works here, and offers a way forward instead of a dead end. */
function OfflineWelcome({
  fixtureLibrary,
  onAsk,
}: {
  fixtureLibrary: boolean;
  onAsk?: (question: string) => void;
}) {
  return (
    <div className={styles.stack}>
      <p className={styles.lead}>
        Hello. I&apos;m the Legal Advisor for Indian law. AI answers are off in this setup, so I reply by finding the
        passages in the legal library that match your question and showing them with their sources.
      </p>
      <p className={styles.leadMuted}>
        {fixtureLibrary
          ? 'The library here holds a few test passages, so ask about one of these situations:'
          : 'Describe a specific situation, or start from one of these:'}
      </p>
      <AskList
        questions={suggestedQuestions(fixtureLibrary ? 'fixture' : 'full', 4)}
        onAsk={onAsk}
        label="Try a question"
      />
      <p className={styles.leadMuted}>
        The advocate directory is open, and the document assistant prepares template drafts you can edit.
      </p>
      <NextLinks />
    </div>
  );
}

function SourcesOnlyBody({
  reply,
  pending,
  libraryDocs,
  fixtureLibrary,
  hideAdvocateNote,
  onReuse,
  onAsk,
}: {
  reply: ReplyData;
  pending: boolean;
  libraryDocs: number | null;
  fixtureLibrary: boolean;
  hideAdvocateNote: boolean;
  onReuse?: (question: string) => void;
  onAsk?: (question: string) => void;
}) {
  const parts = parseSourcesOnlyText(reply.text);
  const sources = reply.sources ?? [];

  // Greeting, welcome and out-of-scope replies have no sources. The welcome is
  // laid out here once it is complete; anything else is plain text.
  if (reply.sources === null) {
    if (!pending && isOfflineWelcome(reply.text)) {
      return <OfflineWelcome fixtureLibrary={fixtureLibrary} onAsk={onAsk} />;
    }
    return <LegalText text={reply.text} caret={pending} className={styles.replyText} />;
  }

  const noMatch =
    parts.noMatch || (sources.length === 0 && parts.entries.length === 0 && reply.text.trim() !== '');
  if (noMatch) {
    return (
      <NoMatch
        text={stripAdvocateNote(reply.text)}
        libraryDocs={libraryDocs}
        fixtureLibrary={fixtureLibrary}
        showAdvocateLink={!isHighStakes(reply.risk)}
        question={reply.question}
        onReuse={onReuse}
        onAsk={onAsk}
      />
    );
  }

  const entries =
    parts.entries.length > 0
      ? parts.entries
      : sources.map((s, i) => ({ n: i + 1, heading: s.document_title, excerpt: s.excerpt ?? '' }));

  return (
    <>
      {parts.intro && <p className={styles.intro}>{parts.intro}</p>}
      {entries.length > 0 && (
        <section aria-label="Matching passages">
          <h2 className={styles.listLabel}>
            {entries.length === 1 ? 'Best matching passage' : `${entries.length} matching passages`}
          </h2>
          <ol className={styles.sourceList}>
            {entries.map((entry) => (
              <SourceCard
                key={entry.n}
                id={`src-${reply.id}-${entry.n}`}
                n={entry.n}
                source={sources[entry.n - 1]}
                heading={entry.heading}
                excerpt={entry.excerpt || null}
                variant="result"
              />
            ))}
          </ol>
        </section>
      )}
      {parts.outro && (
        <p className={styles.outro}>{parts.outro}</p>
      )}
      {parts.extra.map((block, i) => (
        <p key={i} className={styles.extra}>
          {block}
        </p>
      ))}
      {parts.advocateNote && !hideAdvocateNote && <p className={styles.extra}>{parts.advocateNote}</p>}
    </>
  );
}

export function AssistantReply({
  reply,
  pending = false,
  stage = 'done',
  expectCards = false,
  libraryDocs = null,
  fixtureLibrary = false,
  directoryHasSamples = false,
  onReuse,
  onAsk,
}: {
  reply: ReplyData;
  pending?: boolean;
  /** For a pending reply: before or after the classification event arrived. */
  stage?: 'classifying' | 'writing' | 'done';
  /** Offline setup: show the passage-card skeleton while waiting. */
  expectCards?: boolean;
  libraryDocs?: number | null;
  /** The library holds only the bundled test passages. */
  fixtureLibrary?: boolean;
  /** The advocate directory in this setup includes synthetic sample listings. */
  directoryHasSamples?: boolean;
  /** Put a question back in the box to edit it. */
  onReuse?: (question: string) => void;
  /** Ask a question straight away (suggestions under replies that lead nowhere). */
  onAsk?: (question: string) => void;
}) {
  const [openSources, setOpenSources] = useState<ReadonlySet<number>>(new Set());
  const sources = reply.sources;
  const hasSources = Array.isArray(sources) && sources.length > 0;
  const showAdvocates = isHighStakes(reply.risk) && !pending;
  const waiting = pending && !reply.text && !hasSources;
  // The offline welcome (a reply to "hi") has no sources and no real
  // classification, so it carries no topic, risk or jurisdiction badges.
  const bare = reply.mode === 'sources_only' && reply.sources === null && !reply.outOfScope;
  const prefix = `src-${reply.id}`;

  const openSource = (n: number) => setOpenSources((prev) => new Set(prev).add(n));
  const toggleSource = (n: number, open: boolean) =>
    setOpenSources((prev) => {
      const next = new Set(prev);
      if (open) next.add(n);
      else next.delete(n);
      return next;
    });

  const sourcesOnly = reply.mode === 'sources_only' || (reply.mode === null && expectCards);

  let body: ReactNode;
  if (waiting) {
    const cards = sourcesOnly;
    body = (
      <PendingBody
        shape={cards ? 'cards' : 'text'}
        label={
          stage === 'classifying'
            ? 'Reading your question…'
            : cards
              ? 'Finding matching passages…'
              : 'Writing the answer…'
        }
      />
    );
  } else if (reply.mode === 'sources_only') {
    body = (
      <SourcesOnlyBody
        reply={reply}
        pending={pending}
        libraryDocs={libraryDocs}
        fixtureLibrary={fixtureLibrary}
        hideAdvocateNote={showAdvocates}
        onReuse={onReuse}
        onAsk={onAsk}
      />
    );
  } else {
    body = (
      <>
        <LegalText
          text={showAdvocates ? stripAdvocateNote(reply.text) : reply.text}
          sourceIdPrefix={prefix}
          sourceCount={sources?.length ?? 0}
          sourceTitles={sources?.map((s) => describeSource(s).title)}
          onCite={openSource}
          caret={pending}
        />
        {reply.general && reply.text && !pending && (
          <p className="note mt-4">
            Not drawn from any document in the library. Check important details against the official text on{' '}
            <a href="https://www.indiacode.nic.in/" target="_blank" rel="noopener noreferrer" className="link">
              India Code
            </a>{' '}
            or with an advocate.
          </p>
        )}
        {hasSources && (
          <section aria-label="Sources" className="mt-5">
            <h2 className={styles.listLabel}>
              {sources.length === 1 ? '1 source' : `${sources.length} sources`}
            </h2>
            <ol className={styles.sourceList}>
              {sources.map((s, i) => (
                <SourceCard
                  key={`${s.document_id}-${i}`}
                  id={`${prefix}-${i + 1}`}
                  n={i + 1}
                  source={s}
                  heading={s.document_title}
                  excerpt={s.excerpt ?? null}
                  variant="reference"
                  open={openSources.has(i + 1)}
                  onToggle={(open) => toggleSource(i + 1, open)}
                />
              ))}
            </ol>
          </section>
        )}
      </>
    );
  }

  return (
    <article className={styles.reply} aria-label="Assistant reply" aria-busy={pending}>
      <div className={styles.replyHead}>
        <span className={styles.replyMark} aria-hidden="true">
          §
        </span>
        <span className={styles.replyName}>Legal Advisor</span>
      </div>
      <ReplyBadges reply={bare ? { ...reply, category: null, jurisdiction: null, risk: null } : reply} />
      {body}
      {reply.outOfScope && !pending && (
        <div className={cx(styles.stack, styles.stackAfter)}>
          <AskList
            questions={suggestedQuestions(fixtureLibrary ? 'fixture' : 'full', 3)}
            onAsk={onAsk}
            label="Questions to start from"
          />
          <NextLinks />
        </div>
      )}
      {showAdvocates && (
        <AdvocateCard
          category={reply.category}
          advocates={reply.advocates}
          risk={reply.risk}
          directoryHasSamples={directoryHasSamples}
        />
      )}
    </article>
  );
}

export function UserMessage({ text }: { text: string }) {
  return (
    <div className="bubble-user">
      <span className="sr-only">You: </span>
      {text}
    </div>
  );
}
