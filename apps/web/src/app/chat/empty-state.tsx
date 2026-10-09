'use client';

import type { ReactNode } from 'react';
import {
  ArrowRightIcon,
  BriefcaseIcon,
  DocumentIcon,
  HomeIcon,
  LockIcon,
  ShieldIcon,
} from '@/components/icons';
import { startersFor, type LlmMode, type StarterIcon } from './chat-helpers';
import styles from './chat.module.css';

const ICONS: Record<StarterIcon, ReactNode> = {
  briefcase: <BriefcaseIcon />,
  home: <HomeIcon />,
  shield: <ShieldIcon />,
  lock: <LockIcon />,
  document: <DocumentIcon />,
};

const LEDE: Record<LlmMode | 'unknown', string> = {
  offline:
    'Ask in plain words. You get the passages in the legal library that match your question, with their sources, rather than a written explanation.',
  ai: 'Ask in plain words. Answers cite passages from the legal library when it has something relevant, and say so when it does not.',
  unknown: 'Ask a question about Indian law in plain words and see what the legal library has on it.',
};

/**
 * `checking`: the status call has not answered yet, so which starters work is
 * not known. `fixture`: only the bundled test passages are loaded. `full`:
 * anything else (a real corpus, or AI answering from general knowledge).
 */
export type StarterLibrary = 'checking' | 'fixture' | 'full';

/** First screen of a new conversation: what this is, and questions to start from, grouped by topic. */
export function EmptyState({
  mode,
  library,
  libraryDocs,
  notices,
  disabled,
  onPick,
}: {
  mode: LlmMode | null;
  library: StarterLibrary;
  libraryDocs: number | null;
  /** Setup notices (AI off, library empty, server unreachable), shown under the introduction. */
  notices?: ReactNode;
  disabled: boolean;
  onPick: (question: string) => void;
}) {
  const groups = library === 'checking' ? [] : startersFor(library === 'fixture' ? 'fixture' : 'full');
  return (
    <div className={styles.empty}>
      <div>
        <h1 className={`display display-md ${styles.heroTitle}`}>What would you like to look up?</h1>
        <p className={styles.heroLede}>{LEDE[mode ?? 'unknown']}</p>
        {notices && <div className={styles.heroNotices}>{notices}</div>}
      </div>

      <div>
        {library === 'checking' ? (
          <div role="status">
            <span className="sr-only">Checking which questions this library can answer</span>
            <div className={styles.starterGrid} aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex flex-col gap-2">
                  <div className="skeleton h-3 w-28" />
                  <div className="skeleton skeleton-block h-[3.6rem]" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <p className={styles.starterIntro}>
              {library === 'fixture'
                ? `This setup's library holds ${
                    libraryDocs === null ? 'only a few' : libraryDocs
                  } test passages, so these are the questions it can answer. Anything else will say that nothing matched.`
                : 'Start with one of these, or type your own question below.'}
            </p>
            <div className={styles.starterGrid}>
              {groups.map((group) => (
                <section key={group.id} aria-labelledby={`starter-${group.id}`}>
                  <h2 id={`starter-${group.id}`} className={styles.starterTitle}>
                    {ICONS[group.icon]}
                    {group.title}
                  </h2>
                  <ul className={styles.starterList}>
                    {group.questions.map((q) => (
                      <li key={q}>
                        <button
                          type="button"
                          className={styles.starterBtn}
                          disabled={disabled}
                          onClick={() => onPick(q)}
                        >
                          <span>{q}</span>
                          <ArrowRightIcon />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            {library === 'fixture' && (
              <p className={styles.starterNote}>Or type your own question below.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
