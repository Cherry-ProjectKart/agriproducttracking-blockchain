import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAccount } from './accountService.js';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('registerAccount', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the registration fields with API names to /api/accounts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { active: true, role: 'retailer' }));
    vi.stubGlobal('fetch', fetchMock);

    await registerAccount({
      fullName: 'Ravi Retail',
      username: 'ravi.retail',
      password: 'Sunrise2026',
      confirmPassword: 'Sunrise2026',
      role: 'retailer',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/accounts');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      full_name: 'Ravi Retail',
      username: 'ravi.retail',
      password: 'Sunrise2026',
      confirm_password: 'Sunrise2026',
      role: 'retailer',
    });
  });

  it('resolves with the signed-in session returned by the server', async () => {
    const payload = { active: true, role: 'farmer', username: 'asha.farmer' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(201, payload)));

    await expect(
      registerAccount({ fullName: 'Asha', username: 'asha.farmer', password: 'p1', confirmPassword: 'p1', role: 'farmer' }),
    ).resolves.toEqual(payload);
  });

  it('rejects with the status and field details for a duplicate username', async () => {
    const body = { error: { code: 409, message: 'That username is already taken.', details: { username: 'Taken.' } } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(409, body)));

    await expect(
      registerAccount({ fullName: 'A', username: 'asha', password: 'p1', confirmPassword: 'p1', role: 'farmer' }),
    ).rejects.toMatchObject({ status: 409, body });
  });
});
