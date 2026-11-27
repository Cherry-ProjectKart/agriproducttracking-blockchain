/**
 * Sign-in, sign-out and session calls. The backend is the authority for sessions and roles.
 * The role is never sent by the browser: it is read from the signed-in account.
 */

import { getJson, sendJson } from './apiClient.js';

export const SUPPORTED_ROLE_KEYS = Object.freeze(['farmer', 'distributor', 'retailer']);

export function isSupportedRole(role) {
  return typeof role === 'string' && SUPPORTED_ROLE_KEYS.includes(role);
}

/** Resolves with the list of { key, label, description } roles. */
export async function fetchRoles({ signal } = {}) {
  const body = await getJson('/api/roles', { signal });
  return body.roles;
}

/** Resolves with { active, role, role_label, display_name, username } for the current browser session. */
export function fetchSession({ signal } = {}) {
  return getJson('/api/session', { signal });
}

/** Signs in with { username, password }. Resolves with the signed-in session state. */
export function signIn({ username, password }, { signal } = {}) {
  return sendJson('POST', '/api/session', { body: { username, password }, signal });
}

/** Signs out. Resolves with the signed-out session state. Idempotent. */
export function endSession({ signal } = {}) {
  return sendJson('DELETE', '/api/session', { signal });
}

/** Resolves with { role, role_label, actions } for the signed-in role. Rejects with 401 when signed out. */
export function fetchRoleActions({ signal } = {}) {
  return getJson('/api/role-actions', { signal });
}
