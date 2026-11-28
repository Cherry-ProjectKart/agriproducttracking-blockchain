// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App.jsx';
import * as accessService from './services/accessService.js';
import * as settings from './services/accountSettingsService.js';
import { fetchHealth } from './services/healthService.js';

// Account settings routing and table density (BPT-104).

vi.mock('./services/accessService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchRoles: vi.fn(),
  fetchSession: vi.fn(),
  signIn: vi.fn(),
  endSession: vi.fn(),
  fetchRoleActions: vi.fn(),
}));

vi.mock('./services/accountSettingsService.js', () => ({
  fetchAccount: vi.fn(),
  updateProfile: vi.fn(),
  updatePreferences: vi.fn(),
  changePassword: vi.fn(),
}));

vi.mock('./services/accountService.js', () => ({
  registerAccount: vi.fn(),
}));

vi.mock('./services/healthService.js', () => ({
  fetchHealth: vi.fn(),
}));

vi.mock('./services/shipmentService.js', () => ({
  fetchShipmentBatches: vi.fn().mockResolvedValue([]),
  createShipment: vi.fn(),
}));

vi.mock('./services/receiptService.js', () => ({
  fetchAwaitingReceipts: vi.fn().mockResolvedValue([]),
  confirmReceipt: vi.fn(),
}));

vi.mock('./services/ledgerService.js', () => ({
  fetchLedger: vi.fn().mockResolvedValue({ count: 0, latest: null, blocks: [] }),
}));

vi.mock('./services/batchService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchBatches: vi.fn().mockResolvedValue([]),
  createBatch: vi.fn(),
}));

const ROLES = [
  { key: 'farmer', label: 'Farmer', description: 'Register agricultural product batches.' },
  { key: 'distributor', label: 'Distributor', description: 'View batches and record shipments.' },
  { key: 'retailer', label: 'Retailer', description: 'View incoming batches and confirm receipt.' },
];

const SIGNED_OUT = { active: false, role: null, role_label: null, display_name: null, username: null };

function session(role, density = 'comfortable') {
  const labels = { farmer: 'Farmer', distributor: 'Distributor', retailer: 'Retailer' };
  return {
    active: true,
    role,
    role_label: labels[role],
    display_name: `Demo ${labels[role]}`,
    username: `demo.${role}`,
    grid_density: density,
  };
}

const ACCOUNT = {
  username: 'demo.farmer',
  full_name: 'Demo Farmer',
  role: 'farmer',
  role_label: 'Farmer',
  created_at: '2026-11-27T10:00:00.000Z',
  updated_at: null,
  grid_density: 'comfortable',
};

describe('account settings route and density', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    accessService.fetchRoles.mockResolvedValue(ROLES);
    accessService.fetchRoleActions.mockResolvedValue({ role: 'farmer', role_label: 'Farmer', actions: [] });
    settings.fetchAccount.mockResolvedValue(ACCOUNT);
    fetchHealth.mockResolvedValue({ status: 'ok', application: 'x', database: { status: 'connected', schema_initialized: true } });
    delete document.documentElement.dataset.gridDensity;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
    delete document.documentElement.dataset.gridDensity;
  });

  it('a signed-in retailer can open account settings from the header', async () => {
    // The link is shared by every role's header; each role's own workspace is covered in the guard tests.
    accessService.fetchSession.mockResolvedValue(session('retailer'));
    render(<App />);

    fireEvent.click(await screen.findByRole('link', { name: 'Account settings' }));
    await waitFor(() => expect(window.location.pathname).toBe('/account'));

    expect(await screen.findByRole('heading', { name: 'Account settings' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Retailer workspace' })).toBeNull();
  });

  it('the account page is reachable directly by a signed-in user, and the workspace nav remains available', async () => {
    accessService.fetchSession.mockResolvedValue(session('distributor'));
    window.history.replaceState({}, '', '/account');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Account settings' })).toBeTruthy();
    expect(window.location.pathname).toBe('/account');
  });

  it('a signed-out visitor opening /account is sent to sign-in and sees no account data', async () => {
    accessService.fetchSession.mockResolvedValue(SIGNED_OUT);
    window.history.replaceState({}, '', '/account');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Welcome Back' })).toBeTruthy();
    await waitFor(() => expect(window.location.pathname).toBe('/sign-in'));
    expect(settings.fetchAccount).not.toHaveBeenCalled();
  });

  it('from account settings, a workspace address still returns the user to their own workspace', async () => {
    accessService.fetchSession.mockResolvedValue(session('farmer'));
    window.history.replaceState({}, '', '/account');
    render(<App />);
    await screen.findByRole('heading', { name: 'Account settings' });

    window.history.pushState({}, '', '/retailer');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(await screen.findByRole('heading', { name: 'Farmer workspace' })).toBeTruthy();
    await waitFor(() => expect(window.location.pathname).toBe('/farmer'));
  });

  it('the account settings link is marked as the current page while open', async () => {
    accessService.fetchSession.mockResolvedValue(session('farmer'));
    window.history.replaceState({}, '', '/account');
    render(<App />);
    await screen.findByRole('heading', { name: 'Account settings' });

    expect(screen.getByRole('link', { name: 'Account settings' }).getAttribute('aria-current')).toBe('page');
  });

  it('applies the compact density saved for the signed-in account', async () => {
    accessService.fetchSession.mockResolvedValue(session('farmer', 'compact'));
    render(<App />);

    await screen.findByRole('heading', { name: 'Farmer workspace' });
    expect(document.documentElement.dataset.gridDensity).toBe('compact');
  });

  it('uses comfortable density for an account that has not chosen one, and when signed out', async () => {
    accessService.fetchSession.mockResolvedValue(SIGNED_OUT);
    render(<App />);

    await screen.findByRole('heading', { name: 'Welcome Back' });
    expect(document.documentElement.dataset.gridDensity).toBe('comfortable');
  });

  it('after a density change is saved, the refreshed session applies it immediately', async () => {
    accessService.fetchSession.mockResolvedValueOnce(session('farmer', 'comfortable'));
    accessService.fetchSession.mockResolvedValue(session('farmer', 'compact'));
    settings.updatePreferences.mockResolvedValue({ ...ACCOUNT, grid_density: 'compact' });
    window.history.replaceState({}, '', '/account');
    render(<App />);
    await screen.findByRole('heading', { name: 'Account settings' });
    // The account and session load after the heading appears, so wait for each before using it.
    await waitFor(() => expect(document.documentElement.dataset.gridDensity).toBe('comfortable'), { timeout: 4000 });

    fireEvent.click(await screen.findByRole('radio', { name: /Compact/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));

    await waitFor(() => expect(document.documentElement.dataset.gridDensity).toBe('compact'), { timeout: 4000 });
  });
});
