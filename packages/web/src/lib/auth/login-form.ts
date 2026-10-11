export type LoginMode = 'login' | 'signup';

/** Minimum password length the signup form asks for. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Checks the login form before it goes to the server. Returns the first problem in
 * words, or null when the form can be sent. The server still checks everything.
 */
export function loginFormError(mode: LoginMode, email: string, password: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email address.';
  if (password === '') return 'Enter your password.';
  if (mode === 'signup' && password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${String(MIN_PASSWORD_LENGTH)} characters for the password.`;
  }
  return null;
}
