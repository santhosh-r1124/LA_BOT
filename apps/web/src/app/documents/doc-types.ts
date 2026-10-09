import type { QuestionOut } from '@/lib/document-client';

/**
 * Presentation data for the document assistant. The API owns the questions
 * (keys, labels, required flags); everything here is optional polish layered on
 * top: a description and icon per type, how the questions are grouped, and what
 * kind of control each one gets. Unknown types and keys fall back to sensible
 * defaults, so a new document type on the server still renders.
 */

export type DocIconName =
  | 'rental'
  | 'employment'
  | 'nda'
  | 'affidavit'
  | 'declaration'
  | 'business'
  | 'partnership'
  | 'authorization'
  | 'service'
  | 'notice'
  | 'other';

export interface GroupMeta {
  id: string;
  title: string;
  /** One quiet line under the group title. */
  description?: string;
  keys: string[];
}

export interface DocTypeMeta {
  label: string;
  description: string;
  icon: DocIconName;
  /** Which picker section the type sits in. */
  section: 'agreements' | 'statements' | 'other';
  groups: GroupMeta[];
}

export const PICKER_SECTIONS: Array<{
  id: DocTypeMeta['section'];
  title: string;
  description: string;
}> = [
  {
    id: 'agreements',
    title: 'Agreements',
    description: 'Between two or more parties, to be signed by all of them.',
  },
  {
    id: 'statements',
    title: 'Statements and authority',
    description: 'Something one person states, swears or permits.',
  },
  {
    id: 'other',
    title: 'Notices and everything else',
    description: 'A formal demand, or a document that is not listed.',
  },
];

export const DOC_TYPES: Record<string, DocTypeMeta> = {
  RENTAL_AGREEMENT: {
    label: 'Rental Agreement',
    description: 'A lease between a landlord and a tenant: rent, deposit, term and house rules.',
    icon: 'rental',
    section: 'agreements',
    groups: [
      { id: 'parties', title: 'Parties', keys: ['landlord_name', 'tenant_name'] },
      {
        id: 'property',
        title: 'The property',
        keys: ['property_address', 'state_code'],
      },
      {
        id: 'terms',
        title: 'Rent and term',
        keys: ['monthly_rent', 'security_deposit', 'lease_start_date', 'lease_duration_months'],
      },
      { id: 'extra', title: 'Anything else', keys: ['special_terms'] },
    ],
  },
  EMPLOYMENT_AGREEMENT: {
    label: 'Employment Agreement',
    description: 'Terms between an employer and an employee: role, pay, probation and notice.',
    icon: 'employment',
    section: 'agreements',
    groups: [
      { id: 'parties', title: 'Parties', keys: ['employer_name', 'employee_name'] },
      {
        id: 'role',
        title: 'Role and pay',
        keys: ['designation', 'monthly_salary', 'employment_start_date', 'probation_period_months'],
      },
      {
        id: 'place',
        title: 'Place and other terms',
        keys: ['state_code', 'key_terms'],
      },
    ],
  },
  SERVICE_AGREEMENT: {
    label: 'Service Agreement',
    description: 'What a service provider will do for a client, for what fee and for how long.',
    icon: 'service',
    section: 'agreements',
    groups: [
      { id: 'parties', title: 'Parties', keys: ['service_provider_name', 'client_name'] },
      {
        id: 'work',
        title: 'The work',
        keys: ['service_description', 'fee_amount', 'effective_date', 'duration', 'state_code'],
      },
    ],
  },
  BUSINESS_AGREEMENT: {
    label: 'Business Agreement',
    description: 'How two parties will work together: purpose, payment, deliverables and exit.',
    icon: 'business',
    section: 'agreements',
    groups: [
      { id: 'parties', title: 'Parties', keys: ['party_a_name', 'party_b_name'] },
      {
        id: 'arrangement',
        title: 'The arrangement',
        keys: ['business_purpose', 'effective_date', 'key_terms', 'state_code'],
      },
    ],
  },
  PARTNERSHIP_DOCUMENT: {
    label: 'Partnership Document',
    description: 'A partnership firm on paper: partners, capital and how profits are shared.',
    icon: 'partnership',
    section: 'agreements',
    groups: [
      {
        id: 'firm',
        title: 'The firm',
        keys: ['firm_name', 'partner_names', 'state_code'],
      },
      {
        id: 'money',
        title: 'Money and dates',
        keys: ['capital_contribution', 'profit_sharing_ratio', 'effective_date'],
      },
    ],
  },
  NDA: {
    label: 'NDA',
    description: 'A non-disclosure agreement that keeps shared business information confidential.',
    icon: 'nda',
    section: 'agreements',
    groups: [
      {
        id: 'parties',
        title: 'Parties',
        keys: ['disclosing_party', 'receiving_party', 'mutual_or_one_way'],
      },
      {
        id: 'purpose',
        title: 'Purpose and term',
        keys: ['purpose', 'effective_date', 'term_months', 'state_code'],
      },
    ],
  },
  AFFIDAVIT: {
    label: 'Affidavit',
    description:
      'A sworn written statement of facts, for example for a bank or a government office.',
    icon: 'affidavit',
    section: 'statements',
    groups: [
      { id: 'you', title: 'About you', keys: ['full_name', 'address', 'state_code'] },
      {
        id: 'statement',
        title: 'What you are stating',
        keys: ['purpose', 'facts_to_declare', 'supporting_documents'],
      },
    ],
  },
  DECLARATION: {
    label: 'Declaration',
    description:
      'A signed statement of facts you stand behind, usually less formal than an affidavit.',
    icon: 'declaration',
    section: 'statements',
    groups: [
      { id: 'you', title: 'About you', keys: ['declarant_name', 'address', 'state_code'] },
      { id: 'statement', title: 'What you are stating', keys: ['purpose', 'facts_declared'] },
    ],
  },
  AUTHORIZATION_LETTER: {
    label: 'Authorization Letter',
    description: 'Lets someone act for you on one task, such as collecting a document.',
    icon: 'authorization',
    section: 'statements',
    groups: [
      {
        id: 'people',
        title: 'The people',
        keys: ['authorizer_name', 'authorized_person_name'],
      },
      {
        id: 'authority',
        title: 'The authority given',
        keys: ['purpose', 'validity_period', 'state_code'],
      },
    ],
  },
  LEGAL_NOTICE: {
    label: 'Legal Notice',
    description:
      'A formal notice that sets out a grievance and what you want the other side to do.',
    icon: 'notice',
    section: 'other',
    groups: [
      { id: 'parties', title: 'Sender and recipient', keys: ['sender_name', 'recipient_name'] },
      {
        id: 'grievance',
        title: 'The grievance',
        keys: ['subject_matter', 'facts_and_grievance', 'relief_sought', 'state_code'],
      },
    ],
  },
  OTHER: {
    label: 'Other',
    description: 'Not on the list? Describe the document and get a draft built from your details.',
    icon: 'other',
    section: 'other',
    groups: [
      {
        id: 'document',
        title: 'The document',
        keys: ['document_description', 'key_facts', 'state_code'],
      },
    ],
  },
};

// Acronyms that stay upper-case when a type has no entry above.
const ACRONYMS = new Set(['NDA', 'IT', 'IP']);

function titleCase(documentType: string): string {
  return documentType
    .split('_')
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w) ? w : (w[0] ?? '') + w.slice(1).toLowerCase()))
    .join(' ');
}

export function typeLabel(documentType: string): string {
  return DOC_TYPES[documentType]?.label ?? titleCase(documentType);
}

export function typeMeta(documentType: string): DocTypeMeta {
  return (
    DOC_TYPES[documentType] ?? {
      label: titleCase(documentType),
      description: 'Answer a few questions to get a labelled draft with notes.',
      icon: 'other',
      section: 'other',
      groups: [],
    }
  );
}

// ---------------------------------------------------------------------------
// Field kinds
// ---------------------------------------------------------------------------

export type FieldKind = 'text' | 'long' | 'date' | 'money' | 'months' | 'state' | 'mutual';

export interface FieldMeta {
  kind: FieldKind;
  /** Visible lines of a `long` field. */
  rows?: number;
  placeholder?: string;
  /** Plain-language help, shown under the label when the API sends none. */
  hint?: string;
  autoComplete?: string;
}

const FIELDS: Record<string, FieldMeta> = {
  state_code: { kind: 'state' },
  mutual_or_one_way: { kind: 'mutual' },

  // Names
  landlord_name: { kind: 'text', placeholder: 'e.g. Meera Iyer' },
  tenant_name: { kind: 'text', placeholder: 'e.g. Arjun Rao' },
  employer_name: { kind: 'text', placeholder: 'e.g. Northwind Technologies Pvt. Ltd.' },
  employee_name: { kind: 'text', placeholder: 'e.g. Kavya Nair' },
  designation: { kind: 'text', placeholder: 'e.g. Software Engineer' },
  disclosing_party: { kind: 'text', placeholder: 'Person or company sharing the information' },
  receiving_party: { kind: 'text', placeholder: 'Person or company receiving it' },
  full_name: {
    kind: 'text',
    hint: 'As it appears on your identity document.',
    autoComplete: 'name',
  },
  declarant_name: {
    kind: 'text',
    hint: 'As it appears on your identity document.',
    autoComplete: 'name',
  },
  party_a_name: { kind: 'text', placeholder: 'Person or company' },
  party_b_name: { kind: 'text', placeholder: 'Person or company' },
  firm_name: { kind: 'text', placeholder: 'e.g. Rao and Iyer Associates' },
  authorizer_name: { kind: 'text', hint: 'You, or whoever is giving permission.' },
  authorized_person_name: { kind: 'text', hint: 'The person who will act on that permission.' },
  service_provider_name: { kind: 'text', placeholder: 'Person or company doing the work' },
  client_name: { kind: 'text', placeholder: 'Person or company paying for it' },
  sender_name: {
    kind: 'text',
    hint: 'The person or company sending the notice.',
    autoComplete: 'name',
  },
  recipient_name: { kind: 'text', hint: 'Who the notice is addressed to.' },

  // Places and addresses
  property_address: {
    kind: 'long',
    rows: 3,
    hint: 'House or flat number, street, locality, city and PIN code.',
  },
  address: {
    kind: 'long',
    rows: 3,
    hint: 'House or flat number, street, locality, city and PIN code.',
    autoComplete: 'street-address',
  },

  // Money and numbers
  monthly_rent: {
    kind: 'money',
    hint: 'Rupees per month, digits only. For example 25000.',
  },
  security_deposit: {
    kind: 'money',
    hint: 'Rupees, digits only. Write 0 if there is no deposit.',
  },
  monthly_salary: {
    kind: 'money',
    hint: 'Rupees per month, digits only. For example 60000.',
  },
  lease_duration_months: {
    kind: 'months',
    hint: 'Number of months, digits only. For example 11.',
  },
  probation_period_months: {
    kind: 'months',
    hint: 'Digits only. Leave this empty if there is no probation.',
  },
  term_months: {
    kind: 'months',
    hint: 'Number of months, digits only. For example 24.',
  },

  // Dates
  lease_start_date: { kind: 'date' },
  employment_start_date: { kind: 'date' },
  effective_date: { kind: 'date', hint: 'The date the document takes effect.' },

  // Free text
  special_terms: {
    kind: 'long',
    rows: 3,
    hint: 'Maintenance, notice period, lock-in, pets, anything else you have agreed. One point per line.',
  },
  key_terms: {
    kind: 'long',
    rows: 4,
    hint: 'Payment, deliverables, notice period, confidentiality and so on. One point per line.',
  },
  purpose: { kind: 'long', rows: 2 },
  business_purpose: {
    kind: 'long',
    rows: 3,
    hint: 'What the two parties are doing together, in a few lines.',
  },
  facts_to_declare: {
    kind: 'long',
    rows: 5,
    hint: 'Put each fact on its own line, in your own words. Only state what you know to be true.',
  },
  facts_declared: {
    kind: 'long',
    rows: 5,
    hint: 'Put each fact on its own line, in your own words. Only state what you know to be true.',
  },
  supporting_documents: {
    kind: 'long',
    rows: 2,
    hint: 'For example an Aadhaar card, a utility bill or a sale deed. Leave empty if none.',
  },
  partner_names: { kind: 'long', rows: 3, hint: 'One name per line.' },
  capital_contribution: {
    kind: 'long',
    rows: 2,
    hint: 'Each partner and the amount in rupees, one per line.',
  },
  profit_sharing_ratio: { kind: 'text', hint: 'For example 60:40, or equal.' },
  validity_period: { kind: 'text', hint: 'For example 6 months, or until 31 March 2027.' },
  service_description: {
    kind: 'long',
    rows: 4,
    hint: 'What will be delivered, and anything that is not included.',
  },
  fee_amount: {
    kind: 'long',
    rows: 2,
    hint: 'The amount and when it is paid. For example: Rs. 50,000 per month, paid by the 5th.',
  },
  duration: { kind: 'text', hint: 'For example 12 months, or until the work is finished.' },
  subject_matter: { kind: 'long', rows: 2, hint: 'One or two lines: what this notice is about.' },
  facts_and_grievance: {
    kind: 'long',
    rows: 5,
    hint: 'What happened, in order, with dates and amounts where you have them.',
  },
  relief_sought: {
    kind: 'long',
    rows: 3,
    hint: 'What you want the recipient to do, and by when.',
  },
  document_description: {
    kind: 'long',
    rows: 3,
    hint: 'What the document is, who it is between and what it is for.',
  },
  key_facts: {
    kind: 'long',
    rows: 5,
    hint: 'Names, dates, amounts and conditions it should include. One point per line.',
  },
};

/** Type-specific overrides for keys whose meaning changes with the document. */
const FIELD_OVERRIDES: Record<string, FieldMeta> = {
  'AFFIDAVIT.purpose': {
    kind: 'long',
    rows: 2,
    placeholder: 'e.g. Proof of address for a bank account',
    hint: 'Who asked for it and why, in a line or two.',
  },
  'DECLARATION.purpose': {
    kind: 'long',
    rows: 2,
    placeholder: 'e.g. Name change declaration for a college record',
    hint: 'Who asked for it and why, in a line or two.',
  },
  'NDA.purpose': {
    kind: 'long',
    rows: 2,
    placeholder: 'e.g. Evaluating a possible partnership',
    hint: 'Why the information is being shared.',
  },
  'AUTHORIZATION_LETTER.purpose': {
    kind: 'long',
    rows: 2,
    placeholder: 'e.g. Collect my passport from the regional office',
    hint: 'Be specific: the authority covers only what you write here.',
  },
};

export function fieldMeta(documentType: string, key: string): FieldMeta {
  return FIELD_OVERRIDES[`${documentType}.${key}`] ?? FIELDS[key] ?? { kind: 'text' };
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export interface QuestionGroup {
  id: string;
  title: string;
  description?: string;
  questions: QuestionOut[];
}

/**
 * Arrange a type's questions into the groups defined above. Questions the
 * groups do not mention (a field added on the server) land in a final "More
 * details" group, and keys listed here but missing from the API are skipped, so
 * the form always shows exactly the questions the server will check.
 */
export function groupQuestions(documentType: string, questions: QuestionOut[]): QuestionGroup[] {
  const byKey = new Map(questions.map((q) => [q.key, q] as const));
  const used = new Set<string>();
  const groups: QuestionGroup[] = [];

  for (const group of typeMeta(documentType).groups) {
    const list = group.keys.flatMap((key) => {
      const q = byKey.get(key);
      if (!q || used.has(key)) return [];
      used.add(key);
      return [q];
    });
    if (list.length > 0) {
      groups.push({
        id: group.id,
        title: group.title,
        description: group.description,
        questions: list,
      });
    }
  }

  const rest = questions.filter((q) => !used.has(q.key));
  if (rest.length > 0) {
    groups.push({
      id: 'more',
      title: groups.length > 0 ? 'More details' : typeLabel(documentType),
      questions: rest,
    });
  }
  return groups;
}
