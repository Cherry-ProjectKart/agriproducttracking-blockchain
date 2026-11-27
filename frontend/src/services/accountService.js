/** Account registration. The server validates every field and signs the new account in. */

import { sendJson } from './apiClient.js';

/**
 * Creates an account. Resolves with the signed-in session state (active, role, display_name, ...).
 * Rejects with ApiError: 400 with error.details for invalid fields, 409 when the username is taken.
 */
export function registerAccount(
  { fullName, username, password, confirmPassword, role },
  { signal } = {},
) {
  return sendJson('POST', '/api/accounts', {
    body: {
      full_name: fullName,
      username,
      password,
      confirm_password: confirmPassword,
      role,
    },
    signal,
  });
}
