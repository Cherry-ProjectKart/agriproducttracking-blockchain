import { getJson, sendJson } from './apiClient.js';

/** A fresh key for one logical registration. Reuse it when retrying the same submission. */
export function createSubmissionKey() {
  return globalThis.crypto.randomUUID();
}

/**
 * Register a batch. The Idempotency-Key header lets the backend return the original batch
 * if the same submission is sent again, instead of saving a duplicate.
 * Resolves with the batch object.
 */
export async function createBatch(payload, submissionKey, { signal } = {}) {
  const body = await sendJson('POST', '/api/batches', {
    body: payload,
    headers: { 'Idempotency-Key': submissionKey },
    signal,
  });
  return body.batch;
}

/** Resolves with the farmer's own batches, newest first. */
export async function fetchBatches({ signal } = {}) {
  const body = await getJson('/api/batches', { signal });
  return body.batches;
}

/**
 * Changes the description of one of the farmer's batches. It is the only detail that can change after
 * registration: the other details are on the ledger. `batchRowId` is the batch's internal row id (the `id`
 * field), not the public PB- code. Resolves with the updated batch.
 */
export async function updateBatchDescription(batchRowId, description, { signal } = {}) {
  const body = await sendJson('PATCH', `/api/batches/${batchRowId}`, {
    body: { description },
    signal,
  });
  return body.batch;
}

