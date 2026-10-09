'use client';

import { useId, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRightIcon } from '@/components/icons';
import { Notice, Skeleton } from '@/components/ui';
import { providerLabel, usePlatformStatus } from '@/lib/status-client';
import { aiMode } from '@/lib/status-summary';
import { buildChatHref, MAX_QUESTION_LENGTH, normaliseQuestion } from '@/lib/shell-helpers';

/** Short chips that fill the box with a full question (they do not send it). */
const EXAMPLES = [
  {
    label: 'Unpaid salary',
    question: 'My employer has not paid my salary for two months. What can I do?',
  },
  {
    label: 'Security deposit',
    question: 'My landlord is refusing to return my security deposit after I moved out.',
  },
  {
    label: 'Bounced cheque',
    question: 'A cheque I received has bounced. What are my options?',
  },
  {
    label: 'Will or gift deed',
    question: 'What is the difference between a will and a gift deed?',
  },
];

/** What this setup will do with the question, said calmly and truthfully. */
function ModeNote() {
  const { state } = usePlatformStatus();

  if (state.kind === 'loading') {
    return <Skeleton className="rounded-item h-[4.25rem] w-full" />;
  }
  if (state.kind === 'error') {
    return (
      <Notice tone="warn" title="The server is not answering">
        Questions cannot be answered until it is back. Try again in a moment.
      </Notice>
    );
  }
  if (aiMode(state.status) === 'offline') {
    return (
      <Notice tone="info" title="AI answers are off in this setup">
        You still get the library passages that match your question, a risk level worked out by
        fixed rules, and advocates to contact when a matter is serious. No written explanation is
        generated.
      </Notice>
    );
  }
  return (
    <Notice tone="ok" title="AI answers are on">
      Replies are written by {providerLabel(state.status.llm.provider)} from the passages found and
      always list their sources.
    </Notice>
  );
}

/**
 * The home page question box. Submitting opens `/chat?q=<question>`, and the chat
 * page sends it as the first message. Enter sends, Shift+Enter adds a line.
 */
export function AskBox() {
  const router = useRouter();
  const [question, setQuestion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (pending) return;
    const text = normaliseQuestion(question);
    if (!text) {
      setError('Type your question first, then press Ask.');
      fieldRef.current?.focus();
      return;
    }
    setError(null);
    startTransition(() => router.push(buildChatHref(text)));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const fill = (text: string) => {
    setQuestion(text);
    setError(null);
    fieldRef.current?.focus();
  };

  return (
    <section aria-labelledby={`${id}-title`} className="surface flex flex-col gap-4 p-5 sm:p-6">
      <div>
        <h2 id={`${id}-title`} className="title title-lg">
          Ask a legal question
        </h2>
        <p className="muted mt-1 text-sm">
          Describe your situation in a sentence or two. Please leave out phone numbers, Aadhaar
          numbers and other personal IDs.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <div className="field">
          <label htmlFor={`${id}-q`} className="label">
            Your question
          </label>
          <div className="composer has-[textarea[aria-invalid=true]]:border-danger flex-col items-stretch sm:flex-row sm:items-end">
            <textarea
              id={`${id}-q`}
              ref={fieldRef}
              value={question}
              onChange={(event) => {
                setQuestion(event.target.value);
                if (error) setError(null);
              }}
              onKeyDown={onKeyDown}
              maxLength={MAX_QUESTION_LENGTH}
              rows={3}
              placeholder="For example: my landlord will not return my deposit"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${errorId} ${hintId}` : hintId}
              className="min-h-[5.25rem] sm:min-h-[4.5rem]"
            />
            <button
              type="submit"
              className="btn btn-primary btn-lg sm:shrink-0"
              aria-busy={pending ? true : undefined}
            >
              {pending ? 'Opening chat' : 'Ask'}
              {pending ? null : <ArrowRightIcon />}
            </button>
          </div>
          {error && (
            <p id={errorId} className="field-error" role="alert">
              {error}
            </p>
          )}
          <p id={hintId} className="hint">
            <span className="kbd">Enter</span> to ask, <span className="kbd">Shift</span> +{' '}
            <span className="kbd">Enter</span> for a new line.
          </p>
        </div>
      </form>

      <div role="group" aria-label="Example questions" className="flex flex-col gap-2">
        <p className="caps subtle">Or start from an example</p>
        <div className="grid grid-cols-2 gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example.label}
              type="button"
              className="chip min-h-10 justify-center"
              onClick={() => fill(example.question)}
            >
              {example.label}
            </button>
          ))}
        </div>
      </div>

      <ModeNote />
    </section>
  );
}
