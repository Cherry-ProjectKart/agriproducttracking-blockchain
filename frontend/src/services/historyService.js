import { getJson } from './apiClient.js';

/**
 * Resolves with { batch: { batch_id, product_name, current_status }, count, events }.
 * Rejects with ApiError status 404 when no batch has this ID.
 */
export function fetchBatchHistory(batchId, { signal } = {}) {
  return getJson(`/api/history/${encodeURIComponent(batchId)}`, { signal });
}

/**
 * Resolves with the ledger verification result: { result: 'valid' | 'invalid', checked_blocks, failures, checks, ... }.
 * The check is read-only on the server. A failed check is a result, not an error.
 */
export function verifyLedger({ signal } = {}) {
  return getJson('/api/ledger/verify', { signal });
}
