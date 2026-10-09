import { ApiRequestError } from '@/lib/api-client';
import type { UpdateProfilePayload } from '@/lib/auth-client';

/**
 * Pure helpers for the sign-in, sign-up, account-recovery and profile pages:
 * client-side validation, mapping API errors to messages a person can act on,
 * the post-login redirect guard and the role labels. No React in here, so it is
 * all unit-tested (auth-logic.test.ts).
 */

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
export const MAX_NAME_LENGTH = 150;

export type FieldErrors<K extends string = string> = Partial<Record<K, string>>;

// ---------------------------------------------------------------------------
// Validation. Each returns a message, or null when the value is fine.
// `openLogin` is the server's demo mode: any non-empty identifier and any
// password (even an empty one) is accepted, so the client must not be stricter.
// ---------------------------------------------------------------------------

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(value: string, openLogin: boolean): string | null {
  const email = value.trim();
  if (!email) return 'Enter your email address.';
  if (email.length > 320) return 'That address is too long.';
  if (!openLogin && !EMAIL_SHAPE.test(email)) {
    return 'Enter a valid email address, like name@example.com.';
  }
  return null;
}

/** Sign-in password: required only outside demo mode. */
export function validateLoginPassword(value: string, openLogin: boolean): string | null {
  if (openLogin) return null;
  return value ? null : 'Enter your password.';
}

/** A password being chosen (sign-up, reset). The server rule is length only. */
export function validateNewPassword(value: string, openLogin: boolean): string | null {
  if (value.length > MAX_PASSWORD_LENGTH) {
    return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  if (openLogin) return null;
  if (!value) return 'Choose a password.';
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters. You have ${value.length}.`;
  }
  return null;
}

export function validateConfirmation(password: string, confirmation: string): string | null {
  if (!confirmation) return 'Type the new password again to confirm it.';
  return password === confirmation ? null : 'The two passwords do not match.';
}

export function validateDisplayName(value: string): string | null {
  return value.trim().length > MAX_NAME_LENGTH
    ? `Use at most ${MAX_NAME_LENGTH} characters.`
    : null;
}

/** 0 to 1: how close a password is to the minimum length. Drives the length meter. */
export function lengthProgress(value: string): number {
  return Math.min(value.length / MIN_PASSWORD_LENGTH, 1);
}

// ---------------------------------------------------------------------------
// API error mapping
// ---------------------------------------------------------------------------

export type AuthContext = 'login' | 'register' | 'reset' | 'verify' | 'profile' | 'request';

export type AuthErrorKind =
  | 'invalid_credentials'
  | 'account_inactive'
  | 'email_taken'
  | 'invalid_token'
  | 'session_expired'
  | 'validation'
  | 'rate_limited'
  | 'network'
  | 'server'
  | 'other';

export interface MappedAuthError {
  kind: AuthErrorKind;
  /** A message for the form as a whole (shown in the alert). */
  form?: string;
  /** Messages for single fields, keyed by the page's field names. */
  fields: FieldErrors;
}

const GENERIC = 'Something went wrong. Try again in a moment.';

/** `body.new_password` -> the page's field name; unknown fields map to undefined. */
const API_FIELD: Record<string, string> = {
  email: 'email',
  password: 'password',
  new_password: 'password',
  display_name: 'displayName',
  state_code: 'stateCode',
  preferred_language: 'language',
};

/** Turns Pydantic's wording into a short instruction. */
export function friendlyValidationMessage(raw: string): string {
  const message = raw.replace(/^value error,\s*/i, '').trim();
  const atLeast = /should have at least (\d+) characters?/i.exec(message);
  if (atLeast) return `Use at least ${atLeast[1]} characters.`;
  const atMost = /should have at most (\d+) characters?/i.exec(message);
  if (atMost) return `Use at most ${atMost[1]} characters.`;
  if (/not a valid email/i.test(message)) return 'Enter a valid email address.';
  if (/^field required$/i.test(message)) return 'This field is required.';
  if (!message) return 'Check this value.';
  return /[.!?]$/.test(message) ? message : `${message}.`;
}

export function mapAuthError(err: unknown, context: AuthContext): MappedAuthError {
  if (!(err instanceof ApiRequestError)) {
    return { kind: 'other', form: GENERIC, fields: {} };
  }

  if (err.status === 0 || err.code === 'network_error') {
    return {
      kind: 'network',
      form: "We couldn't reach the server. Check that the app is running on this computer, then try again.",
      fields: {},
    };
  }
  if (err.status === 429 || err.code === 'rate_limited') {
    return {
      kind: 'rate_limited',
      form: 'Too many attempts in a short time. Wait a minute, then try again.',
      fields: {},
    };
  }

  switch (err.code) {
    case 'invalid_credentials':
      return {
        kind: 'invalid_credentials',
        form: "That email and password don't match. Check both and try again.",
        fields: {},
      };
    case 'account_inactive':
      return {
        kind: 'account_inactive',
        form: 'This account has been deactivated, so it cannot sign in.',
        fields: {},
      };
    case 'email_taken':
      return {
        kind: 'email_taken',
        fields: { email: 'An account with this email already exists.' },
      };
    case 'invalid_token':
      return {
        kind: 'invalid_token',
        form:
          context === 'verify'
            ? 'This verification link is invalid or has expired.'
            : 'This reset link is invalid, has expired, or was already used.',
        fields: {},
      };
    default:
      break;
  }

  // A 401 that is not a failed log in: the access token has expired or been revoked.
  if (err.status === 401) {
    return {
      kind: 'session_expired',
      form: 'Your session has ended. Log in again, then repeat what you were doing.',
      fields: {},
    };
  }

  if (err.status === 422 || err.code === 'validation_error') {
    const fields: FieldErrors = {};
    const loose: string[] = [];
    for (const detail of err.details ?? []) {
      const key = API_FIELD[detail.field.split('.').pop() ?? ''];
      const message = friendlyValidationMessage(detail.message);
      if (key) fields[key] ??= message;
      else loose.push(message);
    }
    const hasFields = Object.keys(fields).length > 0;
    return {
      kind: 'validation',
      fields,
      form: hasFields
        ? undefined
        : (loose[0] ?? 'Some of the details need another look. Check the form and try again.'),
    };
  }

  if (err.status >= 500) {
    return {
      kind: 'server',
      form: 'The server hit a problem on its side. Try again in a moment.',
      fields: {},
    };
  }

  // Remaining 4xx responses carry a plain-language message written for people
  // by the API (it never includes internals), except the generic http_error.
  if (err.code !== 'http_error' && err.message) {
    return { kind: 'other', form: err.message, fields: {} };
  }
  return { kind: 'other', form: GENERIC, fields: {} };
}

/** One sentence for a place with no field to attach to (a "send again" button). */
export function problemMessage(mapped: MappedAuthError): string {
  return mapped.form ?? Object.values(mapped.fields)[0] ?? GENERIC;
}

/** A short heading for the form-level alert that goes with a mapped error. */
export function errorTitle(kind: AuthErrorKind, context: AuthContext): string {
  switch (kind) {
    case 'network':
      return "Can't reach the server";
    case 'server':
      return 'The server had a problem';
    case 'rate_limited':
      return 'Too many attempts';
    case 'account_inactive':
      return 'This account is switched off';
    case 'session_expired':
      return 'Your session has ended';
    case 'invalid_credentials':
      return 'Those details did not match';
    case 'invalid_token':
      return context === 'verify' ? "This link can't be used" : "This reset link can't be used";
    case 'validation':
      return 'Check the form';
    default:
      break;
  }
  switch (context) {
    case 'login':
      return "Couldn't log you in";
    case 'register':
      return "Couldn't create your account";
    case 'profile':
      return "Couldn't save your changes";
    case 'request':
      return "Couldn't send the link";
    case 'reset':
      return "Couldn't save the new password";
    default:
      return 'Something went wrong';
  }
}

// ---------------------------------------------------------------------------
// Redirects
// ---------------------------------------------------------------------------

/**
 * Where to go after signing in, from a `?next=` value. Only same-site paths are
 * accepted (a leading `/`, no `//`, no backslash, no scheme), and the auth pages
 * themselves are refused so a link can never loop.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 300) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  if (/[\u0000-\u001f]/.test(raw)) return null;
  const path = raw.split(/[?#]/)[0] ?? '';
  if (/^\/(login|register|reset-password|verify-email)(\/|$)/.test(path)) return null;
  return raw;
}

export function loginHref(next?: string): string {
  return authHref('/login', next);
}

/** `/login`, `/register`... carrying a safe `?next=` along, so it survives a detour. */
export function authHref(
  path: '/login' | '/register' | '/reset-password',
  next?: string | null,
): string {
  const safe = safeNextPath(next);
  return safe ? `${path}?next=${encodeURIComponent(safe)}` : path;
}

/** One value from a Next `searchParams` entry (`?a=1&a=2` arrives as an array). */
export function firstParam(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' && first ? first : null;
}

/** Where a signed-in person lands when no `?next=` was given. */
export const DEFAULT_AFTER_LOGIN = '/profile';

/** Plain words for a destination, for "Taking you to ..." lines. */
export function destinationLabel(path: string): string {
  const name = path.split(/[?#]/)[0] ?? '';
  if (name === '/profile') return 'your profile';
  if (name === '/chat') return 'the chat';
  if (name === '/documents' || name.startsWith('/documents/')) return 'documents';
  if (name === '/advocates' || name.startsWith('/advocates/')) return 'the advocate directory';
  return 'where you were going';
}

// ---------------------------------------------------------------------------
// Roles and profile data
// ---------------------------------------------------------------------------

const ROLE_LABEL: Record<string, string> = {
  CONSUMER: 'Consumer',
  ADVOCATE: 'Advocate',
  ADMIN: 'Admin',
  LEGAL_ADMIN: 'Legal admin',
  ENTERPRISE_USER: 'Enterprise',
};

export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role.charAt(0) + role.slice(1).toLowerCase().replace(/_/g, ' ');
}

export interface ProfileValues {
  displayName: string;
  stateCode: string;
  language: string;
}

export interface ProfileSource {
  display_name: string | null;
  state_code: string | null;
  preferred_language: string | null;
}

export function profileValuesOf(user: ProfileSource): ProfileValues {
  return {
    displayName: user.display_name ?? '',
    stateCode: user.state_code ?? '',
    language: user.preferred_language ?? '',
  };
}

export function isProfileDirty(values: ProfileValues, user: ProfileSource): boolean {
  const saved = profileValuesOf(user);
  return (
    values.displayName.trim() !== saved.displayName ||
    values.stateCode !== saved.stateCode ||
    values.language !== saved.language
  );
}

/**
 * The PATCH body: only fields that changed. A cleared field is sent as `null`,
 * which the API reads as "remove it" (it applies exactly the fields that are
 * present); `undefined` would leave the old value in place.
 */
export function buildProfilePatch(
  values: ProfileValues,
  user: ProfileSource,
): Record<'display_name' | 'state_code' | 'preferred_language', string | null | undefined> {
  const saved = profileValuesOf(user);
  const name = values.displayName.trim();
  return {
    display_name: name === saved.displayName ? undefined : name || null,
    state_code: values.stateCode === saved.stateCode ? undefined : values.stateCode || null,
    preferred_language: values.language === saved.language ? undefined : values.language || null,
  };
}

/**
 * `updateProfile` is typed with `string | undefined`, but the API also accepts
 * `null` to clear a field. This is the one place that widening happens.
 */
export function asUpdatePayload(patch: ReturnType<typeof buildProfilePatch>): UpdateProfilePayload {
  return patch as unknown as UpdateProfilePayload;
}
