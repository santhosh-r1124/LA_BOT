import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatCount,
  formatInr,
  formatPhone,
  initials,
  languageName,
  practiceAreaLabel,
  stateName,
} from './format';

describe('initials', () => {
  it('uses the first and last name', () => {
    expect(initials('Shalini Naidu')).toBe('SN');
    expect(initials('Mohan Krishnan Iyer')).toBe('MI');
  });

  it('skips titles and honorifics', () => {
    expect(initials('Adv. Meera Sharma')).toBe('MS');
    expect(initials('Advocate Dr. R. K. Rao')).toBe('RR');
    expect(initials('Smt. Lakshmi')).toBe('L');
  });

  it('handles a single word, non-Latin names and empty input', () => {
    expect(initials('Meera')).toBe('M');
    expect(initials('अनिल शर्मा')).toBe('अश');
    expect(initials('')).toBe('A');
    expect(initials(null)).toBe('A');
    expect(initials('   ')).toBe('A');
    expect(initials('Adv.')).toBe('A');
  });
});

describe('formatCount / formatBytes', () => {
  it('groups digits the Indian way', () => {
    expect(formatCount(1000)).toBe('1,000');
    expect(formatCount(1234567)).toBe('12,34,567');
  });

  it('formats file sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(72)).toBe('72 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(250 * 1024)).toBe('250 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(-1)).toBe('');
  });
});

describe('existing helpers keep working', () => {
  it('labels codes', () => {
    expect(practiceAreaLabel('IT_LAW')).toBe('IT Law');
    expect(practiceAreaLabel('CONSUMER_LAW')).toBe('Consumer Law');
    expect(stateName('TN')).toBe('Tamil Nadu');
    expect(stateName('ZZ')).toBe('ZZ');
    expect(languageName('ta')).toBe('Tamil');
  });

  it('formats money and phone numbers', () => {
    expect(formatInr('1500.00')).toBe('₹1,500');
    expect(formatInr(null)).toBeNull();
    expect(formatPhone('9761450515')).toBe('+91 97614 50515');
    expect(formatPhone('+91 97614 50515')).toBe('+91 97614 50515');
    expect(formatPhone('044-2345')).toBe('044-2345');
  });
});
