'use client';

import { INDIAN_STATES, MANDATORY_DISCLAIMER, PRACTICE_AREAS } from '@legal-platform/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Disclaimer, EmptyState, ErrorState, PageHeader, StatusBadge } from '@/components/ui';
import { ApiRequestError } from '@/lib/api-client';
import {
  advocateClient,
  type AdvocateDirectoryEntry,
  type AdvocateFacets,
  type AdvocateSearchFilters,
} from '@/lib/advocate-client';
import { useAuth } from '@/lib/auth-context';
import {
  formatInr,
  formatPhone,
  languageName,
  languageOptionLabel,
  practiceAreaLabel,
  stateName,
  stateOptionLabel,
} from '@/lib/format';

const PAGE_SIZE = 20;
const TEXT_DEBOUNCE_MS = 350;

interface Filters {
  practiceArea: string;
  state: string;
  city: string;
  language: string;
}

const NO_FILTERS: Filters = { practiceArea: '', state: '', city: '', language: '' };

/** Filters as the API's query parameters (and the page URL's). */
function toQuery(f: Filters, page: number): AdvocateSearchFilters {
  return {
    practice_area: f.practiceArea || undefined,
    state: f.state || undefined,
    city: f.city || undefined,
    language_code: f.language || undefined,
    page,
    page_size: PAGE_SIZE,
  };
}

/** Filters from the address bar, so a search can be shared or reloaded. */
function fromUrl(): { filters: Filters; page: number } {
  const q = new URLSearchParams(window.location.search);
  return {
    filters: {
      practiceArea: q.get('practice_area') ?? '',
      state: q.get('state') ?? q.get('state_code') ?? '',
      city: q.get('city') ?? '',
      language: q.get('language_code') ?? q.get('language') ?? '',
    },
    page: Math.max(1, Number(q.get('page')) || 1),
  };
}

function writeUrl(f: Filters, page: number): void {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(toQuery(f, page))) {
    if (value !== undefined && key !== 'page_size' && !(key === 'page' && value === 1)) {
      q.set(key, String(value));
    }
  }
  const qs = q.toString();
  window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
}

export default function AdvocatesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'LEGAL_ADMIN';
  const [ready, setReady] = useState(false);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  // What's typed in the city box; copied into `filters.city` once typing pauses,
  // so "Chennai" is one request, not seven.
  const [cityInput, setCityInput] = useState('');
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<AdvocateDirectoryEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiRequestError | Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const [facets, setFacets] = useState<AdvocateFacets | null>(null);

  useEffect(() => {
    const initial = fromUrl();
    setFilters(initial.filters);
    setCityInput(initial.filters.city);
    setPage(initial.page);
    setReady(true);
    advocateClient
      .facets()
      .then(setFacets)
      .catch(() => setFacets(null)); // dropdowns fall back to the full lists
  }, []);

  useEffect(() => {
    const next = cityInput.trim();
    const t = setTimeout(() => {
      setFilters((f) => {
        if (f.city === next) return f;
        setPage(1);
        return { ...f, city: next };
      });
    }, TEXT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [cityInput]);

  useEffect(() => {
    if (!ready) return;
    writeUrl(filters, page);
    let cancelled = false;
    setLoading(true);
    setError(null);
    advocateClient
      .search(toQuery(filters, page))
      .then((res) => {
        if (cancelled) return;
        setResults(res.items);
        setTotal(res.total);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setResults(null);
        setError(
          err instanceof ApiRequestError && err.code !== 'network_error'
            ? err
            : new Error('The advocate directory is unreachable right now.'),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, filters, page, nonce]);

  const setFilter = (key: keyof Filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  const hasFilters = Boolean(
    filters.practiceArea || filters.state || filters.city || filters.language || cityInput,
  );
  // Practice area -> Any, State -> Any, City -> empty, Language -> Any, page 1,
  // and always a fresh request (even when nothing was set).
  const clearFilters = () => {
    setFilters(NO_FILTERS);
    setCityInput('');
    setPage(1);
    setNonce((n) => n + 1);
  };

  const stateCodes = facets?.states.length
    ? facets.states.map((s) => s.code)
    : [...INDIAN_STATES].sort();
  const languageCodes = facets?.languages.length
    ? facets.languages.map((l) => l.code)
    : ['en', 'hi', 'ta', 'te', 'kn', 'ml', 'mr', 'bn', 'gu', 'pa', 'or', 'ur'];
  const count = (list: AdvocateFacets['states'] | undefined, code: string) => {
    const n = list?.find((v) => v.code === code)?.count;
    return n === undefined ? '' : ` (${n})`;
  };
  // Keep a value from the URL selectable even when no listing uses it.
  const withCurrent = (codes: string[], current: string) =>
    current && !codes.includes(current) ? [current, ...codes] : codes;

  const sampleCount = facets?.sample_count ?? 0;
  const allSample = facets !== null && facets.total > 0 && sampleCount === facets.total;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = (page - 1) * PAGE_SIZE;

  return (
    <main className="page">
      <PageHeader
        eyebrow="Advocate directory"
        title="Find an advocate"
        description="Filter by practice area, state, city and language, then contact the advocate directly."
      />
      {isAdmin && (
        <p className="-mt-2 mb-4 text-sm">
          <Link href="/advocates/import" className="link font-medium">
            Import advocates from a CSV file →
          </Link>
        </p>
      )}

      {sampleCount > 0 && (
        <div className="alert alert-warn mb-4" role="note" data-testid="sample-notice">
          <div>
            <p className="font-semibold">
              {allSample
                ? 'Every listing here is sample data.'
                : `${sampleCount} of ${facets?.total} listings are sample data.`}
            </p>
            <p className="muted mt-0.5 text-sm">
              Listings marked <strong>Sample</strong> are synthetic records for trying the
              directory. They are not real advocates, have not been verified, and their contact
              details are not real. Don&apos;t rely on them for legal help.
            </p>
          </div>
        </div>
      )}

      <form
        role="search"
        aria-label="Filter advocates"
        className="surface mb-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]"
        onSubmit={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="f-area" className="hint">
            Practice area
          </label>
          <select
            id="f-area"
            name="practice_area"
            value={filters.practiceArea}
            onChange={(e) => setFilter('practiceArea', e.target.value)}
            className="input"
          >
            <option value="">Any</option>
            {withCurrent([...PRACTICE_AREAS], filters.practiceArea).map((c) => (
              <option key={c} value={c}>
                {practiceAreaLabel(c)}
                {count(facets?.practice_areas, c)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-state" className="hint">
            State / UT (code)
          </label>
          <select
            id="f-state"
            name="state"
            value={filters.state}
            onChange={(e) => setFilter('state', e.target.value)}
            className="input"
          >
            <option value="">Any</option>
            {withCurrent(stateCodes, filters.state).map((s) => (
              <option key={s} value={s}>
                {stateOptionLabel(s)}
                {count(facets?.states, s)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-city" className="hint">
            City
          </label>
          <input
            id="f-city"
            name="city"
            placeholder="e.g. Chennai"
            value={cityInput}
            onChange={(e) => setCityInput(e.target.value)}
            className="input"
            list="f-city-options"
            autoComplete="off"
          />
          {facets && (
            <datalist id="f-city-options">
              {facets.cities.map((c) => (
                <option key={c.code} value={c.code} />
              ))}
            </datalist>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-lang" className="hint">
            Language (code)
          </label>
          <select
            id="f-lang"
            name="language_code"
            value={filters.language}
            onChange={(e) => setFilter('language', e.target.value)}
            className="input"
          >
            <option value="">Any</option>
            {withCurrent(languageCodes, filters.language).map((code) => (
              <option key={code} value={code}>
                {languageOptionLabel(code)}
                {count(facets?.languages, code)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button type="button" onClick={clearFilters} className="btn btn-ghost w-full">
            Clear
          </button>
        </div>
      </form>

      <div aria-live="polite" aria-busy={loading}>
        {error ? (
          <ErrorState
            title={
              error instanceof ApiRequestError && error.status === 422
                ? 'Those filters are not valid'
                : "Couldn't load advocates"
            }
            message={[
              error.message,
              ...(error instanceof ApiRequestError
                ? (error.details ?? []).map((d) => `${d.field}: ${d.message}`)
                : []),
            ].join(' ')}
            onRetry={() => setNonce((n) => n + 1)}
          />
        ) : loading && results === null ? (
          <div className="grid gap-3 md:grid-cols-2" role="status">
            <span className="sr-only">Loading advocates</span>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="skeleton h-28" />
            ))}
          </div>
        ) : results && results.length > 0 ? (
          <>
            <p className="muted mb-3 text-sm" data-testid="result-count">
              {total} advocate{total === 1 ? '' : 's'}
              {hasFilters ? ' match your filters' : ' listed'}
              {loading && ' · updating…'}
            </p>
            <ul
              className={`grid gap-3 md:grid-cols-2 ${loading ? 'opacity-60' : ''}`}
              data-testid="results"
            >
              {results.map((a) => {
                const fee = formatInr(a.consultation_fee);
                return (
                  <li key={a.id}>
                    <Link
                      href={`/advocates/${a.id}`}
                      className="surface-flat surface-interactive flex h-full flex-col gap-2 p-4"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-semibold">{a.display_name || 'Advocate'}</span>
                        <span className="flex items-baseline gap-2">
                          {fee && <span className="muted text-sm">{fee}</span>}
                          {a.is_sample && <StatusBadge tone="warn">Sample</StatusBadge>}
                        </span>
                      </div>
                      <p className="muted text-sm" data-testid="advocate-location">
                        {a.city}, <abbr title={stateName(a.state_code)}>{a.state_code}</abbr>
                        {a.experience_years != null && ` · ${a.experience_years} yrs`}
                        {a.languages.length > 0 && (
                          <>
                            {' · '}
                            {a.languages.map((code, i) => (
                              <span key={code}>
                                {i > 0 && ', '}
                                <abbr title={languageName(code)}>{code}</abbr>
                              </span>
                            ))}
                          </>
                        )}
                      </p>
                      {a.phone && <p className="text-sm">{formatPhone(a.phone)}</p>}
                      {a.practice_areas.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {a.practice_areas.slice(0, 4).map((p) => (
                            <span key={p} className="badge">
                              {practiceAreaLabel(p)}
                            </span>
                          ))}
                          {a.practice_areas.length > 4 && (
                            <span className="badge">+{a.practice_areas.length - 4}</span>
                          )}
                        </div>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {total > PAGE_SIZE && (
              <nav aria-label="Pagination" className="mt-5 flex items-center justify-between">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <span className="muted text-sm">
                  {first + 1}–{Math.min(first + PAGE_SIZE, total)} of {total} · page {page} of{' '}
                  {pages}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={page >= pages || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </nav>
            )}
          </>
        ) : (
          <EmptyState
            title={hasFilters ? 'No advocates match those filters' : 'No advocates listed yet'}
            action={
              hasFilters ? (
                <button type="button" onClick={clearFilters} className="btn btn-secondary btn-sm">
                  Clear filters
                </button>
              ) : undefined
            }
          >
            {hasFilters
              ? 'Try a broader practice area, another state, or remove the city or language filter.'
              : 'Advocates appear here once they are verified or imported by an administrator.'}
          </EmptyState>
        )}
      </div>

      <Disclaimer text={MANDATORY_DISCLAIMER} />
    </main>
  );
}
