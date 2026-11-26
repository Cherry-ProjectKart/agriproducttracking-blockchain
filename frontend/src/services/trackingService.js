import { getJson } from './apiClient.js';

/**
 * Public, read-only tracking view of one batch. Needs no session and sends no credentials.
 * Resolves with { batch: { batch_id, product_name, origin, current_status }, count, events }.
 * Rejects with ApiError: status 400 for a malformed ID, 404 when no batch has the ID.
 */
export function fetchPublicTracking(batchId, { signal } = {}) {
  return getJson(`/api/tracking/${encodeURIComponent(batchId)}`, { signal });
}
