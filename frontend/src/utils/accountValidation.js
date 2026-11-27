/**
 * Client-side mirror of the server rules in backend/app/models/account.py. The server validates
 * every field again and is the authority; this mirror only gives immediate feedback.
 */

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const FULL_NAME_MIN_LENGTH = 2;
export const FULL_NAME_MAX_LENGTH = 80;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** The three operational roles offered at registration. Consumer is never a registration role. */
export const REGISTRATION_ROLES = Object.freeze([
  {
    key: 'farmer',
    label: 'Farmer',
    description: 'Register and track agricultural product batches.',
  },
  {
    key: 'distributor',
    label: 'Distributor',
    description: 'Manage product movement and shipment updates.',
  },
  {
    key: 'retailer',
    label: 'Retailer',
    description: 'Receive delivered products and confirm receipt.',
  },
]);

const ROLE_KEYS = REGISTRATION_ROLES.map((role) => role.key);

export const PASSWORD_HINT = `At least ${PASSWORD_MIN_LENGTH} characters, with a letter and a number.`;

/** First password rule the value breaks, or null. */
export function passwordProblem(password) {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must include at least one letter and one number.';
  }
  return null;
}

/** Field errors for the sign-in form. An empty object means the form can be sent. */
export function validateSignIn({ username = '', password = '' } = {}) {
  const errors = {};
  if (!username.trim()) errors.username = 'Enter your username.';
  if (!password) errors.password = 'Enter your password.';
  return errors;
}

/** Field errors for the registration form, keyed by the API field names. */
export function validateRegistration({
  fullName = '',
  username = '',
  password = '',
  confirmPassword = '',
  role = '',
} = {}) {
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

  if (!password) {
    errors.password = 'Enter a password.';
  } else {
    const problem = passwordProblem(password);
    if (problem) errors.password = problem;
  }

  if (!confirmPassword) {
    errors.confirm_password = 'Confirm your password.';
  } else if (password && confirmPassword !== password) {
    errors.confirm_password = 'The passwords do not match.';
  }

  if (!ROLE_KEYS.includes(role)) {
    errors.role = 'Choose a role: Farmer, Distributor or Retailer.';
  }

  return errors;
}
