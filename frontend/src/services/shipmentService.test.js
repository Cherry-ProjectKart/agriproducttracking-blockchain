import { afterEach, describe, expect, it, vi } from 'vitest';
import { createShipment, fetchShipmentBatches } from './shipmentService.js';

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('shipmentService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetchShipmentBatches reads the distributor batch list', async () => {
    const batches = [{ batch_id: 'PB-7K2M-9QXD' }];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { batches }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchShipmentBatches()).resolves.toEqual(batches);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/shipments/batches');
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
  });

  it('createShipment posts the update with the Idempotency-Key header', async () => {
    const result = { event: { event_id: 4 }, batch: { current_status: 'Shipped' }, ledger_block: { index: 3 } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, result));
    vi.stubGlobal('fetch', fetchMock);
    const payload = { batch_id: 'PB-7K2M-9QXD', status: 'Shipped', note: null };

    await expect(createShipment(payload, 'key-12345678')).resolves.toEqual(result);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/shipments');
    expect(init.method).toBe('POST');
    expect(init.headers['Idempotency-Key']).toBe('key-12345678');
    expect(JSON.parse(init.body)).toEqual(payload);
  });
});
