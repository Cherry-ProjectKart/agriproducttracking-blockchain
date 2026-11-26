import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBatchHistory, verifyLedger } from './historyService.js';

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('historyService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetchBatchHistory reads the history of one batch with GET', async () => {
    const history = { batch: { batch_id: 'PB-7K2M-9QXD' }, count: 0, events: [] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, history));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchBatchHistory('PB-7K2M-9QXD')).resolves.toEqual(history);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/history/PB-7K2M-9QXD');
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
  });

  it('verifyLedger calls the read-only verification endpoint', async () => {
    const result = { result: 'valid', checked_blocks: 1, failures: [] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, result));
    vi.stubGlobal('fetch', fetchMock);

    await expect(verifyLedger()).resolves.toEqual(result);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/ledger/verify');
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
  });
});
