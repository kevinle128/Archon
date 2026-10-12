import { describe, expect, test } from 'bun:test';

import { loginFormError } from './login-form';

describe('loginFormError', () => {
  test('asks for a valid email first', () => {
    expect(loginFormError('login', 'not-an-email', 'secret')).toBe('Enter a valid email address.');
  });

  test('asks for a password', () => {
    expect(loginFormError('login', 'a@b.co', '')).toBe('Enter your password.');
  });

  test('signup needs at least 8 characters', () => {
    expect(loginFormError('signup', 'a@b.co', 'short')).toContain('at least 8');
    expect(loginFormError('signup', 'a@b.co', 'long-enough')).toBeNull();
  });

  test('sign in accepts any non-empty password', () => {
    expect(loginFormError('login', ' a@b.co ', 'x')).toBeNull();
  });
});
