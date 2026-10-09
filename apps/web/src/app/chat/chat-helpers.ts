/**
 * Pure helpers for the chat page: labels, source formatting, parsing the
 * "sources only" reply the server builds when AI answers are off, error
 * classification and history grouping. No React, no DOM, so they are unit
 * tested in chat-helpers.test.ts.
 */
import { ApiRequestError } from '@/lib/api-client';
import type { AnswerMode, ConversationSummary, SourceOut } from '@/lib/chat-client';

/* -------------------------------------------------------------------------- */
/* Labels                                                                     */
/* -------------------------------------------------------------------------- */

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const RISK_META: Record<RiskLevel, { label: string; tone: 'ok' | 'neutral' | 'warn' | 'danger'; hint: string }> = {
  LOW: { label: 'Low', tone: 'ok', hint: 'A general question about how the law works.' },
  MEDIUM: { label: 'Medium', tone: 'neutral', hint: 'Drafting or about-to-do guidance.' },
  HIGH: { label: 'High', tone: 'warn', hint: 'A dispute is already under way. Advice from an advocate is sensible.' },
  CRITICAL: { label: 'Critical', tone: 'danger', hint: 'Arrest, summons or a court order is involved. Speak to an advocate now.' },
};

export const JURISDICTION_LABEL: Record<string, string> = {
  CENTRAL: 'Central law',
  STATE: 'Varies by state',
  LOCAL: 'Local rules apply',
  DISTRICT: 'District-level procedure',
  COURT: 'Depends on the court',
  REGISTRATION_AUTHORITY: 'Registration authority',
  STAMP_DUTY: 'Stamp duty varies by state',
  UNKNOWN: 'Jurisdiction not clear',
};

const KEEP_UPPER = new Set(['IT', 'IP']);

/** `EMPLOYMENT_LAW` -> `Employment Law`, keeping IT and IP upper-case. */
export function categoryLabel(value: string): string {
  return value
    .split('_')
    .map((w) => (KEEP_UPPER.has(w) ? w : (w[0] ?? '') + w.slice(1).toLowerCase()))
    .join(' ');
}

export function isHighStakes(risk: string | null | undefined): boolean {
  return risk === 'HIGH' || risk === 'CRITICAL';
}

/* -------------------------------------------------------------------------- */
/* Answer mode                                                                */
/* -------------------------------------------------------------------------- */

// The first words of the fixed texts the API writes when AI answers are off.
// Used only to recognise old messages loaded from history, which do not carry
// `answer_mode`. Fresh replies always carry it explicitly.
export const SOURCES_ONLY_INTRO_START = 'AI answers are switched off';
export const SOURCES_ONLY_OUTRO_START = 'These passages are source text';
export const NO_MATCH_START = 'Nothing in the legal library matched';
export const OFFLINE_WELCOME_START = "Hello. I'm the Legal Advisor for Indian law. AI answers are switched off";
export const ADVOCATE_NOTE = 'This matter may require advice from a qualified advocate.';

export type LlmMode = 'ai' | 'offline';

/** `status.llm.mode`, falling back to `configured` for API versions without it. */
export function readLlmMode(
  status: { llm: { configured: boolean; mode?: string } } | null | undefined,
): LlmMode | null {
  if (!status) return null;
  if (status.llm.mode === 'ai' || status.llm.mode === 'offline') return status.llm.mode;
  return status.llm.configured ? 'ai' : 'offline';
}

/** The mode of a stored reply: explicit when known, else recognised from its text. */
export function inferAnswerMode(content: string, explicit?: AnswerMode | null): AnswerMode {
  if (explicit === 'ai' || explicit === 'sources_only') return explicit;
  const head = content.trimStart();
  if (
    head.startsWith(SOURCES_ONLY_INTRO_START) ||
    head.startsWith(NO_MATCH_START) ||
    head.startsWith(OFFLINE_WELCOME_START)
  ) {
    return 'sources_only';
  }
  return 'ai';
}

/**
 * The server appends a one-line advocate pointer to HIGH and CRITICAL replies.
 * When the advocate card is shown it says the same thing in full, so drop the
 * duplicate line from the text.
 */
export function stripAdvocateNote(text: string): string {
  const trimmed = text.trimEnd();
  if (trimmed.endsWith(ADVOCATE_NOTE)) {
    return trimmed.slice(0, trimmed.length - ADVOCATE_NOTE.length).trimEnd();
  }
  return text;
}

/** True for the fixed greeting the API gives when AI answers are off. */
export function isOfflineWelcome(text: string): boolean {
  return text.trimStart().startsWith(OFFLINE_WELCOME_START);
}

const NO_MATCH_LEAD = 'AI answers are off in this setup, so there is no written answer to give instead.';

/**
 * The first line of the "nothing matched" card. The API's own text repeats the
 * card title, then suggests example topics that may not exist in this library
 * and (for urgent questions) calls the directory "verified". The card shows its
 * own suggestions and the advocate card says what the directory really is, so
 * only the plain statement is kept: the API sentence is replaced by a fixed
 * one, and an unfamiliar text keeps its sentences minus those two kinds.
 */
export function noMatchLead(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.startsWith(NO_MATCH_START)) return NO_MATCH_LEAD;
  const kept = trimmed
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/^try rewording/i.test(sentence) && !/advocate directory lists|verified advocates/i.test(sentence));
  return kept.join(' ') || NO_MATCH_LEAD;
}

export interface SourcesOnlyEntry {
  /** The `[n]` marker, 1-based, matching the position in `sources`. */
  n: number;
  heading: string;
  excerpt: string;
}

export interface SourcesOnlyParts {
  intro: string;
  entries: SourcesOnlyEntry[];
  outro: string;
  /** The advocate pointer the server appends for HIGH and CRITICAL questions. */
  advocateNote: string | null;
  /** Anything that fit no slot; shown as plain paragraphs, never dropped. */
  extra: string[];
  /** True for the "nothing matched" text. */
  noMatch: boolean;
}

const ENTRY_HEADING = /^\[(\d+)\]\s+([\s\S]+)$/;

/**
 * Split the sources-only reply text into its parts:
 *
 *   intro paragraph
 *   [1] heading            (title, section, court - date - citation)
 *   excerpt
 *   [2] heading
 *   excerpt
 *   outro paragraph
 *   advocate pointer       (HIGH / CRITICAL only)
 *
 * Tolerant by design: unknown blocks land in `extra`, a partly streamed text
 * parses as far as it goes, and text that is not in this shape yields no
 * entries so the caller can fall back to plain rendering.
 */
export function parseSourcesOnlyText(text: string): SourcesOnlyParts {
  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  const parts: SourcesOnlyParts = {
    intro: '',
    entries: [],
    outro: '',
    advocateNote: null,
    extra: [],
    noMatch: text.trimStart().startsWith(NO_MATCH_START),
  };
  const isStructural = (b: string) =>
    ENTRY_HEADING.test(b) || b.startsWith(SOURCES_ONLY_OUTRO_START) || b === ADVOCATE_NOTE;

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i] ?? '';
    const heading = ENTRY_HEADING.exec(block);
    if (heading) {
      const next = blocks[i + 1];
      let excerpt = '';
      if (next !== undefined && !isStructural(next)) {
        excerpt = next;
        i += 1;
      }
      parts.entries.push({
        n: Number(heading[1]),
        heading: (heading[2] ?? '').replace(/\s+/g, ' ').trim(),
        excerpt,
      });
    } else if (block.startsWith(SOURCES_ONLY_OUTRO_START)) {
      parts.outro = block;
    } else if (block === ADVOCATE_NOTE) {
      parts.advocateNote = block;
    } else if (parts.entries.length === 0 && !parts.intro && !parts.noMatch) {
      parts.intro = block;
    } else {
      parts.extra.push(block);
    }
  }
  return parts;
}

/* -------------------------------------------------------------------------- */
/* Sources                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Library titles may end in a bracketed label, e.g.
 * `Ramesh v. Acme Industries [FIXTURE – local verification only]`.
 * Pull it out so the UI can show it as a label instead of burying it.
 */
export function splitTitleLabel(title: string): { title: string; label: string | null } {
  const match = /^(.*?)\s*\[([^\]]{2,100})\]\s*$/.exec(title.trim());
  if (match && match[1]) return { title: match[1].trim(), label: (match[2] ?? '').trim() };
  return { title: title.trim(), label: null };
}

export function isFixtureLabel(label: string | null): boolean {
  return label !== null && /^fixture\b/i.test(label);
}

/** `2019-04-02` -> `2 Apr 2019`; anything else is returned as written. */
export function formatSourceDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value.trim() || null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return value.trim();
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Only http(s) links are rendered: source URLs come from datasets and are untrusted. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export interface SourceView {
  title: string;
  /** Bracketed label from the title, such as the FIXTURE marker. */
  label: string | null;
  fixture: boolean;
  /** `Section 12`, `Article 21`, or both. */
  locator: string | null;
  /** Court, date, citation: only the parts the source really has. */
  meta: string[];
  caseName: string | null;
  dataset: string | null;
  excerpt: string | null;
  url: string | null;
}

export function describeSource(source: SourceOut): SourceView {
  const { title, label } = splitTitleLabel(source.document_title || 'Untitled source');
  const locator =
    [source.section ? `Section ${source.section}` : null, source.article ? `Article ${source.article}` : null]
      .filter(Boolean)
      .join(', ') || null;
  const meta = [source.court, formatSourceDate(source.date), source.citation].filter(
    (v): v is string => Boolean(v),
  );
  const caseName =
    source.case_name && source.case_name.trim() && source.case_name.trim() !== title
      ? source.case_name.trim()
      : null;
  return {
    title,
    label,
    fixture: isFixtureLabel(label),
    locator,
    meta,
    caseName,
    dataset: source.dataset?.trim() || null,
    excerpt: source.excerpt?.trim() || null,
    url: safeHttpUrl(source.source_url),
  };
}

/**
 * Hosts that exist only as placeholders (RFC 2606 / 6761 reserved names). A
 * dataset that points its passages at one of these has no real page to open.
 */
const PLACEHOLDER_HOST = /(^|\.)(example(\.(com|org|net))?|test|invalid|localhost)$/i;

export function isPlaceholderUrl(url: string | null | undefined): boolean {
  const safe = safeHttpUrl(url);
  if (!safe) return false;
  try {
    return PLACEHOLDER_HOST.test(new URL(safe).hostname);
  } catch {
    return false;
  }
}

/**
 * The link worth showing as "Open source": the passage's own http(s) URL, but
 * never for a test fixture or a placeholder address, which would send a reader
 * to a generic page while the card is labelled as a source.
 */
export function publicSourceUrl(view: Pick<SourceView, 'url' | 'fixture' | 'dataset'>): string | null {
  if (!view.url) return null;
  if (view.fixture || (view.dataset !== null && /fixture/i.test(view.dataset))) return null;
  return isPlaceholderUrl(view.url) ? null : view.url;
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

export type ChatFailureKind =
  | 'rate_limit'
  | 'network'
  | 'auth'
  | 'interrupted'
  | 'unavailable'
  | 'invalid'
  | 'server'
  | 'stopped'
  | 'unknown';

export interface ChatFailure {
  kind: ChatFailureKind;
  title: string;
  message: string;
  tone: 'danger' | 'warn' | 'info';
  /** Offer a Retry button that resends the same question. */
  retryable: boolean;
  /** Offer a link to log in again. */
  needsLogin: boolean;
}

function isAbort(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === 'AbortError'
  );
}

/**
 * Map anything thrown while sending a message to calm, specific copy. Never
 * returns raw server text, JSON or stack traces: only strings written here.
 */
export function classifyChatError(err: unknown): ChatFailure {
  if (isAbort(err)) {
    return {
      kind: 'stopped',
      title: 'Stopped',
      message: 'Nothing from that turn was saved. Your question is back in the box if you want to edit it.',
      tone: 'info',
      retryable: false,
      needsLogin: false,
    };
  }
  if (err instanceof ApiRequestError) {
    const code = err.code.toLowerCase();
    if (err.status === 429 || code.includes('rate_limit')) {
      return {
        kind: 'rate_limit',
        title: 'Too many requests for now',
        message: 'The service has reached its limit. Wait a minute, then send your question again.',
        tone: 'warn',
        retryable: true,
        needsLogin: false,
      };
    }
    if (err.status === 401 || err.status === 403) {
      return {
        kind: 'auth',
        title: 'Please log in again',
        message: 'Your session has expired or is no longer valid. Log in again to continue.',
        tone: 'warn',
        retryable: false,
        needsLogin: true,
      };
    }
    if (code === 'stream_interrupted') {
      return {
        kind: 'interrupted',
        title: 'The reply was cut off',
        message: 'The connection dropped before the reply finished. Nothing was saved. Try again.',
        tone: 'warn',
        retryable: true,
        needsLogin: false,
      };
    }
    if (err.status === 0 || code === 'network_error') {
      return {
        kind: 'network',
        title: 'Cannot reach the server',
        message: 'Check your connection and that the API is running, then try again. Your question is kept.',
        tone: 'danger',
        retryable: true,
        needsLogin: false,
      };
    }
    if (err.status === 422 || err.status === 400 || code.includes('validation')) {
      return {
        kind: 'invalid',
        title: 'That question could not be sent',
        message: 'It may be empty or too long (4,000 characters at most). Edit it and try again.',
        tone: 'warn',
        retryable: false,
        needsLogin: false,
      };
    }
    if (code === 'llm_not_configured' || code === 'llm_error' || err.status === 502 || err.status === 503) {
      return {
        kind: 'unavailable',
        title: 'The assistant is not available',
        message: 'The service that writes answers did not respond. Try again in a moment.',
        tone: 'danger',
        retryable: true,
        needsLogin: false,
      };
    }
    if (err.status >= 500) {
      return {
        kind: 'server',
        title: 'Something went wrong on our side',
        message: 'Nothing was saved. Try again in a moment.',
        tone: 'danger',
        retryable: true,
        needsLogin: false,
      };
    }
  }
  return {
    kind: 'unknown',
    title: 'Something went wrong',
    message: 'The question did not go through and nothing was saved. Try again.',
    tone: 'danger',
    retryable: true,
    needsLogin: false,
  };
}

/* -------------------------------------------------------------------------- */
/* Input, history                                                             */
/* -------------------------------------------------------------------------- */

export const MAX_QUESTION_LENGTH = 4000;

/** The `q` parameter of `/chat?q=...`: trimmed, capped, or null when absent or blank. */
export function readQuestionParam(search: string): string | null {
  const raw = new URLSearchParams(search).get('q');
  if (raw === null) return null;
  const q = raw.trim().slice(0, MAX_QUESTION_LENGTH);
  return q ? q : null;
}

export interface HistoryGroup {
  label: string;
  items: ConversationSummary[];
}

function dayKey(d: Date): number {
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000);
}

/** Group conversations under Today / Yesterday / Previous 7 days / Earlier, newest first. */
export function groupHistory(rows: ConversationSummary[], now: Date = new Date()): HistoryGroup[] {
  const order = ['Today', 'Yesterday', 'Previous 7 days', 'Earlier'];
  const buckets = new Map<string, ConversationSummary[]>();
  const sorted = [...rows].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );
  for (const row of sorted) {
    const when = new Date(row.updated_at);
    const diff = Number.isNaN(when.getTime()) ? Infinity : dayKey(now) - dayKey(when);
    const label = diff <= 0 ? 'Today' : diff === 1 ? 'Yesterday' : diff <= 7 ? 'Previous 7 days' : 'Earlier';
    const list = buckets.get(label) ?? [];
    list.push(row);
    buckets.set(label, list);
  }
  return order.filter((l) => buckets.has(l)).map((label) => ({ label, items: buckets.get(label) ?? [] }));
}

/** Initials for the small advocate avatar: `Harini Shah` -> `HS`; honorifics are skipped. */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '')
    .replace(/\b(adv|advocate|dr|mr|mrs|ms|shri|smt)\.?\s+/gi, '')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'A';
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/* -------------------------------------------------------------------------- */
/* Starter questions                                                          */
/* -------------------------------------------------------------------------- */

export type StarterIcon = 'briefcase' | 'home' | 'shield' | 'lock' | 'document';

export interface StarterGroup {
  id: string;
  title: string;
  icon: StarterIcon;
  questions: string[];
}

/** Whether the library holds only the few test passages bundled with this setup, or a real corpus. */
export type LibraryKind = 'fixture' | 'full';

/**
 * Questions the four bundled test passages can answer (checked against the
 * keyword search the offline mode uses). In a setup that has only those
 * passages, every other starter would end at "nothing matched", so the empty
 * state offers just these.
 */
export const FIXTURE_ANSWERABLE: readonly string[] = [
  'What are my legal options if my employer has not paid my salary for several months?',
  'My landlord is not returning my security deposit',
  'A shop sold me a defective product and refuses a refund. What can I do?',
  'A company shared my personal data with a third party without my consent',
];

export const STARTER_GROUPS: StarterGroup[] = [
  {
    id: 'work',
    title: 'Work and pay',
    icon: 'briefcase',
    questions: [
      'What are my legal options if my employer has not paid my salary for several months?',
      'What are the basic requirements for an employment agreement?',
    ],
  },
  {
    id: 'home',
    title: 'Home and rent',
    icon: 'home',
    questions: [
      'My landlord is not returning my security deposit',
      'What information is normally included in a rental agreement?',
    ],
  },
  {
    id: 'consumer',
    title: 'Consumer and business',
    icon: 'shield',
    questions: [
      'A shop sold me a defective product and refuses a refund. What can I do?',
      'What is the process for registering a company in India?',
    ],
  },
  {
    id: 'privacy',
    title: 'Data and privacy',
    icon: 'lock',
    questions: [
      'A company shared my personal data with a third party without my consent',
      'What rights do I have over my personal data held by a company?',
    ],
  },
  {
    id: 'documents',
    title: 'Documents and contracts',
    icon: 'document',
    questions: [
      'What is an affidavit?',
      'What documents are generally required for an affidavit?',
      'What is the difference between an agreement and a contract?',
    ],
  },
];

/** The starter groups to show: all of them, or only what a test-fixture library can answer. */
export function startersFor(kind: LibraryKind): StarterGroup[] {
  if (kind === 'full') return STARTER_GROUPS;
  const answerable = new Set(FIXTURE_ANSWERABLE);
  return STARTER_GROUPS.map((group) => ({
    ...group,
    questions: group.questions.filter((q) => answerable.has(q)),
  })).filter((group) => group.questions.length > 0);
}

/** A few starters to offer under replies that dead-end (greeting, out of scope, nothing matched). */
export function suggestedQuestions(kind: LibraryKind, count = 3): string[] {
  if (kind === 'fixture') return FIXTURE_ANSWERABLE.slice(0, count);
  return STARTER_GROUPS.map((group) => group.questions[0]).filter((q): q is string => Boolean(q)).slice(0, count);
}
