'use client';

import { INDIAN_STATES, PRACTICE_AREAS } from '@legal-platform/shared';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SearchIcon, UsersIcon } from '@/components/icons';
import { EmptyState, ErrorState, PageHeader } from '@/components/ui';
import { ApiRequestError } from '@/lib/api-client';
import {
  advocateClient,
  type AdvocateDirectoryEntry,
  type AdvocateFacets,
} from '@/lib/advocate-client';
import { useAuth } from '@/lib/auth-context';
import { formatCount, languageName, practiceAreaLabel, stateName } from '@/lib/format';
import { AdvocateRow, AdvocateRowSkeleton } from './_components/advocate-row';
import { rememberDirectorySearch } from './_components/directory-memory';
import {
  FILTER_NAMES,
  NO_FILTERS,
  PAGE_SIZE,
  activeFilterKeys,
  fromSearch,
  toQuery,
  toSearch,
  type FilterKey,
  type Filters,
} from './_components/filter-model';
import {
  ActiveFilters,
  FilterPanel,
  filterValueLabel,
  type FilterOptions,
  type SelectOption,
} from './_components/filters';
import { UploadIcon } from './_components/local-icons';
import { Pagination } from './_components/pagination';
import { SampleNotice, useSampleNoticeDismissed } from './_components/sample-notice';
import styles from './directory.module.css';

const TEXT_DEBOUNCE_MS = 350;
const FALLBACK_LANGUAGES = ['en', 'hi', 'ta', 'te', 'kn', 'ml', 'mr', 'bn', 'gu', 'pa', 'or', 'ur'];

function byLabel(a: SelectOption, b: SelectOption): number {
  return a.label.localeCompare(b.label, 'en');
}

/** A filter value from the URL stays selectable even when no listing uses it. */
function withCurrent(codes: readonly string[], current: string): string[] {
  return current && !codes.includes(current) ? [current, ...codes] : [...codes];
}

function countSuffix(list: AdvocateFacets['states'] | undefined, code: string): string {
  const n = list?.find((v) => v.code === code)?.count;
  return n === undefined ? '' : ` (${formatCount(n)})`;
}

export default function AdvocatesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'LEGAL_ADMIN';
  const [noticeDismissed, dismissNotice] = useSampleNoticeDismissed();
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const headRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const initial = fromSearch(window.location.search);
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
    const search = toSearch(filters, page);
    window.history.replaceState(null, '', `${window.location.pathname}${search}`);
    rememberDirectorySearch(search);
    let cancelled = false;
    setLoading(true);
    setError(null);
    advocateClient
      .search(toQuery(filters, page))
      .then((res) => {
        if (cancelled) return;
        const lastPage = Math.max(1, Math.ceil(res.total / PAGE_SIZE));
        if (res.items.length === 0 && res.total > 0 && page > lastPage) {
          setPage(lastPage); // a stale ?page=99 in the address bar: show the last page instead
          return;
        }
        setResults(res.items);
        setTotal(res.total);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setResults(null);
        setError(
          err instanceof ApiRequestError && err.code !== 'network_error'
            ? err
            : new Error('The advocate directory is unreachable right now.'),
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, filters, page, nonce]);

  const setFilter = (key: Exclude<FilterKey, 'city'>, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  const removeFilter = (key: FilterKey) => {
    if (key === 'city') setCityInput('');
    setFilters((f) => ({ ...f, [key]: '' }));
    setPage(1);
  };

  const hasFilters = activeFilterKeys(filters).length > 0 || cityInput.trim() !== '';
  // Practice area, state, city and language all reset, page 1, and always a
  // fresh request (even when nothing was set).
  const clearFilters = () => {
    setFilters(NO_FILTERS);
    setCityInput('');
    setPage(1);
    setNonce((n) => n + 1);
  };

  const goToPage = useCallback((next: number) => {
    setPage(next);
    headRef.current?.scrollIntoView({ block: 'start' });
  }, []);

  const options = useMemo<FilterOptions>(() => {
    const stateCodes = facets?.states.length
      ? facets.states.map((s) => s.code)
      : [...INDIAN_STATES];
    const languageCodes = facets?.languages.length
      ? facets.languages.map((l) => l.code)
      : FALLBACK_LANGUAGES;
    return {
      areas: withCurrent(PRACTICE_AREAS, filters.practiceArea)
        .map((c) => ({
          value: c,
          label: `${practiceAreaLabel(c)}${countSuffix(facets?.practice_areas, c)}`,
        }))
        .sort(byLabel),
      states: withCurrent(stateCodes, filters.state)
        .map((c) => ({ value: c, label: `${stateName(c)}${countSuffix(facets?.states, c)}` }))
        .sort(byLabel),
      languages: withCurrent(languageCodes, filters.language)
        .map((c) => ({ value: c, label: `${languageName(c)}${countSuffix(facets?.languages, c)}` }))
        .sort(byLabel),
      cities: facets?.cities.map((c) => c.code) ?? [],
    };
  }, [facets, filters.practiceArea, filters.state, filters.language]);

  const sampleCount = facets?.sample_count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = (page - 1) * PAGE_SIZE;
  const hasResults = results !== null && results.length > 0;
  const activeSummary = activeFilterKeys(filters)
    .map((k) => `${FILTER_NAMES[k].toLowerCase()} ${filterValueLabel(k, filters[k])}`)
    .join(', ');

  return (
    <main className="page">
      <PageHeader
        eyebrow="Advocate directory"
        title="Find an advocate"
        description="Search by practice area, state, city and language."
        actions={
          isAdmin ? (
            <Link href="/advocates/import" className="btn btn-secondary btn-sm">
              <UploadIcon />
              Import from CSV
            </Link>
          ) : undefined
        }
      />

      {sampleCount > 0 && noticeDismissed === false && (
        <SampleNotice
          sampleCount={sampleCount}
          total={facets?.total ?? sampleCount}
          onDismiss={dismissNotice}
        />
      )}

      <div className={styles.layout}>
        <FilterPanel
          filters={filters}
          cityInput={cityInput}
          options={options}
          open={filtersOpen}
          total={results === null ? null : total}
          loading={loading}
          onToggle={() => setFiltersOpen((o) => !o)}
          onCityInput={setCityInput}
          onFilter={setFilter}
          onClear={clearFilters}
        />

        <section aria-labelledby="results-heading" className="min-w-0">
          <div ref={headRef} className={styles.head}>
            <div>
              <h2 id="results-heading" className={styles.count} data-testid="result-count">
                {results === null ? (
                  'Advocates'
                ) : (
                  <>
                    <span className={styles.countNumber}>{formatCount(total)}</span>
                    <span>
                      {total === 1 ? 'advocate' : 'advocates'}
                      {hasFilters ? (total === 1 ? ' matches' : ' match') : ' listed'}
                    </span>
                  </>
                )}
              </h2>
              {hasResults && (total > 1 || loading) && (
                <p className={styles.sub}>
                  {total > PAGE_SIZE
                    ? `Showing ${formatCount(first + 1)}–${formatCount(Math.min(first + PAGE_SIZE, total))}, page ${page} of ${pages}`
                    : `Showing all ${formatCount(total)}`}
                  {loading && ' · updating…'}
                </p>
              )}
            </div>
            {sampleCount > 0 && noticeDismissed && (
              <span className="badge badge-warn">
                <span className="dot" aria-hidden="true" />
                Sample data, not real advocates
              </span>
            )}
          </div>

          <ActiveFilters filters={filters} onRemove={removeFilter} onClear={clearFilters} />

          <p className="sr-only" role="status" aria-live="polite">
            {loading
              ? 'Loading advocates'
              : error
                ? ''
                : `${formatCount(total)} ${total === 1 ? 'advocate' : 'advocates'} found, page ${page} of ${pages}`}
          </p>

          {error ? (
            <div className="mt-5">
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
            </div>
          ) : results === null ? (
            <ul className={styles.list} aria-hidden="true">
              {Array.from({ length: 6 }, (_, i) => (
                <AdvocateRowSkeleton key={i} />
              ))}
            </ul>
          ) : hasResults ? (
            <>
              <ul
                className={styles.list}
                data-stale={loading}
                aria-busy={loading}
                data-testid="results"
              >
                {results.map((a) => (
                  <AdvocateRow key={a.id} advocate={a} />
                ))}
              </ul>
              <Pagination
                page={page}
                pages={pages}
                total={total}
                pageSize={PAGE_SIZE}
                disabled={loading}
                onPage={goToPage}
              />
            </>
          ) : (
            <div className="mt-5">
              <EmptyState
                icon={hasFilters ? SearchIcon : UsersIcon}
                title={hasFilters ? 'No advocates match these filters' : 'No advocates listed yet'}
                action={
                  hasFilters ? (
                    <button type="button" onClick={clearFilters} className="btn btn-secondary">
                      Clear all filters
                    </button>
                  ) : isAdmin ? (
                    <Link href="/advocates/import" className="btn btn-secondary">
                      <UploadIcon />
                      Import from CSV
                    </Link>
                  ) : undefined
                }
              >
                {hasFilters
                  ? `Nothing is listed for ${activeSummary || `city ${cityInput.trim()}`}. Try a broader practice area, another state, or remove the city or language.`
                  : 'Advocates appear here once an administrator imports or verifies them.'}
              </EmptyState>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
