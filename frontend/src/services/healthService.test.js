import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHealth } from './healthService.js';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('fetchHealth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the payload for a healthy 200 response', async () => {
    const payload = {
      status: 'ok',
      application: 'Blockchain Product Tracking',
      database: { status: 'connected', schema_initialized: true },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, payload)));

    await expect(fetchHealth()).resolves.toEqual(payload);
    expect(fetch).toHaveBeenCalledWith('/api/health', expect.objectContaining({ method: 'GET' }));
  });

  it('returns the degraded payload carried by a 503 response', async () => {
    const payload = {
      status: 'degraded',
      application: 'Blockchain Product Tracking',
      database: { status: 'disconnected', schema_initialized: false },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(503, payload)));

    await expect(fetchHealth()).resolves.toEqual(payload);
  });

  it('reports unreachable when the network request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(fetchHealth()).resolves.toEqual({
      status: 'unreachable',
      application: null,
      database: null,
    });
  });
});
