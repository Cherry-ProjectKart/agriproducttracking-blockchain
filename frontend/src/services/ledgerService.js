import { getJson } from './apiClient.js';

/**
 * Resolves with { count, latest, blocks }. Blocks are in index order.
 * Each block: { index, timestamp, event_type, event_id, batch_id, event_data, previous_hash, block_hash }.
 */
export function fetchLedger({ signal } = {}) {
  return getJson('/api/ledger', { signal });
}
