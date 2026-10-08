'use client';

import { MANDATORY_DISCLAIMER } from '@legal-platform/shared';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertIcon, InfoIcon, RefreshIcon } from '@/components/icons';
import {
  chatClient,
  type AnswerMode,
  type ChatMessageOut,
  type ConversationSummary,
  type RecommendedAdvocate,
  type SourceOut,
} from '@/lib/chat-client';
import { useAuth } from '@/lib/auth-context';
import { usePlatformStatus } from '@/lib/status-client';
import {
  classifyChatError,
  inferAnswerMode,
  readLlmMode,
  readQuestionParam,
  type ChatFailure,
  type RiskLevel,
} from './chat-helpers';
import { HistoryIcon, PlusIcon } from './chat-icons';
import styles from './chat.module.css';
import { Composer } from './composer';
import { EmptyState } from './empty-state';
import { AssistantReply, UserMessage, type ReplyData } from './message';
import { EmptyLibraryNotice, ModeNotice, NoticeSkeleton, StatusErrorNotice } from './notices';
import { Drawer, HistoryPanel, type SetupSummary } from './sidebar';

const CONVERSATION_KEY = 'lp_chat_conversation_id';

/**
 * `retryText`: the question can be resent as is. `keptText`: the question is
 * still shown in the thread as "not sent" and can be pulled back into the box.
 */
type Failure = ChatFailure & { retryText?: string; keptText?: string };

interface StreamingTurn {
  text: string;
  /** Unknown until the first event arrives. */
  mode: AnswerMode | null;
  stage: 'classifying' | 'writing';
  sources: SourceOut[] | null;
  category: string | null;
  jurisdiction: string | null;
  risk: RiskLevel | null;
  outOfScope: boolean;
  advocates: RecommendedAdvocate[];
  question: string;
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
    /* storage unavailable (private mode): the conversation just won't persist */
  }
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function hasFinePointer(): boolean {
  return window.matchMedia?.('(pointer: fine)').matches ?? true;
}

export default function ChatPage() {
  const { user, accessToken, loading: authLoading } = useAuth();
  const { state: statusState, reload: reloadStatus } = usePlatformStatus();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageOut[]>([]);
  const [input, setInput] = useState('');
  const [emptyHint, setEmptyHint] = useState(false);
  const [advocatesByMessage, setAdvocatesByMessage] = useState<Record<string, RecommendedAdvocate[]>>({});
  const [modeByMessage, setModeByMessage] = useState<Record<string, AnswerMode>>({});
  const [streaming, setStreaming] = useState<StreamingTurn | null>(null);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [disclaimer, setDisclaimer] = useState(MANDATORY_DISCLAIMER);
  const [history, setHistory] = useState<ConversationSummary[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [historyNonce, setHistoryNonce] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  /** Set when a running reply is cancelled because the user switched conversation. */
  const discardRef = useRef(false);
  const bootedRef = useRef(false);
  const scrollToEndRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingUserRef = useRef<HTMLLIElement | null>(null);
  const failureRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const sendRef = useRef<(text?: string) => Promise<void>>(async () => {});

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  /* ---- Status ------------------------------------------------------------- */
  const status = statusState.kind === 'ready' ? statusState.status : null;
  const llmMode = readLlmMode(status);
  const generalAnswers = status?.features?.general_answers ?? true;
  const libraryDocs = status?.knowledge_base.documents_indexed ?? null;
  const kbEmpty = status !== null && status.knowledge_base.available && libraryDocs === 0;

  /* ---- Per-message data ---------------------------------------------------- */
  const replies = useMemo(() => {
    const out = new Map<string, ReplyData>();
    messages.forEach((m, i) => {
      if (m.role !== 'assistant') return;
      const prev = i > 0 ? messages[i - 1] : undefined;
      const asked = prev?.role === 'user' ? prev : undefined;
      const mode = modeByMessage[m.id] ?? inferAnswerMode(m.content, m.answer_mode);
      const sources = m.sources ?? null;
      out.set(m.id, {
        id: m.id,
        text: m.content,
        mode,
        sources,
        category: asked && !asked.is_out_of_scope ? asked.legal_category : null,
        jurisdiction: asked && !asked.is_out_of_scope ? asked.jurisdiction_scope : null,
        risk: asked && !asked.is_out_of_scope ? asked.risk_level : null,
        outOfScope: Boolean(asked?.is_out_of_scope),
        advocates: advocatesByMessage[m.id] ?? null,
        general: mode === 'ai' && generalAnswers && Array.isArray(sources) && sources.length === 0,
        question: asked?.content ?? null,
      });
    });
    return out;
  }, [messages, modeByMessage, advocatesByMessage, generalAnswers]);

  const latestReplyMode = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m?.role === 'assistant') return replies.get(m.id)?.mode ?? null;
    }
    return null;
  }, [messages, replies]);

  const offline = llmMode === 'offline' || latestReplyMode === 'sources_only';

  const sourceDatasets = status?.knowledge_base.sources ?? [];
  const fixtureOnly = sourceDatasets.length > 0 && sourceDatasets.every((s) => /fixture/i.test(s.dataset));
  const sampleAdvocates = status?.advocate_directory.sample_advocates ?? null;
  const totalAdvocates = status?.advocate_directory.verified_advocates ?? null;
  const advocatesAreSamples = sampleAdvocates !== null && sampleAdvocates > 0 && sampleAdvocates === totalAdvocates;

  const setup: SetupSummary | null = status
    ? {
        aiOn: llmMode === null ? null : llmMode === 'ai',
        documents: libraryDocs,
        fixtureOnly,
        advocates: totalAdvocates,
        advocatesAreSamples,
      }
    : null;

  const modeDetails = [
    'Replies are assembled from library passages, not written by an AI model, so you read the source text itself.',
    'The topic, risk and jurisdiction labels come from fixed rules rather than a model. Treat them as a guide.',
    fixtureOnly ? 'The library in this setup holds test fixture passages, not real judgments.' : null,
    advocatesAreSamples ? 'Advocate listings in this setup are synthetic samples, not real people.' : null,
  ].filter((line): line is string => line !== null);

  /* ---- Effects -------------------------------------------------------------- */

  // Signed-in users see their history in the sidebar.
  useEffect(() => {
    if (!accessToken) {
      setHistory(null);
      setHistoryError(false);
      return;
    }
    let cancelled = false;
    setHistoryError(false);
    chatClient
      .listConversations(accessToken)
      .then((rows) => !cancelled && setHistory(rows))
      .catch(() => !cancelled && setHistoryError(true));
    return () => {
      cancelled = true;
    };
  }, [accessToken, conversationId, historyNonce]);

  // A conversation that was just loaded opens at its latest message.
  useEffect(() => {
    if (!scrollToEndRef.current) return;
    scrollToEndRef.current = false;
    // Land on the latest message with the box in view, not on the site footer below.
    const main = mainRef.current;
    if (!main) return;
    const bottom = main.getBoundingClientRect().bottom + window.scrollY;
    window.scrollTo({ top: Math.max(0, bottom - window.innerHeight), behavior: 'auto' });
  }, [messages]);

  // Sending: bring the new question to the top so the reply grows below it.
  useEffect(() => {
    if (!sending) return;
    const el = pendingUserRef.current;
    if (!el) return;
    // Only move the page when the question is not already comfortably in view.
    const rect = el.getBoundingClientRect();
    const headerRoom = 72;
    const dockRoom = 180;
    if (rect.top >= headerRoom && rect.bottom <= window.innerHeight - dockRoom) return;
    el.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [sending]);

  // An error must never sit out of sight below the fold.
  useEffect(() => {
    if (!failure) return;
    failureRef.current?.scrollIntoView({
      block: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, [failure]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /* ---- Actions --------------------------------------------------------------- */

  async function handleSend(text?: string) {
    const content = (text ?? input).trim();
    if (!content) {
      setEmptyHint(true);
      inputRef.current?.focus();
      return;
    }
    if (sendingRef.current) return;
    sendingRef.current = true;
    discardRef.current = false;
    setFailure(null);
    setEmptyHint(false);
    // Clear the box when the sent text is what is in it (typed or restored), but
    // leave an unrelated draft alone when a suggestion is clicked.
    if (content === input.trim()) setInput('');
    setSending(true);

    const pendingId = `pending-${Date.now()}`;
    setMessages((prev) => [
      ...prev.filter((m) => !m.id.startsWith('pending-')),
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
    setStreaming({
      text: '',
      mode: null,
      stage: 'classifying',
      sources: null,
      category: null,
      jurisdiction: null,
      risk: null,
      outOfScope: false,
      advocates: [],
      question: content,
    });

    const controller = new AbortController();
    abortRef.current = controller;
    let startMode: AnswerMode | undefined;
    try {
      const res = await chatClient.streamMessage(content, conversationId, accessToken, {
        signal: controller.signal,
        onStart: (start) => {
          startMode = start.answer_mode ?? 'ai';
          setStreaming((s) => ({
            text: s?.text ?? '',
            mode: start.answer_mode ?? 'ai',
            stage: 'writing',
            sources: start.sources,
            category: start.is_out_of_scope ? null : start.legal_category,
            jurisdiction: start.is_out_of_scope ? null : start.jurisdiction_scope,
            risk: start.is_out_of_scope ? null : start.risk_level,
            outOfScope: start.is_out_of_scope,
            advocates: start.recommended_advocates ?? [],
            question: content,
          }));
        },
        onDelta: (delta) => setStreaming((s) => (s ? { ...s, text: s.text + delta } : s)),
      });
      setDisclaimer(res.disclaimer);
      setConversationId(res.conversation_id);
      storageSet(CONVERSATION_KEY, res.conversation_id);
      setAdvocatesByMessage((prev) => ({
        ...prev,
        [res.assistant_message.id]: res.recommended_advocates ?? [],
      }));
      setModeByMessage((prev) => ({
        ...prev,
        [res.assistant_message.id]: res.answer_mode ?? startMode ?? 'ai',
      }));
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== pendingId),
        res.user_message,
        res.assistant_message,
      ]);
    } catch (err) {
      if (discardRef.current) {
        setMessages((prev) => prev.filter((m) => m.id !== pendingId));
      } else {
        const classified = classifyChatError(err);
        if (classified.kind === 'stopped') {
          // Nothing was saved: the question goes back into the box to edit.
          setMessages((prev) => prev.filter((m) => m.id !== pendingId));
          setInput(content);
          setFailure(classified);
        } else {
          // Keep the question in the thread, marked as not sent, with the error under it.
          setFailure({
            ...classified,
            retryText: classified.retryable ? content : undefined,
            keptText: content,
          });
        }
      }
    } finally {
      abortRef.current = null;
      sendingRef.current = false;
      setStreaming(null);
      setSending(false);
      if (hasFinePointer()) inputRef.current?.focus();
    }
  }

  useEffect(() => {
    sendRef.current = handleSend;
  });

  function handleStop() {
    abortRef.current?.abort();
  }

  function startFresh() {
    discardRef.current = true;
    abortRef.current?.abort();
    setConversationId(null);
    setMessages([]);
    setStreaming(null);
    setFailure(null);
    setEmptyHint(false);
    setRestoring(false);
    storageSet(CONVERSATION_KEY, null);
  }

  function handleNewConversation() {
    startFresh();
    setDrawerOpen(false);
    inputRef.current?.focus();
  }

  async function openConversation(id: string) {
    discardRef.current = true;
    abortRef.current?.abort();
    setLoadingId(id);
    setRestoring(true);
    setFailure(null);
    try {
      const detail = await chatClient.getConversation(id, accessToken);
      scrollToEndRef.current = true;
      setConversationId(detail.id);
      setMessages(detail.messages);
      storageSet(CONVERSATION_KEY, detail.id);
      setDrawerOpen(false);
    } catch (err) {
      setFailure({
        ...classifyChatError(err),
        title: 'Could not open that conversation',
        message: 'It may have been removed, or the server did not answer. Try again in a moment.',
        retryable: false,
        needsLogin: false,
        retryText: undefined,
      });
    } finally {
      setLoadingId(null);
      setRestoring(false);
    }
  }

  function editFailedQuestion() {
    if (!failure?.keptText) return;
    const text = failure.keptText;
    setMessages((prev) => prev.filter((m) => !m.id.startsWith('pending-')));
    setFailure(null);
    setInput(text);
    inputRef.current?.focus();
  }

  function reuseQuestion(question: string) {
    setInput(question);
    setEmptyHint(false);
    inputRef.current?.focus();
  }

  // Once the session has settled: start from `?q=` if there is one (and clear it
  // from the address bar), otherwise restore the saved conversation. The timer
  // makes React's dev double-mount harmless: only the second effect survives.
  useEffect(() => {
    if (authLoading || bootedRef.current) return;
    const timer = window.setTimeout(() => {
      if (bootedRef.current) return;
      bootedRef.current = true;

      const question = readQuestionParam(window.location.search);
      if (question !== null) {
        const url = new URL(window.location.href);
        url.searchParams.delete('q');
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
        storageSet(CONVERSATION_KEY, null);
        void sendRef.current(question);
        return;
      }

      const saved = storageGet(CONVERSATION_KEY);
      if (!saved) return;
      setRestoring(true);
      chatClient
        .getConversation(saved, accessToken)
        .then((detail) => {
          scrollToEndRef.current = true;
          setConversationId(detail.id);
          setMessages(detail.messages);
        })
        .catch(() => storageSet(CONVERSATION_KEY, null))
        .finally(() => setRestoring(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, accessToken]);

  /* ---- Render ------------------------------------------------------------------ */

  const lastPendingId = [...messages].reverse().find((m) => m.id.startsWith('pending-'))?.id;
  const isEmpty = messages.length === 0 && !streaming && !restoring;

  const streamingReply: ReplyData | null = streaming
    ? {
        id: 'streaming',
        text: streaming.text,
        mode: streaming.mode,
        sources: streaming.sources,
        category: streaming.category,
        jurisdiction: streaming.jurisdiction,
        risk: streaming.risk,
        outOfScope: streaming.outOfScope,
        advocates: streaming.advocates,
        general:
          streaming.mode === 'ai' &&
          generalAnswers &&
          Array.isArray(streaming.sources) &&
          streaming.sources.length === 0,
        question: streaming.question,
      }
    : null;

  const historyPanel = (
    <HistoryPanel
      signedIn={Boolean(user)}
      history={history}
      historyError={historyError}
      activeId={conversationId}
      loadingId={loadingId}
      onNew={handleNewConversation}
      onSelect={(id) => void openConversation(id)}
      onRetryHistory={() => setHistoryNonce((n) => n + 1)}
      setup={setup}
    />
  );

  const failureClass =
    failure?.tone === 'danger' ? 'alert-danger' : failure?.tone === 'warn' ? 'alert-warn' : 'alert-info';

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar} aria-label="Conversations">
        {historyPanel}
      </aside>

      <Drawer open={drawerOpen} onClose={closeDrawer} title="Conversations">
        {historyPanel}
      </Drawer>

      <main ref={mainRef} className={styles.main}>
        <div className={styles.column}>
          <div className={styles.toolbar}>
            <div className={styles.toolbarTitle}>
              <button
                type="button"
                className={`btn btn-secondary btn-sm ${styles.mobileOnly}`}
                aria-haspopup="dialog"
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen(true)}
              >
                <HistoryIcon />
                History
              </button>
              <h1 className="display text-2xl">Legal chat</h1>
            </div>
            <div className={styles.toolbarActions}>
              <button
                type="button"
                className={`btn btn-secondary btn-sm ${styles.mobileOnly}`}
                onClick={handleNewConversation}
              >
                <PlusIcon />
                New
              </button>
            </div>
          </div>

          {statusState.kind === 'loading' && <NoticeSkeleton />}
          {statusState.kind === 'error' && <StatusErrorNotice onRetry={reloadStatus} />}
          {offline && <ModeNotice details={modeDetails} />}
          {kbEmpty && (
            <EmptyLibraryNotice>
              {offline
                ? 'Replies cannot include any passages until documents are loaded.'
                : generalAnswers
                  ? 'Until then, answers are general information from the AI model, not drawn from any legal document.'
                  : 'Until then, the assistant will say it does not have enough verified information.'}
            </EmptyLibraryNotice>
          )}
        </div>

        <div className={`${styles.column} ${styles.content}`}>
          {restoring ? (
            <div className={styles.restoring} role="status">
              <span className="sr-only">Opening the conversation</span>
              <div className="skeleton skeleton-block ml-auto h-10 w-2/3" aria-hidden="true" />
              <div className="flex flex-col gap-2.5" aria-hidden="true">
                <div className="skeleton h-4 w-24" />
                <div className="skeleton h-4 w-full" />
                <div className="skeleton h-4 w-11/12" />
                <div className="skeleton h-4 w-2/3" />
              </div>
            </div>
          ) : isEmpty ? (
            <EmptyState mode={llmMode} disabled={sending} onPick={(q) => void handleSend(q)} />
          ) : (
            <div role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation" aria-busy={sending}>
              <ol className={styles.thread}>
                {messages.map((m) => {
                  if (m.role === 'user') {
                    return (
                      <li
                        key={m.id}
                        ref={m.id === lastPendingId ? pendingUserRef : undefined}
                        className={styles.turnUser}
                      >
                        <UserMessage text={m.content} />
                        {failure?.keptText !== undefined && m.id === lastPendingId && !sending && (
                          <p className={styles.notSent}>Not sent</p>
                        )}
                      </li>
                    );
                  }
                  const reply = replies.get(m.id);
                  return (
                    <li key={m.id}>
                      {reply && (
                        <AssistantReply
                          reply={reply}
                          libraryDocs={libraryDocs}
                          onReuse={reuseQuestion}
                        />
                      )}
                    </li>
                  );
                })}
                {streamingReply && streaming && (
                  <li key="streaming">
                    <AssistantReply
                      reply={streamingReply}
                      pending
                      stage={streaming.stage}
                      expectCards={llmMode === 'offline'}
                      libraryDocs={libraryDocs}
                    />
                  </li>
                )}
              </ol>
            </div>
          )}

          {failure && (
            <div
              ref={failureRef}
              className={`alert ${failureClass} ${styles.failure}`}
              role={failure.kind === 'stopped' ? 'status' : 'alert'}
            >
              {failure.kind === 'stopped' ? <InfoIcon /> : <AlertIcon />}
              <div>
                <p className="alert-title">{failure.title}</p>
                <p>{failure.message}</p>
                <div className={styles.failureActions}>
                  {failure.retryText && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => void handleSend(failure.retryText)}
                    >
                      <RefreshIcon />
                      Try again
                    </button>
                  )}
                  {failure.needsLogin && (
                    <Link href="/login" className="btn btn-primary btn-sm">
                      Log in
                    </Link>
                  )}
                  {failure.keptText ? (
                    <button
                      type="button"
                      className={`btn btn-ghost btn-sm ${failure.retryText || failure.needsLogin ? '' : '-ml-3'}`}
                      onClick={editFailedQuestion}
                    >
                      Edit question
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`btn btn-ghost btn-sm ${failure.retryText || failure.needsLogin ? '' : '-ml-3'}`}
                      onClick={() => setFailure(null)}
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          <p className={styles.disclaimer} style={{ marginTop: 'auto', paddingTop: '1rem' }}>
            {disclaimer}
          </p>
        </div>

        <div className={styles.dock}>
          <div className={styles.column}>
            <Composer
              value={input}
              onChange={(v) => {
                setInput(v);
                if (emptyHint) setEmptyHint(false);
              }}
              onSend={() => void handleSend()}
              onStop={handleStop}
              sending={sending}
              showEmptyHint={emptyHint}
              inputRef={inputRef}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
