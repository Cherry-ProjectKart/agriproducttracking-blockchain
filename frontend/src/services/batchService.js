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
