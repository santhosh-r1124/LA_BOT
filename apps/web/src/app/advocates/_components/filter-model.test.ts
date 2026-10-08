import { describe, expect, it } from 'vitest';
import { NO_FILTERS, activeFilterKeys, fromSearch, toQuery, toSearch } from './filter-model';

describe('fromSearch', () => {
  it('reads the directory query parameters', () => {
    expect(
      fromSearch('?practice_area=EMPLOYMENT_LAW&state=TN&city=Chennai&language_code=ta&page=3'),
    ).toEqual({
      filters: { practiceArea: 'EMPLOYMENT_LAW', state: 'TN', city: 'Chennai', language: 'ta' },
      page: 3,
    });
  });

  it('accepts the alias names and fixes the case of codes', () => {
    const { filters } = fromSearch('?state_code=tn&language=TA&practice_area=Cyber%20Law');
    expect(filters.state).toBe('TN');
    expect(filters.language).toBe('ta');
    expect(filters.practiceArea).toBe('CYBER_LAW');
  });

  it('keeps an unknown practice area as typed', () => {
    expect(fromSearch('?practice_area=Space%20Law').filters.practiceArea).toBe('Space Law');
  });

  it('falls back to page 1 for anything that is not a positive number', () => {
    for (const q of ['', '?page=0', '?page=-4', '?page=abc', '?page=NaN']) {
      expect(fromSearch(q).page).toBe(1);
    }
    expect(fromSearch('?page=2.9').page).toBe(2);
  });
});

describe('toSearch / toQuery', () => {
  it('is empty when nothing is set, and omits page 1', () => {
    expect(toSearch(NO_FILTERS, 1)).toBe('');
    expect(toSearch({ ...NO_FILTERS, state: 'KA' }, 1)).toBe('?state=KA');
  });

  it('round-trips filters and page', () => {
    const filters = { practiceArea: 'TAX_LAW', state: 'DL', city: 'New Delhi', language: 'hi' };
    expect(fromSearch(toSearch(filters, 4))).toEqual({ filters, page: 4 });
  });

  it('sends the API its own parameter names and a page size', () => {
    expect(toQuery({ ...NO_FILTERS, language: 'ta', practiceArea: 'IT_LAW' }, 2)).toMatchObject({
      practice_area: 'IT_LAW',
      language_code: 'ta',
      page: 2,
      page_size: 20,
      state: undefined,
    });
  });
});

describe('activeFilterKeys', () => {
  it('lists only the filters that are set', () => {
    expect(activeFilterKeys(NO_FILTERS)).toEqual([]);
    expect(activeFilterKeys({ ...NO_FILTERS, city: 'Pune', state: 'MH' })).toEqual([
      'state',
      'city',
    ]);
  });
});
