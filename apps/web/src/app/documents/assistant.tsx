'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorState } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import {
  describeDocumentFailure,
  documentClient,
  generationModeOf,
  type DocumentFailure,
  type DocumentTypeInfoOut,
} from '@/lib/document-client';
import { typeLabel } from './doc-types';
import styles from './documents.module.css';
import { ModeNote, useDraftingInfo } from './mode-note';
import { PendingView } from './pending';
import { Questionnaire } from './questionnaire';
import { ResultView, type DraftResult } from './result';
import { TypePicker, TypePickerSkeleton } from './type-picker';

/** Only show the "drafting" screen if the wait is long enough to be noticed. */
const PENDING_DELAY_MS = 300;

const NO_ANSWERS: Record<string, string> = {};

type View = 'loading' | 'types-error' | 'picker' | 'form' | 'pending' | 'result';

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The document assistant: pick a type, answer the questions, read the draft.
 * The chosen type lives in the address (`/documents?type=NDA`) so the browser's
 * back button and shared links work; answers and the result live in memory only.
 */
export function DocumentAssistant() {
  const router = useRouter();
  const typeParam = useSearchParams().get('type');
  const { accessToken } = useAuth();
  const drafting = useDraftingInfo();

  const [types, setTypes] = useState<DocumentTypeInfoOut[] | null>(null);
  const [typesFailure, setTypesFailure] = useState<DocumentFailure | null>(null);
  const [answersByType, setAnswersByType] = useState<Record<string, Record<string, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const [failure, setFailure] = useState<DocumentFailure | null>(null);
  const [draft, setDraft] = useState<DraftResult | null>(null);

  // Bumped to ignore the outcome of a request nobody is waiting for any more.
  const requestSeq = useRef(0);
  const typesSeq = useRef(0);

  const loadTypes = useCallback(() => {
    const seq = ++typesSeq.current;
    setTypesFailure(null);
    setTypes(null);
    documentClient
      .listTypes()
      .then((list) => {
        if (typesSeq.current === seq) setTypes(list);
      })
      .catch((err: unknown) => {
        if (typesSeq.current === seq) setTypesFailure(describeDocumentFailure(err, 'types'));
      });
  }, []);

  useEffect(() => {
    loadTypes();
  }, [loadTypes]);

  const selected = types?.find((t) => t.document_type === typeParam) ?? null;
  const answers = selected ? (answersByType[selected.document_type] ?? NO_ANSWERS) : NO_ANSWERS;

  // Moving to another type (or back to the list) abandons any draft or request in flight.
  useEffect(() => {
    requestSeq.current += 1;
    setSubmitting(false);
    setShowPending(false);
    setFailure(null);
    setDraft((current) => (current && current.type !== typeParam ? null : current));
  }, [typeParam]);

  useEffect(
    () => () => {
      requestSeq.current += 1;
    },
    [],
  );

  let view: View;
  if (typesFailure) view = 'types-error';
  else if (types === null) view = 'loading';
  else if (selected && draft && draft.type === selected.document_type) view = 'result';
  else if (selected && submitting && showPending) view = 'pending';
  else if (selected) view = 'form';
  else view = 'picker';

  // After a change of screen, send keyboard and screen-reader users to its heading.
  const previousView = useRef<View>(view);
  useEffect(() => {
    const was = previousView.current;
    previousView.current = view;
    const tracked: View[] = ['picker', 'form', 'pending', 'result'];
    if (was === view || !tracked.includes(was) || !tracked.includes(view)) return;
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    document.getElementById('doc-heading')?.focus({ preventScroll: true });
  }, [view]);

  function setAnswer(key: string, value: string) {
    if (!selected) return;
    const type = selected.document_type;
    setAnswersByType((prev) => ({ ...prev, [type]: { ...(prev[type] ?? {}), [key]: value } }));
  }

  function clearAnswers() {
    if (!selected) return;
    const type = selected.document_type;
    setAnswersByType((prev) => ({ ...prev, [type]: {} }));
    setFailure(null);
  }

  async function submit(payload: Record<string, string>) {
    if (!selected || submitting) return;
    const type = selected.document_type;
    const seq = ++requestSeq.current;
    setSubmitting(true);
    setShowPending(false);
    setFailure(null);
    const timer = setTimeout(() => {
      if (requestSeq.current === seq) setShowPending(true);
    }, PENDING_DELAY_MS);
    try {
      const response = await documentClient.create(type, payload, accessToken);
      if (requestSeq.current !== seq) return;
      setDraft({
        type,
        text: response.document.draft_text,
        disclaimer: response.disclaimer,
        mode: generationModeOf(response),
        createdAt: response.document.created_at,
        stateCode: response.document.state_code,
      });
    } catch (err) {
      if (requestSeq.current !== seq) return;
      setFailure(describeDocumentFailure(err, 'draft'));
    } finally {
      clearTimeout(timer);
      if (requestSeq.current === seq) {
        setSubmitting(false);
        setShowPending(false);
      }
    }
  }

  /** Stop waiting: the request may still finish on the server, but its result is dropped. */
  function cancelDrafting() {
    requestSeq.current += 1;
    setSubmitting(false);
    setShowPending(false);
  }

  function startOver() {
    if (selected) setAnswersByType((prev) => ({ ...prev, [selected.document_type]: {} }));
    setDraft(null);
    setFailure(null);
    router.push('/documents');
  }

  return (
    <main className="page" data-view={view}>
      {view === 'loading' &&
        (typeParam ? (
          <FormSkeleton />
        ) : (
          <>
            <PickerIntro drafting={drafting} />
            <TypePickerSkeleton />
          </>
        ))}

      {view === 'types-error' && typesFailure && (
        <>
          <PickerIntro drafting={drafting} />
          <ErrorState
            title={typesFailure.title}
            message={typesFailure.message}
            onRetry={loadTypes}
            retryLabel="Try again"
          />
        </>
      )}

      {view === 'picker' && types && (
        <>
          <PickerIntro drafting={drafting} />
          <TypePicker types={types} unknownType={Boolean(typeParam)} />
        </>
      )}

      {view === 'form' && selected && (
        <Questionnaire
          info={selected}
          answers={answers}
          onChange={setAnswer}
          onSubmit={(payload) => void submit(payload)}
          onClear={clearAnswers}
          submitting={submitting}
          failure={failure}
          drafting={drafting}
        />
      )}

      {view === 'pending' && selected && (
        <PendingView
          label={typeLabel(selected.document_type)}
          mode={drafting.mode}
          onCancel={cancelDrafting}
        />
      )}

      {view === 'result' && draft && (
        <ResultView
          draft={draft}
          sampleAdvocates={drafting.sampleAdvocates}
          onEdit={() => setDraft(null)}
          onReset={startOver}
        />
      )}
    </main>
  );
}

function PickerIntro({ drafting }: { drafting: ReturnType<typeof useDraftingInfo> }) {
  return (
    <header className={`${styles.intro} ${styles.introSplit}`}>
      <div>
        <span className="eyebrow eyebrow-rule">Document assistant</span>
        <h1 id="doc-heading" tabIndex={-1} className="display display-md mt-2 outline-none">
          Prepare a legal document
        </h1>
        <p className="lede mt-3">
          Pick a document, answer a few plain-language questions and get a labelled draft with notes
          on what to check before you sign.
        </p>
        <ol className={styles.steps} aria-label="How it works">
          <li>Choose a document</li>
          <li>Answer the questions</li>
          <li>Review it with an advocate</li>
        </ol>
      </div>
      <ModeNote mode={drafting.mode} loading={drafting.loading} />
    </header>
  );
}

/** Placeholder for the questionnaire while the types load behind a `?type=` link. */
function FormSkeleton() {
  return (
    <div role="status" aria-live="polite" className="flex max-w-2xl flex-col gap-4">
      <span className="sr-only">Loading the questions</span>
      <div className="skeleton h-4 w-40" aria-hidden="true" />
      <div className="skeleton h-9 w-3/5" aria-hidden="true" />
      <div className="skeleton h-4 w-full" aria-hidden="true" />
      <div className="skeleton mt-4 h-64 w-full" aria-hidden="true" />
    </div>
  );
}
