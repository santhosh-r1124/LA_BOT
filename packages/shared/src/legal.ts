/** Legal query categories (FRD §6). Mirrored in `apps/api` as an enum. */
export const LEGAL_CATEGORIES = [
  'CONSUMER_LAW',
  'CONTRACT_LAW',
  'IT_LAW',
  'CYBER_LAW',
  'DATA_PROTECTION',
  'IP_LAW',
  'PROPERTY_LAW',
  'EMPLOYMENT_LAW',
  'CORPORATE_LAW',
  'FAMILY_LAW',
  'CRIMINAL_LAW',
  'TAX_LAW',
  'DOCUMENT_GUIDANCE',
  'ADVOCATE_REQUIRED',
  'OUT_OF_SCOPE',
] as const;

export type LegalCategory = (typeof LEGAL_CATEGORIES)[number];

/** Internal risk classification for a query (FRD §13). */
export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** Which body of law a question potentially depends on (FRD §12). */
export const JURISDICTION_SCOPES = [
  'CENTRAL',
  'STATE',
  'LOCAL',
  'DISTRICT',
  'COURT',
  'REGISTRATION_AUTHORITY',
  'STAMP_DUTY',
  'UNKNOWN',
] as const;
export type JurisdictionScope = (typeof JURISDICTION_SCOPES)[number];

/**
 * Indian states and union territories, in the code convention used by the
 * advocate data (TN, TS, OD, CG, UK, GO, ...). Codes are case-sensitive and
 * stored exactly as written. Mirrored in apps/api app/core/india.py (STATE_NAMES).
 */
export const INDIAN_STATES = [
  'AN',
  'AP',
  'AR',
  'AS',
  'BR',
  'CH',
  'CG',
  'DN',
  'DL',
  'GO',
  'GJ',
  'HR',
  'HP',
  'JK',
  'JH',
  'KA',
  'KL',
  'LA',
  'LD',
  'MP',
  'MH',
  'MN',
  'ML',
  'MZ',
  'NL',
  'OD',
  'PY',
  'PB',
  'RJ',
  'SK',
  'TN',
  'TS',
  'TR',
  'UP',
  'UK',
  'WB',
] as const;
export type IndianStateCode = (typeof INDIAN_STATES)[number];

/**
 * ISO 3166-2:IN codes that differ from the convention above. Valid, and kept
 * as written when data uses them (a CSV row with CT stays CT).
 */
export const LEGACY_STATE_CODES = ['CT', 'GA', 'OR', 'TG', 'UT'] as const;
export type LegacyStateCode = (typeof LEGACY_STATE_CODES)[number];

/** Display names for {@link INDIAN_STATES} and {@link LEGACY_STATE_CODES}. */
export const INDIAN_STATE_NAMES: Record<IndianStateCode | LegacyStateCode, string> = {
  AN: 'Andaman and Nicobar Islands',
  AP: 'Andhra Pradesh',
  AR: 'Arunachal Pradesh',
  AS: 'Assam',
  BR: 'Bihar',
  CH: 'Chandigarh',
  CG: 'Chhattisgarh',
  DN: 'Dadra and Nagar Haveli and Daman and Diu',
  DL: 'Delhi',
  GO: 'Goa',
  GJ: 'Gujarat',
  HR: 'Haryana',
  HP: 'Himachal Pradesh',
  JK: 'Jammu & Kashmir',
  JH: 'Jharkhand',
  KA: 'Karnataka',
  KL: 'Kerala',
  LA: 'Ladakh',
  LD: 'Lakshadweep',
  MP: 'Madhya Pradesh',
  MH: 'Maharashtra',
  MN: 'Manipur',
  ML: 'Meghalaya',
  MZ: 'Mizoram',
  NL: 'Nagaland',
  OD: 'Odisha',
  PY: 'Puducherry',
  PB: 'Punjab',
  RJ: 'Rajasthan',
  SK: 'Sikkim',
  TN: 'Tamil Nadu',
  TS: 'Telangana',
  TR: 'Tripura',
  UP: 'Uttar Pradesh',
  UK: 'Uttarakhand',
  WB: 'West Bengal',
  CT: 'Chhattisgarh',
  GA: 'Goa',
  OR: 'Odisha',
  TG: 'Telangana',
  UT: 'Uttarakhand',
};

/** Advocate practice areas: every legal category except OUT_OF_SCOPE. */
export const PRACTICE_AREAS = LEGAL_CATEGORIES.filter(
  (c): c is Exclude<LegalCategory, 'OUT_OF_SCOPE'> => c !== 'OUT_OF_SCOPE',
);

/** Language codes (lower-case) used for advocate profiles. Mirrored in apps/api app/core/india.py. */
export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  bn: 'Bengali',
  te: 'Telugu',
  mr: 'Marathi',
  ta: 'Tamil',
  ur: 'Urdu',
  gu: 'Gujarati',
  kn: 'Kannada',
  ml: 'Malayalam',
  or: 'Odia',
  pa: 'Punjabi',
  as: 'Assamese',
  ks: 'Kashmiri',
  kok: 'Konkani',
  mai: 'Maithili',
  ne: 'Nepali',
  sa: 'Sanskrit',
  sd: 'Sindhi',
};

/** Document types the Legal Document Assistant supports (FRD §7). */
export const DOCUMENT_TYPES = [
  'RENTAL_AGREEMENT',
  'EMPLOYMENT_AGREEMENT',
  'NDA',
  'AFFIDAVIT',
  'DECLARATION',
  'BUSINESS_AGREEMENT',
  'PARTNERSHIP_DOCUMENT',
  'AUTHORIZATION_LETTER',
  'SERVICE_AGREEMENT',
  'LEGAL_NOTICE',
  'OTHER',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export function isLegalCategory(value: string): value is LegalCategory {
  return (LEGAL_CATEGORIES as readonly string[]).includes(value);
}

export function isRiskLevel(value: string): value is RiskLevel {
  return (RISK_LEVELS as readonly string[]).includes(value);
}

/** Risk levels that must surface an "consult an advocate" recommendation. */
export function requiresAdvocate(risk: RiskLevel): boolean {
  return risk === 'HIGH' || risk === 'CRITICAL';
}
