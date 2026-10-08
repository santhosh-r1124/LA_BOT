import { describe, expect, it } from 'vitest';
import {
  INDIAN_STATES,
  INDIAN_STATE_NAMES,
  LEGACY_STATE_CODES,
  PRACTICE_AREAS,
  isLegalCategory,
  isRiskLevel,
  requiresAdvocate,
} from './legal';
import { hasAdminAccess, isRole } from './roles';

describe('legal guards', () => {
  it('recognises valid legal categories', () => {
    expect(isLegalCategory('IT_LAW')).toBe(true);
    expect(isLegalCategory('SPACE_LAW')).toBe(false);
  });

  it('recognises valid risk levels', () => {
    expect(isRiskLevel('CRITICAL')).toBe(true);
    expect(isRiskLevel('SEVERE')).toBe(false);
  });

  it('flags advocate need for HIGH and CRITICAL only', () => {
    expect(requiresAdvocate('LOW')).toBe(false);
    expect(requiresAdvocate('MEDIUM')).toBe(false);
    expect(requiresAdvocate('HIGH')).toBe(true);
    expect(requiresAdvocate('CRITICAL')).toBe(true);
  });
});

describe('state and practice-area lists', () => {
  it('uses the advocate-data state codes and still names legacy ISO codes', () => {
    for (const code of ['TN', 'TS', 'OD', 'CG', 'UK', 'GO', 'KA', 'KL', 'AP']) {
      expect(INDIAN_STATES).toContain(code);
    }
    expect(INDIAN_STATE_NAMES.TN).toBe('Tamil Nadu');
    expect(INDIAN_STATE_NAMES.TS).toBe('Telangana');
    for (const code of LEGACY_STATE_CODES) {
      expect(INDIAN_STATES).not.toContain(code);
      expect(INDIAN_STATE_NAMES[code]).toBeTruthy();
    }
  });

  it('offers the 14 practice areas, including Document Guidance and Advocate Required', () => {
    expect(PRACTICE_AREAS).toHaveLength(14);
    expect(PRACTICE_AREAS).toContain('DOCUMENT_GUIDANCE');
    expect(PRACTICE_AREAS).toContain('ADVOCATE_REQUIRED');
    expect(PRACTICE_AREAS).not.toContain('OUT_OF_SCOPE');
  });
});

describe('role guards', () => {
  it('recognises platform roles', () => {
    expect(isRole('ADVOCATE')).toBe(true);
    expect(isRole('SUPERUSER')).toBe(false);
  });

  it('grants admin access to ADMIN and LEGAL_ADMIN', () => {
    expect(hasAdminAccess('ADMIN')).toBe(true);
    expect(hasAdminAccess('LEGAL_ADMIN')).toBe(true);
    expect(hasAdminAccess('CONSUMER')).toBe(false);
  });
});
