import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './apiClient.js';
import {
  endSession,
  fetchRoleActions,
  isSupportedRole,
  startSession,
} from './accessService.js';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('isSupportedRole', () => {
  it('accepts only the three demonstration roles', () => {
    expect(isSupportedRole('farmer')).toBe(true);
    expect(isSupportedRole('distributor')).toBe(true);
    expect(isSupportedRole('retailer')).toBe(true);
  });

  it('rejects unknown, differently cased, empty and non-string values', () => {
    expect(isSupportedRole('admin')).toBe(false);
    expect(isSupportedRole('Farmer')).toBe(false);
    expect(isSupportedRole('')).toBe(false);
    expect(isSupportedRole(undefined)).toBe(false);
    expect(isSupportedRole(null)).toBe(false);
    expect(isSupportedRole(['farmer'])).toBe(false);
  });
});

describe('access API calls', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('startSession posts the selected role as JSON to /api/session', async () => {
    const payload = { active: true, role: 'farmer', role_label: 'Farmer', display_name: 'Demo Farmer' };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, payload));
    vi.stubGlobal('fetch', fetchMock);

    await expect(startSession('farmer')).resolves.toEqual(payload);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/session');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ role: 'farmer' });
  });

  it('endSession sends DELETE to /api/session', async () => {
    const payload = { active: false, role: null, role_label: null, display_name: null };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, payload));
    vi.stubGlobal('fetch', fetchMock);

    await expect(endSession()).resolves.toEqual(payload);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/session');
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });

  it('fetchRoleActions uses GET and surfaces backend error bodies on failure', async () => {
    const errorBody = { error: { code: 401, name: 'Unauthorized', message: 'Select a role to sign in.' } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, errorBody));
    vi.stubGlobal('fetch', fetchMock);

    const failure = fetchRoleActions().catch((error) => error);
    const error = await failure;

    expect(fetchMock.mock.calls[0][0]).toBe('/api/role-actions');
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(error.body).toEqual(errorBody);
  });
});
