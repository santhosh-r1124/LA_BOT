'use client';

import Link from 'next/link';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { CheckIcon, CopyIcon, DownloadIcon, RefreshIcon } from '@/components/icons';
import { Notice } from '@/components/ui';
import type { GenerationMode } from '@/lib/document-client';
import { stateName } from '@/lib/format';
import { copyText, downloadText, draftFilename } from './draft-actions';
import {
  countBlanks,
  noteItems,
  parseDraftBlocks,
  parseNotes,
  splitDraft,
  tokenizeInline,
  type DraftBlock,
  type NoteEntry,
} from './draft-parse';
import { PencilGlyph, PrintGlyph } from './doc-icons';
import { typeLabel } from './doc-types';
import styles from './documents.module.css';
import { plural } from './form-helpers';

export interface DraftResult {
  /** `RENTAL_AGREEMENT` and the like. */
  type: string;
  /** The full text exactly as the server returned it, label and Notes included. */
  text: string;
  disclaimer: string;
  mode: GenerationMode;
  createdAt: string;
  stateCode: string | null;
}

// ---------------------------------------------------------------------------
// Rendering a draft as a document
// ---------------------------------------------------------------------------

function Inline({ text }: { text: string }) {
  return (
    <>
      {tokenizeInline(text).map((token, i) => {
        switch (token.type) {
          case 'bold':
            return <strong key={i}>{token.text}</strong>;
          case 'italic':
            return <em key={i}>{token.text}</em>;
          case 'blank':
            return (
              <span key={i} className="blank">
                {token.text}
              </span>
            );
          case 'line':
            return (
              <span
                key={i}
                className={styles.sigLine}
                style={{ width: `${Math.min(token.length, 28)}ch` }}
                aria-hidden="true"
              />
            );
          default:
            return <Fragment key={i}>{token.text}</Fragment>;
        }
      })}
    </>
  );
}

function Block({ block }: { block: DraftBlock }) {
  switch (block.type) {
    case 'title':
      return (
        <h2 className={styles.docTitle}>
          <Inline text={block.text} />
        </h2>
      );
    case 'heading': {
      const Tag = block.level === 2 ? 'h3' : 'h4';
      return (
        <Tag className={block.level === 2 ? styles.docH2 : styles.docH3}>
          <Inline text={block.text} />
        </Tag>
      );
    }
    case 'clause':
      return (
        <p className={styles.clause}>
          <span className={styles.clauseNum}>{block.number}</span>
          <span className={styles.clauseText}>
            <Inline text={block.text} />
          </span>
        </p>
      );
    case 'paragraph':
      return (
        <p className={styles.docP}>
          {block.lines.map((line, i) => (
            <Fragment key={i}>
              {i > 0 && '\n'}
              <Inline text={line} />
            </Fragment>
          ))}
        </p>
      );
    case 'list': {
      const List = block.ordered ? 'ol' : 'ul';
      return (
        <List className={styles.docList} {...(block.ordered ? { start: block.start } : {})}>
          {block.items.map((item, i) => (
            <li key={i}>
              <Inline text={item} />
            </li>
          ))}
        </List>
      );
    }
    case 'rule':
      return <hr className={styles.docRule} />;
  }
}

function DraftSheet({
  blocks,
  mode,
  label,
}: {
  blocks: DraftBlock[];
  mode: GenerationMode;
  label: string;
}) {
  return (
    <article className={`paper sheet ${styles.sheet}`} aria-label={`${label} draft`}>
      <div className={styles.sheetHead}>
        <span className={`stamp ${mode === 'template' ? '' : 'text-info'}`.trim()}>
          {mode === 'template' ? 'Template draft' : 'AI draft'}
        </span>
        <span className={styles.sheetMeta}>Not an executed document</span>
      </div>
      {blocks.length === 0 ? (
        <p className={styles.noBody}>The draft came back empty. Go back and try again.</p>
      ) : (
        blocks.map((block, i) => <Block key={i} block={block} />)
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// The checklist of notes
// ---------------------------------------------------------------------------

/** Used only when a draft has no Notes section, so the page always ends with next steps. */
export function fallbackNotes(stateLabel: string | null, blanks: number): NoteEntry[] {
  return [
    blanks > 0
      ? {
          type: 'item',
          lead: 'Fill in the blanks',
          text: 'Complete or delete every highlighted [BRACKETED] item before anyone signs.',
        }
      : {
          type: 'item',
          lead: 'Check every detail',
          text: 'Read each line against your own records: names, amounts, dates and addresses.',
        },
    {
      type: 'item',
      lead: 'Stamping, notarisation and registration',
      text: stateLabel
        ? `These depend on the state. Confirm the current rules for ${stateLabel} with the local stamp or registration office or an advocate.`
        : 'These depend on the state. Confirm the current rules with the local stamp or registration office or an advocate.',
    },
    {
      type: 'item',
      lead: 'Review',
      text: 'Have a qualified advocate review the draft before you sign or file it. It is not legal advice.',
    },
  ];
}

function Checklist({ entries, general }: { entries: NoteEntry[]; general: boolean }) {
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const total = noteItems(entries).length;
  const done = Object.values(checked).filter(Boolean).length;
  let itemIndex = -1;

  return (
    <section className={styles.notes} aria-labelledby="notes-heading">
      <div className={styles.notesHead}>
        <div>
          <h2 id="notes-heading" className={styles.notesTitle}>
            Before you sign
          </h2>
          <p className={styles.notesLede}>
            {general
              ? 'General reminders that apply to any draft. Tick each one off as you deal with it.'
              : 'Notes that came with your draft. Tick each one off as you deal with it.'}
          </p>
        </div>
        <span className={styles.notesCount} aria-live="polite">
          {done} of {total} done
        </span>
      </div>
      <ul className={styles.checkList}>
        {entries.map((entry, i) => {
          if (entry.type === 'group') {
            return (
              <li key={`g${i}`} className={styles.checkGroup}>
                {entry.text}
              </li>
            );
          }
          itemIndex += 1;
          const index = itemIndex;
          return (
            <li key={`i${i}`} className={styles.checkRow}>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={Boolean(checked[index])}
                  onChange={(e) => setChecked((prev) => ({ ...prev, [index]: e.target.checked }))}
                />
                <span className={styles.checkBody}>
                  {entry.lead && (
                    <span className={styles.checkLead}>
                      <Inline text={entry.lead} />
                    </span>
                  )}
                  <Inline text={entry.text} />
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The result view
// ---------------------------------------------------------------------------

function formatPrepared(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function ResultView({
  draft,
  sampleAdvocates,
  onEdit,
  onReset,
}: {
  draft: DraftResult;
  sampleAdvocates: number;
  onEdit: () => void;
  onReset: () => void;
}) {
  const label = typeLabel(draft.type);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const parsed = useMemo(() => {
    const split = splitDraft(draft.text);
    const blocks = parseDraftBlocks(split.body);
    const blanks = countBlanks(split.body);
    return { split, blocks, blanks };
  }, [draft.text]);

  const stateLabel = draft.stateCode ? stateName(draft.stateCode) : null;
  const prepared = formatPrepared(draft.createdAt);

  const notes = useMemo(() => {
    const fromDraft = parsed.split.notes ? parseNotes(parsed.split.notes) : [];
    return noteItems(fromDraft).length > 0
      ? { entries: fromDraft, general: false }
      : { entries: fallbackNotes(stateLabel, parsed.blanks), general: true };
  }, [parsed, stateLabel]);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  async function handleCopy() {
    const ok = await copyText(draft.text);
    setCopyState(ok ? 'copied' : 'failed');
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyState('idle'), 2500);
  }

  return (
    <>
      <header className="no-print mb-8 flex max-w-2xl flex-col gap-2">
        <span className="eyebrow eyebrow-rule">Document assistant</span>
        <h1 id="doc-heading" tabIndex={-1} className="display display-sm outline-none">
          {label} draft
        </h1>
        <p className="muted max-w-[60ch]">
          Check every detail, fill in the highlighted blanks and work through the checklist below
          before you sign.
        </p>
      </header>

      <div className={styles.resultLayout}>
        <div className={`${styles.areaNotice} no-print`}>
          {draft.mode === 'template' ? (
            <Notice tone="info" title="Template draft, written without AI">
              This draft was assembled from your answers and standard clauses without AI, because AI
              is off in this setup. It is a starting point: complete every highlighted{' '}
              <span className="blank">[BRACKETED]</span> item and have an advocate review it before
              you sign or file anything.
            </Notice>
          ) : (
            <Notice tone="warn" title="AI draft: read it closely">
              An AI model wrote this draft from your answers. It can make mistakes or leave out
              clauses that matter in your state. Read every line and have an advocate review it
              before you sign or file anything.
            </Notice>
          )}
        </div>

        <aside className={`${styles.areaTools} no-print`} aria-label="Draft actions">
          <div className={styles.tools}>
            <div>
              <p className="caps">Your draft</p>
              <h2 className={styles.toolsTitle}>{label}</h2>
            </div>
            <dl className={styles.facts}>
              <div>
                <dt>Made with</dt>
                <dd>{draft.mode === 'template' ? 'Template, no AI' : 'AI model'}</dd>
              </div>
              <div>
                <dt>For</dt>
                <dd>{stateLabel ?? 'State not recognised'}</dd>
              </div>
              {prepared && (
                <div>
                  <dt>Prepared</dt>
                  <dd>{prepared}</dd>
                </div>
              )}
              <div>
                <dt>Blanks to fill</dt>
                <dd>{parsed.blanks === 0 ? 'None found' : parsed.blanks}</dd>
              </div>
            </dl>
            <div className={styles.toolButtons}>
              <button
                type="button"
                className={`btn btn-primary ${styles.toolPrimary}`}
                onClick={() => void handleCopy()}
              >
                {copyState === 'copied' ? <CheckIcon /> : <CopyIcon />}
                {copyState === 'copied' ? 'Copied' : 'Copy draft'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => downloadText(draftFilename(draft.type, draft.mode), draft.text)}
              >
                <DownloadIcon />
                Download .txt
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
                <PrintGlyph />
                Print
              </button>
            </div>
            <p className="sr-only" role="status">
              {copyState === 'copied' ? 'Draft copied to the clipboard.' : ''}
              {copyState === 'failed' ? 'Could not copy. Select the text and copy it by hand.' : ''}
            </p>
            {copyState === 'failed' && (
              <p className="field-error" aria-hidden="true">
                Could not copy automatically. Select the draft text and copy it by hand.
              </p>
            )}
            <div className={styles.toolsMore}>
              <button type="button" className="btn btn-ghost" onClick={onEdit}>
                <PencilGlyph />
                Edit answers
              </button>
              <button type="button" className="btn btn-ghost" onClick={onReset}>
                <RefreshIcon />
                Start over
              </button>
            </div>
          </div>
        </aside>

        <div className={styles.areaSheet}>
          <DraftSheet blocks={parsed.blocks} mode={draft.mode} label={label} />
        </div>

        <div className={`${styles.areaChecklist} no-print`}>
          <Checklist entries={notes.entries} general={notes.general} />
        </div>

        <div className={`${styles.areaFoot} no-print`}>
          <p className={styles.footNote}>{draft.disclaimer}</p>
          <div className={styles.footActions}>
            <Link href="/advocates" className="btn btn-secondary">
              Find an advocate to review it
            </Link>
          </div>
          {sampleAdvocates > 0 && (
            <p className={`${styles.footNote} mt-2`}>
              The advocate directory in this setup lists {sampleAdvocates.toLocaleString('en-IN')}{' '}
              synthetic sample {plural(sampleAdvocates, 'profile')}, not real advocates.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
