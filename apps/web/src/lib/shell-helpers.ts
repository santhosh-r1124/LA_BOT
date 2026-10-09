/** Small pure helpers for the app shell and the home page. */

/** The API accepts chat messages up to 4,000 characters. */
export const MAX_QUESTION_LENGTH = 4000;

/** Collapses whitespace and trims; the chat page sends the result as one message. */
export function normaliseQuestion(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION_LENGTH);
}

/**
 * Link into the chat with a first question: `/chat?q=<urlencoded question>`.
 * An empty question links to the plain chat page.
 */
export function buildChatHref(raw: string): string {
  const question = normaliseQuestion(raw);
  return question ? `/chat?q=${encodeURIComponent(question)}` : '/chat';
}

/** True when `pathname` is `href` or lives under it (`/chat/abc` is in `/chat`). */
export function isNavActive(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Up to two capital letters for an avatar; falls back to the email or "?". */
export function initialsOf(displayName: string | null | undefined, email?: string | null): string {
  const source = (displayName ?? '').trim() || (email ?? '').split('@')[0]?.trim() || '';
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = Array.from(words[0]!)[0] ?? '';
  const last = words.length > 1 ? (Array.from(words[words.length - 1]!)[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}
