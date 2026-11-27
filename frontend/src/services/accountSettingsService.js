/**
 * The signed-in user's own profile, preferences and password (BPT-104). Every call acts on the account
 * behind the server-side session; no account id is sent, so there is nothing to tamper with.
 */

import { getJson, sendJson } from './apiClient.js';

/** Resolves with the account: { username, full_name, role, role_label, created_at, updated_at, grid_density }. */
export async function fetchAccount({ signal } = {}) {
  const body = await getJson('/api/account', { signal });
  return body.account;
}

/** Changes full_name and/or username. Only the fields given are sent. Resolves with the updated account. */
export async function updateProfile({ fullName, username }, { signal } = {}) {
  const body = {};
  if (fullName !== undefined) body.full_name = fullName;
  if (username !== undefined) body.username = username;
  const response = await sendJson('PATCH', '/api/account', { body, signal });
  return response.account;
}

/** Saves the table density preference ('comfortable' or 'compact'). Resolves with the updated account. */
export async function updatePreferences(gridDensity, { signal } = {}) {
  const response = await sendJson('PATCH', '/api/account/preferences', {
    body: { grid_density: gridDensity },
    signal,
  });
  return response.account;
}

/** Changes the password after checking the current one. Resolves with the server's message. */
export async function changePassword({ currentPassword, newPassword, confirmPassword }, { signal } = {}) {
  const response = await sendJson('POST', '/api/account/password', {
    body: {
      current_password: currentPassword,
      new_password: newPassword,
      confirm_password: confirmPassword,
    },
    signal,
  });
  return response.message;
}
