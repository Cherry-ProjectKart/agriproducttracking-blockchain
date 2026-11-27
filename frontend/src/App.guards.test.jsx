// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App.jsx';
import * as accessService from './services/accessService.js';
import { fetchHealth } from './services/healthService.js';

// Route-guard behaviour (BPT-102). The server is the authority for roles; these tests check that the
// browser never shows a workspace the session does not own, and that direct URLs are corrected.

vi.mock('./services/accessService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchRoles: vi.fn(),
  fetchSession: vi.fn(),
  signIn: vi.fn(),
  endSession: vi.fn(),
  fetchRoleActions: vi.fn(),
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

const SESSIONS = {
  farmer: { active: true, role: 'farmer', role_label: 'Farmer', display_name: 'Demo Farmer', username: 'demo.farmer' },
  distributor: {
    active: true,
    role: 'distributor',
    role_label: 'Distributor',
    display_name: 'Demo Distributor',
    username: 'demo.distributor',
  },
  retailer: { active: true, role: 'retailer', role_label: 'Retailer', display_name: 'Demo Retailer', username: 'demo.retailer' },
};

const ACTIONS = {
  farmer: [{ key: 'register_batch', label: 'Register product batch', available: true }],
  distributor: [{ key: 'record_shipment', label: 'Record shipment update', available: true }],
  retailer: [{ key: 'confirm_receipt', label: 'Confirm receipt of batch', available: true }],
};

function actionsFor(role) {
  return { role, role_label: role, actions: ACTIONS[role] };
}

function signedInAs(role) {
  accessService.fetchSession.mockResolvedValue(SESSIONS[role]);
  accessService.fetchRoleActions.mockImplementation(async () => actionsFor(role));
}

describe('route guard: direct URLs', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    accessService.fetchRoles.mockResolvedValue(ROLES);
    fetchHealth.mockResolvedValue({ status: 'ok', application: 'x', database: { status: 'connected', schema_initialized: true } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('a signed-out visitor opening a workspace address sees sign-in, never the workspace', async () => {
    accessService.fetchSession.mockResolvedValue(SIGNED_OUT);
    window.history.replaceState({}, '', '/farmer');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Welcome Back' })).toBeTruthy();
    await waitFor(() => expect(window.location.pathname).toBe('/sign-in'));
    expect(screen.queryByRole('heading', { name: /workspace/ })).toBeNull();
    expect(accessService.fetchRoleActions).not.toHaveBeenCalled();
  });

  it('a signed-in retailer opening the farmer address is sent to the retailer workspace', async () => {
    signedInAs('retailer');
    window.history.replaceState({}, '', '/farmer');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Retailer workspace' })).toBeTruthy();
    await waitFor(() => expect(window.location.pathname).toBe('/retailer'));
    expect(screen.queryByRole('heading', { name: 'Farmer workspace' })).toBeNull();
    expect(screen.queryByText('Register product batch')).toBeNull();
  });

  it('a signed-in farmer opening the home address is sent to the farmer workspace', async () => {
    signedInAs('farmer');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Farmer workspace' })).toBeTruthy();
    await waitFor(() => expect(window.location.pathname).toBe('/farmer'));
  });

  it('a signed-in distributor opening the retailer address is sent to the distributor workspace', async () => {
    signedInAs('distributor');
    window.history.replaceState({}, '', '/retailer');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Distributor workspace' })).toBeTruthy();
    await waitFor(() => expect(window.location.pathname).toBe('/distributor'));
  });

  it('an expired or invalid session at a workspace address shows sign-in', async () => {
    accessService.fetchSession.mockResolvedValue(SIGNED_OUT);
    window.history.replaceState({}, '', '/distributor');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Welcome Back' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /workspace/ })).toBeNull();
  });

  it('while the session is loading, no workspace content is shown', async () => {
    accessService.fetchSession.mockReturnValue(new Promise(() => {}));
    window.history.replaceState({}, '', '/farmer');
    render(<App />);

    expect(await screen.findByText('Loading your session…')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /workspace/ })).toBeNull();
    expect(screen.queryByText('Register product batch')).toBeNull();
    expect(accessService.fetchRoleActions).not.toHaveBeenCalled();
  });
});

describe('route guard: sign-out and browser navigation', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    accessService.fetchRoles.mockResolvedValue(ROLES);
    fetchHealth.mockResolvedValue({ status: 'ok', application: 'x', database: { status: 'connected', schema_initialized: true } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('after sign-out, going back to a workspace address shows sign-in and no workspace', async () => {
    signedInAs('farmer');
    accessService.endSession.mockResolvedValue(SIGNED_OUT);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Welcome Back' })).toBeTruthy();

    // Simulate the browser's Back button returning to the protected address.
    window.history.pushState({}, '', '/farmer');
    window.dispatchEvent(new PopStateEvent('popstate'));

    await waitFor(() => expect(window.location.pathname).toBe('/sign-in'));
    expect(screen.getByRole('heading', { name: 'Welcome Back' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /workspace/ })).toBeNull();
  });

  it('a second user signing in does not see the first user workspace', async () => {
    signedInAs('farmer');
    accessService.endSession.mockResolvedValue(SIGNED_OUT);
    accessService.signIn.mockResolvedValue(SESSIONS.retailer);
    accessService.fetchRoleActions.mockImplementation(async () => actionsFor('retailer'));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Welcome Back' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'demo.retailer' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'RetailerDemo2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(await screen.findByRole('heading', { name: 'Retailer workspace' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Farmer workspace' })).toBeNull();
  });
});

describe('role-specific navigation', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    accessService.fetchRoles.mockResolvedValue(ROLES);
    fetchHealth.mockResolvedValue({ status: 'ok', application: 'x', database: { status: 'connected', schema_initialized: true } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it.each([
    ['farmer', 'Product batches and registration'],
    ['distributor', 'Eligible batches and shipment updates'],
    ['retailer', 'Awaiting receipts and confirmation'],
  ])('a %s sees only its own section links', async (role, ownLink) => {
    signedInAs(role);
    render(<App />);
    await screen.findByRole('heading', { name: `${role[0].toUpperCase()}${role.slice(1)} workspace` });

    const nav = screen.getByRole('navigation', { name: /workspace sections/ });
    expect(nav.textContent).toContain(ownLink);
    for (const other of Object.keys(ACTIONS).filter((key) => key !== role)) {
      expect(nav.textContent).not.toContain(`${other[0].toUpperCase()}${other.slice(1)} workspace`);
    }
    expect(nav.querySelectorAll('a').length).toBe(4);
  });

  it('a farmer never sees receipt or shipment links', async () => {
    signedInAs('farmer');
    render(<App />);
    await screen.findByRole('heading', { name: 'Farmer workspace' });

    const nav = screen.getByRole('navigation', { name: /workspace sections/ });
    expect(nav.textContent).not.toMatch(/receipt|shipment/i);
  });

  it('signed-out visitors see no workspace navigation at all', async () => {
    accessService.fetchSession.mockResolvedValue(SIGNED_OUT);
    render(<App />);
    await screen.findByRole('heading', { name: 'Welcome Back' });

    expect(screen.queryByRole('navigation', { name: /workspace sections/ })).toBeNull();
  });
});
