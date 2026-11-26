// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import * as accessService from '../services/accessService.js';
import useDemoSession, { INACTIVE_SESSION, MESSAGES } from './useDemoSession.js';

vi.mock('../services/accessService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchRoles: vi.fn(),
  fetchSession: vi.fn(),
  startSession: vi.fn(),
  endSession: vi.fn(),
}));

describe('useDemoSession role validation', () => {
  beforeEach(() => {
    accessService.fetchRoles.mockResolvedValue([]);
    accessService.fetchSession.mockResolvedValue(INACTIVE_SESSION);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  async function renderReadyHook() {
    const hook = renderHook(() => useDemoSession());
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    return hook;
  }

  it('rejects an unsupported role without calling the backend', async () => {
    const { result } = await renderReadyHook();

    let accepted;
    await act(async () => {
      accepted = await result.current.selectRole('admin');
    });

    expect(accepted).toBe(false);
    expect(result.current.error).toBe(MESSAGES.invalidRole);
    expect(result.current.session.active).toBe(false);
    expect(accessService.startSession).not.toHaveBeenCalled();
  });

  it.each([undefined, null, ''])('reports a missing role (%j) without calling the backend', async (value) => {
    const { result } = await renderReadyHook();

    await act(async () => {
      await result.current.selectRole(value);
    });

    expect(result.current.error).toBe(MESSAGES.missingRole);
    expect(accessService.startSession).not.toHaveBeenCalled();
  });

  it('clears a previous validation error when a valid role is selected', async () => {
    accessService.startSession.mockResolvedValue({
      active: true,
      role: 'farmer',
      role_label: 'Farmer',
      display_name: 'Demo Farmer',
    });
    const { result } = await renderReadyHook();

    await act(async () => {
      await result.current.selectRole('nope');
    });
    expect(result.current.error).toBe(MESSAGES.invalidRole);

    await act(async () => {
      await result.current.selectRole('farmer');
    });
    expect(result.current.error).toBeNull();
    expect(result.current.session.role).toBe('farmer');
  });
});
