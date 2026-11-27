// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import useAccountSession, { SIGNED_OUT } from './useAccountSession.js';
import * as accessService from '../services/accessService.js';
import * as accountService from '../services/accountService.js';

vi.mock('../services/accessService.js', () => ({
  fetchRoles: vi.fn(),
  fetchSession: vi.fn(),
  signIn: vi.fn(),
  endSession: vi.fn(),
}));

vi.mock('../services/accountService.js', () => ({
  registerAccount: vi.fn(),
}));

const ACTIVE = {
  active: true,
  role: 'farmer',
  role_label: 'Farmer',
  display_name: 'Asha Farmer',
  username: 'asha.farmer',
};

const CREDENTIALS = { fullName: 'Asha Farmer', username: 'asha.farmer', password: 'Sunrise2026', confirmPassword: 'Sunrise2026', role: 'farmer' };

describe('useAccountSession', () => {
  beforeEach(() => {
    accessService.fetchRoles.mockResolvedValue([{ key: 'farmer', label: 'Farmer', description: 'x' }]);
    accessService.fetchSession.mockResolvedValue(SIGNED_OUT);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('starts loading and then mirrors the server session', async () => {
    accessService.fetchSession.mockResolvedValue(ACTIVE);
    const { result } = renderHook(() => useAccountSession());

    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.session).toEqual(ACTIVE);
    expect(result.current.roles).toHaveLength(1);
  });

  it('signIn replaces the session with the one the server returns', async () => {
    accessService.signIn.mockResolvedValue(ACTIVE);
    const { result } = renderHook(() => useAccountSession());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.signIn({ username: 'asha.farmer', password: 'Sunrise2026' });
    });

    expect(accessService.signIn).toHaveBeenCalledWith({ username: 'asha.farmer', password: 'Sunrise2026' });
    expect(result.current.session).toEqual(ACTIVE);
  });

  it('a failed signIn rejects and leaves the session signed out', async () => {
    accessService.signIn.mockRejectedValue(new Error('denied'));
    const { result } = renderHook(() => useAccountSession());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await expect(result.current.signIn({ username: 'x', password: 'y' })).rejects.toThrow('denied');
    });

    expect(result.current.session.active).toBe(false);
  });

  it('register makes the new account the active session', async () => {
    accountService.registerAccount.mockResolvedValue(ACTIVE);
    const { result } = renderHook(() => useAccountSession());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.register(CREDENTIALS);
    });

    expect(accountService.registerAccount).toHaveBeenCalledWith(CREDENTIALS);
    expect(result.current.session).toEqual(ACTIVE);
  });

  it('signOut clears the session and reports success', async () => {
    accessService.fetchSession.mockResolvedValue(ACTIVE);
    accessService.endSession.mockResolvedValue(SIGNED_OUT);
    const { result } = renderHook(() => useAccountSession());
    await waitFor(() => expect(result.current.session.active).toBe(true));

    let outcome;
    await act(async () => {
      outcome = await result.current.signOut();
    });

    expect(outcome).toBe(true);
    expect(result.current.session).toEqual(SIGNED_OUT);
    expect(result.current.busy).toBe(false);
  });

  it('a failed signOut keeps the session and sets an error', async () => {
    accessService.fetchSession.mockResolvedValue(ACTIVE);
    accessService.endSession.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useAccountSession());
    await waitFor(() => expect(result.current.session.active).toBe(true));

    let outcome;
    await act(async () => {
      outcome = await result.current.signOut();
    });

    expect(outcome).toBe(false);
    expect(result.current.session.active).toBe(true);
    expect(result.current.error).toBe('Could not sign out. Please try again.');
  });
});
