import type { Tone } from '@/components/ui';
import { providerLabel, type PlatformStatus } from './status-client';

/**
 * Turns the raw `GET /api/v1/status` payload and the web health route into the
 * plain-language cells shown on the home page. Pure functions: no fetching, no
 * React. Wording here is deliberate: it says what is real (sample data, AI off)
 * and never presents "AI is off" as an error.
 */

export type AiMode = 'ai' | 'offline';

export type InfraStatus = 'loading' | 'ok' | 'degraded' | 'error';

export interface InfraHealth {
  status: InfraStatus;
  detail: string;
  checks?: Record<string, { status: string }>;
}

export interface StatusCell {
  key: 'services' | 'library' | 'ai' | 'directory';
  label: string;
  /** Headline figure ("4", "Off", "2 of 2"). */
  figure: string;
  /** Small unit after the figure ("passages"). May be empty. */
  unit: string;
  tone: Tone;
  /** Badge text: status is always a word, never colour alone. */
  badge: string;
  note: string;
}

/** AI mode from the API, falling back to `configured` for older API versions. */
export function aiMode(status: Pick<PlatformStatus, 'llm'>): AiMode {
  const mode = status.llm.mode;
  if (mode === 'ai' || mode === 'offline') return mode;
  return status.llm.configured ? 'ai' : 'offline';
}

/** Indian digit grouping (1,00,000); an em dash for missing values. */
export function formatCount(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-IN') : '—';
}

/** True for dataset names that mark test data ("local/fixture", "synthetic"). */
export function isSampleDataset(dataset: string): boolean {
  return /\b(fixture|fixtures|sample|synthetic|demo)\b/i.test(dataset);
}

function plural(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}

function capitalise(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

/** "Database ok · Redis ok" from the readiness checks. */
export function formatChecks(checks: InfraHealth['checks']): string {
  if (!checks) return '';
  return Object.entries(checks)
    .map(([name, check]) => `${capitalise(name.replace(/_/g, ' '))} ${check.status}`)
    .join(' · ');
}

export function summariseServices(infra: InfraHealth): StatusCell {
  const checks = Object.values(infra.checks ?? {});
  const passing = checks.filter((c) => c.status === 'ok').length;
  const base = { key: 'services', label: 'Services' } as const;

  switch (infra.status) {
    case 'loading':
      return {
        ...base,
        figure: '…',
        unit: '',
        tone: 'neutral',
        badge: 'Checking',
        note: 'Asking the server.',
      };
    case 'ok':
      return {
        ...base,
        figure: checks.length ? `${passing} of ${checks.length}` : 'Up',
        unit: checks.length ? 'checks passing' : '',
        tone: 'ok',
        badge: 'Operational',
        note: formatChecks(infra.checks) || infra.detail,
      };
    case 'degraded':
      return {
        ...base,
        figure: checks.length ? `${passing} of ${checks.length}` : 'Partly',
        unit: checks.length ? 'checks passing' : 'up',
        tone: 'warn',
        badge: 'Degraded',
        note: formatChecks(infra.checks) || infra.detail,
      };
    default:
      return {
        ...base,
        figure: 'Down',
        unit: '',
        tone: 'danger',
        badge: 'Unreachable',
        note: 'The web server could not reach the API.',
      };
  }
}

export function summariseLibrary(kb: PlatformStatus['knowledge_base']): StatusCell {
  const base = { key: 'library', label: 'Legal library' } as const;

  if (!kb.available) {
    return {
      ...base,
      figure: '—',
      unit: '',
      tone: 'danger',
      badge: 'Unavailable',
      note: 'The server could not read the legal library.',
    };
  }

  const documents = kb.documents_indexed ?? 0;
  const passages = kb.chunks_indexed ?? 0;

  if (kb.corpus_load?.state === 'running') {
    return {
      ...base,
      figure: formatCount(passages),
      unit: plural(passages, 'passage'),
      tone: 'accent',
      badge: 'Loading more',
      note: 'More case law is being added in the background.',
    };
  }

  if (!documents) {
    return {
      ...base,
      figure: '0',
      unit: 'passages',
      tone: 'warn',
      badge: 'Empty',
      note: 'No legal documents are indexed yet, so questions will say that nothing matched.',
    };
  }

  const search =
    (kb.chunks_embedded ?? 0) > 0 ? 'Keyword and meaning-based search.' : 'Keyword search only.';
  const docs = `${formatCount(documents)} ${plural(documents, 'document')}.`;
  const sample = (kb.sources ?? []).some((s) => isSampleDataset(s.dataset));
  const failed = kb.corpus_load?.state === 'failed' ? ' The last attempt to load more failed.' : '';

  if (sample) {
    return {
      ...base,
      figure: formatCount(passages),
      unit: plural(passages, 'passage'),
      tone: 'warn',
      badge: 'Sample data',
      note: `Test fixtures for local use, not real case law. ${docs} ${search}${failed}`,
    };
  }
  return {
    ...base,
    figure: formatCount(passages),
    unit: plural(passages, 'passage'),
    tone: 'ok',
    badge: 'Indexed',
    note: `${docs} ${search}${failed}`,
  };
}

export function summariseAi(llm: PlatformStatus['llm']): StatusCell {
  const base = { key: 'ai', label: 'AI answers' } as const;

  if (aiMode({ llm }) === 'offline') {
    return {
      ...base,
      figure: 'Off',
      unit: 'in this setup',
      tone: 'info',
      badge: 'Offline mode',
      note: 'No AI provider is set up, so replies show matching passages and a rules-based risk level instead of a written explanation.',
    };
  }

  const who = [providerLabel(llm.provider), llm.model].filter(Boolean).join(' · ');
  if (llm.last_call_ok === false) {
    const reason = llm.last_error_message ? ` ${llm.last_error_message.slice(0, 140)}` : '';
    return {
      ...base,
      figure: 'On',
      unit: 'but failing',
      tone: 'danger',
      badge: 'Failing',
      note: `${who}. The last request failed.${reason}`,
    };
  }
  return {
    ...base,
    figure: 'On',
    unit: '',
    tone: 'ok',
    badge: llm.last_call_ok ? 'Working' : 'Configured',
    note: `${who}${llm.is_free_tier ? ' · free tier' : ''}. Replies are written from the passages found and cite them.`,
  };
}

export function summariseDirectory(dir: PlatformStatus['advocate_directory']): StatusCell {
  const base = { key: 'directory', label: 'Advocate directory' } as const;

  if (!dir.available) {
    return {
      ...base,
      figure: '—',
      unit: '',
      tone: 'danger',
      badge: 'Unavailable',
      note: 'The server could not read the directory.',
    };
  }

  const listed = dir.verified_advocates ?? 0;
  const samples = dir.sample_advocates ?? 0;

  if (!listed) {
    return {
      ...base,
      figure: '0',
      unit: 'listings',
      tone: 'neutral',
      badge: 'None yet',
      note: 'No advocates are listed yet.',
    };
  }
  if (samples >= listed) {
    return {
      ...base,
      figure: formatCount(listed),
      unit: plural(listed, 'listing'),
      tone: 'warn',
      badge: 'Sample listings',
      note: 'All of them are synthetic samples for testing. They are not real advocates.',
    };
  }
  return {
    ...base,
    figure: formatCount(listed),
    unit: plural(listed, 'listing'),
    tone: 'ok',
    badge: 'Listed',
    note: samples
      ? `${formatCount(samples)} of them are synthetic samples.`
      : 'Search by practice area, state, city and language.',
  };
}
