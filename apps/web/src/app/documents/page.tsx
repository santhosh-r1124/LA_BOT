'use client';

import { MANDATORY_DISCLAIMER } from '@legal-platform/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { LegalText } from '@/components/legal-text';
import { Disclaimer, EmptyState, ErrorState, PageHeader } from '@/components/ui';
import { ApiRequestError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { documentClient, type DocumentTypeInfoOut, type QuestionOut } from '@/lib/document-client';

// Acronyms that should stay all-caps rather than being title-cased.
const ACRONYMS = new Set(['NDA']);

function formatTypeLabel(documentType: string): string {
  return documentType
    .split('_')
    .map((w) => (ACRONYMS.has(w) ? w : w[0] + w.slice(1).toLowerCase()))
    .join(' ');
}

export default function DocumentsPage() {
  const { accessToken } = useAuth();
  const [types, setTypes] = useState<DocumentTypeInfoOut[] | null>(null);
  const [typesError, setTypesError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DocumentTypeInfoOut | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ text: string; disclaimer: string; type: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  const loadTypes = useCallback(() => {
    setTypesError(null);
    setTypes(null);
    documentClient
      .listTypes()
      .then(setTypes)
      .catch((err: unknown) =>
        setTypesError(
          err instanceof ApiRequestError && err.code !== 'network_error'
            ? err.message
            : 'The document service is unreachable right now.',
        ),
      );
  }, []);

  useEffect(() => loadTypes(), [loadTypes]);

  function selectType(info: DocumentTypeInfoOut) {
    setSelected(info);
    setAnswers({});
    setDraft(null);
    setAttempted(false);
    setSubmitError(null);
  }

  function reset() {
    setSelected(null);
    setAnswers({});
    setDraft(null);
    setAttempted(false);
    setSubmitError(null);
  }

  const missingRequired =
    selected?.questions.filter((q) => q.required && !(answers[q.key] || '').trim()) ?? [];

  async function handleSubmit() {
    if (!selected || submitting) return;
    setAttempted(true);
    if (missingRequired.length > 0) {
      document.getElementById(`q-${missingRequired[0]?.key}`)?.focus();
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await documentClient.create(selected.document_type, answers, accessToken);
      setDraft({
        text: res.document.draft_text,
        disclaimer: res.disclaimer,
        type: selected.document_type,
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setSubmitError(
        err instanceof ApiRequestError ? err.message : 'Could not generate the draft. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function copyDraft() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function downloadDraft() {
    if (!draft) return;
    const blob = new Blob([draft.text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${draft.type.toLowerCase()}-draft.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="page page-narrow">
      <PageHeader
        eyebrow="Document assistant"
        title={draft ? `${formatTypeLabel(draft.type)} — draft` : 'Prepare a legal document'}
        description="Answer a few questions to get a labelled draft, plus notes on what's normally required, stamping, registration and professional review."
      />

      {draft ? (
        <section className="flex flex-col gap-4">
          <div className="alert alert-warn" role="note">
            <p className="text-sm">
              This is a <strong>draft for review</strong>, not an executed document. Stamp duty,
              notarisation and registration requirements vary by state — have an advocate review it
              before use.
            </p>
          </div>
          <div className="surface p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => void copyDraft()}
                className="btn btn-secondary btn-sm"
              >
                <span aria-live="polite">{copied ? 'Copied' : 'Copy text'}</span>
              </button>
              <button type="button" onClick={downloadDraft} className="btn btn-secondary btn-sm">
                Download .txt
              </button>
            </div>
            <LegalText text={draft.text} />
          </div>
          <p className="subtle text-xs leading-relaxed">{draft.disclaimer}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={reset} className="btn btn-secondary">
              Start another document
            </button>
            <Link href="/advocates" className="btn btn-ghost">
              Find an advocate to review it
            </Link>
          </div>
        </section>
      ) : selected ? (
        <section className="surface p-5 sm:p-6" aria-labelledby="form-heading">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="btn btn-ghost btn-sm -ml-2 mb-3"
          >
            ← All document types
          </button>
          <h2 id="form-heading" className="display text-xl">
            {formatTypeLabel(selected.document_type)}
          </h2>
          <p className="subtle mt-1 text-xs">Fields marked * are required.</p>

          <form
            className="mt-5 flex flex-col gap-5"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit();
            }}
          >
            {selected.questions.map((q: QuestionOut) => {
              const invalid = attempted && q.required && !(answers[q.key] || '').trim();
              const describedBy = [q.help_text ? `h-${q.key}` : '', invalid ? `e-${q.key}` : '']
                .filter(Boolean)
                .join(' ');
              return (
                <div key={q.key} className="flex flex-col gap-1.5">
                  <label htmlFor={`q-${q.key}`} className="label">
                    {q.label}
                    {q.required ? (
                      <span className="text-accent" aria-hidden="true">
                        {' '}
                        *
                      </span>
                    ) : (
                      <span className="subtle font-normal"> (optional)</span>
                    )}
                  </label>
                  {q.help_text && (
                    <span id={`h-${q.key}`} className="hint">
                      {q.help_text}
                    </span>
                  )}
                  <textarea
                    id={`q-${q.key}`}
                    value={answers[q.key] ?? ''}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [q.key]: e.target.value }))}
                    rows={2}
                    required={q.required}
                    aria-invalid={invalid || undefined}
                    aria-describedby={describedBy || undefined}
                    className="input resize-y"
                  />
                  {invalid && (
                    <span id={`e-${q.key}`} className="field-error">
                      This field is required.
                    </span>
                  )}
                </div>
              );
            })}

            {submitError && (
              <ErrorState
                title="The draft couldn't be generated"
                message={submitError}
                onRetry={() => void handleSubmit()}
              />
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={submitting} className="btn btn-primary">
                {submitting ? 'Drafting…' : 'Generate draft'}
              </button>
              {submitting && (
                <span className="muted text-sm" role="status">
                  Drafting usually takes 10–40 seconds on the free model tier.
                </span>
              )}
              {attempted && missingRequired.length > 0 && !submitting && (
                <span className="field-error" role="alert">
                  {missingRequired.length} required field{missingRequired.length === 1 ? '' : 's'}{' '}
                  still empty.
                </span>
              )}
            </div>
          </form>
        </section>
      ) : (
        <section aria-label="Document types">
          {typesError ? (
            <ErrorState
              title="Document types unavailable"
              message={typesError}
              onRetry={loadTypes}
            />
          ) : types === null ? (
            <div className="grid gap-2 sm:grid-cols-2" role="status">
              <span className="sr-only">Loading document types</span>
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="skeleton h-14" />
              ))}
            </div>
          ) : types.length === 0 ? (
            <EmptyState title="No document types available" />
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {types.map((info) => (
                <li key={info.document_type}>
                  <button
                    type="button"
                    onClick={() => selectType(info)}
                    className="surface-flat surface-interactive flex w-full items-center justify-between px-4 py-3.5 text-left"
                  >
                    <span className="font-medium">{formatTypeLabel(info.document_type)}</span>
                    <span className="subtle text-xs">{info.questions.length} questions</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Disclaimer text={MANDATORY_DISCLAIMER} />
    </main>
  );
}
