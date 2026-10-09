import { INDIAN_STATES } from '@legal-platform/shared';
import { describe, expect, it } from 'vitest';
import {
  formatFee,
  initialsOf,
  languageOptions,
  practiceAreaLabel,
  practiceAreaOptions,
  stateName,
  stateOptions,
} from './options';

describe('state options', () => {
  it('offers every state and union territory with its name and code', () => {
    const options = stateOptions();
    expect(options).toHaveLength(INDIAN_STATES.length);
    expect(options.find((o) => o.value === 'KA')?.label).toBe('Karnataka (KA)');
  });

  it('sorts by name', () => {
    const labels = stateOptions().map((o) => o.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'en')));
  });

  it('keeps a saved code that is not in the list', () => {
    expect(stateOptions('ZZ').some((o) => o.value === 'ZZ')).toBe(true);
    expect(stateOptions('CT').some((o) => o.value === 'CT')).toBe(true);
    expect(stateName('CT')).toBe('Chhattisgarh');
  });
});

describe('practice area and language options', () => {
  it('labels category codes the way the directory does', () => {
    expect(practiceAreaLabel('IT_LAW')).toBe('IT Law');
    expect(practiceAreaLabel('DATA_PROTECTION')).toBe('Data Protection');
  });

  it('leaves out ADVOCATE_REQUIRED unless it is already saved', () => {
    expect(practiceAreaOptions().some((o) => o.value === 'ADVOCATE_REQUIRED')).toBe(false);
    expect(practiceAreaOptions().some((o) => o.value === 'OUT_OF_SCOPE')).toBe(false);
    expect(
      practiceAreaOptions(['ADVOCATE_REQUIRED']).some((o) => o.value === 'ADVOCATE_REQUIRED'),
    ).toBe(true);
  });

  it('puts English and Hindi first and keeps unknown saved codes', () => {
    const values = languageOptions(['xx']).map((o) => o.value);
    expect(values.slice(0, 2)).toEqual(['en', 'hi']);
    expect(values.at(-1)).toBe('xx');
  });
});

describe('display helpers', () => {
  it('makes initials without the title', () => {
    expect(initialsOf('Adv. Meera Iyer', 'm@x.in')).toBe('MI');
    expect(initialsOf('Rohan', 'r@x.in')).toBe('R');
    expect(initialsOf(null, 'zed@x.in')).toBe('Z');
  });

  it('formats fees in rupees', () => {
    expect(formatFee('1500.00')).toBe('₹1,500');
    expect(formatFee('1500.50')).toBe('₹1,500.50');
    expect(formatFee(null)).toBeNull();
    expect(formatFee('abc')).toBeNull();
  });
});
