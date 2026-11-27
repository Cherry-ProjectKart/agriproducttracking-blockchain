/**
 * Client-side checks for the settings forms (BPT-104). They mirror the server rules in
 * backend/app/services/profile_service.py and account_service.py; the server is the authority.
 */

import {
  FULL_NAME_MAX_LENGTH,
  FULL_NAME_MIN_LENGTH,
  passwordProblem,
  USERNAME_PATTERN,
} from './accountValidation.js';

export const GRID_DENSITY_OPTIONS = Object.freeze([
  {
    key: 'comfortable',
    label: 'Comfortable',
    description: 'More space between rows. Easier to read on a small screen.',
  },
  {
    key: 'compact',
    label: 'Compact',
    description: 'Tighter rows, so more batches fit on screen at once.',
  },
]);

/** Field errors for the profile form, keyed by API field name. An empty object means the form can be sent. */
export function validateProfile({ fullName = '', username = '' } = {}) {
  const errors = {};

  const name = fullName.trim();
  if (!name) {
    errors.full_name = 'Enter your full name.';
  } else if (name.length < FULL_NAME_MIN_LENGTH || name.length > FULL_NAME_MAX_LENGTH) {
    errors.full_name = `Full name must be ${FULL_NAME_MIN_LENGTH} to ${FULL_NAME_MAX_LENGTH} characters.`;
  }

  const user = username.trim().toLowerCase();
  if (!user) {
    errors.username = 'Enter a username.';
  } else if (user.length < 3 || user.length > 32) {
    errors.username = 'Username must be 3 to 32 characters.';
  } else if (!USERNAME_PATTERN.test(user)) {
    errors.username = 'Use letters, numbers, dots, underscores or hyphens. Start with a letter or number.';
  }

  return errors;
}

/** Field errors for the password form, keyed by API field name. */
export function validatePasswordChange({ currentPassword = '', newPassword = '', confirmPassword = '' } = {}) {
  const errors = {};

  if (!currentPassword) errors.current_password = 'Enter your current password.';

  if (!newPassword) {
    errors.new_password = 'Enter a new password.';
  } else {
    const problem = passwordProblem(newPassword);
    if (problem) {
      errors.new_password = problem;
    } else if (currentPassword && newPassword === currentPassword) {
      errors.new_password = 'Choose a password different from your current one.';
    }
  }

  if (!confirmPassword) {
    errors.confirm_password = 'Confirm your new password.';
  } else if (newPassword && confirmPassword !== newPassword) {
    errors.confirm_password = 'The passwords do not match.';
  }

  return errors;
}
