import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '@/lib/api-client';
import type { ConversationSummary, SourceOut } from '@/lib/chat-client';
import {
  ADVOCATE_NOTE,
  categoryLabel,
  classifyChatError,
  describeSource,
  FIXTURE_ANSWERABLE,
  formatSourceDate,
  groupHistory,
  inferAnswerMode,
  initials,
  isHighStakes,
  isOfflineWelcome,
  isPlaceholderUrl,
  noMatchLead,
  parseSourcesOnlyText,
  publicSourceUrl,
  readLlmMode,
  readQuestionParam,
  safeHttpUrl,
  splitTitleLabel,
  startersFor,
  STARTER_GROUPS,
  stripAdvocateNote,
  suggestedQuestions,
} from './chat-helpers';

const INTRO =
  'AI answers are switched off on this server, so no explanation has been written for your question. These are the passages in the legal library that match it best. The numbers match the sources listed with this reply.';
const OUTRO =
  'These passages are source text, not advice on your situation. Check the official text before relying on them.';
const NO_MATCH =
  'Nothing in the legal library matched your question, and AI answers are switched off on this server, so there is no answer to give. Try rewording it around the specific topic, law or document involved.';

const ONE_SOURCE = [
  INTRO,
  '[1] Ramesh v. Acme Industries (FIXTURE – local verification only) (High Court of Delhi - 2019-04-02 - FIXTURE/2019/1)',
  'FIXTURE TEXT for local verification. The appellant employee had not been paid his salary.',
  OUTRO,
].join('\n\n');

describe('parseSourcesOnlyText', () => {
  it('splits intro, one entry and outro', () => {
    const parts = parseSourcesOnlyText(ONE_SOURCE);
    expect(parts.intro).toBe(INTRO);
    expect(parts.outro).toBe(OUTRO);
    expect(parts.noMatch).toBe(false);
    expect(parts.advocateNote).toBeNull();
    expect(parts.extra).toEqual([]);
    expect(parts.entries).toEqual([
      {
        n: 1,
        heading:
          'Ramesh v. Acme Industries (FIXTURE – local verification only) (High Court of Delhi - 2019-04-02 - FIXTURE/2019/1)',
        excerpt: 'FIXTURE TEXT for local verification. The appellant employee had not been paid his salary.',
      },
    ]);
  });

  it('keeps entry numbers and order for several passages', () => {
    const text = [INTRO, '[1] First', 'Excerpt one.', '[2] Second, Section 12', 'Excerpt two.', OUTRO].join('\n\n');
    const parts = parseSourcesOnlyText(text);
    expect(parts.entries.map((e) => [e.n, e.heading, e.excerpt])).toEqual([
      [1, 'First', 'Excerpt one.'],
      [2, 'Second, Section 12', 'Excerpt two.'],
    ]);
  });

  it('recognises the advocate pointer appended for HIGH and CRITICAL questions', () => {
    const parts = parseSourcesOnlyText(`${ONE_SOURCE}\n\n${ADVOCATE_NOTE}`);
    expect(parts.advocateNote).toBe(ADVOCATE_NOTE);
    expect(parts.outro).toBe(OUTRO);
    expect(parts.entries).toHaveLength(1);
  });

  it('flags the no-match text and produces no entries', () => {
    const parts = parseSourcesOnlyText(NO_MATCH);
    expect(parts.noMatch).toBe(true);
    expect(parts.entries).toEqual([]);
    expect(parts.intro).toBe('');
  });

  it('does not lose a heading with no excerpt', () => {
    const parts = parseSourcesOnlyText([INTRO, '[1] Lonely heading', OUTRO].join('\n\n'));
    expect(parts.entries).toEqual([{ n: 1, heading: 'Lonely heading', excerpt: '' }]);
    expect(parts.outro).toBe(OUTRO);
  });

  it('parses a partly streamed text as far as it goes', () => {
    const parts = parseSourcesOnlyText(`${INTRO}\n\n[1] Title (Court - 2020-01-01 - C/1)\n\nHalf an exc`);
    expect(parts.entries).toHaveLength(1);
    expect(parts.entries[0]?.excerpt).toBe('Half an exc');
    expect(parts.outro).toBe('');
  });

  it('keeps unknown blocks instead of dropping them', () => {
    const parts = parseSourcesOnlyText(`${ONE_SOURCE}\n\nSomething else the server said.`);
    expect(parts.extra).toEqual(['Something else the server said.']);
  });

  it('yields no entries for ordinary prose (so the caller falls back to plain text)', () => {
    const parts = parseSourcesOnlyText('Hello. Ask about a specific situation.');
    expect(parts.entries).toEqual([]);
    expect(parts.noMatch).toBe(false);
  });

  it('survives empty input', () => {
    expect(parseSourcesOnlyText('')).toMatchObject({ entries: [], intro: '', outro: '', extra: [] });
  });
});

describe('inferAnswerMode', () => {
  it('trusts an explicit mode', () => {
    expect(inferAnswerMode('anything', 'ai')).toBe('ai');
    expect(inferAnswerMode('anything', 'sources_only')).toBe('sources_only');
  });
  it('recognises the fixed offline texts in old messages', () => {
    expect(inferAnswerMode(ONE_SOURCE)).toBe('sources_only');
    expect(inferAnswerMode(NO_MATCH)).toBe('sources_only');
    expect(
      inferAnswerMode(
        "Hello. I'm the Legal Advisor for Indian law. AI answers are switched off on this server, so I reply by...",
      ),
    ).toBe('sources_only');
  });
  it('treats everything else as an AI reply', () => {
    expect(inferAnswerMode('A defective product gives you rights under the Act [1].')).toBe('ai');
  });
});

describe('stripAdvocateNote', () => {
  it('removes the trailing pointer only', () => {
    expect(stripAdvocateNote(`Body text.\n\n${ADVOCATE_NOTE}`)).toBe('Body text.');
    expect(stripAdvocateNote('Body text.')).toBe('Body text.');
    expect(stripAdvocateNote(`${ADVOCATE_NOTE} Then more.`)).toBe(`${ADVOCATE_NOTE} Then more.`);
  });
});

describe('labels', () => {
  it('formats categories and keeps IT / IP upper-case', () => {
    expect(categoryLabel('EMPLOYMENT_LAW')).toBe('Employment Law');
    expect(categoryLabel('IT_LAW')).toBe('IT Law');
    expect(categoryLabel('IP_LAW')).toBe('IP Law');
  });
  it('knows which risk levels need an advocate', () => {
    expect(isHighStakes('HIGH')).toBe(true);
    expect(isHighStakes('CRITICAL')).toBe(true);
    expect(isHighStakes('MEDIUM')).toBe(false);
    expect(isHighStakes(null)).toBe(false);
  });
  it('reads the LLM mode, falling back to `configured`', () => {
    expect(readLlmMode(null)).toBeNull();
    expect(readLlmMode({ llm: { configured: false, mode: 'offline' } })).toBe('offline');
    expect(readLlmMode({ llm: { configured: true, mode: 'ai' } })).toBe('ai');
    expect(readLlmMode({ llm: { configured: true } })).toBe('ai');
    expect(readLlmMode({ llm: { configured: false } })).toBe('offline');
    expect(readLlmMode({ llm: { configured: true, mode: 'weird' } })).toBe('ai');
  });
  it('makes initials, skipping honorifics', () => {
    expect(initials('Harini Shah')).toBe('HS');
    expect(initials('Adv. Meera Iyer')).toBe('MI');
    expect(initials('Rohit')).toBe('R');
    expect(initials(null)).toBe('A');
  });
});

describe('sources', () => {
  it('pulls a bracketed label out of a title', () => {
    expect(splitTitleLabel('Ramesh v. Acme Industries [FIXTURE – local verification only]')).toEqual({
      title: 'Ramesh v. Acme Industries',
      label: 'FIXTURE – local verification only',
    });
    expect(splitTitleLabel('Indian Contract Act, 1872')).toEqual({
      title: 'Indian Contract Act, 1872',
      label: null,
    });
    expect(splitTitleLabel('[Only a label]')).toEqual({ title: '[Only a label]', label: null });
  });

  it('formats ISO dates and leaves anything else alone', () => {
    expect(formatSourceDate('2019-04-02')).toBe('2 Apr 2019');
    expect(formatSourceDate('2021-09-14')).toBe('14 Sept 2021');
    expect(formatSourceDate('Spring 2019')).toBe('Spring 2019');
    expect(formatSourceDate(null)).toBeNull();
    expect(formatSourceDate('')).toBeNull();
  });

  it('only allows http(s) links', () => {
    expect(safeHttpUrl('https://www.indiacode.nic.in/')).toBe('https://www.indiacode.nic.in/');
    expect(safeHttpUrl('http://example.com/a')).toBe('http://example.com/a');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,<b>x</b>')).toBeNull();
    expect(safeHttpUrl('not a url')).toBeNull();
    expect(safeHttpUrl('')).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
  });

  it('describes a source without inventing anything', () => {
    const source: SourceOut = {
      document_id: 'd1',
      document_title: 'Ramesh v. Acme Industries [FIXTURE – local verification only]',
      section: '12',
      article: null,
      source_url: 'javascript:alert(1)',
      court: 'High Court of Delhi',
      date: '2019-04-02',
      citation: null,
      case_name: 'Ramesh v. Acme Industries',
      dataset: 'local/fixture',
      excerpt: '  Passage text.  ',
    };
    expect(describeSource(source)).toEqual({
      title: 'Ramesh v. Acme Industries',
      label: 'FIXTURE – local verification only',
      fixture: true,
      locator: 'Section 12',
      meta: ['High Court of Delhi', '2 Apr 2019'],
      caseName: null,
      dataset: 'local/fixture',
      excerpt: 'Passage text.',
      url: null,
    });
  });

  it('keeps a case name that differs from the title', () => {
    const view = describeSource({
      document_id: 'd2',
      document_title: 'Judgment of 3 March 2020',
      section: null,
      article: '21',
      source_url: 'https://example.org/j',
      case_name: 'Meera v. Sharma Estates',
    });
    expect(view.caseName).toBe('Meera v. Sharma Estates');
    expect(view.locator).toBe('Article 21');
    expect(view.fixture).toBe(false);
    expect(view.url).toBe('https://example.org/j');
  });
});

describe('classifyChatError', () => {
  const api = (status: number, code: string) => new ApiRequestError(status, code, 'Raw {"detail":"boom"} Traceback');

  it('maps an abort to a calm "stopped"', () => {
    const failure = classifyChatError(new DOMException('aborted', 'AbortError'));
    expect(failure).toMatchObject({ kind: 'stopped', tone: 'info', retryable: false });
  });
  it('maps rate limits, by status or code', () => {
    expect(classifyChatError(api(429, 'rate_limited')).kind).toBe('rate_limit');
    expect(classifyChatError(api(503, 'llm_rate_limited')).kind).toBe('rate_limit');
    expect(classifyChatError(api(429, 'x'))).toMatchObject({ retryable: true, needsLogin: false });
  });
  it('maps auth errors to a login prompt', () => {
    expect(classifyChatError(api(401, 'unauthorized'))).toMatchObject({
      kind: 'auth',
      needsLogin: true,
      retryable: false,
    });
    expect(classifyChatError(api(403, 'forbidden')).kind).toBe('auth');
  });
  it('maps network failures and interrupted streams separately', () => {
    expect(classifyChatError(api(0, 'network_error'))).toMatchObject({ kind: 'network', retryable: true });
    expect(classifyChatError(api(0, 'stream_interrupted'))).toMatchObject({ kind: 'interrupted', retryable: true });
  });
  it('maps validation, unavailable and server errors', () => {
    expect(classifyChatError(api(422, 'validation_error')).kind).toBe('invalid');
    expect(classifyChatError(api(503, 'llm_error')).kind).toBe('unavailable');
    expect(classifyChatError(api(500, 'internal_error')).kind).toBe('server');
  });
  it('never leaks raw server text, JSON or stack traces', () => {
    const codes: Array<[number, string]> = [
      [429, 'rate_limited'],
      [401, 'unauthorized'],
      [0, 'network_error'],
      [0, 'stream_interrupted'],
      [422, 'validation_error'],
      [503, 'llm_error'],
      [500, 'internal_error'],
      [418, 'teapot'],
    ];
    for (const [status, code] of codes) {
      const failure = classifyChatError(api(status, code));
      expect(`${failure.title} ${failure.message}`).not.toMatch(/Traceback|detail|boom|\{/);
    }
    expect(classifyChatError(new Error('kaboom at /srv/app.py:12'))).toMatchObject({ kind: 'unknown' });
    expect(classifyChatError('weird').message).not.toMatch(/weird/);
  });
});

describe('readQuestionParam', () => {
  it('reads and trims q', () => {
    expect(readQuestionParam('?q=What%20is%20an%20affidavit%3F')).toBe('What is an affidavit?');
    expect(readQuestionParam('?q=%20%20hello%20')).toBe('hello');
    expect(readQuestionParam('q=a+b')).toBe('a b');
  });
  it('is null when absent or blank', () => {
    expect(readQuestionParam('')).toBeNull();
    expect(readQuestionParam('?x=1')).toBeNull();
    expect(readQuestionParam('?q=')).toBeNull();
    expect(readQuestionParam('?q=%20%20')).toBeNull();
  });
  it('caps the length at 4000 characters', () => {
    expect(readQuestionParam(`?q=${'a'.repeat(5000)}`)).toHaveLength(4000);
  });
});

describe('groupHistory', () => {
  const row = (id: string, updated_at: string): ConversationSummary => ({
    id,
    title: id,
    created_at: updated_at,
    updated_at,
  });
  it('groups newest first under Today / Yesterday / Previous 7 days / Earlier', () => {
    const now = new Date(2026, 9, 8, 15, 0, 0);
    const groups = groupHistory(
      [
        row('old', new Date(2026, 7, 1, 9).toISOString()),
        row('today-early', new Date(2026, 9, 8, 8).toISOString()),
        row('yesterday', new Date(2026, 9, 7, 22).toISOString()),
        row('week', new Date(2026, 9, 3, 12).toISOString()),
        row('today-late', new Date(2026, 9, 8, 14).toISOString()),
      ],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Previous 7 days', 'Earlier']);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['today-late', 'today-early']);
    expect(groups[3]?.items.map((i) => i.id)).toEqual(['old']);
  });
  it('omits empty groups and handles an empty list', () => {
    expect(groupHistory([])).toEqual([]);
    const now = new Date(2026, 9, 8, 15);
    expect(groupHistory([row('a', new Date(2026, 9, 8, 9).toISOString())], now).map((g) => g.label)).toEqual([
      'Today',
    ]);
  });
});

describe('source links', () => {
  const view = (over: Partial<Parameters<typeof publicSourceUrl>[0]>) => ({
    url: 'https://indiankanoon.org/doc/1/',
    fixture: false,
    dataset: 'Sumitedu/indian-case-laws' as string | null,
    ...over,
  });

  it('recognises placeholder addresses', () => {
    expect(isPlaceholderUrl('https://example.com/fixture-1')).toBe(true);
    expect(isPlaceholderUrl('http://www.example.org/x')).toBe(true);
    expect(isPlaceholderUrl('https://docs.example.net/')).toBe(true);
    expect(isPlaceholderUrl('http://localhost:3000/a')).toBe(true);
    expect(isPlaceholderUrl('https://court.test/a')).toBe(true);
    expect(isPlaceholderUrl('https://indiankanoon.org/doc/1/')).toBe(false);
    expect(isPlaceholderUrl('https://notexample.com/')).toBe(false);
    expect(isPlaceholderUrl('javascript:alert(1)')).toBe(false);
    expect(isPlaceholderUrl(null)).toBe(false);
  });

  it('keeps a real link for a real dataset', () => {
    expect(publicSourceUrl(view({}))).toBe('https://indiankanoon.org/doc/1/');
  });

  it('never offers "Open source" for a fixture or a placeholder address', () => {
    expect(publicSourceUrl(view({ fixture: true }))).toBeNull();
    expect(publicSourceUrl(view({ dataset: 'local/fixture' }))).toBeNull();
    expect(publicSourceUrl(view({ url: 'https://example.com/fixture-1' }))).toBeNull();
    expect(publicSourceUrl(view({ url: null }))).toBeNull();
  });
});

describe('noMatchLead', () => {
  const API_TEXT =
    'Nothing in the legal library matched your question, and AI answers are switched off on this server, so there is no answer to give. Try rewording it around the specific topic, law or document involved, for example a security deposit, unpaid salary or a trademark registration. If this is urgent, the advocate directory lists verified advocates by practice area and state.';

  it('replaces the API text, which repeats the title and suggests topics that may not exist', () => {
    const lead = noMatchLead(API_TEXT);
    expect(lead).toMatch(/AI answers are off/);
    expect(lead).not.toMatch(/trademark|verified|urgent|rewording/i);
  });

  it('keeps an unfamiliar text but drops the example and "verified" sentences', () => {
    const lead = noMatchLead(
      'No passage was found. Try rewording it for example a bounced cheque. The directory lists verified advocates by state.',
    );
    expect(lead).toBe('No passage was found.');
  });

  it('never returns an empty line', () => {
    expect(noMatchLead('Try rewording it.')).toMatch(/AI answers are off/);
    expect(noMatchLead('')).toMatch(/AI answers are off/);
  });
});

describe('starter questions', () => {
  const all = STARTER_GROUPS.flatMap((g) => g.questions);

  it('every fixture-answerable question is one of the starters', () => {
    for (const q of FIXTURE_ANSWERABLE) expect(all).toContain(q);
  });

  it('shows everything for a full library', () => {
    expect(startersFor('full')).toEqual(STARTER_GROUPS);
  });

  it('shows only questions the test passages can answer for a fixture library', () => {
    const groups = startersFor('fixture');
    expect(groups.flatMap((g) => g.questions).sort()).toEqual([...FIXTURE_ANSWERABLE].sort());
    expect(groups.every((g) => g.questions.length > 0)).toBe(true);
  });

  it('suggests answerable questions for a fixture library and varied topics otherwise', () => {
    expect(suggestedQuestions('fixture', 3)).toEqual(FIXTURE_ANSWERABLE.slice(0, 3));
    const full = suggestedQuestions('full', 3);
    expect(full).toHaveLength(3);
    expect(new Set(full).size).toBe(3);
  });
});

describe('isOfflineWelcome', () => {
  it('recognises the fixed greeting only', () => {
    expect(
      isOfflineWelcome("Hello. I'm the Legal Advisor for Indian law. AI answers are switched off on this server, so I reply by finding"),
    ).toBe(true);
    expect(isOfflineWelcome('I can only help with general Indian legal information.')).toBe(false);
  });
});
