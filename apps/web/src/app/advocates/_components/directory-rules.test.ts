import { describe, expect, it } from 'vitest';
import type { AdvocateDirectoryEntry } from '@/lib/advocate-client';
import { fieldsOfPractice, isFieldOfPractice } from '@/lib/format';
import { sampleBadgeLabel } from './sample-label';
import { otherAdvocates } from './similar';

function advocate(id: string, name: string | null, city = 'Chennai'): AdvocateDirectoryEntry {
  return {
    id,
    display_name: name,
    practice_areas: ['FAMILY_LAW'],
    state_code: 'TN',
    city,
    languages: ['en'],
    consultation_fee: null,
    bio: null,
    experience_years: null,
    availability: null,
    email: null,
    phone: null,
    is_sample: false,
  };
}

describe('fields of practice', () => {
  it('leaves out the chat categories that are not something to hire an advocate for', () => {
    expect(isFieldOfPractice('FAMILY_LAW')).toBe(true);
    expect(isFieldOfPractice('ADVOCATE_REQUIRED')).toBe(false);
    expect(isFieldOfPractice('DOCUMENT_GUIDANCE')).toBe(false);
    expect(fieldsOfPractice(['ADVOCATE_REQUIRED', 'TAX_LAW', 'DOCUMENT_GUIDANCE', 'CYBER_LAW'])).toEqual([
      'TAX_LAW',
      'CYBER_LAW',
    ]);
    expect(fieldsOfPractice(['ADVOCATE_REQUIRED'])).toEqual([]);
  });
});

describe('otherAdvocates', () => {
  const me = advocate('1', 'Adv. Meera Iyer');

  it('drops the profile itself and any copy of it', () => {
    const list = [me, advocate('2', 'Adv. Meera Iyer'), advocate('3', 'Rohit Kulkarni')];
    expect(otherAdvocates(list, me).map((a) => a.id)).toEqual(['3']);
  });

  it('shows one of several identical names in the same city', () => {
    const list = [
      advocate('2', 'Fatima Sheikh'),
      advocate('3', ' fatima sheikh '),
      advocate('4', 'Fatima Sheikh', 'Madurai'),
    ];
    expect(otherAdvocates(list, me).map((a) => a.id)).toEqual(['2', '4']);
  });

  it('copes with listings that have no name', () => {
    expect(otherAdvocates([advocate('2', null), advocate('3', null)], me)).toHaveLength(1);
  });
});

describe('sampleBadgeLabel', () => {
  it('says so plainly when every listing is a sample', () => {
    expect(sampleBadgeLabel(1000, 1000)).toBe('Sample data, not real advocates');
  });

  it('does not claim everything is a sample when some listings are real', () => {
    expect(sampleBadgeLabel(1000, 1005)).toBe('Mostly sample data');
    expect(sampleBadgeLabel(3, 40)).toBe('Includes sample data');
  });
});
