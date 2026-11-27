// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import Root from './Root.jsx';
import * as accessService from './services/accessService.js';
import * as trackingService from './services/trackingService.js';
import { fetchHealth } from './services/healthService.js';

vi.mock('./services/accessService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchRoles: vi.fn().mockResolvedValue([
    { key: 'farmer', label: 'Farmer', description: 'Register agricultural product batches.' },
  ]),
  fetchSession: vi.fn().mockResolvedValue({ active: false, role: null, role_label: null, display_name: null }),
  signIn: vi.fn(),
  endSession: vi.fn(),
  fetchRoleActions: vi.fn(),
}));

vi.mock('./services/trackingService.js', () => ({
  fetchPublicTracking: vi.fn().mockResolvedValue({
    batch: { batch_id: 'PB-7K2M-9QXD', product_name: 'Basmati Rice', origin: 'Green Valley Farm', current_status: 'Registered' },
    count: 0,
    events: [],
  }),
}));

vi.mock('./services/healthService.js', () => ({
  fetchHealth: vi.fn().mockResolvedValue({ status: 'ok', application: 'x', database: { status: 'connected', schema_initialized: true } }),
}));

describe('Root: direct navigation to a QR tracking link', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/track/PB-7K2M-9QXD');
  });

  afterEach(() => {
    cleanup();
    window.history.pushState({}, '', '/');
    vi.clearAllMocks();
  });

  it('opens the public tracking page for the batch in the link', async () => {
    render(<Root />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Basmati Rice' })).toBeTruthy();
    expect(trackingService.fetchPublicTracking).toHaveBeenCalledWith('PB-7K2M-9QXD', expect.any(Object));
  });

  it('does not require a login or role selection and never loads the session or role code', async () => {
    render(<Root />);
    await screen.findByRole('heading', { level: 1, name: 'Basmati Rice' });

    expect(accessService.fetchSession).not.toHaveBeenCalled();
    expect(accessService.fetchRoles).not.toHaveBeenCalled();
    expect(accessService.signIn).not.toHaveBeenCalled();
    expect(screen.queryByText('Welcome Back')).toBeNull();
    expect(screen.queryByText('Blockchain Product Tracking', { selector: 'h1' })).toBeNull();
  });
});

describe('Root: the application address', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the application, not the tracking page, at the root address', async () => {
    render(<Root />);

    expect(await screen.findByText('Welcome Back')).toBeTruthy();
    expect(trackingService.fetchPublicTracking).not.toHaveBeenCalled();
    expect(accessService.fetchSession).toHaveBeenCalled();
  });
});
