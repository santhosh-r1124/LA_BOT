import { describe, expect, it } from 'vitest';
import type { PlatformStatus } from './status-client';
import {
  aiMode,
  formatChecks,
  formatCount,
  isSampleDataset,
  summariseAi,
  summariseDirectory,
  summariseLibrary,
  summariseServices,
} from './status-summary';

const llm = (over: Partial<PlatformStatus['llm']> = {}): PlatformStatus['llm'] => ({
  configured: false,
  mode: 'offline',
  provider: null,
  model: null,
  is_free_tier: null,
  last_call_ok: null,
  last_call_at: null,
  last_error_code: null,
  last_error_message: null,
  ...over,
});

const kb = (
  over: Partial<PlatformStatus['knowledge_base']> = {},
): PlatformStatus['knowledge_base'] => ({
  available: true,
  documents_indexed: 4,
  documents_failed: 0,
  chunks_indexed: 4,
  chunks_embedded: 0,
  last_indexed_at: null,
  sources: [{ dataset: 'local/fixture', documents: 4 }],
  corpus_load: null,
  ...over,
});

describe('aiMode', () => {
  it('trusts the API mode', () => {
    expect(aiMode({ llm: llm({ mode: 'offline' }) })).toBe('offline');
    expect(aiMode({ llm: llm({ mode: 'ai', configured: true }) })).toBe('ai');
  });

  it('derives the mode from `configured` on older API versions', () => {
    expect(aiMode({ llm: llm({ mode: undefined, configured: true }) })).toBe('ai');
    expect(aiMode({ llm: llm({ mode: undefined, configured: false }) })).toBe('offline');
  });
});

describe('formatCount', () => {
  it('groups digits the Indian way', () => {
    expect(formatCount(1000)).toBe('1,000');
    expect(formatCount(100000)).toBe('1,00,000');
  });
  it('shows a dash for missing values', () => {
    expect(formatCount(null)).toBe('—');
    expect(formatCount(undefined)).toBe('—');
    expect(formatCount(Number.NaN)).toBe('—');
  });
});

describe('isSampleDataset', () => {
  it('flags test data names but not real datasets', () => {
    expect(isSampleDataset('local/fixture')).toBe(true);
    expect(isSampleDataset('synthetic-advocates')).toBe(true);
    expect(isSampleDataset('Sumitedu/indian-case-laws')).toBe(false);
    expect(isSampleDataset('official sources')).toBe(false);
    expect(isSampleDataset('latest-judgments')).toBe(false);
  });
});

describe('summariseAi', () => {
  it('describes offline mode calmly, not as a failure', () => {
    const cell = summariseAi(llm());
    expect(cell.figure).toBe('Off');
    expect(cell.tone).toBe('info');
    expect(cell.tone).not.toBe('danger');
    expect(cell.badge).toBe('Offline mode');
    expect(cell.note).toMatch(/matching passages/);
  });

  it('shows provider and model when configured', () => {
    const cell = summariseAi(
      llm({
        configured: true,
        mode: 'ai',
        provider: 'gemini',
        model: 'gemini-x',
        last_call_ok: true,
      }),
    );
    expect(cell.tone).toBe('ok');
    expect(cell.badge).toBe('Working');
    expect(cell.note).toContain('Google Gemini');
    expect(cell.note).toContain('gemini-x');
  });

  it('reports a failing provider as a problem and trims long messages', () => {
    const cell = summariseAi(
      llm({
        configured: true,
        mode: 'ai',
        provider: 'groq',
        last_call_ok: false,
        last_error_message: 'x'.repeat(400),
      }),
    );
    expect(cell.tone).toBe('danger');
    expect(cell.badge).toBe('Failing');
    expect(cell.note.length).toBeLessThan(260);
  });
});

describe('summariseLibrary', () => {
  it('labels fixture passages as sample data', () => {
    const cell = summariseLibrary(kb());
    expect(cell.figure).toBe('4');
    expect(cell.unit).toBe('passages');
    expect(cell.badge).toBe('Sample data');
    expect(cell.note).toMatch(/not real case law/);
    expect(cell.note).toMatch(/Keyword search only/);
  });

  it('reports a real, embedded corpus as indexed', () => {
    const cell = summariseLibrary(
      kb({
        chunks_indexed: 120000,
        chunks_embedded: 100,
        documents_indexed: 1,
        sources: [{ dataset: 'Sumitedu/indian-case-laws', documents: 1 }],
      }),
    );
    expect(cell.figure).toBe('1,20,000');
    expect(cell.badge).toBe('Indexed');
    expect(cell.note).toMatch(/meaning-based/);
  });

  it('handles an empty or unavailable library', () => {
    expect(summariseLibrary(kb({ documents_indexed: 0, chunks_indexed: 0 })).badge).toBe('Empty');
    expect(summariseLibrary(kb({ available: false })).badge).toBe('Unavailable');
  });

  it('says when a background load is running', () => {
    const cell = summariseLibrary(
      kb({ corpus_load: { state: 'running', dataset: 'x', message: null, updated_at: null } }),
    );
    expect(cell.badge).toBe('Loading more');
  });
});

describe('summariseDirectory', () => {
  it('says all-sample listings are not real advocates', () => {
    const cell = summariseDirectory({
      available: true,
      verified_advocates: 1000,
      sample_advocates: 1000,
    });
    expect(cell.figure).toBe('1,000');
    expect(cell.badge).toBe('Sample listings');
    expect(cell.note).toMatch(/not real advocates/);
  });

  it('handles mixed, real, empty and unavailable directories', () => {
    expect(
      summariseDirectory({ available: true, verified_advocates: 10, sample_advocates: 4 }).note,
    ).toMatch(/4 of them are synthetic/);
    expect(
      summariseDirectory({ available: true, verified_advocates: 10, sample_advocates: 0 }).badge,
    ).toBe('Listed');
    expect(summariseDirectory({ available: true, verified_advocates: 0 }).badge).toBe('None yet');
    expect(summariseDirectory({ available: false, verified_advocates: null }).badge).toBe(
      'Unavailable',
    );
  });
});

describe('summariseServices', () => {
  const checks = { database: { status: 'ok' }, redis: { status: 'ok' } };

  it('counts passing checks', () => {
    const cell = summariseServices({ status: 'ok', detail: '', checks });
    expect(cell.figure).toBe('2 of 2');
    expect(cell.badge).toBe('Operational');
    expect(cell.note).toBe('Database ok · Redis ok');
  });

  it('reports degraded and unreachable states with words', () => {
    const degraded = summariseServices({
      status: 'degraded',
      detail: '',
      checks: { database: { status: 'ok' }, redis: { status: 'fail' } },
    });
    expect(degraded.figure).toBe('1 of 2');
    expect(degraded.badge).toBe('Degraded');
    expect(summariseServices({ status: 'error', detail: 'x' }).badge).toBe('Unreachable');
    expect(summariseServices({ status: 'loading', detail: '' }).badge).toBe('Checking');
  });

  it('formats check names', () => {
    expect(formatChecks({ vector_search: { status: 'ok' } })).toBe('Vector search ok');
    expect(formatChecks(undefined)).toBe('');
  });
});
