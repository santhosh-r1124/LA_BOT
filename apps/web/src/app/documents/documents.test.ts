import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '@/lib/api-client';
import {
  describeDocumentFailure,
  generationModeOf,
  parseRetryAfter,
  type QuestionOut,
} from '@/lib/document-client';
import { draftFilename, toDownloadText } from './draft-actions';
import {
  countBlanks,
  noteItems,
  parseDraftBlocks,
  parseNotes,
  splitDraft,
  tokenizeInline,
} from './draft-parse';
import {
  buildPayload,
  formatDateAnswer,
  isBlank,
  layoutFields,
  missingRequired,
  plural,
  progressOf,
  requiredMessage,
} from './form-helpers';
import { typeLabel } from './doc-types';

function q(key: string, required: boolean): QuestionOut {
  return { key, label: key, required, help_text: null };
}

// ---------------------------------------------------------------------------
// document-client: what a person sees when a request fails
// ---------------------------------------------------------------------------

describe('describeDocumentFailure', () => {
  it('turns a dropped connection into a network failure that keeps the answers', () => {
    const failure = describeDocumentFailure(new TypeError('Failed to fetch'));
    expect(failure.kind).toBe('network');
    expect(failure.message).toMatch(/answers are still in the form/i);
  });

  it('treats the client network_error code as a network failure', () => {
    const failure = describeDocumentFailure(new ApiRequestError(0, 'network_error', 'offline'));
    expect(failure.kind).toBe('network');
  });

  it('reads the wait from a rate-limit message', () => {
    const err = new ApiRequestError(429, 'rate_limited', 'You sent too many. Please wait 23s.');
    const failure = describeDocumentFailure(err);
    expect(failure.kind).toBe('rate_limited');
    expect(failure.retryAfterSeconds).toBe(23);
    expect(failure.message).toContain('23 seconds');
  });

  it('still explains a rate limit that gives no wait', () => {
    const failure = describeDocumentFailure(new ApiRequestError(429, 'rate_limited', 'Slow down'));
    expect(failure.retryAfterSeconds).toBeNull();
    expect(failure.message).toMatch(/wait a minute/i);
  });

  it('maps server field errors to question keys', () => {
    const err = new ApiRequestError(422, 'validation_error', 'bad', 'req-1', [
      { field: 'answers.tenant_name', message: 'This field is required.' },
      { field: 'answers.tenant_name', message: 'a second message is ignored' },
      { field: 'answers.monthly_rent', message: '' },
    ]);
    const failure = describeDocumentFailure(err);
    expect(failure.kind).toBe('invalid');
    expect(failure.fieldErrors).toEqual({
      tenant_name: 'This field is required.',
      monthly_rent: 'This answer is required.',
    });
  });

  it('never repeats a provider or server message for 5xx errors', () => {
    const cases: Array<[number, string, string]> = [
      [503, 'llm_error', 'Gemini API key invalid sk-123'],
      [500, 'internal_error', 'Traceback (most recent call last)'],
    ];
    for (const [status, code, message] of cases) {
      const failure = describeDocumentFailure(new ApiRequestError(status, code, message));
      const shown = `${failure.title} ${failure.message}`;
      expect(shown).not.toMatch(/gemini|sk-|traceback|api key/i);
    }
  });

  it('words the picker failure differently from the draft failure', () => {
    const err = new ApiRequestError(503, 'unavailable', 'down');
    expect(describeDocumentFailure(err, 'types').title).toMatch(/document types/i);
    expect(describeDocumentFailure(err, 'draft').title).toMatch(/draft/i);
  });
});

describe('parseRetryAfter', () => {
  it('finds the number of seconds', () => {
    expect(parseRetryAfter('Please wait 23s and try again')).toBe(23);
    expect(parseRetryAfter('wait 5 seconds')).toBe(5);
  });

  it('caps long waits at two minutes and ignores messages without one', () => {
    expect(parseRetryAfter('wait 999s')).toBe(120);
    expect(parseRetryAfter('wait 9999s')).toBeNull();
    expect(parseRetryAfter('wait 0s')).toBeNull();
    expect(parseRetryAfter('try later')).toBeNull();
  });
});

describe('generationModeOf', () => {
  it('reports template only when the server says so', () => {
    expect(generationModeOf({ generation_mode: 'template' })).toBe('template');
    expect(generationModeOf({ generation_mode: 'ai' })).toBe('ai');
  });

  it('treats a response from an older server as AI', () => {
    expect(generationModeOf({})).toBe('ai');
  });
});

// ---------------------------------------------------------------------------
// form-helpers: validation and the payload
// ---------------------------------------------------------------------------

describe('required answers', () => {
  const questions = [q('a', true), q('b', true), q('c', false)];

  it('counts whitespace as blank', () => {
    expect(isBlank('   ')).toBe(true);
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank(' x ')).toBe(false);
  });

  it('lists only required questions that are empty, in order', () => {
    expect(missingRequired(questions, { a: 'x', c: 'y' }).map((x) => x.key)).toEqual(['b']);
    expect(missingRequired(questions, { a: ' ' }).map((x) => x.key)).toEqual(['a', 'b']);
  });

  it('measures progress on required questions only', () => {
    expect(progressOf(questions, { c: 'optional answer' })).toMatchObject({
      answered: 0,
      total: 2,
      percent: 0,
      complete: false,
    });
    expect(progressOf(questions, { a: '1', b: '2' })).toMatchObject({
      answered: 2,
      percent: 100,
      complete: true,
    });
    expect(progressOf([q('x', false)], {}).percent).toBe(100);
  });

  it('words the empty-answer message for the kind of control', () => {
    expect(requiredMessage('state')).toMatch(/state/i);
    expect(requiredMessage('date')).toMatch(/date/i);
    expect(requiredMessage('text')).toBe('This answer is required.');
  });
});

describe('buildPayload', () => {
  it('trims, drops blanks and ignores keys the type does not ask about', () => {
    const questions = [q('landlord_name', true), q('special_terms', false)];
    const payload = buildPayload('RENTAL_AGREEMENT', questions, {
      landlord_name: '  Meera Iyer  ',
      special_terms: '   ',
      stray: 'not sent',
    });
    expect(payload).toEqual({ landlord_name: 'Meera Iyer' });
  });

  it('spells out a date answer', () => {
    const payload = buildPayload('RENTAL_AGREEMENT', [q('lease_start_date', true)], {
      lease_start_date: '2026-11-01',
    });
    expect(payload.lease_start_date).toBe('1 November 2026');
  });
});

describe('formatDateAnswer', () => {
  it('spells out real dates and leaves everything else alone', () => {
    expect(formatDateAnswer('2026-04-01')).toBe('1 April 2026');
    expect(formatDateAnswer('2026-02-30')).toBe('2026-02-30');
    expect(formatDateAnswer('next Monday')).toBe('next Monday');
  });
});

describe('layoutFields', () => {
  it('pairs short fields and gives everything else a full row', () => {
    const slots = layoutFields('RENTAL_AGREEMENT', [
      q('landlord_name', true),
      q('tenant_name', true),
      q('property_address', true),
      q('state_code', true),
    ]);
    expect(slots.map((s) => s.wide)).toEqual([false, false, true, true]);
  });

  it('never leaves a lone short field half-width', () => {
    const slots = layoutFields('RENTAL_AGREEMENT', [q('landlord_name', true)]);
    expect(slots[0]?.wide).toBe(true);
  });
});

describe('plural and labels', () => {
  it('pluralises', () => {
    expect(plural(1, 'question')).toBe('question');
    expect(plural(2, 'question')).toBe('questions');
  });

  it('labels known and unknown document types', () => {
    expect(typeLabel('RENTAL_AGREEMENT')).toBe('Rental Agreement');
    expect(typeLabel('SOMETHING_NEW')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// draft-actions: copy, download, file name
// ---------------------------------------------------------------------------

describe('draft files', () => {
  it('names the file after the type and how it was made', () => {
    expect(draftFilename('RENTAL_AGREEMENT', 'template')).toBe(
      'rental-agreement-template-draft.txt',
    );
    expect(draftFilename('NDA', 'ai')).toBe('nda-ai-draft.txt');
    expect(draftFilename('!!!', 'ai')).toBe('document-ai-draft.txt');
  });

  it('writes a BOM and Windows line endings so Notepad shows rupees and lines correctly', () => {
    const text = toDownloadText('a\nb\r\nc');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1)).toBe('a\r\nb\r\nc');
  });
});

// ---------------------------------------------------------------------------
// draft-parse: turning a draft into a document and a checklist
// ---------------------------------------------------------------------------

const TEMPLATE = `TEMPLATE DRAFT - generated without AI from your answers. Review with an advocate before use.

# AFFIDAVIT

I, Asha Verma, [SON / DAUGHTER / WIFE OF NAME], aged about [AGE] years, state:

1. I am the deponent.
2. I reside at the address given.

## DEPONENT

Signature: ____________________

## Notes

- Information normally needed: the deponent's full name and the facts.
- Execution, stamping and registration: stamp duty depends on the state you named.
`;

describe('splitDraft', () => {
  it('separates the label, the body and the notes', () => {
    const split = splitDraft(TEMPLATE);
    expect(split.label).toMatch(/^TEMPLATE DRAFT - generated without AI/);
    expect(split.body).toContain('# AFFIDAVIT');
    expect(split.body).not.toContain('Notes');
    expect(split.notes).toContain('Information normally needed');
  });

  it('copes with a draft that has no notes and no label', () => {
    const split = splitDraft('# RENTAL AGREEMENT\n\nPlain body.');
    expect(split.label).toBeNull();
    expect(split.notes).toBeNull();
    expect(split.body).toContain('Plain body.');
  });

  it('accepts the Notes heading in the styles a model tends to use', () => {
    for (const heading of ['## Notes', '**Notes**', 'Notes:', '### Notes on this draft']) {
      const split = splitDraft(`# TITLE\n\nBody.\n\n${heading}\n\n- One thing to check.`);
      expect(split.notes, heading).toContain('One thing to check');
      expect(split.body, heading).not.toContain('One thing');
    }
  });
});

describe('parseDraftBlocks', () => {
  const blocks = parseDraftBlocks(splitDraft(TEMPLATE).body);

  it('finds the title, a numbered list and headings', () => {
    expect(blocks[0]).toMatchObject({ type: 'title', text: 'AFFIDAVIT' });
    expect(blocks.some((b) => b.type === 'heading')).toBe(true);
    const list = blocks.find((b) => b.type === 'list');
    expect(list && list.type === 'list' ? list.items.length : 0).toBe(2);
  });

  it('produces data only, never markup', () => {
    const out = parseDraftBlocks('Hello <script>alert(1)</script> world');
    expect(JSON.stringify(out)).toContain('<script>');
    expect(out[0]).toMatchObject({ type: 'paragraph' });
  });
});

describe('tokenizeInline', () => {
  it('marks gaps, bold, italic and signature lines', () => {
    const tokens = tokenizeInline('Sign **here** at [PLACE] *now* ________');
    expect(tokens.map((t) => t.type)).toEqual([
      'text',
      'bold',
      'text',
      'blank',
      'text',
      'italic',
      'text',
      'line',
    ]);
  });

  it('does not treat a citation number or a link as a gap', () => {
    expect(
      tokenizeInline('see [1] and [site](https://example.com)').some((t) => t.type === 'blank'),
    ).toBe(false);
  });
});

describe('countBlanks', () => {
  it('counts every gap the reader has to fill', () => {
    expect(countBlanks(splitDraft(TEMPLATE).body)).toBe(2);
    expect(countBlanks('No gaps here.')).toBe(0);
  });
});

describe('parseNotes', () => {
  it('turns bullets into checklist items with a bold lead', () => {
    const items = noteItems(parseNotes(splitDraft(TEMPLATE).notes ?? ''));
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ lead: 'Information normally needed' });
    expect(items[1]?.lead).toBe('Execution, stamping and registration');
    expect(items[1]?.text.startsWith('S')).toBe(true);
  });

  it('keeps group headings apart from items', () => {
    const entries = parseNotes('**Stamping and registration**\n1. Stamp duty varies by state.');
    expect(entries[0]).toEqual({ type: 'group', text: 'Stamping and registration' });
    expect(noteItems(entries)).toHaveLength(1);
  });

  it('joins a wrapped bullet into one item', () => {
    const items = noteItems(parseNotes('- First line\n  continues here.'));
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toContain('continues here');
  });
});
