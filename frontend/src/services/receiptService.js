import { getJson, sendJson } from './apiClient.js';

/** Resolves with the batches awaiting retailer receipt (status "Delivered to Retailer"). */
export async function fetchAwaitingReceipts({ signal } = {}) {
  const body = await getJson('/api/receipts/awaiting', { signal });
  return body.batches;
}

/** Resolves with the batches a retailer has already received (status "Received by Retailer"). */
export async function fetchReceivedReceipts({ signal } = {}) {
  const body = await getJson('/api/receipts/received', { signal });
  return body.batches;
}

/**
 * Confirms that the retailer received a batch. The Idempotency-Key header lets the backend return
 * the stored receipt if the same confirmation is sent again. Resolves with { event, batch, ledger_block }.
 */
export function confirmReceipt(batchId, submissionKey, { signal } = {}) {
  return sendJson('POST', '/api/receipts', {
    body: { batch_id: batchId },
    headers: { 'Idempotency-Key': submissionKey },
    signal,
  });
}
