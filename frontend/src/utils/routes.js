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
