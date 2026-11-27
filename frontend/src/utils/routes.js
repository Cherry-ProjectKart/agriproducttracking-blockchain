/**
 * Batch ID from a QR tracking path such as /track/PB-7K2M-9QXD, or null for any other path.
 * The path is decoded and a trailing slash is ignored. Validation of the ID itself is done by the server.
 */
export function trackingBatchIdFromPath(pathname) {
  const match = /^\/track\/([^/]+)\/?$/.exec(pathname ?? '');
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export const PATHS = Object.freeze({
  home: '/',
  signIn: '/sign-in',
  register: '/register',
});

/** Address of each role's workspace. Only a signed-in account with that role may show it. */
export const WORKSPACE_PATHS = Object.freeze({
  farmer: '/farmer',
  distributor: '/distributor',
  retailer: '/retailer',
});

/** The workspace address for a signed-in role, or the home address for an unknown role. */
export function workspacePathForRole(role) {
  return Object.hasOwn(WORKSPACE_PATHS, role) ? WORKSPACE_PATHS[role] : PATHS.home;
}

/** True when the address is a protected workspace address (any role). */
export function isWorkspacePath(pathname) {
  return Object.values(WORKSPACE_PATHS).includes(pathname);
}

/**
 * Which signed-out page an address shows: 'register' for /register, otherwise 'sign-in'.
 * Only used when no session is active; signed-in users always see their workspace.
 */
export function authPageFromPath(pathname) {
  return pathname === PATHS.register ? 'register' : 'sign-in';
}
