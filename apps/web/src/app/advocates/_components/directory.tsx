'use client';

import { INDIAN_STATES, PRACTICE_AREAS } from '@legal-platform/shared';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SearchIcon, UsersIcon } from '@/components/icons';
import { EmptyState, ErrorState, Notice } from '@/components/ui';
import { ApiRequestError } from '@/lib/api-client';
import {
  advocateClient,
  type AdvocateDirectoryEntry,
  type AdvocateFacets,
} from '@/lib/advocate-client';
import { useAuth } from '@/lib/auth-context';
import {
  fieldsOfPractice,
  formatCount,
  languageName,
  practiceAreaLabel,
  stateName,
} from '@/lib/format';
import { AdvocateRow, AdvocateRowSkeleton } from './advocate-row';
import { rememberDirectorySearch } from './directory-memory';
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
} from './filter-model';
import {
  ActiveFilters,
  FilterPanel,
  filterValueLabel,
  type FilterOptions,
  type SelectOption,
} from './filters';
import { UploadIcon } from './local-icons';
import { Pagination } from './pagination';
import { sampleBadgeLabel } from './sample-label';
import { SampleNotice, useSampleNoticeDismissed } from './sample-notice';
import styles from '../directory.module.css';

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

export function AdvocateDirectory({
  initialFacets,
  initialNoticeDismissed,
}: {
  /** Filter values and sample counts the server already fetched, or null if it could not. */
  initialFacets: AdvocateFacets | null;
  initialNoticeDismissed: boolean;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'LEGAL_ADMIN';
  const [noticeDismissed, dismissNotice] = useSampleNoticeDismissed(initialNoticeDismissed);
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
  const [facets, setFacets] = useState<AdvocateFacets | null>(initialFacets);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const headRef = useRef<HTMLDivElement>(null);
  const countRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const initial = fromSearch(window.location.search);
    setFilters(initial.filters);
    setCityInput(initial.filters.city);
    setPage(initial.page);
    setReady(true);
    if (initialFacets) return;
    // The server could not fetch the facets: ask from here. Dropdowns fall back to the full lists.
    advocateClient
      .facets()
      .then(setFacets)
      .catch(() => setFacets(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, on mount
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

  // The notice (and the button that was focused) is removed from the page, so
  // hand keyboard focus to the results heading instead of dropping it on <body>.
  const onDismissNotice = () => {
    dismissNotice();
    requestAnimationFrame(() => countRef.current?.focus());
  };

  const options = useMemo<FilterOptions>(() => {
    const stateCodes = facets?.states.length
      ? facets.states.map((s) => s.code)
      : [...INDIAN_STATES];
    const languageCodes = facets?.languages.length
      ? facets.languages.map((l) => l.code)
      : FALLBACK_LANGUAGES;
    return {
      areas: withCurrent(fieldsOfPractice(PRACTICE_AREAS), filters.practiceArea)
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
      hasCounts: facets !== null,
    };
  }, [facets, filters.practiceArea, filters.state, filters.language]);

  const sampleCount = facets?.sample_count ?? 0;
  const directoryTotal = facets?.total ?? sampleCount;
  const showNotice = sampleCount > 0 && !noticeDismissed;
  const badInput = error instanceof ApiRequestError && error.status === 422;
  const emptyResult = !error && !loading && results !== null && results.length === 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = (page - 1) * PAGE_SIZE;
  const hasResults = results !== null && results.length > 0;
  const activeSummary = activeFilterKeys(filters)
    .map((k) => `${FILTER_NAMES[k].toLowerCase()} ${filterValueLabel(k, filters[k])}`)
    .join(', ');

  return (
    <main className="page">
      <header className={`${styles.hero} ${showNotice ? styles.heroSplit : ''}`}>
        <div>
          <span className="eyebrow eyebrow-rule">Advocate directory</span>
          <h1 className="display display-md mt-2">Find an advocate</h1>
          <p className="lede mt-3">
            Search by practice area, state, city and language, then open a profile for the details
            an advocate has shared.
          </p>
          {isAdmin && (
            <div className="mt-4">
              <Link href="/advocates/import" className="btn btn-secondary btn-sm">
                <UploadIcon />
                Import from CSV
              </Link>
            </div>
          )}
        </div>
        {showNotice && (
          <SampleNotice
            sampleCount={sampleCount}
            total={directoryTotal}
            onDismiss={onDismissNotice}
          />
        )}
      </header>

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
              <h2
                id="results-heading"
                ref={countRef}
                tabIndex={-1}
                className={styles.count}
                data-testid="result-count"
              >
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
              {hasResults && (total > PAGE_SIZE || loading) && (
                <p className={styles.sub}>
                  {total > PAGE_SIZE &&
                    `Showing ${formatCount(first + 1)}–${formatCount(Math.min(first + PAGE_SIZE, total))}, page ${page} of ${pages}`}
                  {loading && (total > PAGE_SIZE ? ' · updating…' : 'Updating…')}
                </p>
              )}
            </div>
            {sampleCount > 0 && noticeDismissed && (
              <span className="badge badge-warn">
                <span className="dot" aria-hidden="true" />
                {sampleBadgeLabel(sampleCount, directoryTotal)}
              </span>
            )}
          </div>

          <ActiveFilters
            filters={filters}
            onRemove={removeFilter}
            onClear={clearFilters}
            showClear={!emptyResult && !badInput}
          />

          <p className="sr-only" role="status" aria-live="polite">
            {loading
              ? 'Loading advocates'
              : error
                ? ''
                : `${formatCount(total)} ${total === 1 ? 'advocate' : 'advocates'} found, page ${page} of ${pages}`}
          </p>

          {error ? (
            <div className="mt-5">
              {badInput ? (
                // Retrying would send the same filters again, so the way out is to drop them.
                <Notice
                  tone="warn"
                  title="One of the filters in this link isn't recognised"
                  action={
                    <button type="button" onClick={clearFilters} className="btn btn-secondary">
                      Clear filters
                    </button>
                  }
                >
                  <span className="muted">
                    Pick a practice area, state or language from the lists instead, or clear the
                    filters to see everyone.
                  </span>
                </Notice>
              ) : (
                <ErrorState
                  title="Couldn't load advocates"
                  message={error.message}
                  onRetry={() => setNonce((n) => n + 1)}
                />
              )}
            </div>
          ) : results === null ? (
            // As tall as a real page of results, so the footer stays below the fold while loading.
            <ul className={styles.list} aria-hidden="true">
              {Array.from({ length: 10 }, (_, i) => (
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
