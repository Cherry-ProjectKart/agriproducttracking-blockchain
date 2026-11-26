import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPublicTracking } from './trackingService.js';

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('trackingService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests the public tracking endpoint with GET and sends no credentials', async () => {
    const view = { batch: { batch_id: 'PB-7K2M-9QXD' }, count: 0, events: [] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, view));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchPublicTracking('PB-7K2M-9QXD')).resolves.toEqual(view);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/tracking/PB-7K2M-9QXD');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.body).toBeUndefined();
  });
});
