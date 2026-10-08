'use client';

import type { ReactNode } from 'react';
import { ArrowRightIcon, BriefcaseIcon, DocumentIcon, HomeIcon, ShieldIcon } from '@/components/icons';
import { STARTER_GROUPS, type StarterIcon, type LlmMode } from './chat-helpers';
import styles from './chat.module.css';

const ICONS: Record<StarterIcon, ReactNode> = {
  briefcase: <BriefcaseIcon />,
  home: <HomeIcon />,
  shield: <ShieldIcon />,
  document: <DocumentIcon />,
};

const LEDE: Record<LlmMode | 'unknown', string> = {
  offline:
    'Ask in plain words. AI answers are off in this setup, so you get the passages in the legal library that match your question, with their sources, rather than a written explanation.',
  ai: 'Ask in plain words. Answers cite passages from the legal library when it has something relevant, and say so when it does not.',
  unknown: 'Ask a question about Indian law in plain words and see what the legal library has on it.',
};

/** First screen of a new conversation: what this is, and questions to start from, grouped by topic. */
export function EmptyState({
  mode,
  disabled,
  onPick,
}: {
  mode: LlmMode | null;
  disabled: boolean;
  onPick: (question: string) => void;
}) {
  return (
    <div className={styles.empty}>
      <div>
        <div className={styles.heroRow}>
          <div className={styles.heroMark} aria-hidden="true">
            §
          </div>
          <h2 className="display display-sm">What would you like to look up?</h2>
        </div>
        <p className={styles.heroLede}>{LEDE[mode ?? 'unknown']}</p>
      </div>

      <div>
        <p className="muted mb-3 text-sm">Start with one of these, or type your own question below.</p>
        <div className={styles.starterGrid}>
          {STARTER_GROUPS.map((group) => (
            <section key={group.id} aria-labelledby={`starter-${group.id}`}>
              <h3 id={`starter-${group.id}`} className={styles.starterTitle}>
                {ICONS[group.icon]}
                {group.title}
              </h3>
              <ul className={styles.starterList}>
                {group.questions.map((q) => (
                  <li key={q}>
                    <button type="button" className={styles.starterBtn} disabled={disabled} onClick={() => onPick(q)}>
                      <span>{q}</span>
                      <ArrowRightIcon />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
