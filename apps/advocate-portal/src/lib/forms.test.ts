import { describe, expect, it } from 'vitest';
import {
  feeToInput,
  loginErrorMessage,
  mapServerError,
  profileChanged,
  profileChecklist,
  profileToValues,
  toProfilePayload,
  toRegisterPayload,
  validateBio,
  validateEmail,
  validateExperience,
  validateFee,
  validatePassword,
  validateProfile,
  validateRegister,
  PROFILE_FIELDS,
  REGISTER_FIELDS,
  type FormValues,
} from './forms';

const EMPTY: FormValues = {
  email: '',
  password: '',
  displayName: '',
  stateCode: '',
  city: '',
  practiceAreas: [],
  languages: [],
  fee: '',
  experience: '',
  bio: '',
};

const VALID: FormValues = {
  email: ' Meera@Example.com ',
  password: 'correct horse battery',
  displayName: ' Adv. Meera Iyer ',
  stateCode: 'TN',
  city: ' Chennai ',
  practiceAreas: ['FAMILY_LAW', 'CRIMINAL_LAW'],
  languages: ['en', 'ta'],
  fee: '1500.50',
  experience: '12',
  bio: ' Family matters. ',
};

describe('field validators', () => {
  it('checks the email shape', () => {
    expect(validateEmail('')).toMatch(/Enter your email/);
    expect(validateEmail('nope')).toMatch(/valid email/);
    expect(validateEmail('a@b')).toMatch(/valid email/);
    expect(validateEmail('  a@b.in ')).toBeUndefined();
  });

  it('checks password length', () => {
    expect(validatePassword('')).toBeDefined();
    expect(validatePassword('1234567')).toMatch(/at least 8/);
    expect(validatePassword('12345678')).toBeUndefined();
    expect(validatePassword('x'.repeat(129))).toMatch(/128/);
  });

  it('accepts a missing fee but not a malformed one', () => {
    expect(validateFee('')).toBeUndefined();
    expect(validateFee('1500')).toBeUndefined();
    expect(validateFee('1500.5')).toBeUndefined();
    expect(validateFee('1500.555')).toBeDefined();
    expect(validateFee('-5')).toBeDefined();
    expect(validateFee('12abc')).toBeDefined();
    expect(validateFee('100000000')).toMatch(/too large/);
  });

  it('keeps experience between 0 and 70 whole years', () => {
    expect(validateExperience('')).toBeUndefined();
    expect(validateExperience('0')).toBeUndefined();
    expect(validateExperience('70')).toBeUndefined();
    expect(validateExperience('71')).toBeDefined();
    expect(validateExperience('2.5')).toBeDefined();
  });

  it('limits the bio and says how long it is', () => {
    expect(validateBio('x'.repeat(2000))).toBeUndefined();
    expect(validateBio('x'.repeat(2001))).toMatch(/2001/);
  });
});

describe('form validation', () => {
  it('requires exactly the fields the API requires', () => {
    expect(Object.keys(validateRegister(EMPTY)).sort()).toEqual(
      ['city', 'displayName', 'email', 'password', 'stateCode'].sort(),
    );
  });

  it('passes a complete form', () => {
    expect(validateRegister(VALID)).toEqual({});
  });

  it('does not ask a profile edit for account fields', () => {
    expect(Object.keys(validateProfile(EMPTY)).sort()).toEqual(['city', 'stateCode']);
    expect(PROFILE_FIELDS.every((f) => REGISTER_FIELDS.includes(f))).toBe(true);
  });
});

describe('request payloads', () => {
  it('keeps arrays of codes and the fee as a string', () => {
    expect(toRegisterPayload(VALID)).toEqual({
      email: 'Meera@Example.com',
      password: 'correct horse battery',
      display_name: 'Adv. Meera Iyer',
      state_code: 'TN',
      city: 'Chennai',
      practice_areas: ['FAMILY_LAW', 'CRIMINAL_LAW'],
      languages: ['en', 'ta'],
      consultation_fee: '1500.50',
      bio: 'Family matters.',
      experience_years: 12,
    });
  });

  it('leaves optional values out of a registration when they are empty', () => {
    const payload = toRegisterPayload({
      ...EMPTY,
      email: 'a@b.in',
      password: '12345678',
      displayName: 'A',
      stateCode: 'KA',
      city: 'Mysuru',
    });
    expect(payload.practice_areas).toBeUndefined();
    expect(payload.languages).toBeUndefined();
    expect(payload.consultation_fee).toBeUndefined();
    expect(payload.bio).toBeUndefined();
    expect(payload.experience_years).toBeUndefined();
  });

  it('sends null to clear an optional value on a profile edit', () => {
    const payload = toProfilePayload({ ...VALID, fee: '', bio: '  ', experience: '' });
    expect(payload.consultation_fee).toBeNull();
    expect(payload.bio).toBeNull();
    expect(payload.experience_years).toBeNull();
    expect(payload.practice_areas).toEqual(['FAMILY_LAW', 'CRIMINAL_LAW']);
  });

  it('shows a whole-rupee fee without the trailing .00', () => {
    expect(feeToInput('1500.00')).toBe('1500');
    expect(feeToInput('1500.50')).toBe('1500.50');
    expect(feeToInput(null)).toBe('');
  });
});

describe('profile change detection', () => {
  const saved = profileToValues({
    practice_areas: ['FAMILY_LAW', 'CRIMINAL_LAW'],
    state_code: 'TN',
    city: 'Chennai',
    languages: ['en', 'ta'],
    consultation_fee: '1500.00',
    bio: null,
    experience_years: 12,
  });

  it('sees no change in a fresh copy, whatever the chip order', () => {
    expect(profileChanged(saved, saved)).toBe(false);
    expect(profileChanged({ ...saved, practiceAreas: ['CRIMINAL_LAW', 'FAMILY_LAW'] }, saved)).toBe(
      false,
    );
    expect(profileChanged({ ...saved, city: ' Chennai ' }, saved)).toBe(false);
  });

  it('sees a real change', () => {
    expect(profileChanged({ ...saved, languages: ['en'] }, saved)).toBe(true);
    expect(profileChanged({ ...saved, fee: '1600' }, saved)).toBe(true);
    expect(profileChanged({ ...saved, bio: 'Hello' }, saved)).toBe(true);
  });
});

describe('profile checklist', () => {
  it('marks only what is missing', () => {
    const items = profileChecklist({
      practice_areas: [],
      state_code: 'TN',
      city: 'Chennai',
      languages: ['en'],
      consultation_fee: null,
      bio: '  ',
      experience_years: 0,
    });
    const missing = items.filter((i) => !i.done).map((i) => i.key);
    expect(missing).toEqual(['practiceAreas', 'fee', 'bio']);
  });

  it('counts zero years of experience as filled in', () => {
    const items = profileChecklist({
      practice_areas: ['TAX_LAW'],
      state_code: 'DL',
      city: 'Delhi',
      languages: ['hi'],
      consultation_fee: '0.00',
      bio: 'x',
      experience_years: 0,
    });
    expect(items.every((i) => i.done)).toBe(true);
  });
});

describe('server error mapping', () => {
  const FALLBACK = 'fallback';

  it('puts a taken email on the email field', () => {
    const m = mapServerError(
      { status: 409, code: 'email_taken', message: 'An account with this email already exists.' },
      REGISTER_FIELDS,
      FALLBACK,
    );
    expect(m.fields.email).toMatch(/already exists/);
    expect(m.form).toBeNull();
  });

  it('maps 422 details to fields, dropping the body. prefix and the snake_case', () => {
    const m = mapServerError(
      {
        status: 422,
        code: 'validation_error',
        message: 'The request payload is invalid.',
        details: [
          { field: 'body.state_code', message: 'String should have at least 2 characters' },
          { field: 'body.consultation_fee', message: 'Input should be greater than or equal to 0' },
          { field: 'body.practice_areas.3', message: 'x' },
        ],
      },
      REGISTER_FIELDS,
      FALLBACK,
    );
    expect(Object.keys(m.fields).sort()).toEqual(['fee', 'practiceAreas', 'stateCode']);
    expect(m.form).toBeNull();
    // The raw pydantic wording is not shown.
    expect(Object.values(m.fields).join(' ')).not.toMatch(/String should|Input should/);
  });

  it('falls back to a form message when a detail names no field on this form', () => {
    const m = mapServerError(
      {
        status: 422,
        code: 'validation_error',
        message: 'The request payload is invalid.',
        details: [{ field: 'body.password', message: 'too short' }],
      },
      PROFILE_FIELDS,
      FALLBACK,
    );
    expect(m.fields).toEqual({});
    expect(m.form).toMatch(/not accepted/);
  });

  it('explains an unreachable server, rate limiting and server faults', () => {
    expect(
      mapServerError({ status: 0, code: 'network_error', message: 'x' }, REGISTER_FIELDS, FALLBACK)
        .form,
    ).toMatch(/Could not reach the server/);
    expect(
      mapServerError({ status: 429, code: 'rate_limited', message: 'x' }, REGISTER_FIELDS, FALLBACK)
        .form,
    ).toMatch(/Too many attempts/);
    expect(
      mapServerError(
        { status: 500, code: 'internal_error', message: 'Traceback...' },
        REGISTER_FIELDS,
        FALLBACK,
      ).form,
    ).not.toMatch(/Traceback/);
  });

  it('uses the fallback for something that is not an API error', () => {
    expect(mapServerError(new Error('boom'), REGISTER_FIELDS, FALLBACK)).toEqual({
      fields: {},
      form: FALLBACK,
    });
  });
});

describe('login error messages', () => {
  it('speaks plainly about the common failures', () => {
    expect(
      loginErrorMessage({
        status: 401,
        code: 'invalid_credentials',
        message: 'Incorrect email or password.',
      }),
    ).toMatch(/not right/);
    expect(loginErrorMessage({ status: 401, code: 'account_inactive', message: 'x' })).toMatch(
      /deactivated/,
    );
    expect(loginErrorMessage({ status: 0, code: 'network_error', message: 'x' })).toMatch(
      /Could not reach/,
    );
    expect(loginErrorMessage(new Error('boom'))).toMatch(/Something went wrong/);
  });
});
