import { afterEach, describe, expect, it, vi } from 'vitest';
import { changePassword, fetchAccount, updatePreferences, updateProfile } from './accountSettingsService.js';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const ACCOUNT = {
  username: 'asha.farmer',
  full_name: 'Asha Farmer',
  role: 'farmer',
  role_label: 'Farmer',
  created_at: '2026-11-27T10:00:00.000Z',
  updated_at: null,
  grid_density: 'comfortable',
};

describe('accountSettingsService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetchAccount reads the signed-in account without sending any identifier', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { account: ACCOUNT }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAccount()).resolves.toEqual(ACCOUNT);

    expect(fetchMock.mock.calls[0][0]).toBe('/api/account');
  });

  it('updateProfile sends only the fields it was given, as API names', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { account: ACCOUNT }));
    vi.stubGlobal('fetch', fetchMock);

    await updateProfile({ fullName: 'Asha Grower' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/account');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ full_name: 'Asha Grower' });
  });

  it('updatePreferences sends the density under grid_density', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { account: { ...ACCOUNT, grid_density: 'compact' } }));
    vi.stubGlobal('fetch', fetchMock);

    const updated = await updatePreferences('compact');

    expect(updated.grid_density).toBe('compact');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/account/preferences');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ grid_density: 'compact' });
  });

  it('changePassword posts the three password fields and returns the server message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { message: 'Your password has been changed.' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      changePassword({ currentPassword: 'Sunrise2026', newPassword: 'BrandNew2027', confirmPassword: 'BrandNew2027' }),
    ).resolves.toBe('Your password has been changed.');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/account/password');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      current_password: 'Sunrise2026',
      new_password: 'BrandNew2027',
      confirm_password: 'BrandNew2027',
    });
  });

  it('rejects with the status and field details when the server refuses a change', async () => {
    const body = { error: { code: 400, message: 'Please correct the highlighted fields.', details: { current_password: 'Your current password is incorrect.' } } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(400, body)));

    await expect(
      changePassword({ currentPassword: 'wrong', newPassword: 'BrandNew2027', confirmPassword: 'BrandNew2027' }),
    ).rejects.toMatchObject({ status: 400, body });
  });
});
