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

/**
 * Which signed-out page an address shows: 'register' for /register, otherwise 'sign-in'.
 * Only used when no session is active; signed-in users always see their workspace.
 */
export function authPageFromPath(pathname) {
  return pathname === PATHS.register ? 'register' : 'sign-in';
}
