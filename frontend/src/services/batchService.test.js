import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBatch, createSubmissionKey, fetchBatches } from './batchService.js';

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('batchService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('createSubmissionKey returns a UUID-shaped key that is unique per call', () => {
    const first = createSubmissionKey();
    const second = createSubmissionKey();

    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(first).not.toBe(second);
  });

  it('createBatch posts the payload with the Idempotency-Key header and returns the batch', async () => {
    const batch = { id: 3, product_name: 'Rice' };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { batch }));
    vi.stubGlobal('fetch', fetchMock);
    const payload = { product_name: 'Rice', quantity: 2 };

    await expect(createBatch(payload, 'key-12345678')).resolves.toEqual(batch);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/batches');
    expect(init.method).toBe('POST');
    expect(init.headers['Idempotency-Key']).toBe('key-12345678');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual(payload);
  });

  it('fetchBatches reads the farmer batch list', async () => {
    const batches = [{ id: 1, product_name: 'Rice' }];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { batches }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchBatches()).resolves.toEqual(batches);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/batches');
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
  });
});
