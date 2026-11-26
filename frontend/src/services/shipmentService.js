import { getJson, sendJson } from './apiClient.js';

/** Resolves with the registered batches available for shipment updates. */
export async function fetchShipmentBatches({ signal } = {}) {
  const body = await getJson('/api/shipments/batches', { signal });
  return body.batches;
}

/**
 * Records a shipment update. The Idempotency-Key header lets the backend return the existing
 * update if the same submission is sent again, instead of recording it twice.
 * Resolves with { event, batch, ledger_block }.
 */
export function createShipment(payload, submissionKey, { signal } = {}) {
  return sendJson('POST', '/api/shipments', {
    body: payload,
    headers: { 'Idempotency-Key': submissionKey },
    signal,
  });
}
