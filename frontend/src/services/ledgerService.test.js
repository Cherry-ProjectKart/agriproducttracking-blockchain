import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLedger } from './ledgerService.js';

describe('ledgerService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests the ledger from the backend and returns its blocks', async () => {
    const body = { count: 1, latest: null, blocks: [{ index: 0 }] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchLedger()).resolves.toEqual(body);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/ledger');
    expect(init.method).toBe('GET');
  });
});
