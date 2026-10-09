import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '@/lib/api-client';
import {
  asUpdatePayload,
  authHref,
  buildProfilePatch,
  destinationLabel,
  errorTitle,
  firstParam,
  friendlyValidationMessage,
  isProfileDirty,
  mapAuthError,
  profileValuesOf,
  roleLabel,
  safeNextPath,
  validateConfirmation,
  validateDisplayName,
  validateEmail,
  validateLoginPassword,
  validateNewPassword,
} from './auth-logic';
import { languageOptions, stateLabel, stateOptions } from './options';

describe('validation', () => {
  it('requires an email, and a real-looking one outside demo mode', () => {
    expect(validateEmail('', true)).toMatch(/Enter your email/);
    expect(validateEmail('  ', false)).toMatch(/Enter your email/);
    expect(validateEmail('priya', false)).toMatch(/valid email/);
    expect(validateEmail('priya@example.com', false)).toBeNull();
    // Demo mode accepts any non-empty identifier, as the server does.
    expect(validateEmail('priya', true)).toBeNull();
    expect(validateEmail('x'.repeat(321), true)).toMatch(/too long/);
  });

  it('only asks for a sign-in password outside demo mode', () => {
    expect(validateLoginPassword('', false)).toMatch(/Enter your password/);
    expect(validateLoginPassword('x', false)).toBeNull();
    expect(validateLoginPassword('', true)).toBeNull();
  });

  it('checks new passwords by length and tells the person how short they are', () => {
    expect(validateNewPassword('', false)).toMatch(/Choose a password/);
    expect(validateNewPassword('abc', false)).toBe('Use at least 8 characters. You have 3.');
    expect(validateNewPassword('abcdefgh', false)).toBeNull();
    expect(validateNewPassword('abc', true)).toBeNull();
    expect(validateNewPassword('x'.repeat(129), true)).toMatch(/at most 128/);
  });

  it('compares the confirmation', () => {
    expect(validateConfirmation('abcdefgh', '')).toMatch(/again/);
    expect(validateConfirmation('abcdefgh', 'abcdefgx')).toMatch(/do not match/);
    expect(validateConfirmation('abcdefgh', 'abcdefgh')).toBeNull();
  });

  it('limits the display name', () => {
    expect(validateDisplayName('Priya Sharma')).toBeNull();
    expect(validateDisplayName('x'.repeat(151))).toMatch(/at most 150/);
  });
});

describe('mapAuthError', () => {
  const api = (status: number, code: string, message = 'server text', details?: never) =>
    new ApiRequestError(status, code, message, undefined, details);

  it('maps the cases the pages show specially', () => {
    expect(mapAuthError(api(401, 'invalid_credentials'), 'login').kind).toBe('invalid_credentials');
    expect(mapAuthError(api(403, 'account_inactive'), 'login').kind).toBe('account_inactive');
    const taken = mapAuthError(api(409, 'email_taken'), 'register');
    expect(taken.kind).toBe('email_taken');
    expect(taken.fields.email).toMatch(/already exists/);
    expect(mapAuthError(api(422, 'invalid_token'), 'verify').form).toMatch(/verification link/);
    expect(mapAuthError(api(422, 'invalid_token'), 'reset').form).toMatch(/reset link/);
  });

  it('treats network failures, rate limits and server errors as their own kinds', () => {
    expect(mapAuthError(new ApiRequestError(0, 'network_error', 'x'), 'login').kind).toBe(
      'network',
    );
    expect(mapAuthError(api(429, 'rate_limited'), 'login').kind).toBe('rate_limited');
    const server = mapAuthError(
      api(500, 'internal_error', 'Traceback (most recent call last)'),
      'login',
    );
    expect(server.kind).toBe('server');
    // Raw server text never reaches the person.
    expect(server.form).not.toMatch(/Traceback/);
  });

  it('treats a 401 that is not a failed log in as an ended session', () => {
    const mapped = mapAuthError(api(401, 'unauthorized', 'Not signed in.'), 'profile');
    expect(mapped.kind).toBe('session_expired');
    expect(mapped.form).toMatch(/Log in again/);
  });

  it('puts validation messages on the field they belong to', () => {
    const mapped = mapAuthError(
      api(422, 'validation_error', 'x', [
        { field: 'body.password', message: 'Value error, Use at least 8 characters.' },
        { field: 'body.display_name', message: 'String should have at most 150 characters' },
      ] as never),
      'register',
    );
    expect(mapped.kind).toBe('validation');
    expect(mapped.fields).toEqual({
      password: 'Use at least 8 characters.',
      displayName: 'Use at most 150 characters.',
    });
    expect(mapped.form).toBeUndefined();
  });

  it('falls back to a form-level message for unknown validation fields', () => {
    const mapped = mapAuthError(
      api(422, 'validation_error', 'x', [{ field: 'body.other', message: 'Bad thing' }] as never),
      'register',
    );
    expect(mapped.form).toBe('Bad thing.');
  });

  it('never leaks a generic http_error or a non-API error', () => {
    expect(mapAuthError(api(400, 'http_error', 'Request failed (400).'), 'login').form).toMatch(
      /Something went wrong/,
    );
    expect(mapAuthError(new Error('boom: stack trace'), 'login').form).toMatch(
      /Something went wrong/,
    );
  });

  it('has a heading for every kind', () => {
    expect(errorTitle('network', 'login')).toMatch(/reach the server/);
    expect(errorTitle('other', 'register')).toMatch(/create your account/);
    expect(errorTitle('other', 'profile')).toMatch(/save/);
  });
});

describe('friendlyValidationMessage', () => {
  it('shortens Pydantic wording', () => {
    expect(friendlyValidationMessage('String should have at least 8 characters')).toBe(
      'Use at least 8 characters.',
    );
    expect(friendlyValidationMessage('value is not a valid email address')).toBe(
      'Enter a valid email address.',
    );
    expect(friendlyValidationMessage('Field required')).toBe('This field is required.');
    expect(friendlyValidationMessage('')).toBe('Check this value.');
  });
});

describe('redirects', () => {
  it('accepts only same-site paths', () => {
    expect(safeNextPath('/chat')).toBe('/chat');
    expect(safeNextPath('/documents?type=NDA')).toBe('/documents?type=NDA');
    expect(safeNextPath('https://evil.example')).toBeNull();
    expect(safeNextPath('//evil.example')).toBeNull();
    expect(safeNextPath('/\\evil.example')).toBeNull();
    expect(safeNextPath('javascript:alert(1)')).toBeNull();
    expect(safeNextPath('/chat\nSet-Cookie: x')).toBeNull();
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath('/' + 'a'.repeat(400))).toBeNull();
  });

  it('refuses the auth pages themselves so a link can never loop', () => {
    for (const p of ['/login', '/register', '/reset-password?token=x', '/verify-email']) {
      expect(safeNextPath(p)).toBeNull();
    }
    expect(safeNextPath('/login-help')).toBe('/login-help');
  });

  it('carries a safe next along when linking between auth pages', () => {
    expect(authHref('/register', '/chat')).toBe('/register?next=%2Fchat');
    expect(authHref('/login', 'https://evil.example')).toBe('/login');
    expect(authHref('/reset-password')).toBe('/reset-password');
  });

  it('reads the first value of a query parameter', () => {
    expect(firstParam('a')).toBe('a');
    expect(firstParam(['a', 'b'])).toBe('a');
    expect(firstParam('')).toBeNull();
    expect(firstParam(undefined)).toBeNull();
  });

  it('describes a destination in plain words', () => {
    expect(destinationLabel('/profile')).toBe('your profile');
    expect(destinationLabel('/documents?type=NDA')).toBe('documents');
    expect(destinationLabel('/somewhere')).toBe('where you were going');
  });
});

describe('profile data', () => {
  const user = { display_name: 'Priya', state_code: 'KA', preferred_language: null };

  it('labels roles', () => {
    expect(roleLabel('CONSUMER')).toBe('Consumer');
    expect(roleLabel('LEGAL_ADMIN')).toBe('Legal admin');
    expect(roleLabel('SOMETHING_NEW')).toBe('Something new');
  });

  it('detects changes, ignoring stray spaces in the name', () => {
    expect(isProfileDirty(profileValuesOf(user), user)).toBe(false);
    expect(isProfileDirty({ ...profileValuesOf(user), displayName: ' Priya ' }, user)).toBe(false);
    expect(isProfileDirty({ ...profileValuesOf(user), stateCode: 'MH' }, user)).toBe(true);
  });

  it('sends only changed fields, and null for a cleared one', () => {
    const patch = buildProfilePatch({ displayName: '', stateCode: 'KA', language: 'hi' }, user);
    expect(patch).toEqual({ display_name: null, state_code: undefined, preferred_language: 'hi' });
    expect(JSON.parse(JSON.stringify(asUpdatePayload(patch)))).toEqual({
      display_name: null,
      preferred_language: 'hi',
    });
  });
});

describe('state and language options', () => {
  it('lists every state by name, A to Z', () => {
    const options = stateOptions();
    expect(options.length).toBeGreaterThanOrEqual(36);
    expect(options.find((o) => o.value === 'KA')?.label).toBe('Karnataka (KA)');
    const labels = options.map((o) => o.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'en')));
  });

  it('keeps a saved value that is not in the list', () => {
    expect(stateOptions('ZZ').some((o) => o.value === 'ZZ')).toBe(true);
    expect(stateOptions('KA').filter((o) => o.value === 'KA')).toHaveLength(1);
    expect(languageOptions('english').some((o) => o.value === 'english')).toBe(true);
    expect(languageOptions('hi').filter((o) => o.value === 'hi')).toHaveLength(1);
  });

  it('turns a code into a name, or leaves an unknown code alone', () => {
    expect(stateLabel('TN')).toBe('Tamil Nadu');
    expect(stateLabel('ZZ')).toBe('ZZ');
    expect(stateLabel(null)).toBe('');
  });
});
