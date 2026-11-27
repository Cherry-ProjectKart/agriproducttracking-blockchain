import { describe, expect, it } from 'vitest';
import { passwordProblem, validateRegistration, validateSignIn } from './accountValidation.js';

const VALID = {
  fullName: 'Asha Farmer',
  username: 'asha.farmer',
  password: 'Sunrise2026',
  confirmPassword: 'Sunrise2026',
  role: 'farmer',
};

const USERNAME_FORMAT = 'Use letters, numbers, dots, underscores or hyphens. Start with a letter or number.';

describe('validateRegistration', () => {
  it('accepts a complete valid registration', () => {
    expect(validateRegistration(VALID)).toEqual({});
  });

  it('reports every missing required field by its API name', () => {
    expect(validateRegistration({})).toEqual({
      full_name: 'Enter your full name.',
      username: 'Enter a username.',
      password: 'Enter a password.',
      confirm_password: 'Confirm your password.',
      role: 'Choose a role: Farmer, Distributor or Retailer.',
    });
  });

  it('treats a whitespace-only name as missing', () => {
    expect(validateRegistration({ ...VALID, fullName: '   ' }).full_name).toBe('Enter your full name.');
  });

  it('checks the full name length', () => {
    expect(validateRegistration({ ...VALID, fullName: 'A' }).full_name).toBe('Full name must be 2 to 80 characters.');
    expect(validateRegistration({ ...VALID, fullName: 'x'.repeat(81) }).full_name).toBe(
      'Full name must be 2 to 80 characters.',
    );
  });

  it.each([
    ['ab', 'Username must be 3 to 32 characters.'],
    ['a'.repeat(33), 'Username must be 3 to 32 characters.'],
    ['1 bad', USERNAME_FORMAT],
    ['-dash', USERNAME_FORMAT],
    ['bad@mail', USERNAME_FORMAT],
  ])('rejects the username %j', (username, message) => {
    expect(validateRegistration({ ...VALID, username }).username).toBe(message);
  });

  it('accepts a username with mixed case, since the server lower-cases it', () => {
    expect(validateRegistration({ ...VALID, username: 'Asha.Farmer' })).toEqual({});
  });

  it('applies the password rules', () => {
    expect(validateRegistration({ ...VALID, password: 'short1', confirmPassword: 'short1' }).password).toBe(
      'Password must be 8 to 128 characters.',
    );
    expect(validateRegistration({ ...VALID, password: 'allletters', confirmPassword: 'allletters' }).password).toBe(
      'Password must include at least one letter and one number.',
    );
  });

  it('requires the confirmation to match', () => {
    expect(validateRegistration({ ...VALID, confirmPassword: 'Different2026' }).confirm_password).toBe(
      'The passwords do not match.',
    );
    expect(validateRegistration({ ...VALID, confirmPassword: '' }).confirm_password).toBe('Confirm your password.');
  });

  it.each(['admin', 'Farmer', 'consumer', ''])('only offers the three roles (rejects %j)', (role) => {
    expect(validateRegistration({ ...VALID, role }).role).toBe('Choose a role: Farmer, Distributor or Retailer.');
  });

  it('accepts each of the three operational roles', () => {
    for (const role of ['farmer', 'distributor', 'retailer']) {
      expect(validateRegistration({ ...VALID, role })).toEqual({});
    }
  });
});

describe('passwordProblem', () => {
  it('returns null for an acceptable password and the first broken rule otherwise', () => {
    expect(passwordProblem('Sunrise2026')).toBeNull();
    expect(passwordProblem('1234abc')).toBe('Password must be 8 to 128 characters.');
    expect(passwordProblem('12345678')).toBe('Password must include at least one letter and one number.');
  });
});

describe('validateSignIn', () => {
  it('requires both fields', () => {
    expect(validateSignIn({ username: '', password: '' })).toEqual({
      username: 'Enter your username.',
      password: 'Enter your password.',
    });
  });

  it('accepts any non-empty credentials; the server decides whether they are correct', () => {
    expect(validateSignIn({ username: 'demo.farmer', password: 'anything' })).toEqual({});
  });
});
