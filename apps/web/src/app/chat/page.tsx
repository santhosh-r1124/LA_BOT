'use client';

import { MANDATORY_DISCLAIMER } from '@legal-platform/shared';
import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { LegalText } from '@/components/legal-text';
import { StatusBadge } from '@/components/ui';
import { ApiRequestError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  chatClient,
  type ChatMessageOut,
  type ConversationSummary,
  type SourceOut,
} from '@/lib/chat-client';
import { usePlatformStatus } from '@/lib/status-client';

const CONVERSATION_KEY = 'lp_chat_conversation_id';

// FRD example questions — shown on a fresh conversation.
const SUGGESTED_QUESTIONS = [
  'What is an affidavit?',
  'What documents are generally required for an affidavit?',
  'What is the difference between an agreement and a contract?',
  'What information is normally included in a rental agreement?',
  'What are the basic requirements for an employment agreement?',
  'What is the process for registering a company in India?',
];

const JURISDICTION_LABEL: Record<string, string> = {
  CENTRAL: 'Central law',
  STATE: 'Varies by state',
  LOCAL: 'Local rules apply',
  DISTRICT: 'District-level procedure',
  COURT: 'Depends on court jurisdiction',
  REGISTRATION_AUTHORITY: 'Registration authority',
  STAMP_DUTY: 'Stamp duty varies by state',
};

function titleCase(value: string): string {
  return value
    .split('_')
    .map((w) => (w === 'IT' || w === 'IP' ? w : w[0] + w.slice(1).toLowerCase()))
    .join(' ');
}

interface StreamingTurn {
  text: string;
  sources: SourceOut[] | null;
  category: string | null;
  jurisdiction: string | null;
}

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) — conversation just won't persist */
  }
}

export default function ChatPage() {
  const { user, accessToken, loading: authLoading } = useAuth();
  const { state: statusState } = usePlatformStatus();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageOut[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState<StreamingTurn | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ message: string; retryText?: string } | null>(null);
  const [disclaimer, setDisclaimer] = useState(MANDATORY_DISCLAIMER);
  const [history, setHistory] = useState<ConversationSummary[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [showHistoryMobile, setShowHistoryMobile] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Restore a saved conversation once auth state has settled.
  useEffect(() => {
    if (authLoading) return;
    const saved = storageGet(CONVERSATION_KEY);
    if (!saved) return;
    let cancelled = false;
    chatClient
      .getConversation(saved, accessToken)
      .then((detail) => {
        if (cancelled) return;
        setConversationId(detail.id);
        setMessages(detail.messages);
      })
      .catch(() => storageSet(CONVERSATION_KEY, null));
    return () => {
      cancelled = true;
    };
  }, [authLoading, accessToken]);

  // Signed-in users see their history in the sidebar.
  useEffect(() => {
    if (!accessToken) {
      setHistory(null);
      return;
    }
    let cancelled = false;
    chatClient
      .listConversations(accessToken)
      .then((rows) => !cancelled && setHistory(rows))
      .catch(() => !cancelled && setHistoryError(true));
    return () => {
      cancelled = true;
    };
  }, [accessToken, conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streaming?.text]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function handleSend(text?: string) {
    const content = (text ?? input).trim();
    if (!content || sending) return;
    setError(null);
    setInput('');
    setSending(true);

    const pendingId = `pending-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: pendingId,
        role: 'user',
        content,
        legal_category: null,
        jurisdiction_scope: null,
        is_out_of_scope: null,
        risk_level: null,
        created_at: new Date().toISOString(),
      },
    ]);
    setStreaming({ text: '', sources: null, category: null, jurisdiction: null });

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await chatClient.streamMessage(content, conversationId, accessToken, {
        signal: controller.signal,
        onStart: (start) =>
          setStreaming((s) => ({
            text: s?.text ?? '',
            sources: start.sources,
            category: start.is_out_of_scope ? null : start.legal_category,
            jurisdiction: start.jurisdiction_scope,
          })),
        onDelta: (delta) => setStreaming((s) => (s ? { ...s, text: s.text + delta } : s)),
      });
      setDisclaimer(res.disclaimer);
      setConversationId(res.conversation_id);
      storageSet(CONVERSATION_KEY, res.conversation_id);
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== pendingId),
        res.user_message,
        res.assistant_message,
      ]);
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== pendingId));
      if (err instanceof DOMException && err.name === 'AbortError') {
        setInput(content);
        setError({ message: 'Stopped. Nothing from that turn was saved.' });
      } else {
        setError({
          message:
            err instanceof ApiRequestError
              ? err.message
              : 'Something went wrong reaching the assistant.',
          retryText: content,
        });
      }
    } finally {
      abortRef.current = null;
      setStreaming(null);
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function handleNewConversation() {
    abortRef.current?.abort();
    setConversationId(null);
    setMessages([]);
    setError(null);
    storageSet(CONVERSATION_KEY, null);
    inputRef.current?.focus();
  }

  async function loadConversation(id: string) {
    try {
      const detail = await chatClient.getConversation(id, accessToken);
      setConversationId(detail.id);
      setMessages(detail.messages);
      storageSet(CONVERSATION_KEY, detail.id);
      setShowHistoryMobile(false);
      setError(null);
    } catch (err) {
      setError({
        message: err instanceof ApiRequestError ? err.message : 'Could not load that conversation.',
      });
    }
  }

  function onInputKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  const status = statusState.kind === 'ready' ? statusState.status : null;
  const llmMissing = status !== null && !status.llm.configured;
  const kbEmpty =
    status !== null && status.knowledge_base.available && !status.knowledge_base.documents_indexed;
  // Replies with no backing source are general-knowledge answers unless the
  // server runs in strict sources-only mode.
  const generalAnswers = status?.features?.general_answers ?? true;

  const historyPanel = (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={handleNewConversation} className="btn btn-secondary w-full">
        New conversation
      </button>
      {user ? (
        <nav aria-label="Conversation history" className="mt-2">
          <p className="subtle px-2 pb-1 text-xs font-semibold uppercase tracking-wider">History</p>
          {historyError ? (
            <p className="text-danger px-2 text-xs">Couldn&apos;t load history.</p>
          ) : history === null ? (
            <div className="flex flex-col gap-2 px-2" role="status">
              <span className="sr-only">Loading history</span>
              <div className="skeleton h-4" />
              <div className="skeleton h-4 w-3/4" />
            </div>
          ) : history.length === 0 ? (
            <p className="subtle px-2 text-xs">No past conversations yet.</p>
          ) : (
            <ul className="flex max-h-[60vh] flex-col overflow-y-auto">
              {history.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => void loadConversation(c.id)}
                    aria-current={c.id === conversationId ? 'true' : undefined}
                    className={`w-full truncate rounded-md px-2 py-1.5 text-left text-sm ${
                      c.id === conversationId
                        ? 'text-fg bg-white/[0.07]'
                        : 'text-fg-muted hover:text-fg hover:bg-white/[0.04]'
                    }`}
                  >
                    {c.title || 'Untitled conversation'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>
      ) : (
        <p className="subtle mt-2 px-1 text-xs leading-relaxed">
          You&apos;re chatting anonymously.{' '}
          <Link href="/login" className="link">
            Log in
          </Link>{' '}
          to keep your history across devices.
        </p>
      )}
    </div>
  );

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden lg:block">
        <div className="sticky top-20">{historyPanel}</div>
      </aside>

      <section className="flex min-h-[calc(100dvh-7.5rem)] flex-col">
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="display text-2xl">Legal chat</h1>
            <p className="muted mt-1 text-sm" aria-live="polite">
              {statusState.kind === 'loading' && 'Checking the knowledge base…'}
              {statusState.kind === 'error' && 'Knowledge base status unavailable.'}
              {status &&
                (status.knowledge_base.documents_indexed
                  ? `Answers cite ${status.knowledge_base.documents_indexed} indexed official source${status.knowledge_base.documents_indexed === 1 ? '' : 's'} where they match.`
                  : generalAnswers
                    ? 'General information about Indian law, in plain language.'
                    : 'Answers are grounded only in indexed official sources.')}
            </p>
          </div>
          <div className="flex gap-2 lg:hidden">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              aria-expanded={showHistoryMobile}
              aria-controls="mobile-history"
              onClick={() => setShowHistoryMobile((v) => !v)}
            >
              {showHistoryMobile ? 'Hide history' : 'History'}
            </button>
          </div>
        </header>

        {showHistoryMobile && (
          <div id="mobile-history" className="surface mb-4 p-3 lg:hidden">
            {historyPanel}
          </div>
        )}

        {llmMissing && (
          <div className="alert alert-danger mb-4" role="alert">
            <div>
              <p className="font-semibold">The assistant isn&apos;t configured on this server.</p>
              <p className="muted mt-0.5 text-sm">
                An administrator needs to set a model provider key (free options: Gemini, Groq, or a
                local Ollama model). Messages will fail until then.
              </p>
            </div>
          </div>
        )}
        {!llmMissing && kbEmpty && (
          <div className="alert alert-warn mb-4" role="status">
            <div>
              <p className="font-semibold">No official legal sources have been indexed yet.</p>
              <p className="muted mt-0.5 text-sm">
                {generalAnswers
                  ? 'Answers are general information from the AI model, not quotes from official texts. Verify anything important on India Code or with an advocate.'
                  : "Rather than guess, the assistant will say it doesn't have enough verified information until official sources are loaded."}
              </p>
            </div>
          </div>
        )}

        <div
          className="flex-1"
          role="log"
          aria-live="polite"
          aria-busy={sending}
          aria-label="Conversation"
        >
          {messages.length === 0 && !streaming ? (
            <div className="flex flex-col items-start gap-4 py-8">
              <p className="muted text-sm">Try one of these, or ask your own question:</p>
              <div className="grid w-full gap-2 sm:grid-cols-2">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => void handleSend(q)}
                    disabled={sending}
                    className="surface-flat surface-interactive px-4 py-3 text-left text-sm"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ol className="flex flex-col gap-5">
              {messages.map((m, i) => {
                const prev = i > 0 ? messages[i - 1] : undefined;
                return (
                  <li key={m.id}>
                    {m.role === 'user' ? (
                      <UserBubble text={m.content} />
                    ) : (
                      <AssistantMessage
                        id={m.id}
                        text={m.content}
                        general={generalAnswers && Array.isArray(m.sources) && m.sources.length === 0}
                        sources={m.sources ?? null}
                        category={
                          prev?.role === 'user' && !prev.is_out_of_scope
                            ? prev.legal_category
                            : null
                        }
                        jurisdiction={prev?.role === 'user' ? prev.jurisdiction_scope : null}
                      />
                    )}
                  </li>
                );
              })}
              {streaming && (
                <li>
                  <AssistantMessage
                    id="streaming"
                    text={streaming.text}
                    general={
                      generalAnswers &&
                      Array.isArray(streaming.sources) &&
                      streaming.sources.length === 0
                    }
                    sources={streaming.sources}
                    category={streaming.category}
                    jurisdiction={streaming.jurisdiction}
                    pending
                  />
                </li>
              )}
            </ol>
          )}
          <div ref={bottomRef} />
        </div>

        {error && (
          <div className="alert alert-danger mt-4 items-center justify-between" role="alert">
            <p className="text-sm">{error.message}</p>
            {error.retryText && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void handleSend(error.retryText)}
              >
                Retry
              </button>
            )}
          </div>
        )}

        <div className="surface sticky bottom-3 mt-4 bg-elevated/95 p-2">
          <label htmlFor="chat-input" className="sr-only">
            Ask a legal question
          </label>
          <div className="flex items-end gap-2">
            <textarea
              id="chat-input"
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onInputKeyDown}
              rows={2}
              maxLength={4000}
              placeholder="Ask a question about Indian law…"
              className="text-fg placeholder:text-fg-subtle max-h-48 min-h-[2.75rem] flex-1 resize-y bg-transparent px-3 py-2 text-sm focus:outline-none"
            />
            {sending ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="btn btn-secondary"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!input.trim()}
                className="btn btn-primary"
              >
                Send
              </button>
            )}
          </div>
          <p className="subtle px-3 pb-1 text-[11px]">Enter to send · Shift+Enter for a new line</p>
        </div>

        <p className="subtle mt-4 text-center text-xs leading-relaxed">{disclaimer}</p>
      </section>
    </main>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="border-accent/25 bg-accent-soft max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md border px-4 py-2.5 text-sm">
        <span className="sr-only">You: </span>
        {text}
      </div>
    </div>
  );
}

function AssistantMessage({
  id,
  text,
  general,
  sources,
  category,
  jurisdiction,
  pending = false,
}: {
  id: string;
  text: string;
  /** No indexed source backs this reply: it's general AI-generated information. */
  general: boolean;
  sources: SourceOut[] | null;
  category: string | null;
  jurisdiction: string | null;
  pending?: boolean;
}) {
  const prefix = `src-${id}`;
  const jurisdictionLabel = jurisdiction ? JURISDICTION_LABEL[jurisdiction] : undefined;
  return (
    <article className="surface-flat p-4 sm:p-5" aria-label="Assistant answer">
      {(category || jurisdictionLabel || general) && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {category && <StatusBadge tone="accent">{titleCase(category)}</StatusBadge>}
          {general && <StatusBadge tone="neutral">General information</StatusBadge>}
          {jurisdictionLabel && (
            <StatusBadge tone={jurisdiction === 'CENTRAL' ? 'neutral' : 'warn'}>
              {jurisdictionLabel}
            </StatusBadge>
          )}
        </div>
      )}

      {text ? (
        <LegalText text={text} sourceIdPrefix={prefix} sourceCount={sources?.length ?? 0} />
      ) : (
        <div role="status" className="flex flex-col gap-2">
          <span className="muted text-sm">Thinking about your question…</span>
          <div className="skeleton h-3.5 w-full" />
          <div className="skeleton h-3.5 w-5/6" />
        </div>
      )}
      {pending && text && (
        <span className="bg-accent ml-1 inline-block h-4 w-1.5 animate-pulse align-middle" />
      )}

      {general && text && !pending && (
        <p className="subtle border-line mt-4 border-t pt-3 text-xs leading-relaxed">
          Not drawn from the platform&apos;s indexed official sources. Check important details
          against the official text on{' '}
          <a
            href="https://www.indiacode.nic.in/"
            target="_blank"
            rel="noreferrer noopener"
            className="link"
          >
            India Code
          </a>{' '}
          or with an advocate.
        </p>
      )}

      {sources && sources.length > 0 && (
        <div className="border-line mt-4 border-t pt-3">
          <p className="subtle mb-1.5 text-xs font-semibold uppercase tracking-wider">Sources</p>
          <ol className="flex flex-col gap-1 text-sm">
            {sources.map((s, i) => (
              <li key={`${s.document_id}-${i}`} id={`${prefix}-${i + 1}`} className="flex gap-2">
                <span className="cite shrink-0">{i + 1}</span>
                <a href={s.source_url} target="_blank" rel="noreferrer noopener" className="link">
                  {s.document_title}
                  {s.section ? `, Section ${s.section}` : ''}
                  {s.article ? `, Article ${s.article}` : ''}
                  <span className="sr-only"> (opens official source in a new tab)</span>
                </a>
              </li>
            ))}
          </ol>
        </div>
      )}
    </article>
  );
}
