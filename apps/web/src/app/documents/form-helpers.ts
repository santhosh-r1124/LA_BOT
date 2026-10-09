import type { QuestionOut } from '@/lib/document-client';
import { fieldMeta, type FieldKind } from './doc-types';

/** Pure helpers for the questionnaire, kept apart from React so they are testable. */

export function isBlank(value: string | undefined | null): boolean {
  return !value || value.trim() === '';
}

/** Required questions with no non-blank answer, in the order the API sends them. */
export function missingRequired(
  questions: QuestionOut[],
  answers: Record<string, string>,
): QuestionOut[] {
  return questions.filter((q) => q.required && isBlank(answers[q.key]));
}

export interface Progress {
  answered: number;
  total: number;
  /** 0 to 100, rounded. 100 when there are no required questions. */
  percent: number;
  complete: boolean;
}

/** How many required questions have an answer. Optional ones never count. */
export function progressOf(questions: QuestionOut[], answers: Record<string, string>): Progress {
  const required = questions.filter((q) => q.required);
  const answered = required.filter((q) => !isBlank(answers[q.key])).length;
  const total = required.length;
  const percent = total === 0 ? 100 : Math.round((answered / total) * 100);
  return { answered, total, percent, complete: answered === total };
}

/** The inline message for a required question left empty. */
export function requiredMessage(kind: FieldKind): string {
  switch (kind) {
    case 'state':
      return 'Choose a state or union territory.';
    case 'date':
      return 'Pick a date.';
    case 'mutual':
      return 'Choose one.';
    default:
      return 'This answer is required.';
  }
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * `2026-04-01` -> `1 April 2026`. A date input holds ISO text, but a draft reads
 * better with the month spelled out. Anything that is not a real ISO date is
 * returned unchanged (so a typed answer is never altered).
 */
export function formatDateAnswer(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  const real =
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day;
  if (!real) return value;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/**
 * The answers to send: trimmed, blanks left out, date inputs spelled out. Only
 * keys the document type asks about are sent.
 */
export function buildPayload(
  documentType: string,
  questions: QuestionOut[],
  answers: Record<string, string>,
): Record<string, string> {
  const payload: Record<string, string> = {};
  for (const q of questions) {
    const raw = answers[q.key];
    if (isBlank(raw)) continue;
    const value = (raw ?? '').trim();
    payload[q.key] =
      fieldMeta(documentType, q.key).kind === 'date' ? formatDateAnswer(value) : value;
  }
  return payload;
}

/** `plural(2, 'answer')` -> `answers`. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

const SHORT_KINDS: ReadonlySet<FieldKind> = new Set(['text', 'date', 'money', 'months']);

export interface FieldSlot {
  question: QuestionOut;
  /** True when the field takes the full row; false when it shares a row with a neighbour. */
  wide: boolean;
}

/**
 * Lay a group's questions out on a two-column grid: two short fields in a row
 * become a pair, everything else (long text, a select, a choice, or a short
 * field with no short neighbour) takes the full row, so no row is left lopsided.
 */
export function layoutFields(documentType: string, questions: QuestionOut[]): FieldSlot[] {
  const isShort = (q: QuestionOut | undefined) =>
    q !== undefined && SHORT_KINDS.has(fieldMeta(documentType, q.key).kind);
  const slots: FieldSlot[] = [];
  let i = 0;
  while (i < questions.length) {
    const current = questions[i] as QuestionOut;
    const next = questions[i + 1];
    if (isShort(current) && isShort(next)) {
      slots.push(
        { question: current, wide: false },
        { question: next as QuestionOut, wide: false },
      );
      i += 2;
    } else {
      slots.push({ question: current, wide: true });
      i += 1;
    }
  }
  return slots;
}
