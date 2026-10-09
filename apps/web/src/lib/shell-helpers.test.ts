import { describe, expect, it } from 'vitest';
import {
  buildChatHref,
  initialsOf,
  isNavActive,
  MAX_QUESTION_LENGTH,
  normaliseQuestion,
} from './shell-helpers';

describe('normaliseQuestion', () => {
  it('trims and collapses whitespace, including newlines', () => {
    expect(normaliseQuestion('  my  landlord\n\nwill not\treturn it  ')).toBe(
      'my landlord will not return it',
    );
  });

  it('caps the length at what the API accepts', () => {
    expect(normaliseQuestion('a'.repeat(MAX_QUESTION_LENGTH + 50))).toHaveLength(
      MAX_QUESTION_LENGTH,
    );
  });
});

describe('buildChatHref', () => {
  it('links to /chat with the question url-encoded', () => {
    expect(buildChatHref('Can my employer withhold my salary?')).toBe(
      '/chat?q=Can%20my%20employer%20withhold%20my%20salary%3F',
    );
  });

  it('encodes characters that would break a query string', () => {
    const href = buildChatHref('rent & deposit = 50% #1');
    expect(href).toBe('/chat?q=rent%20%26%20deposit%20%3D%2050%25%20%231');
    expect(new URL(href, 'http://localhost').searchParams.get('q')).toBe('rent & deposit = 50% #1');
  });

  it('round-trips Hindi text', () => {
    const question = 'मेरा मकान मालिक जमानत राशि वापस नहीं कर रहा';
    const href = buildChatHref(question);
    expect(new URL(href, 'http://localhost').searchParams.get('q')).toBe(question);
  });

  it('falls back to the plain chat page for an empty question', () => {
    expect(buildChatHref('')).toBe('/chat');
    expect(buildChatHref('   \n ')).toBe('/chat');
  });
});

describe('isNavActive', () => {
  it('matches the section and anything under it', () => {
    expect(isNavActive('/chat', '/chat')).toBe(true);
    expect(isNavActive('/advocates/abc', '/advocates')).toBe(true);
  });

  it('does not match a path that only shares a prefix', () => {
    expect(isNavActive('/chatter', '/chat')).toBe(false);
    expect(isNavActive('/documents', '/chat')).toBe(false);
  });

  it('only matches the home page exactly', () => {
    expect(isNavActive('/', '/')).toBe(true);
    expect(isNavActive('/chat', '/')).toBe(false);
  });

  it('handles a missing pathname', () => {
    expect(isNavActive(null, '/chat')).toBe(false);
    expect(isNavActive(undefined, '/chat')).toBe(false);
  });
});

describe('initialsOf', () => {
  it('uses the first and last word of a display name', () => {
    expect(initialsOf('Asha Menon')).toBe('AM');
    expect(initialsOf('asha kumari menon')).toBe('AM');
    expect(initialsOf('Asha')).toBe('A');
  });

  it('falls back to the email local part', () => {
    expect(initialsOf('', 'priya.nair@example.com')).toBe('PN');
    expect(initialsOf(null, 'raj@example.com')).toBe('R');
  });

  it('never returns an empty string', () => {
    expect(initialsOf('', '')).toBe('?');
    expect(initialsOf(undefined, undefined)).toBe('?');
  });
});
