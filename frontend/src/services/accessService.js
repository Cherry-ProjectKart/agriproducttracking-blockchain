/**
 * Demo role-access API calls. The backend is the authority for roles and sessions;
 * SUPPORTED_ROLE_KEYS is a client-side guard so an unsupported value never leaves the browser.
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

/** Resolves with { active, role, role_label, display_name } for the current browser session. */
export function fetchSession({ signal } = {}) {
  return getJson('/api/session', { signal });
}

/** Selects a role and starts a demo session. Resolves with the new session state. */
export function startSession(role, { signal } = {}) {
  return sendJson('POST', '/api/session', { body: { role }, signal });
}

/** Exits the current demo session. Resolves with the inactive session state. */
export function endSession({ signal } = {}) {
  return sendJson('DELETE', '/api/session', { signal });
}

/** Resolves with { role, role_label, actions } for the active role. Rejects with 401 when signed out. */
export function fetchRoleActions({ signal } = {}) {
  return getJson('/api/role-actions', { signal });
}
