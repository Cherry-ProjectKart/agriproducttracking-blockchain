import { describe, expect, it } from 'vitest';
import { validatePasswordChange, validateProfile } from './accountSettingsValidation.js';

describe('validateProfile', () => {
  it('accepts a valid name and username', () => {
    expect(validateProfile({ fullName: 'Asha Farmer', username: 'asha.farmer' })).toEqual({});
  });

  it('requires a name and a username', () => {
    expect(validateProfile({ fullName: '  ', username: '' })).toEqual({
      full_name: 'Enter your full name.',
      username: 'Enter a username.',
    });
  });

  it('checks the name length', () => {
    expect(validateProfile({ fullName: 'A', username: 'asha' }).full_name).toBe('Full name must be 2 to 80 characters.');
    expect(validateProfile({ fullName: 'x'.repeat(81), username: 'asha' }).full_name).toBe(
      'Full name must be 2 to 80 characters.',
    );
  });

  it('applies the username rules, ignoring letter case', () => {
    expect(validateProfile({ fullName: 'Asha', username: 'ASHA.Farmer' })).toEqual({});
    expect(validateProfile({ fullName: 'Asha', username: 'ab' }).username).toBe('Username must be 3 to 32 characters.');
    expect(validateProfile({ fullName: 'Asha', username: 'bad name' }).username).toMatch(/Use letters/);
  });
});

describe('validatePasswordChange', () => {
  const VALID = { currentPassword: 'Sunrise2026', newPassword: 'BrandNew2027', confirmPassword: 'BrandNew2027' };

  it('accepts a complete change', () => {
    expect(validatePasswordChange(VALID)).toEqual({});
  });

  it('requires every field', () => {
    expect(validatePasswordChange({})).toEqual({
      current_password: 'Enter your current password.',
      new_password: 'Enter a new password.',
      confirm_password: 'Confirm your new password.',
    });
  });

  it('applies the password rules to the new password', () => {
    expect(validatePasswordChange({ ...VALID, newPassword: 'short1', confirmPassword: 'short1' }).new_password).toBe(
      'Password must be 8 to 128 characters.',
    );
    expect(validatePasswordChange({ ...VALID, newPassword: 'allletters', confirmPassword: 'allletters' }).new_password).toBe(
      'Password must include at least one letter and one number.',
    );
  });

  it('rejects a new password that equals the current one', () => {
    const errors = validatePasswordChange({
      currentPassword: 'Sunrise2026',
      newPassword: 'Sunrise2026',
      confirmPassword: 'Sunrise2026',
    });

    expect(errors.new_password).toBe('Choose a password different from your current one.');
  });

  it('requires the confirmation to match', () => {
    expect(validatePasswordChange({ ...VALID, confirmPassword: 'Different2027' }).confirm_password).toBe(
      'The passwords do not match.',
    );
  });
});
