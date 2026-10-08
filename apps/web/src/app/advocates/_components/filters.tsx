'use client';

import { ChevronDownIcon, CloseIcon, FilterIcon, SearchIcon } from '@/components/icons';
import { formatCount, languageName, practiceAreaLabel, stateName } from '@/lib/format';
import styles from '../directory.module.css';
import { FILTER_NAMES, activeFilterKeys, type FilterKey, type Filters } from './filter-model';

export interface SelectOption {
  value: string;
  label: string;
}

export interface FilterOptions {
  areas: SelectOption[];
  states: SelectOption[];
  languages: SelectOption[];
  cities: string[];
}

const PANEL_ID = 'advocate-filters';

/** Human text for one active filter's value. */
export function filterValueLabel(key: FilterKey, value: string): string {
  switch (key) {
    case 'practiceArea':
      return practiceAreaLabel(value);
    case 'state':
      return stateName(value);
    case 'language':
      return languageName(value);
    default:
      return value;
  }
}

/**
 * The filter controls. From 1024px this is an always-open sticky rail; below
 * that the "Filters" button opens and closes it.
 */
export function FilterPanel({
  filters,
  cityInput,
  options,
  open,
  total,
  loading,
  onToggle,
  onCityInput,
  onFilter,
  onClear,
}: {
  filters: Filters;
  cityInput: string;
  options: FilterOptions;
  open: boolean;
  total: number | null;
  loading: boolean;
  onToggle: () => void;
  onCityInput: (value: string) => void;
  onFilter: (key: Exclude<FilterKey, 'city'>, value: string) => void;
  onClear: () => void;
}) {
  const activeCount = activeFilterKeys(filters).length + (cityInput && !filters.city ? 1 : 0);

  return (
    <form
      role="search"
      aria-label="Filter advocates"
      onSubmit={(e) => e.preventDefault()}
      className={styles.rail}
    >
      <button
        type="button"
        className={`btn btn-secondary ${styles.toggle}`}
        aria-expanded={open}
        aria-controls={PANEL_ID}
        onClick={onToggle}
      >
        <span className={styles.toggleLabel}>
          <FilterIcon />
          Filters
          {activeCount > 0 && (
            <span className={styles.toggleCount}>
              {activeCount}
              <span className="sr-only"> active</span>
            </span>
          )}
        </span>
        <ChevronDownIcon className={styles.chevron} />
      </button>

      <div id={PANEL_ID} className={`surface ${styles.panel}`} data-open={open}>
        <div className={styles.panelHead}>
          <span className={styles.panelTitle}>
            <FilterIcon />
            Filters
          </span>
          {activeCount > 0 && (
            <button type="button" className="btn btn-ghost btn-sm -mr-2" onClick={onClear}>
              Clear all
            </button>
          )}
        </div>

        <div className={styles.fields}>
          <div className="field">
            <label htmlFor="f-area" className="label">
              Practice area
            </label>
            <select
              id="f-area"
              name="practice_area"
              value={filters.practiceArea}
              onChange={(e) => onFilter('practiceArea', e.target.value)}
              className="input"
            >
              <option value="">Any practice area</option>
              {options.areas.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="f-state" className="label">
              State or UT
            </label>
            <select
              id="f-state"
              name="state"
              value={filters.state}
              onChange={(e) => onFilter('state', e.target.value)}
              className="input"
            >
              <option value="">Any state or UT</option>
              {options.states.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="f-city" className="label">
              City
            </label>
            <div className="input-wrap">
              <SearchIcon />
              <input
                id="f-city"
                name="city"
                type="search"
                placeholder="e.g. Chennai"
                value={cityInput}
                onChange={(e) => onCityInput(e.target.value)}
                className="input"
                list="f-city-options"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            {options.cities.length > 0 && (
              <datalist id="f-city-options">
                {options.cities.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            )}
          </div>

          <div className="field">
            <label htmlFor="f-lang" className="label">
              Language
            </label>
            <select
              id="f-lang"
              name="language_code"
              value={filters.language}
              onChange={(e) => onFilter('language', e.target.value)}
              className="input"
            >
              <option value="">Any language</option>
              {options.languages.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Mobile only: close the panel and see the results. */}
        <div className={styles.showResults}>
          <button type="button" className="btn btn-primary btn-block" onClick={onToggle}>
            {total === null || loading
              ? 'Show results'
              : `Show ${formatCount(total)} ${total === 1 ? 'advocate' : 'advocates'}`}
          </button>
          {activeCount > 0 && (
            <button type="button" className="btn btn-ghost btn-block" onClick={onClear}>
              Clear all filters
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

/** One removable chip per active filter, plus a Clear button. */
export function ActiveFilters({
  filters,
  onRemove,
  onClear,
}: {
  filters: Filters;
  onRemove: (key: FilterKey) => void;
  onClear: () => void;
}) {
  const keys = activeFilterKeys(filters);
  if (keys.length === 0) return null;
  return (
    <div className={styles.chips} role="group" aria-label="Active filters">
      {keys.map((key) => {
        const value = filterValueLabel(key, filters[key]);
        return (
          <button
            key={key}
            type="button"
            className={`chip is-active ${styles.chip}`}
            onClick={() => onRemove(key)}
            aria-label={`Remove filter: ${FILTER_NAMES[key]} ${value}`}
          >
            <span className={styles.chipName}>{FILTER_NAMES[key]}:</span>
            <span className={styles.chipValue}>{value}</span>
            <CloseIcon />
          </button>
        );
      })}
      <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
