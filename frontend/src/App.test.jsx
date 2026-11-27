// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App.jsx';
import * as accessService from './services/accessService.js';
import * as accountService from './services/accountService.js';
import { ApiError } from './services/apiClient.js';
import { fetchHealth } from './services/healthService.js';

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

// The Distributor workspace loads shipment batches; keep those calls off the network here.
vi.mock('./services/shipmentService.js', () => ({
  fetchShipmentBatches: vi.fn().mockResolvedValue([]),
  createShipment: vi.fn(),
}));

// Every workspace shows the local ledger; keep it off the network in these tests.
vi.mock('./services/receiptService.js', () => ({
  fetchAwaitingReceipts: vi.fn().mockResolvedValue([]),
  confirmReceipt: vi.fn(),
}));

vi.mock('./services/ledgerService.js', () => ({
  fetchLedger: vi.fn().mockResolvedValue({ count: 0, latest: null, blocks: [] }),
}));

// The farmer workspace also loads batches; keep those calls off the network in these tests.
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

function activeSession(role, label, displayName, username = `demo.${role}`) {
  return { active: true, role, role_label: label, display_name: displayName, username };
}

function farmerActions() {
  return {
    role: 'farmer',
    role_label: 'Farmer',
    actions: [{ key: 'register_batch', label: 'Register product batch', available: false }],
  };
}

function apiError(status, message, details) {
  return new ApiError(`Request to /api failed with status ${status}.`, {
    status,
    body: { error: { code: status, message, ...(details ? { details } : {}) } },
  });
}

async function signInAs(username, password) {
  fireEvent.change(await screen.findByLabelText('Username'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
}

describe('App sign-in and session', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    accessService.fetchRoles.mockResolvedValue(ROLES);
    accessService.fetchSession.mockResolvedValue(SIGNED_OUT);
    accessService.fetchRoleActions.mockResolvedValue(farmerActions());
    fetchHealth.mockResolvedValue({
      status: 'ok',
      application: 'Blockchain Product Tracking',
      database: { status: 'connected', schema_initialized: true },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('shows the sign-in page, with no role selector, when signed out', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Welcome Back' })).toBeTruthy();
    expect(screen.getByLabelText('Username')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Farmer/ })).toBeNull();
    expect(screen.queryByTestId('active-role')).toBeNull();
  });

  it('signing in redirects to the workspace of the role the server returns', async () => {
    accessService.signIn.mockResolvedValue(activeSession('retailer', 'Retailer', 'Demo Retailer'));
    accessService.fetchRoleActions.mockResolvedValue({
      role: 'retailer',
      role_label: 'Retailer',
      actions: [{ key: 'confirm_receipt', label: 'Confirm receipt of batch', available: false }],
    });
    render(<App />);

    await signInAs('demo.retailer', 'RetailerDemo2026');

    expect(await screen.findByRole('heading', { name: 'Retailer workspace' })).toBeTruthy();
    expect(screen.getByTestId('active-role').textContent).toContain('Role: Retailer');
    expect(accessService.signIn).toHaveBeenCalledWith({ username: 'demo.retailer', password: 'RetailerDemo2026' });
    expect(screen.queryByRole('heading', { name: 'Welcome Back' })).toBeNull();
  });

  it('shows the generic invalid-credentials message and stays on sign-in', async () => {
    accessService.signIn.mockRejectedValue(apiError(401, 'Username or password is incorrect.'));
    render(<App />);

    await signInAs('demo.farmer', 'WrongPassword1');

    expect((await screen.findByRole('alert')).textContent).toContain('Username or password is incorrect.');
    expect(screen.getByRole('heading', { name: 'Welcome Back' })).toBeTruthy();
    expect(screen.queryByTestId('active-role')).toBeNull();
  });

  it('restores an existing session on load without asking to sign in again', async () => {
    accessService.fetchSession.mockResolvedValue(activeSession('farmer', 'Farmer', 'Demo Farmer'));
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Farmer workspace' })).toBeTruthy();
    expect(screen.getByTestId('active-role').textContent).toContain('Signed in as Demo Farmer');
    expect(screen.queryByRole('heading', { name: 'Welcome Back' })).toBeNull();
  });

  it('sign out ends the session and returns to the sign-in page', async () => {
    accessService.fetchSession.mockResolvedValue(activeSession('farmer', 'Farmer', 'Demo Farmer'));
    accessService.endSession.mockResolvedValue(SIGNED_OUT);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Welcome Back' })).toBeTruthy();
    expect(screen.queryByTestId('active-role')).toBeNull();
    expect(accessService.endSession).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/sign-in');
  });

  it('a failed sign-out keeps the workspace and shows the error', async () => {
    accessService.fetchSession.mockResolvedValue(activeSession('farmer', 'Farmer', 'Demo Farmer'));
    accessService.endSession.mockRejectedValue(new ApiError('Network error while contacting the API.'));
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(await screen.findByText('Could not sign out. Please try again.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Farmer workspace' })).toBeTruthy();
  });

  it('reports a session check failure but still offers the sign-in form', async () => {
    accessService.fetchSession.mockRejectedValue(new ApiError('Network error while contacting the API.'));
    render(<App />);

    expect(await screen.findByText('Could not check your sign-in. Make sure the backend is running.')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Welcome Back' })).toBeTruthy();
  });

  it('reports a roles load failure without offering any role choice', async () => {
    accessService.fetchRoles.mockRejectedValue(new ApiError('Network error while contacting the API.'));
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText('Could not load the account roles. Make sure the backend is running.')).toBeTruthy(),
    );
  });

  it('reports a failure to load role actions in the workspace', async () => {
    accessService.fetchSession.mockResolvedValue(activeSession('farmer', 'Farmer', 'Demo Farmer'));
    accessService.fetchRoleActions.mockRejectedValue(new ApiError('Unauthorized', { status: 401 }));
    render(<App />);

    expect((await screen.findByText('Could not load the actions for this role. Make sure the backend is running.')).textContent).toBeTruthy();
  });
});

describe('App registration', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    accessService.fetchRoles.mockResolvedValue(ROLES);
    accessService.fetchSession.mockResolvedValue(SIGNED_OUT);
    accessService.fetchRoleActions.mockResolvedValue(farmerActions());
    fetchHealth.mockResolvedValue({ status: 'ok', application: 'x', database: { status: 'connected', schema_initialized: true } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
  });

  async function fillRegistration(role = 'retailer') {
    fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: 'Ravi Retail' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'ravi.retail' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Sunrise2026' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'Sunrise2026' } });
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(`^${role[0].toUpperCase()}${role.slice(1)}`) }));
  }

  it('the Create Account link opens the registration page', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('link', { name: 'Create an account' }));

    expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeTruthy();
    expect(window.location.pathname).toBe('/register');
  });

  it('a successful registration opens that role workspace without another sign-in', async () => {
    accountService.registerAccount.mockResolvedValue(activeSession('retailer', 'Retailer', 'Ravi Retail', 'ravi.retail'));
    accessService.fetchRoleActions.mockResolvedValue({
      role: 'retailer',
      role_label: 'Retailer',
      actions: [{ key: 'confirm_receipt', label: 'Confirm receipt of batch', available: false }],
    });
    window.history.replaceState({}, '', '/register');
    render(<App />);

    await fillRegistration('retailer');
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(await screen.findByRole('heading', { name: 'Retailer workspace' })).toBeTruthy();
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(accountService.registerAccount).toHaveBeenCalledTimes(1);
  });

  it('a duplicate username from the server is shown against the username field', async () => {
    accountService.registerAccount.mockRejectedValue(
      apiError(409, 'That username is already taken.', { username: 'This username is already taken. Choose another.' }),
    );
    window.history.replaceState({}, '', '/register');
    render(<App />);

    await fillRegistration('farmer');
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect((await screen.findByRole('alert')).textContent).toContain('This username is already taken.');
    expect(screen.getByLabelText('Username').value).toBe('ravi.retail');
    expect(screen.queryByTestId('active-role')).toBeNull();
  });

  it('sign-in and registration link to each other', async () => {
    window.history.replaceState({}, '', '/register');
    render(<App />);

    fireEvent.click(await screen.findByRole('link', { name: 'Sign In' }));

    expect(await screen.findByRole('heading', { name: 'Welcome Back' })).toBeTruthy();
    expect(window.location.pathname).toBe('/sign-in');
  });
});
