'use client';

import {
  INDIAN_STATES,
  LANGUAGE_NAMES,
  LEGAL_CATEGORIES,
  MANDATORY_DISCLAIMER,
} from '@legal-platform/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Disclaimer, EmptyState, ErrorState, PageHeader } from '@/components/ui';
import { ApiRequestError } from '@/lib/api-client';
import {
  advocateClient,
  type AdvocateDirectoryEntry,
  type AdvocateSearchFilters,
} from '@/lib/advocate-client';
import { useAuth } from '@/lib/auth-context';
import { formatInr, formatPhone, languageName, practiceAreaLabel, stateName } from '@/lib/format';

const PAGE_SIZE = 20;
const TEXT_DEBOUNCE_MS = 350;

/** Returns `value` only after it has been stable for `delay` ms. */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const STATE_OPTIONS = [...INDIAN_STATES].sort((a, b) => stateName(a).localeCompare(stateName(b)));
const LANGUAGE_OPTIONS = Object.entries(LANGUAGE_NAMES).sort(([, a], [, b]) => a.localeCompare(b));

export default function AdvocatesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'LEGAL_ADMIN';
  const [practiceArea, setPracticeArea] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [city, setCity] = useState('');
  const [language, setLanguage] = useState('');
  const [offset, setOffset] = useState(0);
  const [results, setResults] = useState<AdvocateDirectoryEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // The city input is debounced so typing "Chennai" is one request, not seven.
  const debouncedCity = useDebounced(city.trim(), TEXT_DEBOUNCE_MS);

  useEffect(() => {
    setOffset(0);
  }, [practiceArea, stateCode, debouncedCity, language]);

  useEffect(() => {
    const filters: AdvocateSearchFilters = {
      practice_area: practiceArea || undefined,
      state_code: stateCode || undefined,
      city: debouncedCity || undefined,
      language: language || undefined,
      limit: PAGE_SIZE,
      offset,
    };
    let cancelled = false;
    setLoading(true);
    setError(null);
    advocateClient
      .search(filters)
      .then((res) => {
        if (cancelled) return;
        setResults(res.items);
        setTotal(res.total);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiRequestError && err.code !== 'network_error'
            ? err.message
            : 'The advocate directory is unreachable right now.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [practiceArea, stateCode, debouncedCity, language, offset, nonce]);

  const hasFilters = Boolean(practiceArea || stateCode || city || language);
  const clearFilters = () => {
    setPracticeArea('');
    setStateCode('');
    setCity('');
    setLanguage('');
  };

  return (
    <main className="page">
      <PageHeader
        eyebrow="Advocate directory"
        title="Find a verified advocate"
        description="Only advocates verified by the platform are listed. Filter by practice area, location and language, then contact them directly."
      />
      {isAdmin && (
        <p className="-mt-2 mb-4 text-sm">
          <Link href="/advocates/import" className="link font-medium">
            Import advocates from a CSV file →
          </Link>
        </p>
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
            value={practiceArea}
            onChange={(e) => setPracticeArea(e.target.value)}
            className="input"
          >
            <option value="">Any</option>
            {LEGAL_CATEGORIES.filter((c) => c !== 'OUT_OF_SCOPE').map((c) => (
              <option key={c} value={c}>
                {practiceAreaLabel(c)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-state" className="hint">
            State / UT
          </label>
          <select
            id="f-state"
            value={stateCode}
            onChange={(e) => setStateCode(e.target.value)}
            className="input"
          >
            <option value="">Any</option>
            {STATE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {stateName(s)}
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
            placeholder="e.g. Chennai"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="input"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-lang" className="hint">
            Language
          </label>
          <select
            id="f-lang"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="input"
          >
            <option value="">Any</option>
            {LANGUAGE_OPTIONS.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={clearFilters}
            disabled={!hasFilters}
            className="btn btn-ghost w-full"
          >
            Clear
          </button>
        </div>
      </form>

      <div aria-live="polite" aria-busy={loading}>
        {error ? (
          <ErrorState
            title="Couldn't load advocates"
            message={error}
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
            <p className="muted mb-3 text-sm">
              {total} verified advocate{total === 1 ? '' : 's'}
              {hasFilters ? ' match your filters' : ''}
              {loading && ' · updating…'}
            </p>
            <ul className={`grid gap-3 md:grid-cols-2 ${loading ? 'opacity-60' : ''}`}>
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
                        {fee && <span className="muted text-sm">{fee}</span>}
                      </div>
                      <p className="muted text-sm">
                        {a.city}, {stateName(a.state_code)}
                        {a.experience_years != null && ` · ${a.experience_years} yrs`}
                        {a.languages.length > 0 && ` · ${a.languages.map(languageName).join(', ')}`}
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
                  disabled={offset === 0 || loading}
                  onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                >
                  Previous
                </button>
                <span className="muted text-sm">
                  {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={offset + PAGE_SIZE >= total || loading}
                  onClick={() => setOffset((o) => o + PAGE_SIZE)}
                >
                  Next
                </button>
              </nav>
            )}
          </>
        ) : (
          <EmptyState
            title={hasFilters ? 'No advocates match those filters' : 'No verified advocates yet'}
            action={
              hasFilters ? (
                <button type="button" onClick={clearFilters} className="btn btn-secondary btn-sm">
                  Clear filters
                </button>
              ) : undefined
            }
          >
            {hasFilters
              ? 'Try a broader practice area or remove the city filter.'
              : 'Advocates appear here once they are verified or imported by an administrator.'}
          </EmptyState>
        )}
      </div>

      <Disclaimer text={MANDATORY_DISCLAIMER} />
    </main>
  );
}
