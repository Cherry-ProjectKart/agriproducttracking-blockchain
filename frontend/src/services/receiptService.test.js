import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmReceipt, fetchAwaitingReceipts } from './receiptService.js';

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('receiptService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetchAwaitingReceipts reads the batches awaiting receipt', async () => {
    const batches = [{ batch_id: 'PB-7K2M-9QXD' }];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { batches }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAwaitingReceipts()).resolves.toEqual(batches);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/receipts/awaiting');
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
  });

  it('confirmReceipt posts the batch ID with the Idempotency-Key header', async () => {
    const result = { event: { event_id: 5 }, batch: { current_status: 'Received by Retailer' }, ledger_block: { index: 4 } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, result));
    vi.stubGlobal('fetch', fetchMock);

    await expect(confirmReceipt('PB-7K2M-9QXD', 'key-12345678')).resolves.toEqual(result);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/receipts');
    expect(init.method).toBe('POST');
    expect(init.headers['Idempotency-Key']).toBe('key-12345678');
    expect(JSON.parse(init.body)).toEqual({ batch_id: 'PB-7K2M-9QXD' });
  });
});
