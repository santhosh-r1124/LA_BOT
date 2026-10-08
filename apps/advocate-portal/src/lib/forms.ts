/**
 * Pure form logic for the register and profile pages: validation, request
 * payloads, the profile checklist and the mapping from API errors to messages a
 * person can act on. No React and no runtime imports, so it is easy to test.
 */

export interface FormValues {
  email: string;
  password: string;
  displayName: string;
  stateCode: string;
  city: string;
  practiceAreas: string[];
  languages: string[];
  /** Rupees as typed, e.g. "1500" or "1500.50"; empty when not given. */
  fee: string;
  /** Whole years as typed; empty when not given. */
  experience: string;
  bio: string;
}

export type RegisterField = keyof FormValues;
export type ProfileField = Exclude<RegisterField, 'email' | 'password' | 'displayName'>;
export type FieldErrors<F extends string = RegisterField> = Partial<Record<F, string>>;

export const REGISTER_FIELDS: readonly RegisterField[] = [
  'email',
  'password',
  'displayName',
  'stateCode',
  'city',
  'practiceAreas',
  'languages',
  'fee',
  'experience',
  'bio',
];

export const PROFILE_FIELDS: readonly ProfileField[] = [
  'stateCode',
  'city',
  'practiceAreas',
  'languages',
  'fee',
  'experience',
  'bio',
];

export const LIMITS = {
  passwordMin: 8,
  passwordMax: 128,
  nameMax: 150,
  cityMax: 100,
  bioMax: 2000,
  experienceMax: 70,
  /** The fee column holds up to 8 digits before the decimal point. */
  feeMax: 99_999_999.99,
} as const;

// ---- Field validators (each returns a message, or undefined when fine) -------

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value: string): string | undefined {
  const v = value.trim();
  if (!v) return 'Enter your email address.';
  if (v.length > 254 || !EMAIL_PATTERN.test(v)) {
    return 'Enter a valid email address, like name@example.com.';
  }
  return undefined;
}

export function validatePassword(value: string): string | undefined {
  if (!value) return 'Choose a password.';
  if (value.length < LIMITS.passwordMin) {
    return `Use at least ${LIMITS.passwordMin} characters.`;
  }
  if (value.length > LIMITS.passwordMax) {
    return `Use ${LIMITS.passwordMax} characters or fewer.`;
  }
  return undefined;
}

export function validateDisplayName(value: string): string | undefined {
  const v = value.trim();
  if (!v) return 'Enter your full name.';
  if (v.length > LIMITS.nameMax) return `Use ${LIMITS.nameMax} characters or fewer.`;
  return undefined;
}

export function validateStateCode(value: string): string | undefined {
  return value.trim() ? undefined : 'Choose your state or union territory.';
}

export function validateCity(value: string): string | undefined {
  const v = value.trim();
  if (!v) return 'Enter your city.';
  if (v.length > LIMITS.cityMax) return `Use ${LIMITS.cityMax} characters or fewer.`;
  return undefined;
}

export function validateFee(value: string): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) {
    return 'Enter an amount in rupees, like 1500 or 1500.50.';
  }
  if (Number(v) > LIMITS.feeMax) return 'That amount is too large.';
  return undefined;
}

export function validateExperience(value: string): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  if (!/^\d+$/.test(v)) return 'Enter a whole number of years.';
  if (Number(v) > LIMITS.experienceMax) {
    return `Enter ${LIMITS.experienceMax} years or fewer.`;
  }
  return undefined;
}

export function validateBio(value: string): string | undefined {
  if (value.length > LIMITS.bioMax) {
    return `Keep this under ${LIMITS.bioMax} characters (it is ${value.length} now).`;
  }
  return undefined;
}

const VALIDATORS: Record<RegisterField, (v: FormValues) => string | undefined> = {
  email: (v) => validateEmail(v.email),
  password: (v) => validatePassword(v.password),
  displayName: (v) => validateDisplayName(v.displayName),
  stateCode: (v) => validateStateCode(v.stateCode),
  city: (v) => validateCity(v.city),
  practiceAreas: () => undefined,
  languages: () => undefined,
  fee: (v) => validateFee(v.fee),
  experience: (v) => validateExperience(v.experience),
  bio: (v) => validateBio(v.bio),
};

/** Validates one field of a form that has the given fields. */
export function validateField(field: RegisterField, values: FormValues): string | undefined {
  return VALIDATORS[field](values);
}

/** Validates every field in `fields`; the result only has keys that failed. */
export function validateFields<F extends RegisterField>(
  fields: readonly F[],
  values: FormValues,
): FieldErrors<F> {
  const errors: FieldErrors<F> = {};
  for (const field of fields) {
    const message = VALIDATORS[field](values);
    if (message) errors[field] = message;
  }
  return errors;
}

export const validateRegister = (values: FormValues) => validateFields(REGISTER_FIELDS, values);
export const validateProfile = (values: FormValues) => validateFields(PROFILE_FIELDS, values);

/** The first field with an error, in the order the fields appear on the page. */
export function firstErrorField<F extends string>(
  order: readonly F[],
  errors: FieldErrors<F>,
): F | undefined {
  return order.find((f) => errors[f] !== undefined);
}

// ---- Request payloads (shapes are unchanged: arrays of codes, fee as string) --

export interface RegisterPayload {
  email: string;
  password: string;
  display_name: string;
  practice_areas?: string[];
  state_code: string;
  city: string;
  languages?: string[];
  consultation_fee?: string;
  bio?: string;
  experience_years?: number;
}

export interface ProfilePayload {
  practice_areas: string[];
  state_code: string;
  city: string;
  languages: string[];
  consultation_fee: string | null;
  bio: string | null;
  experience_years: number | null;
}

export function toRegisterPayload(v: FormValues): RegisterPayload {
  const fee = v.fee.trim();
  const bio = v.bio.trim();
  const experience = v.experience.trim();
  return {
    email: v.email.trim(),
    password: v.password,
    display_name: v.displayName.trim(),
    state_code: v.stateCode,
    city: v.city.trim(),
    practice_areas: v.practiceAreas.length > 0 ? v.practiceAreas : undefined,
    languages: v.languages.length > 0 ? v.languages : undefined,
    consultation_fee: fee || undefined,
    bio: bio || undefined,
    experience_years: experience ? Number(experience) : undefined,
  };
}

/** Everything the profile form edits. Emptied optional fields are sent as null, which clears them. */
export function toProfilePayload(v: FormValues): ProfilePayload {
  const fee = v.fee.trim();
  const bio = v.bio.trim();
  const experience = v.experience.trim();
  return {
    state_code: v.stateCode,
    city: v.city.trim(),
    practice_areas: v.practiceAreas,
    languages: v.languages,
    consultation_fee: fee || null,
    bio: bio || null,
    experience_years: experience ? Number(experience) : null,
  };
}

// ---- Profile -> form values, change detection ---------------------------------

export interface ProfileLike {
  practice_areas: string[];
  state_code: string;
  city: string;
  languages: string[];
  consultation_fee: string | null;
  bio: string | null;
  experience_years: number | null;
}

/** "1500.00" is shown as "1500"; "1500.50" stays as it is. */
export function feeToInput(fee: string | null | undefined): string {
  if (fee === null || fee === undefined || fee === '') return '';
  return fee.replace(/\.00$/, '');
}

export function profileToValues(profile: ProfileLike): FormValues {
  return {
    email: '',
    password: '',
    displayName: '',
    stateCode: profile.state_code,
    city: profile.city,
    practiceAreas: [...profile.practice_areas],
    languages: [...profile.languages],
    fee: feeToInput(profile.consultation_fee),
    experience: profile.experience_years === null ? '' : String(profile.experience_years),
    bio: profile.bio ?? '',
  };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');
}

/** True when the profile fields differ from what is saved. */
export function profileChanged(current: FormValues, saved: FormValues): boolean {
  return (
    current.stateCode !== saved.stateCode ||
    current.city.trim() !== saved.city.trim() ||
    !sameSet(current.practiceAreas, saved.practiceAreas) ||
    !sameSet(current.languages, saved.languages) ||
    current.fee.trim() !== saved.fee.trim() ||
    current.experience.trim() !== saved.experience.trim() ||
    current.bio.trim() !== saved.bio.trim()
  );
}

// ---- Completeness checklist ------------------------------------------------------

export type ChecklistKey = 'location' | 'practiceAreas' | 'languages' | 'experience' | 'fee' | 'bio';

export interface ChecklistItem {
  key: ChecklistKey;
  label: string;
  /** Why it matters, shown while it is missing. */
  why: string;
  done: boolean;
}

export function profileChecklist(profile: ProfileLike): ChecklistItem[] {
  return [
    {
      key: 'location',
      label: 'State and city',
      why: 'People filter the directory by where you practise.',
      done: Boolean(profile.state_code && profile.city.trim()),
    },
    {
      key: 'practiceAreas',
      label: 'Practice areas',
      why: 'Without one, you cannot match a search by legal topic.',
      done: profile.practice_areas.length > 0,
    },
    {
      key: 'languages',
      label: 'Languages',
      why: 'Clients look for someone who speaks theirs.',
      done: profile.languages.length > 0,
    },
    {
      key: 'experience',
      label: 'Years of experience',
      why: 'A number clients can compare.',
      done: profile.experience_years !== null,
    },
    {
      key: 'fee',
      label: 'Consultation fee',
      why: 'Saves a first call just to ask about cost.',
      done: profile.consultation_fee !== null && profile.consultation_fee !== '',
    },
    {
      key: 'bio',
      label: 'Short bio',
      why: 'A few lines on the matters you usually take.',
      done: (profile.bio ?? '').trim().length > 0,
    },
  ];
}

// ---- API errors -> messages ------------------------------------------------------------

/** The parts of `ApiRequestError` that the mapping needs. */
export interface ServerErrorLike {
  status: number;
  code: string;
  message: string;
  details?: Array<{ field: string; message: string }>;
}

const SERVER_FIELD_KEYS: Record<string, RegisterField> = {
  email: 'email',
  password: 'password',
  display_name: 'displayName',
  state_code: 'stateCode',
  city: 'city',
  practice_areas: 'practiceAreas',
  languages: 'languages',
  consultation_fee: 'fee',
  experience_years: 'experience',
  bio: 'bio',
};

/** Friendly wording per field, used when the server rejects a value. */
const SERVER_FIELD_MESSAGES: Record<RegisterField, string> = {
  email: 'The server did not accept this email address. Check it for typos.',
  password: `The server did not accept this password. Use ${LIMITS.passwordMin} to ${LIMITS.passwordMax} characters.`,
  displayName: 'The server did not accept this name. Check its length.',
  stateCode: 'The server did not accept this state. Choose one from the list.',
  city: 'The server did not accept this city. Check its length.',
  practiceAreas: 'The server did not accept these practice areas. Choose up to 20.',
  languages: 'The server did not accept these languages. Choose up to 20.',
  fee: 'The server did not accept this fee. Use a non-negative amount in rupees.',
  experience: `The server did not accept this number. Use 0 to ${LIMITS.experienceMax}.`,
  bio: `The server did not accept this bio. Keep it under ${LIMITS.bioMax} characters.`,
};

export const NETWORK_MESSAGE =
  'Could not reach the server. Check that the API is running on this computer, then try again.';
const BUSY_MESSAGE = 'Too many attempts in a short time. Wait a minute, then try again.';
const SERVER_MESSAGE = 'The server had a problem and nothing was saved. Try again in a moment.';

/** One sentence for any API failure; never raw JSON or a stack trace. */
export function describeApiError(err: unknown, fallback: string): string {
  if (!isServerErrorLike(err)) return fallback;
  if (err.status === 0) return NETWORK_MESSAGE;
  if (err.status === 429) return BUSY_MESSAGE;
  if (err.status >= 500) return SERVER_MESSAGE;
  if (err.code === 'session_expired' || err.code === 'unauthorized') {
    return 'Your session has expired. Log in again.';
  }
  return err.message || fallback;
}

export function isServerErrorLike(value: unknown): value is ServerErrorLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ServerErrorLike).status === 'number' &&
    typeof (value as ServerErrorLike).code === 'string' &&
    typeof (value as ServerErrorLike).message === 'string'
  );
}

export interface MappedError<F extends string> {
  /** Messages to show beside the matching fields. */
  fields: FieldErrors<F>;
  /** A message for the whole form, or null when the fields say it all. */
  form: string | null;
}

/**
 * Turns a failed register or profile request into field messages plus, when
 * nothing maps to a field, a message for the whole form. Only fields in
 * `allowed` get a message; anything else falls back to the form message.
 */
export function mapServerError<F extends RegisterField>(
  err: unknown,
  allowed: readonly F[],
  fallback: string,
): MappedError<F> {
  const fields: FieldErrors<F> = {};
  const allows = (field: RegisterField): field is F => (allowed as readonly string[]).includes(field);

  if (!isServerErrorLike(err)) return { fields, form: fallback };

  if (err.code === 'email_taken' && allows('email')) {
    fields.email = 'An account with this email already exists. Log in, or use a different email.';
    return { fields, form: null };
  }

  if (err.status === 422 && err.details && err.details.length > 0) {
    let unmapped = false;
    for (const detail of err.details) {
      const key = detail.field.replace(/^(body|query)\./, '').split('.')[0] ?? '';
      const field = SERVER_FIELD_KEYS[key];
      if (field && allows(field)) fields[field] ??= SERVER_FIELD_MESSAGES[field];
      else unmapped = true;
    }
    const mapped = Object.keys(fields).length > 0;
    if (mapped && !unmapped) return { fields, form: null };
    return {
      fields,
      form: mapped ? null : 'Some details were not accepted. Check what you entered and try again.',
    };
  }

  return { fields, form: describeApiError(err, fallback) };
}

/** Message for a failed login. */
export function loginErrorMessage(err: unknown): string {
  const fallback = 'Something went wrong while logging in. Try again.';
  if (!isServerErrorLike(err)) return fallback;
  if (err.code === 'invalid_credentials') {
    return 'The email or password is not right. Check both and try again.';
  }
  if (err.code === 'account_inactive') {
    return 'This account has been deactivated. Contact the administrator.';
  }
  if (err.code === 'not_an_advocate') return err.message;
  if (err.status === 422) return 'Enter a valid email address and your password.';
  return describeApiError(err, fallback);
}
